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
    otp_max_attempts: int = 5
    otp_sender: str = "console"
    jwt_secret: str = "dev-only-change-me-in-production"
    cors_origins: str = "http://localhost,http://127.0.0.1,null"

    smtp_host: str = ""
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_use_tls: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
