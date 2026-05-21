"""
Yields-as-a-Service routes — wraps :mod:`pydefi.yields`.

GET  /api/yields/markets          — enumerate Aave V3 + Compound V3 + Morpho + Aave V4 supply markets
GET  /api/yields/positions        — user's non-zero supply balances
POST /api/yields/route            — build a sequenced execution plan
GET  /api/yields/rebalance/best   — best same-chain rebalance, or null

Bridge-bearing strategies (``bridge_then_supply``, cross-chain
``withdraw_then_supply``) are not wired yet — a bridge instance has to be
constructed per source/target pair and that surface isn't exposed here yet.
"""

from __future__ import annotations

from decimal import Decimal
from typing import get_args

from fastapi import APIRouter, HTTPException, Query
from pydefi._utils import decode_address, encode_address
from pydefi.types import Address, Token, TokenAmount
from pydefi.yields import (
    Position,
    YieldMarket,
    YieldRoute,
    build_yield_route,
    find_best_rebalance,
    get_positions,
    get_yield_markets,
)
from pydefi.yields.router import Protocol, Strategy

from backend.deps import get_w3s

router = APIRouter()

_VALID_PROTOCOLS: tuple[Protocol, ...] = get_args(Protocol)
_VALID_STRATEGIES: tuple[Strategy, ...] = get_args(Strategy)


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------


def _token_to_dict(token: Token) -> dict:
    return {
        "chain_id": token.chain_id,
        "address": encode_address(token.address, token.chain_id),
        "symbol": token.symbol,
        "decimals": token.decimals,
    }


def _market_to_dict(market: YieldMarket) -> dict:
    return {
        "market_id": market.market_id,
        "protocol": market.protocol,
        "chain_id": market.chain_id,
        "token": _token_to_dict(market.token),
        "supply_apy": str(market.supply_apy),
        "utilization": str(market.utilization),
        "available_liquidity": str(market.available_liquidity.amount),
        "available_liquidity_human": str(market.available_liquidity.human_amount),
    }


def _position_to_dict(position: Position) -> dict:
    return {
        "market": _market_to_dict(position.market),
        "balance": str(position.balance.amount),
        "balance_human": str(position.balance.human_amount),
    }


def _tx_to_jsonable(tx: dict) -> dict:
    """pydefi's tx builders return ``to`` as ``Address`` (a bytes subclass) and
    sometimes ``data`` as bytes — both must become ``0x...`` strings before
    pydantic can JSON-encode them."""
    out: dict = {}
    for k, v in tx.items():
        if isinstance(v, (bytes, bytearray, memoryview)):
            out[k] = "0x" + bytes(v).hex()
        else:
            out[k] = v
    return out


def _route_to_dict(route: YieldRoute) -> dict:
    return {
        "route_id": route.route_id,
        "strategy": route.strategy,
        "source_chain": route.source_chain,
        "target_chain": route.target_chain,
        "target_market": _market_to_dict(route.target_market) if route.target_market else None,
        "steps": [
            {
                "kind": step.kind,
                "chain_id": step.chain_id,
                "tx": _tx_to_jsonable(step.tx),
            }
            for step in route.steps
        ],
    }


# ---------------------------------------------------------------------------
# Request parsing
# ---------------------------------------------------------------------------


def _parse_csv_ints(raw: str | None) -> list[int] | None:
    if not raw:
        return None
    try:
        return [int(x) for x in raw.split(",") if x.strip()]
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"invalid integer list: {raw!r} ({exc})")


def _parse_protocols(raw: str | None) -> list[Protocol] | None:
    if not raw:
        return None
    out: list[Protocol] = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        if item not in _VALID_PROTOCOLS:
            raise HTTPException(
                status_code=422,
                detail=f"unknown protocol {item!r}; valid: {list(_VALID_PROTOCOLS)}",
            )
        out.append(item)  # type: ignore[arg-type]
    return out or None


def _token_from_body(data: dict) -> Token:
    try:
        chain_id = int(data["chain_id"])
        return Token(
            chain_id=chain_id,
            address=Address(decode_address(str(data["address"]), chain_id)),
            symbol=str(data["symbol"]),
            decimals=int(data["decimals"]),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"invalid token object: {exc}")


def _market_from_body(data: dict) -> YieldMarket:
    """Rehydrate a market the client received from ``/yields/markets``.

    Metric fields (APY / utilization / liquidity) are kept as-is — the
    router doesn't read them during plan construction; they round-trip
    only so the response echoes the same market identity."""
    try:
        token = _token_from_body(data["token"])
        protocol = str(data["protocol"])
        if protocol not in _VALID_PROTOCOLS:
            raise HTTPException(status_code=422, detail=f"unknown protocol: {protocol!r}")
        chain_id = int(data["chain_id"])
        return YieldMarket(
            protocol=protocol,  # type: ignore[arg-type]
            chain_id=chain_id,
            token=token,
            supply_apy=Decimal(str(data.get("supply_apy", "0"))),
            utilization=Decimal(str(data.get("utilization", "0"))),
            available_liquidity=TokenAmount(token, int(data.get("available_liquidity", 0) or 0)),
            market_id=str(data.get("market_id") or f"{protocol}:{chain_id}:{token.symbol}"),
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"invalid market object: {exc}")


def _require_chain(w3s: dict, chain_id: int) -> None:
    if chain_id not in w3s:
        raise HTTPException(
            status_code=503,
            detail=(
                f"no RPC configured for chain {chain_id}. Set RPC_URLS env var, "
                f'e.g. RPC_URLS=\'{{"1":"https://..."}}\'.'
            ),
        )


