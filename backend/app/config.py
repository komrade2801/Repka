from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "sqlite:///./repka.db"
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    # Claude 3.5 Sonnet is retired on OpenRouter; use current Sonnet (override via OPENROUTER_MODEL).
    openrouter_model: str = "anthropic/claude-sonnet-4.6"


@lru_cache
def get_settings() -> Settings:
    return Settings()
