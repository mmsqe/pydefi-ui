// Matches backend _pool_to_dict() response exactly
export interface Pool {
  pool_address: string;
  protocol: string;
  chain_id: number;
  token0_address: string;
  token0_symbol: string;
  token0_decimals: number;
  token1_address: string;
  token1_symbol: string;
  token1_decimals: number;
  fee_bps: number;
  // Only present on GET /api/pools/{address}
  last_indexed_block?: number | null;
}

// Matches backend _factory_to_dict() response
export interface Factory {
  factory_address: string;
  protocol: string;
  chain_id: number;
  last_indexed_block?: number | null;
  pools_discovered?: number;
}

export interface PoolHistoryItem {
  block_number: number;
  timestamp?: number;
  price?: number | null;
  reserve0_human?: number | null;
  reserve1_human?: number | null;
  sqrt_price_x96?: string | null;
  liquidity?: string | null;
  tick?: number | null;
  amount0?: string | null;
  amount1?: string | null;
  tx_hash?: string;
}

export type PoolHistory = PoolHistoryItem[];

// Matches GET /api/stats response
export interface Stats {
  pools: number;
  factories: number;
  v2_events: number;
  v3_events: number;
  latest_block?: number | null;
}

// Matches GET /api/indexer/state response (list)
export interface IndexerStateItem {
  address: string;
  last_indexed_block: number;
}

export interface RunBackfillBody {
  pool_address?: string;
  from_block: number;
  to_block?: number;
  batch_size?: number;
}

// ── Swap ─────────────────────────────────────────────────────────────────────

/** Mirrors pydefi's Token dataclass — sent as token_in / token_out in swap requests. */
export interface TokenRef {
  address: string;
  symbol: string;
  decimals: number;
  chain_id: number;
}

// ── Yields ───────────────────────────────────────────────────────────────────

/** Matches backend ``_token_to_dict`` and ``_token_from_body``. */
export interface YieldToken {
  chain_id: number;
  address: string;
  symbol: string;
  decimals: number;
}

/** Matches backend ``_market_to_dict`` — sent back verbatim to ``/yields/route``. */
export interface YieldMarket {
  market_id: string;
  protocol: "aave_v3" | "compound_v3" | "morpho" | "aave_v4";
  chain_id: number;
  token: YieldToken;
  supply_apy: string;          // Decimal-string, e.g. "0.0345"
  utilization: string;
  available_liquidity: string; // raw sub-units
  available_liquidity_human: string;
}

export interface YieldPosition {
  market: YieldMarket;
  balance: string;        // raw sub-units
  balance_human: string;
}

export type YieldStrategy = "supply_then_bridge" | "withdraw_then_supply" | "bridge_then_supply";
export type YieldStepKind = "approve" | "supply" | "withdraw" | "bridge";

export interface YieldTx {
  to: string;
  data: string;
  value: string;
  gas: string;
}

export interface YieldStep {
  kind: YieldStepKind;
  chain_id: number;
  tx: YieldTx;
}

export interface YieldRoute {
  route_id: string;
  strategy: YieldStrategy;
  source_chain: number;
  target_chain: number | null;
  target_market: YieldMarket | null;
  steps: YieldStep[];
}

export interface BuildYieldRouteRequest {
  strategy: YieldStrategy;
  user: string;
  amount_in: { token: YieldToken; amount: string };
  target_market: YieldMarket;
  source_market?: YieldMarket;
  target_chain?: number;
}

export interface SwapRequest {
  token_in: TokenRef;
  token_out: TokenRef;
  amount_in: string;     // human-readable, e.g. "0.1"
  is_native_in?: boolean;
  // multi-hop routing (routing-lab): explicit waypoints + optional split fractions
  path?: TokenRef[];
  split_fractions_bps?: number[];
  // candidate-discovery solver. "hop_dp" (default) is the hop-bounded DP;
  // "hermes" is the treewidth-parameterized SSSP (no hop cap, finds long-tail
  // routes the DP misses, slower per query at small graph sizes).
  solver?: "hop_dp" | "hermes";
  // hop cap for the hop_dp solver on the non-waypoint full-route flow
  // (default 3, range 1–5). Beyond 5, switch to solver=hermes.
  max_hops?: number;
  // build-only fields
  slippage_bps?: number;
  sender?: string;
}
