from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "my-tech-lab-backend"
    environment: str = "development"
    database_url: str = "postgresql+psycopg://mytechlab:mytechlab@localhost:5432/mytechlab"

    access_token_ttl_minutes: int = 30
    refresh_token_ttl_days: int = 30
    otp_ttl_seconds: int = 600


@lru_cache
def get_settings() -> Settings:
    return Settings()
