"use client";

import { useParams } from "next/navigation";
import useSWR from "swr";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PriceChart } from "@/components/pools/price-chart";
import { swrFetcher } from "@/lib/api";
import {
  formatAddress,
  formatNumber,
  chainName,
  pairLabel,
} from "@/lib/utils";
import type { Pool, PoolHistory } from "@/lib/types";
import { ArrowLeft, ExternalLink, Copy, Check } from "lucide-react";
import { useState } from "react";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="text-muted hover:text-cyan transition-colors p-1 rounded"
      title="Copy address"
    >
      {copied ? <Check size={12} className="text-green" /> : <Copy size={12} />}
    </button>
  );
}

export default function PoolDetailPage() {
  const { address } = useParams<{ address: string }>();

  const { data: pool, isLoading: poolLoading, error: poolError } = useSWR<Pool>(
    address ? `${BASE}/api/pools/${address}` : null,
    swrFetcher
  );

  const { data: history, isLoading: historyLoading } = useSWR<PoolHistory>(
    address ? `${BASE}/api/pools/${address}/history?limit=200` : null,
    swrFetcher
  );

  if (poolLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted">
        Loading pool...
      </div>
    );
  }

  if (poolError || !pool) {
    return (
      <div className="max-w-3xl space-y-4">
        <Link
          href="/pools"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-cyan transition-colors"
        >
          <ArrowLeft size={14} /> Back to pools
        </Link>
        <Card>
          <CardContent className="py-12 text-center text-muted">
            Pool not found or API unavailable.
          </CardContent>
        </Card>
      </div>
    );
  }

  const pair = pairLabel(pool);
  const recentEvents = (history ?? []).slice(-50).reverse();

  // Compute stats from history
  const blockNums = (history ?? []).map((h) => h.block_number).filter(Boolean);
  const minBlock = blockNums.length ? Math.min(...blockNums) : null;
  const maxBlock = blockNums.length ? Math.max(...blockNums) : null;
  const currentPrice =
    history && history.length > 0
      ? history[history.length - 1].price
      : null;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Back link */}
      <Link
        href="/pools"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-cyan transition-colors"
      >
        <ArrowLeft size={14} /> Back to pools
      </Link>

      {/* Header */}
      <Card glow>
        <CardHeader>
          <div className="flex items-start gap-3 flex-wrap">
            <div>
              <h2 className="text-xl font-bold text-[#e8eaf0] mb-2">{pair}</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={(pool.protocol?.toLowerCase() as "v2" | "v3") ?? "muted"}>
                  {(pool.protocol ?? "?").toUpperCase()}
                </Badge>
                <Badge variant="muted">{chainName(pool.chain_id)}</Badge>
                {pool.fee_bps != null && (
                  <Badge variant="purple">{pool.fee_bps / 100}% fee</Badge>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted uppercase tracking-wider mb-1">Pool Address</p>
              <div className="flex items-center gap-1.5 font-mono text-xs text-[#e8eaf0]">
                <span>{pool.pool_address}</span>
                <CopyButton text={pool.pool_address} />
              </div>
            </div>
            <div>
              <p className="text-xs text-muted uppercase tracking-wider mb-1">Token 0</p>
              <span className="font-mono text-xs text-[#e8eaf0]">
                {pool.token0_symbol ? (
                  <span>
                    <span className="text-cyan mr-1">{pool.token0_symbol}</span>
                    <span className="text-muted">{formatAddress(pool.token0_address, 6)}</span>
                  </span>
                ) : (
                  formatAddress(pool.token0_address, 8)
                )}
              </span>
            </div>
            <div>
              <p className="text-xs text-muted uppercase tracking-wider mb-1">Token 1</p>
              <span className="font-mono text-xs text-[#e8eaf0]">
                {pool.token1_symbol ? (
                  <span>
                    <span className="text-cyan mr-1">{pool.token1_symbol}</span>
                    <span className="text-muted">{formatAddress(pool.token1_address, 6)}</span>
                  </span>
                ) : (
                  formatAddress(pool.token1_address, 8)
                )}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Current Price", value: currentPrice != null ? formatNumber(currentPrice, 6) : "—", color: "text-cyan" },
          { label: "Event Count", value: history?.length ?? "—", color: "text-purple" },
          { label: "First Block", value: minBlock ? formatNumber(minBlock) : "—", color: "text-muted" },
          { label: "Last Block", value: maxBlock ? formatNumber(maxBlock) : (pool.last_indexed_block ? formatNumber(pool.last_indexed_block) : "—"), color: "text-green" },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle>{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold font-mono ${color}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Price chart */}
      <Card glow>
        <CardHeader>
          <CardTitle>Price History</CardTitle>
          <span className="text-xs text-muted">{history?.length ?? 0} data points</span>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className="h-56 flex items-center justify-center text-muted text-sm">
              Loading chart...
            </div>
          ) : (
            <PriceChart
              data={history ?? []}
              token0Symbol={pool.token0_symbol}
              token1Symbol={pool.token1_symbol}
            />
          )}
        </CardContent>
      </Card>

      {/* Recent events table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Events</CardTitle>
          <span className="text-xs text-muted">last 50</span>
        </CardHeader>
        <CardContent className="p-0">
          {recentEvents.length === 0 ? (
            <div className="px-5 py-8 text-center text-muted text-sm">
              No events recorded.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-muted uppercase tracking-wider border-b border-border-dim">
                    <th className="px-5 py-2 text-left font-medium">Block</th>
                    <th className="px-3 py-2 text-left font-medium">Type</th>
                    <th className="px-3 py-2 text-right font-medium hidden sm:table-cell">Price</th>
                    <th className="px-3 py-2 text-right font-medium hidden md:table-cell">Reserve0</th>
                    <th className="px-5 py-2 text-right font-medium hidden md:table-cell">Reserve1</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEvents.map((ev, i) => (
                    <tr
                      key={`${ev.block_number}-${i}`}
                      className="border-b border-border-dim/40 last:border-0 hover:bg-white/2 transition-colors"
                    >
                      <td className="px-5 py-2.5 text-cyan">{ev.block_number}</td>
                      <td className="px-3 py-2.5 text-right text-[#94a3b8] hidden sm:table-cell">
                        {ev.price != null ? formatNumber(ev.price, 6) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right text-muted hidden md:table-cell">
                        {ev.reserve0_human != null ? formatNumber(ev.reserve0_human, 4) : "—"}
                      </td>
                      <td className="px-5 py-2.5 text-right text-muted hidden md:table-cell">
                        {ev.reserve1_human != null ? formatNumber(ev.reserve1_human, 4) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