def _parse_user(raw: str) -> Address:
    try:
        return Address(decode_address(raw, 1))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"invalid user address: {raw!r} ({exc})")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/yields/markets")
async def list_markets(
    token_symbol: str = Query(..., description="Token ticker, e.g. USDC"),
    chains: str | None = Query(None, description="Comma-separated chain ids (default: all known)"),
    protocols: str | None = Query(None, description=f"Comma-separated subset of {list(_VALID_PROTOCOLS)}"),
) -> list[dict]:
    """Enumerate active Aave V3 + Compound V3 + Morpho + Aave V4 supply markets
    for *token_symbol*, sorted by APY descending. Chains without a configured
    RPC are skipped."""
    w3s = get_w3s()
    markets = await get_yield_markets(
        token_symbol,
        w3s,
        chains=_parse_csv_ints(chains),
        protocols=_parse_protocols(protocols),
    )
    return [_market_to_dict(m) for m in markets]


@router.get("/yields/positions")
async def list_positions(
    user: str = Query(..., description="EVM address (0x...)"),
    token_symbol: str = Query(..., description="Token ticker, e.g. USDC"),
    chains: str | None = Query(None),
    protocols: str | None = Query(None),
) -> list[dict]:
    """*user*'s non-zero supply positions in *token_symbol*, balance descending."""
    w3s = get_w3s()
    positions = await get_positions(
        _parse_user(user),
        token_symbol,
        w3s,
        chains=_parse_csv_ints(chains),
        protocols=_parse_protocols(protocols),
    )
    return [_position_to_dict(p) for p in positions]


@router.post("/yields/route")
async def build_route(body: dict) -> dict:
    """Compile a YieldRoute the client can sign step-by-step.

    Body keys:
      - ``strategy``: ``"supply_then_bridge"`` | ``"withdraw_then_supply"``
        (bridge-bearing strategies aren't wired yet — see module docstring)
      - ``user``: 0x address
      - ``amount_in``: ``{token: {chain_id, address, symbol, decimals}, amount: "<raw>"}``
      - ``target_market``: market object as returned by ``/yields/markets``
      - ``source_market``: required for ``withdraw_then_supply``
      - ``target_chain``: optional, for ``supply_then_bridge`` bookkeeping
    """
    strategy = str(body.get("strategy", ""))
    if strategy not in _VALID_STRATEGIES:
        raise HTTPException(status_code=422, detail=f"unknown strategy: {strategy!r}; valid: {list(_VALID_STRATEGIES)}")
    if strategy == "bridge_then_supply":
        raise HTTPException(
            status_code=501,
            detail="bridge_then_supply requires a configured LucidBridge — not wired into the UI surface yet.",
        )

    user = _parse_user(str(body.get("user", "")))
    amount_in_raw = body.get("amount_in") or {}
    token = _token_from_body(amount_in_raw.get("token") or {})
    try:
        amount = int(amount_in_raw["amount"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"amount_in.amount must be an integer string: {exc}")
    if amount <= 0:
        raise HTTPException(status_code=422, detail="amount_in.amount must be positive.")

    target_market = _market_from_body(body.get("target_market") or {})
    source_market = _market_from_body(body["source_market"]) if body.get("source_market") else None

    if strategy == "withdraw_then_supply":
        if source_market is None:
            raise HTTPException(status_code=422, detail="withdraw_then_supply requires source_market")
        if source_market.chain_id != target_market.chain_id:
            raise HTTPException(
                status_code=501,
                detail="cross-chain withdraw_then_supply requires a LucidBridge — not wired into the UI surface yet.",
            )

    w3s = get_w3s()
    _require_chain(w3s, target_market.chain_id)
    if source_market is not None:
        _require_chain(w3s, source_market.chain_id)

    target_chain = body.get("target_chain")
    target_chain_int = int(target_chain) if target_chain is not None else None

    try:
        route = await build_yield_route(
            strategy,  # type: ignore[arg-type]
            user=user,
            amount_in=TokenAmount(token, amount),
            w3s=w3s,
            target_market=target_market,
            source_market=source_market,
            target_chain=target_chain_int,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return _route_to_dict(route)


@router.get("/yields/rebalance/best")
async def best_rebalance(
    user: str = Query(...),
    token_symbol: str = Query(...),
    horizon_seconds: int = Query(30 * 86400, ge=1),
    min_apy_gain_bps: int = Query(50, ge=0),
    chains: str | None = Query(None),
    protocols: str | None = Query(None),
) -> dict:
    """Most profitable same-chain rebalance for *user*, or ``{"route": null}``
    when no candidate clears ``min_apy_gain_bps``."""
    w3s = get_w3s()
    user_addr = _parse_user(user)
    chain_filter = _parse_csv_ints(chains)
    proto_filter = _parse_protocols(protocols)
    positions = await get_positions(user_addr, token_symbol, w3s, chains=chain_filter, protocols=proto_filter)
    if not positions:
        return {"route": None, "reason": "no positions"}
    markets = await get_yield_markets(token_symbol, w3s, chains=chain_filter, protocols=proto_filter)
    route = await find_best_rebalance(
        user_addr,
        positions=positions,
        markets=markets,
        w3s=w3s,
        horizon_seconds=horizon_seconds,
        min_apy_gain_bps=min_apy_gain_bps,
    )
    return {"route": _route_to_dict(route) if route is not None else None}
