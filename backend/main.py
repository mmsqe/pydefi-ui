"""
DeFi dashboard FastAPI application.

Start with:
    DB_PATH=/path/to/pools.db uvicorn backend.main:app --reload
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.routers import factories, indexer, pools, stats, swap

app = FastAPI(title="DeFi Dashboard API", version="0.1.0")

# ---------------------------------------------------------------------------
# CORS — allow all origins for local development
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(stats.router, prefix="/api")
app.include_router(pools.router, prefix="/api")
app.include_router(factories.router, prefix="/api")
app.include_router(indexer.router, prefix="/api")
app.include_router(swap.router, prefix="/api")


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health() -> dict:
    """Liveness probe."""
    return {"status": "ok"}
