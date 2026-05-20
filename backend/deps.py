"""
Shared FastAPI dependencies.

Provides a cached PoolIndexer instance and a helper to read RPC_URL from
the environment.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Optional

from pydefi.indexer import PoolIndexer
from web3 import AsyncWeb3


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


@lru_cache(maxsize=1)
def get_w3s() -> dict[int, AsyncWeb3]:
    """Per-chain ``AsyncWeb3`` map driven by env.

    ``RPC_URLS`` (preferred) is a JSON dict of ``{chain_id: url}``, e.g.
    ``RPC_URLS='{"1":"https://eth.llama","8453":"https://base.llama"}'``.
    Falls back to single ``RPC_URL`` + ``CHAIN_ID`` (default ``1``) when
    ``RPC_URLS`` is unset. Returns ``{}`` if no source is configured —
    the yields router treats this as "no chains available".
    """
    raw = os.environ.get("RPC_URLS")
    if raw:
        mapping = json.loads(raw)
        return {int(cid): AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(url)) for cid, url in mapping.items()}
    url = os.environ.get("RPC_URL")
    if url:
        chain_id = int(os.environ.get("CHAIN_ID", "1"))
        return {chain_id: AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(url))}
    return {}
