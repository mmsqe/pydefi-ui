"""
Shared FastAPI dependencies.

Provides a cached PoolIndexer instance and a helper to read RPC_URL from
the environment.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Optional

from pydefi.indexer import PoolIndexer


@lru_cache(maxsize=1)
def get_indexer() -> PoolIndexer:
    """Return a singleton PoolIndexer backed by the configured SQLite database.

    Set the ``DB_PATH`` environment variable to the path of the SQLite file,
    e.g. ``DB_PATH=/data/pools.db uvicorn backend.main:app``.

    Raises ``RuntimeError`` if ``DB_PATH`` is not set.
    """
    db_path_env = os.environ.get("DB_PATH")
    if not db_path_env:
        raise RuntimeError(
            "DB_PATH environment variable is not set. "
            "Example: DB_PATH=/path/to/pools.db uvicorn backend.main:app --reload"
        )
    abs_path = os.path.abspath(db_path_env)
    return PoolIndexer(db_url=f"sqlite:///{abs_path}")


def get_rpc_url() -> Optional[str]:
    """Return the RPC endpoint URL from the ``RPC_URL`` environment variable."""
    return os.environ.get("RPC_URL") or None
