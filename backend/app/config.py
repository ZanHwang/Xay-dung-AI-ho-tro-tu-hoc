from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Accepted for older .env files; the worker is no longer used.
    ai_worker_url: str = ""
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
    openai_embedding_api_key: str = ""
    gemini_embedding_api_key: str = ""


    # Object Storage
    object_storage_url: str = "http://localhost:9000"
    object_storage_access_key: str = "minioadmin"
    object_storage_secret_key: str = "minioadmin"
    object_storage_bucket: str = "documents"

    # LLM
    llm_provider: str = "openai"
    openai_api_key: str = ""
    openai_model: str = "gpt-4-turbo-preview"
    # Vision model (OCR of scanned pages, figure captions, and query-time
    # figure inspection). Must support images - gpt-4o-mini does, and it is
    # the cheapest vision-capable model in the GPT-4o family.
    vision_model: str = "gpt-4o-mini"
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-3-sonnet-20240229"

    # Conversation memory: how many recent messages are fed to the LLM as
    # context on each call. Tune via ASK_MEMORY_MESSAGES in .env.
    ask_memory_messages: int = 30

    # Embedding
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dimension: int = 384

    # Reranker
    reranker_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"

    # Sandbox
    sandbox_enabled: bool = True
    sandbox_timeout_seconds: int = 10

    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
