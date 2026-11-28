from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql://user:password@localhost:5432/ai_tutor"

    # JWT
    secret_key: str = "change-this-secret-key"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30

    # Qdrant
    qdrant_url: str = "http://localhost:6333"
    qdrant_collection_name: str = "ai-assisted-learning-document"
    qdrant_api_key: str = ""

    # File storage (see app/services/storage.py). With all four R2 values set,
    # files go to Cloudflare R2 (shared by every machine/server); otherwise to
    # `local_storage_dir` on this machine (tests, or before R2 is set up).
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket: str = ""
    local_storage_dir: str = "storage"

    # Allowed browser origins (comma-separated) - add the deployed frontend's
    # domain here in production.
    cors_origins: str = "http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:3000"

    # LLM
    llm_provider: str = "openai"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    # Vision model (OCR of scanned pages, figure captions, and query-time
    # figure inspection). Must support images - gpt-4o-mini does, and it is
    # the cheapest vision-capable model in the GPT-4o family.
    vision_model: str = "gpt-4o-mini"
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-3-sonnet-20240229"

    # Conversation memory: how many recent messages are fed to the LLM as
    # context on each call. Tune via ASK_MEMORY_MESSAGES in .env.
    ask_memory_messages: int = 30

    # Embedding (Google Gemini API - see app/ai/embedding.py). The dimension
    # must match the existing Qdrant collection's vectors.
    gemini_embedding_api_key: str = ""
    embedding_model: str = "gemini-embedding-001"
    embedding_dimension: int = 768

    class Config:
        env_file = ".env"
        case_sensitive = False
        # A teammate's older .env may still carry keys this version dropped
        # (OBJECT_STORAGE_*, AI_WORKER_URL, ...) - ignore them instead of
        # refusing to start.
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
