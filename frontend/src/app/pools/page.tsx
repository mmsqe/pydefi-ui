"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { swrFetcher } from "@/lib/api";
import { formatAddress, formatNumber, chainName, pairLabel, CHAIN_NAMES } from "@/lib/utils";
import type { Pool } from "@/lib/types";
import { Search, ArrowUpRight } from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function PoolsPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [protocolFilter, setProtocolFilter] = useState("");
  const [chainFilter, setChainFilter] = useState("");

  const { data: pools, isLoading } = useSWR<Pool[]>(
    `${BASE}/api/pools`,
    swrFetcher,
    { refreshInterval: 30000 }
  );

  const protocols = useMemo(() => {
    const set = new Set<string>();
    pools?.forEach((p) => set.add((p.protocol ?? "").toLowerCase()));
    return Array.from(set).filter(Boolean);
  }, [pools]);

  const chains = useMemo(() => {
    const set = new Set<number>();
    pools?.forEach((p) => set.add(p.chain_id));
    return Array.from(set);
  }, [pools]);

  const filtered = useMemo(() => {
    return (pools ?? []).filter((p) => {
      const pair = pairLabel(p).toLowerCase();
      const addr = p.pool_address.toLowerCase();
      const q = search.toLowerCase();
      if (q && !pair.includes(q) && !addr.includes(q)) return false;
      if (protocolFilter && (p.protocol ?? "").toLowerCase() !== protocolFilter) return false;
      if (chainFilter && String(p.chain_id) !== chainFilter) return false;
      return true;
    });
  }, [pools, search, protocolFilter, chainFilter]);

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Pool Browser</CardTitle>
          <span className="text-xs text-muted font-mono">{filtered.length} pools</span>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[200px]">
              <Input
                placeholder="Search pair or address..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                adornmentStart={<Search size={14} />}
              />
            </div>
            <div className="w-36">
              <Select
                value={protocolFilter}
                onChange={(e) => setProtocolFilter(e.target.value)}
              >
                <option value="">All Protocols</option>
                {protocols.map((p) => (
                  <option key={p} value={p}>
                    {p.toUpperCase()}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-40">
              <Select
                value={chainFilter}
                onChange={(e) => setChainFilter(e.target.value)}
              >
                <option value="">All Chains</option>
                {chains.map((c) => (
                  <option key={c} value={String(c)}>
                    {chainName(c)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-12 text-center text-muted text-sm">
              Loading pools...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-muted text-sm">
              No pools found. Try adjusting filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted uppercase tracking-wider border-b border-border-dim">
                    <th className="px-5 py-3 text-left font-medium">Pair</th>
                    <th className="px-3 py-3 text-left font-medium">Protocol</th>
                    <th className="px-3 py-3 text-left font-medium hidden sm:table-cell">Chain</th>
                    <th className="px-3 py-3 text-right font-medium hidden md:table-cell">Fee</th>
                    <th className="px-3 py-3 text-right font-medium hidden lg:table-cell">Last Block</th>
                    <th className="px-5 py-3 text-right font-medium">Address</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((pool) => (
                    <tr
                      key={pool.pool_address}
                      onClick={() => router.push(`/pools/${pool.pool_address}`)}
                      className="border-b border-border-dim/50 last:border-0 cursor-pointer transition-all row-hover group"
                    >
                      <td className="px-5 py-3.5 font-medium text-[#e8eaf0] group-hover:text-cyan transition-colors">
                        {pairLabel(pool)}
                      </td>
                      <td className="px-3 py-3.5">
                        <Badge variant={(pool.protocol?.toLowerCase() as "v2" | "v3") ?? "muted"}>
                          {(pool.protocol ?? "?").toUpperCase()}
                        </Badge>
                      </td>
                      <td className="px-3 py-3.5 text-muted hidden sm:table-cell text-xs">
                        {chainName(pool.chain_id)}
                      </td>
                      <td className="px-3 py-3.5 text-right font-mono text-muted hidden md:table-cell text-xs">
                        {pool.fee_bps != null ? `${pool.fee_bps / 100}%` : "—"}
                      </td>
                      <td className="px-3 py-3.5 text-right font-mono text-muted hidden lg:table-cell text-xs">
                        {pool.last_indexed_block ? formatNumber(pool.last_indexed_block) : "—"}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="font-mono text-xs text-muted group-hover:text-cyan/80 transition-colors">
                            {formatAddress(pool.pool_address, 6)}
                          </span>
                          <ArrowUpRight size={12} className="text-muted group-hover:text-cyan transition-colors" />
                        </div>
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
