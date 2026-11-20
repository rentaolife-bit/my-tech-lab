from fastapi import FastAPI

from .config import get_settings
from .routers import auth, notes


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name)

    @app.get("/api/v1/health")
    def health() -> dict[str, str]:
        return {
            "status": "ok",
            "service": settings.app_name,
            "environment": settings.environment,
        }

    app.include_router(auth.router)
    app.include_router(notes.router)

    return app


app = create_app()
