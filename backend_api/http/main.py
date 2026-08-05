"""FastAPI application entry point."""

from contextlib import asynccontextmanager
import traceback

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend_api.db.session import init_db
from backend_api.http.config import API_PREFIX, CORS_ORIGINS, UPLOADS_DIR
from backend_api.http.middleware.error_tracking import ErrorTrackingMiddleware
from backend_api.http.middleware.request_metrics import RequestMetricsMiddleware
from backend_api.http.routers import (
    admin,
    auth,
    blog,
    bug_reports,
    errors,
    health,
    site,
    survey,
)
from backend_api.http.services import error_tracking_service


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    try:
        from backend_api.db.session import SessionLocal

        db = SessionLocal()
        try:
            error_tracking_service.refresh_config_cache(db)
        finally:
            db.close()
    except Exception:
        error_tracking_service.set_cached_config(error_tracking_service.ErrorTrackingConfig())
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="LabCD Admin API",
        description="FastAPI backend for LabCD admin platform (auth + admin modules).",
        version="1.0.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(ErrorTrackingMiddleware)
    app.add_middleware(RequestMetricsMiddleware)

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        if error_tracking_service.should_track("backend") and not getattr(
            request.state, "error_tracked_as_backend", False
        ):
            path = request.url.path
            if not error_tracking_service.should_skip_path(path):
                request.state.error_tracked_as_backend = True
                error_tracking_service.record_error_best_effort(
                    source="backend",
                    message=f"{type(exc).__name__}: {exc}",
                    stack_trace="".join(
                        traceback.format_exception(type(exc), exc, exc.__traceback__)
                    ),
                    path=path,
                    method=request.method,
                    status_code=500,
                    user_agent=request.headers.get("user-agent"),
                )
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"},
        )

    app.include_router(health.router, prefix=API_PREFIX)
    app.include_router(auth.router, prefix=API_PREFIX)
    app.include_router(admin.router, prefix=API_PREFIX)
    app.include_router(site.router, prefix=API_PREFIX)
    app.include_router(blog.router, prefix=API_PREFIX)
    app.include_router(survey.router, prefix=API_PREFIX)
    app.include_router(bug_reports.router, prefix=API_PREFIX)
    app.include_router(errors.router, prefix=API_PREFIX)
    app.mount(f"{API_PREFIX}/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")
    return app


app = create_app()
