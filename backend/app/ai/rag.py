from typing import List, Optional, Dict, Any
from uuid import UUID
import httpx
import re
from app.config import settings
from app.ai.qdrant_store import qdrant_store


class RAGPipeline:
    """
    RAG (Retrieval-Augmented Generation) pipeline for document-based Q&A.
    Retrieval is done against the shared Qdrant store that is populated
    during document upload.
    """

    # PDF pages are tagged into the extracted text as "[Trang N]"; chunks
    # overlap, so the LAST marker inside a chunk is the page its ending
    # (the most-cited) content came from.
    _PAGE_MARKER = re.compile(r"\[Trang (\d+)\]")

    def __init__(self):
        self.qdrant_url = settings.qdrant_url
        self.collection_name = settings.qdrant_collection_name
        self.embedding_dimension = settings.embedding_dimension

    @classmethod
    def _page_of(cls, result: Dict[str, Any]) -> Optional[str]:
        """Best-effort real page number for a chunk.

        Qdrant only stores a chunk_index; the true page lives inside the
        text as a "[Trang N]" marker. Prefer that, fall back to the index.
        """
        content = result.get("content") or ""
        markers = cls._PAGE_MARKER.findall(content)
        if markers:
            return str(markers[-1])
        # Non-PDF documents have no page markers; don't fake a page.
        return None

    async def search_documents(
        self,
        query: str,
        user_id: UUID,
        document_ids: Optional[List[UUID]] = None,
        limit: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Search for relevant document chunks in Qdrant.

        Results are already similarity-ranked, so no separate rerank step
        (or dependency on the AI worker) is required.
        """
        results = await qdrant_store.search(
            query=query,
            user_id=user_id,
            document_ids=document_ids,
            limit=limit,
        )

        # Qdrant can return points from documents that no longer exist (a
        # fast delete race); keep the list, downstream filtering is cheap.
        return [r for r in results if r.get("content")]

    async def _generate_embedding(self, text: str) -> List[float]:
        """Generate a query embedding using the configured provider."""
        vectors = await qdrant_store.embedding.embed([text])
        return vectors[0]

    def build_context(
        self,
        query: str,
        search_results: List[Dict[str, Any]]
    ) -> str:
        """
        Build context string from search results for LLM.
        """
        if not search_results:
            return ""

        context_parts = []
        context_parts.append("=== TÀI LIỆU THAM KHẢO ===\n")

        for i, result in enumerate(search_results, 1):
            context_parts.append(f"\n[Tài liệu {i}]")
            context_parts.append(f"Tên: {result.get('document_name', 'N/A')}")
            context_parts.append(f"Trang: {self._page_of(result) or 'không rõ'}")
            context_parts.append(f"Nội dung: {result.get('content', '')}")

        return "\n".join(context_parts)

    def extract_sources(
        self,
        search_results: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Extract source citations from search results."""
        sources = []
        for result in search_results:
            sources.append({
                "document_id": result.get("document_id"),
                "document_name": result.get("document_name"),
                "page": self._page_of(result),
                "chunk_id": result.get("id"),
                # Relative path of the stored figure when this chunk is a
                # figure caption; the UI builds the /api/documents/figures URL.
                "figure": result.get("figure"),
                "content_preview": (
                    result.get("content", "")[:200] + "..."
                    if len(result.get("content", "")) > 200
                    else result.get("content", "")
                )
            })
        return sources
