from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routers import (
    auth,
    daily_focus,
    data_center,
    documents,
    ideas,
    knowledge,
    notes,
    tasks,
)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name)
    origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/v1/health")
    def health() -> dict[str, str]:
        return {
            "status": "ok",
            "service": settings.app_name,
            "environment": settings.environment,
        }

    app.include_router(auth.router)
    app.include_router(notes.router)
    app.include_router(tasks.router)
    app.include_router(ideas.router)
    app.include_router(documents.router)
    app.include_router(daily_focus.router)
    app.include_router(data_center.router)
    app.include_router(knowledge.router)

    return app


app = create_app()
