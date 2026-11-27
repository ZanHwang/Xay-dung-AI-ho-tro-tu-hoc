import asyncio
from typing import Any, Dict, List, Optional, Optional
from uuid import UUID, uuid4

from qdrant_client import AsyncQdrantClient, models
from qdrant_client.http.exceptions import ApiException

from app.ai.embedding import EmbeddingProvider
from app.config import settings

# Retry budget for talking to Qdrant Cloud - a network blip (timeout,
# connection reset...) during upsert used to fail the whole document
# immediately with no retry at all.
_UPSERT_MAX_ATTEMPTS = 5
_UPSERT_BACKOFF_BASE_SECONDS = 2.0
_UPSERT_BACKOFF_CAP_SECONDS = 30.0


class QdrantStore:
    """Stores and retrieves document chunks in Qdrant Cloud."""

    def __init__(self) -> None:
        self.client = AsyncQdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key or None,
            # Without an explicit timeout this client has none (can hang
            # indefinitely on a dropped connection) - would leave a document
            # stuck at "embedding" even with a perfectly healthy server
            # process (no restart involved). The retry loop around upsert()
            # below bounds total attempts; this bounds each individual one.
            timeout=30,
        )
        self.collection = settings.qdrant_collection_name
        self.embedding = EmbeddingProvider()

    async def ensure_collection(self) -> None:
        """Create the collection (and its payload indexes) if missing.

        Qdrant requires a payload index on any key used in a filter, so we
        index ``user_id`` and ``document_id`` here. This is idempotent and
        runs for both new and pre-existing collections.
        """
        exists = await self.client.collection_exists(self.collection)
        if not exists:
            await self.client.create_collection(
                collection_name=self.collection,
                vectors_config=models.VectorParams(
                    size=settings.embedding_dimension,
                    distance=models.Distance.COSINE,
                ),
            )

        for key in ("user_id", "document_id"):
            try:
                await self.client.create_payload_index(
                    collection_name=self.collection,
                    field_name=key,
                    field_schema=models.PayloadSchemaType.KEYWORD,
                )
            except Exception:
                # Index already exists (or the field is empty on a brand-new
                # collection) - safe to ignore.
                pass

    async def store_chunks(
        self,
        document_id: UUID,
        user_id: UUID,
        document_name: str,
        chunks: List[str],
        figures: Optional[List[str]] = None,
    ) -> int:
        """Embed and upsert all chunks for a document. Returns chunk count.

        ``figures`` is an optional parallel list: a relative path (served by
        the figures endpoint) when a chunk is a figure caption, else None.
        The UI uses it to show the actual image next to the source line.
        """
        if not chunks:
            return 0

        vectors = await self.embedding.embed_batched(chunks)
        points = [
            models.PointStruct(
                id=str(uuid4()),
                vector=vector,
                payload={
                    "document_id": str(document_id),
                    "user_id": str(user_id),
                    "document_name": document_name,
                    "chunk_index": index,
                    "content": text,
                    "figure": (figures[index] if figures and index < len(figures) else None),
                },
            )
            for index, (text, vector) in enumerate(zip(chunks, vectors))
        ]

        last_error: Exception | None = None
        for attempt in range(1, _UPSERT_MAX_ATTEMPTS + 1):
            try:
                await self.client.upsert(collection_name=self.collection, points=points)
                return len(points)
            except ApiException as exc:
                # Network blip or bad response talking to Qdrant Cloud -
                # retry with backoff instead of failing the whole document
                # on one transient failure.
                last_error = exc
                if attempt == _UPSERT_MAX_ATTEMPTS:
                    raise RuntimeError(
                        f"Qdrant: không lưu được vector sau {_UPSERT_MAX_ATTEMPTS} lần thử "
                        f"({type(exc).__name__}: {exc})"
                    ) from exc
                await asyncio.sleep(min(_UPSERT_BACKOFF_BASE_SECONDS ** attempt, _UPSERT_BACKOFF_CAP_SECONDS))
        # Unreachable: the loop above always returns or raises.
        raise RuntimeError(f"Qdrant: không lưu được vector ({last_error})")

    async def search(
        self,
        query: str,
        user_id: UUID,
        document_ids: Optional[List[UUID]] = None,
        limit: int = 5,
        score_threshold: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        """Find the most relevant chunks for a query within a user's docs.

        `score_threshold` (cosine similarity, same scale as the `score` this
        returns) drops anything below it - use it when the caller wants
        "however many are actually relevant" rather than a fixed top-N.
        """
        await self.ensure_collection()

        vector = (await self.embedding.embed([query]))[0]
        conditions = [
            models.FieldCondition(
                key="user_id", match=models.MatchValue(value=str(user_id))
            ),
        ]
        if document_ids:
            conditions.append(
                models.FieldCondition(
                    key="document_id",
                    match=models.MatchAny(any=[str(doc_id) for doc_id in document_ids]),
                )
            )

        response = await self.client.query_points(
            collection_name=self.collection,
            query=vector,
            query_filter=models.Filter(must=conditions),
            limit=limit,
            score_threshold=score_threshold,
            with_payload=True,
        )

        results = []
        for point in response.points:
            payload = point.payload or {}
            results.append(
                {
                    "id": str(point.id),
                    "document_id": payload.get("document_id"),
                    "document_name": payload.get("document_name"),
                    "page": payload.get("chunk_index"),
                    "content": payload.get("content", ""),
                    # Relative path of the stored figure (None for text chunks).
                    "figure": payload.get("figure"),
                    "score": float(point.score or 0.0),
                }
            )
        return results

    async def delete_document(self, document_id: UUID, user_id: UUID) -> None:
        """Remove all chunks belonging to a document - called on document
        delete, and before re-embedding (process_document) so a re-run never
        leaves duplicate chunks from an earlier attempt alongside the new
        ones. A document with nothing stored yet is a harmless no-op.

        Same retry budget as store_chunks() - a transient network blip here
        must not fail the whole (re-)processing attempt before it even gets
        to upsert the new chunks.
        """
        for attempt in range(1, _UPSERT_MAX_ATTEMPTS + 1):
            try:
                await self.client.delete(
                    collection_name=self.collection,
                    points_selector=models.Filter(
                        must=[
                            models.FieldCondition(
                                key="document_id",
                                match=models.MatchValue(value=str(document_id)),
                            ),
                            models.FieldCondition(
                                key="user_id",
                                match=models.MatchValue(value=str(user_id)),
                            ),
                        ]
                    ),
                )
                return
            except ApiException as exc:
                if attempt == _UPSERT_MAX_ATTEMPTS:
                    raise RuntimeError(
                        f"Qdrant: không xóa được dữ liệu cũ sau {_UPSERT_MAX_ATTEMPTS} lần thử "
                        f"({type(exc).__name__}: {exc})"
                    ) from exc
                await asyncio.sleep(min(_UPSERT_BACKOFF_BASE_SECONDS ** attempt, _UPSERT_BACKOFF_CAP_SECONDS))


qdrant_store = QdrantStore()
