from typing import List, Optional

import asyncio
import re

import httpx

from app.config import settings

# Transient HTTP status codes worth retrying (rate limits / upstream blips).
_RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}
_MAX_ATTEMPTS = 8
_BACKOFF_BASE_SECONDS = 2.0
_BACKOFF_CAP_SECONDS = 65.0
# Gemini 429s carry the wait as "Please retry in 55.1s" in the error message.
_RETRY_HINT_RE = re.compile(r"retry in\s+([\d.]+)\s*s", re.IGNORECASE)


def _retry_hint_seconds(response: "httpx.Response") -> Optional[float]:
    """Seconds Gemini asks us to wait, parsed from the 429 error message."""
    try:
        body = response.json()
        message = body.get("error", {}).get("message", "")
        match = _RETRY_HINT_RE.search(message)
        if match:
            return min(float(match.group(1)), _BACKOFF_CAP_SECONDS)
    except Exception:
        pass
    return None


def _backoff_seconds(attempt: int, response: "httpx.Response | None" = None) -> float:
    """Wait time before the next attempt.

    Honors a ``Retry-After`` header or the in-message "retry in Ns" hint that
    Gemini sends on 429s; otherwise exponential backoff (2s, 4s, 8s, ...)
    capped at 65s. ``attempt`` is 1-based.
    """
    if response is not None:
        raw = response.headers.get("Retry-After")
        if raw:
            try:
                return min(float(raw), _BACKOFF_CAP_SECONDS)
            except ValueError:
                pass
        hint = _retry_hint_seconds(response)
        if hint is not None:
            return hint
    return min(_BACKOFF_BASE_SECONDS ** attempt, _BACKOFF_CAP_SECONDS)


class EmbeddingProvider:
    """Generate text embeddings via the Google Gemini embeddings API."""

    API_URL = "https://generativelanguage.googleapis.com/v1beta/models"
    MAX_BATCH = 20  # Gemini batchEmbedContents caps at 20 requests/call

    def __init__(self):
        self.api_key = settings.gemini_embedding_api_key
        self.model = settings.embedding_model
        self.dimension = settings.embedding_dimension

    async def embed(self, texts: List[str]) -> List[List[float]]:
        """Embed a batch of texts (up to MAX_BATCH). Returns one vector each."""
        if not self.api_key:
            raise RuntimeError("GEMINI_EMBEDDING_API_KEY is not configured")

        url = f"{self.API_URL}/{self.model}:batchEmbedContents"
        payload = {
            "requests": [
                {
                    "model": f"models/{self.model}",
                    "content": {"parts": [{"text": t}]},
                    "outputDimensionality": self.dimension,
                }
                for t in texts
            ]
        }
        headers = {
            "x-goog-api-key": self.api_key,
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            response: httpx.Response | None = None
            last_error: Exception | None = None
            for attempt in range(1, _MAX_ATTEMPTS + 1):
                try:
                    response = await client.post(url, json=payload, headers=headers)
                except httpx.RequestError as exc:
                    # No response came back at all (timeout, connection reset,
                    # DNS blip...) - retry it exactly like a 5xx/429 response
                    # instead of failing the whole document on one network
                    # hiccup in the middle of a long pipeline.
                    last_error = exc
                    response = None
                    if attempt < _MAX_ATTEMPTS:
                        await asyncio.sleep(_backoff_seconds(attempt))
                    continue
                if response.status_code not in _RETRYABLE_STATUS:
                    break
                last_error = httpx.HTTPStatusError(
                    f"{response.status_code} from {url}",
                    request=response.request,
                    response=response,
                )
                # Transient failure (rate limit / blip) - wait and retry.
                if attempt < _MAX_ATTEMPTS:
                    await asyncio.sleep(_backoff_seconds(attempt, response))
            if response is None:
                # Every attempt failed at the network level before any
                # response came back.
                raise RuntimeError(
                    f"Gemini API: không kết nối được sau {_MAX_ATTEMPTS} lần thử "
                    f"({type(last_error).__name__}: {last_error})"
                ) from last_error
            if response.status_code >= 400:
                # Only mention the retry budget when we actually exhausted it
                # (a transient failure that kept failing); a first-try 4xx
                # (bad key, malformed request) should not claim retries.
                suffix = f" (đã thử {_MAX_ATTEMPTS} lần)" if last_error is not None else ""
                detail = ""
                try:
                    body = response.json()
                    detail = body.get("error", {}).get("message", "")
                except Exception:
                    pass
                raise httpx.HTTPStatusError(
                    f"Gemini API trả {response.status_code} {detail}{suffix}".strip(),
                    request=response.request,
                    response=response,
                )
            data = response.json()

        vectors = []
        for item in data["embeddings"]:
            # gemini-embedding-001 returns the vector at the top level of each
            # entry ("values"); newer models nest it under "value".
            if "values" in item:
                vectors.append(item["values"])
            elif "value" in item:
                vectors.append(item["value"])
            else:
                vectors.append(item["embedding"]["values"])
        return vectors

    async def embed_batched(self, texts: List[str]) -> List[List[float]]:
        """Embed many texts, splitting into Gemini-safe batch sizes."""
        if not texts:
            return []
        results: List[List[float]] = []
        for i in range(0, len(texts), self.MAX_BATCH):
            results.extend(await self.embed(texts[i : i + self.MAX_BATCH]))
        return results
