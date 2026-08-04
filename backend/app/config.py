from functools import lru_cache
import json
from typing import Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]


def _parse_cors_origins(value: Any) -> list[str]:
    if value is None or value == "":
        return list(_DEFAULT_CORS_ORIGINS)
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return list(_DEFAULT_CORS_ORIGINS)
        if text.startswith("["):
            parsed = json.loads(text)
            if not isinstance(parsed, list):
                raise ValueError("CORS_ORIGINS JSON must be an array of strings")
            return [str(item).strip() for item in parsed if str(item).strip()]
        return [part.strip() for part in text.split(",") if part.strip()]
    raise TypeError(f"Unsupported CORS_ORIGINS type: {type(value)!r}")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "sqlite:///./repka.db"
    cors_origins: list[str] = list(_DEFAULT_CORS_ORIGINS)

    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_model: str = "openai/gpt-4o-mini"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: Any) -> list[str]:
        return _parse_cors_origins(value)


@lru_cache
def get_settings() -> Settings:
    return Settings()
