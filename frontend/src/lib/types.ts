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

// Matches backend AddPoolBody exactly
export interface AddPoolBody {
  pool_address: string;
  protocol: string;
  token0_address: string;
  token0_symbol: string;
  token0_decimals: number;
  token1_address: string;
  token1_symbol: string;
  token1_decimals: number;
  chain_id: number;
  fee_bps: number;
}

export type AddV2PoolBody = AddPoolBody;
export type AddV3PoolBody = AddPoolBody;

export interface AddFactoryBody {
  factory_address: string;
  protocol: string;
  chain_id: number;
}

export interface RunBackfillBody {
  pool_address?: string;
  from_block: number;
  to_block?: number;
  batch_size?: number;
}
