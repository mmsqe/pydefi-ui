# pydefi-ui

Next.js 14 + FastAPI dashboard for the pydefi AMM pool indexer.

## Requirements

- Python ≥ 3.11, [uv](https://github.com/astral-sh/uv)
- Node.js ≥ 18, npm

## Quick start

### Backend

```bash
uv sync

# Start API server — DB_PATH is required
DB_PATH=/path/to/pools.db uv run uvicorn backend.main:app --reload
```

Optional: set `RPC_URL` for backfill operations.

```bash
DB_PATH=... RPC_URL=https://mainnet.infura.io/v3/<key> uv run uvicorn backend.main:app --reload
```

### Frontend

```bash
npm run dev        # from repo root, proxies /api/* → localhost:8000
```

Open [http://localhost:3000](http://localhost:3000).

## Wallet connection

Click **Connect Wallet** in the top-right. Any EIP-1193 browser wallet works (Rabby, MetaMask, etc.). The active chain is highlighted in the topbar.

## Project layout

```
backend/
  main.py          FastAPI app entry point
  deps.py          Shared dependencies (PoolIndexer singleton)
  routers/
    stats.py       GET /api/stats
    pools.py       GET/POST/DELETE /api/pools
    factories.py   GET/POST /api/factories
    indexer.py     GET/POST /api/indexer

frontend/
  src/
    app/           Next.js App Router pages
    components/    UI components (layout, wallet, charts)
    lib/           API client, wagmi config, types, utils
```

## Linting

```bash
uv run ruff format . && uv run ruff check --fix . && uv run ruff check . && uv run ruff format --check .
```
