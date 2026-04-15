import type {
  Pool,
  Factory,
  PoolHistory,
  Stats,
  IndexerStateItem,
  AddV2PoolBody,
  AddV3PoolBody,
  AddFactoryBody,
  RunBackfillBody,
} from "./types";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Read endpoints ──────────────────────────────────────────────────────────

export async function fetchStats(): Promise<Stats> {
  return apiFetch<Stats>("/api/stats");
}

export async function fetchPools(params?: {
  chain_id?: number;
  protocol?: string;
  limit?: number;
  offset?: number;
}): Promise<Pool[]> {
  const qs = params
    ? "?" + new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      ).toString()
    : "";
  return apiFetch<Pool[]>(`/api/pools${qs}`);
}

export async function fetchPool(address: string): Promise<Pool> {
  return apiFetch<Pool>(`/api/pools/${address}`);
}

export async function fetchPoolHistory(
  address: string,
  limit = 200
): Promise<PoolHistory> {
  return apiFetch<PoolHistory>(`/api/pools/${address}/history?limit=${limit}`);
}

export async function fetchFactories(): Promise<Factory[]> {
  return apiFetch<Factory[]>("/api/factories");
}

export async function fetchIndexerState(): Promise<IndexerStateItem[]> {
  return apiFetch<IndexerStateItem[]>("/api/indexer/state");
}

// ── Write endpoints ─────────────────────────────────────────────────────────

export async function addV2Pool(body: AddV2PoolBody): Promise<Pool> {
  return apiFetch<Pool>("/api/pools/v2", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function addV3Pool(body: AddV3PoolBody): Promise<Pool> {
  return apiFetch<Pool>("/api/pools/v3", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function addFactory(body: AddFactoryBody): Promise<Factory> {
  return apiFetch<Factory>("/api/factories", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function runBackfill(
  body: RunBackfillBody
): Promise<{ message: string; task_id?: string }> {
  return apiFetch<{ message: string; task_id?: string }>("/api/indexer/backfill", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── SWR fetcher ─────────────────────────────────────────────────────────────

export const swrFetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
};
