"use client";

import { useState } from "react";
import useSWR from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { swrFetcher, addFactory } from "@/lib/api";
import { formatAddress, formatNumber, chainName, pairLabel } from "@/lib/utils";
import type { Factory, Pool } from "@/lib/types";
import {
  Factory as FactoryIcon,
  ChevronDown,
  ChevronRight,
  Plus,
  CheckCircle,
  XCircle,
} from "lucide-react";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type Toast = { id: number; type: "success" | "error"; message: string };
let toastId = 0;

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const addToast = (type: "success" | "error", message: string) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };
  return { toasts, addToast };
}

function ToastStack({ toasts }: { toasts: Toast[] }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 space-y-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-2 px-4 py-3 rounded-xl border text-sm max-w-sm shadow-lg ${
            t.type === "success"
              ? "bg-green/10 border-green/30 text-green"
              : "bg-red-500/10 border-red-500/30 text-red-400"
          }`}
        >
          {t.type === "success" ? (
            <CheckCircle size={14} className="mt-0.5 flex-shrink-0" />
          ) : (
            <XCircle size={14} className="mt-0.5 flex-shrink-0" />
          )}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

function FactoryRow({
  factory,
  pools,
}: {
  factory: Factory;
  pools: Pool[];
}) {
  const [expanded, setExpanded] = useState(false);
  const relatedPools = pools.filter(
    (p) =>
      p.pool_address?.toLowerCase() !== undefined  // factories page: filter by protocol+chain_id instead
        && p.protocol?.toLowerCase() === factory.protocol?.toLowerCase()
        && p.chain_id === factory.chain_id
  );

  return (
    <>
      <tr
        onClick={() => setExpanded(!expanded)}
        className="border-b border-border-dim/50 cursor-pointer hover:bg-white/2 transition-colors group"
      >
        <td className="px-5 py-3.5">
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown size={13} className="text-cyan flex-shrink-0" />
            ) : (
              <ChevronRight size={13} className="text-muted group-hover:text-cyan flex-shrink-0 transition-colors" />
            )}
            <span className="font-mono text-xs text-[#e8eaf0]">
              {formatAddress(factory.factory_address, 8)}
            </span>
          </div>
        </td>
        <td className="px-3 py-3.5">
          <Badge variant={(factory.protocol?.toLowerCase() as "v2" | "v3") ?? "muted"}>
            {(factory.protocol ?? "?").toUpperCase()}
          </Badge>
        </td>
        <td className="px-3 py-3.5 text-muted text-xs hidden sm:table-cell">
          {chainName(factory.chain_id)}
        </td>
        <td className="px-3 py-3.5 text-right font-mono text-muted text-xs hidden md:table-cell">
          {factory.last_indexed_block ? formatNumber(factory.last_indexed_block) : "—"}
        </td>
        <td className="px-5 py-3.5 text-right">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan/8 border border-cyan/15 text-cyan text-xs font-mono font-semibold">
            {relatedPools.length > 0 ? relatedPools.length : factory.pools_discovered ?? 0} pools
          </span>
        </td>
      </tr>

      {/* Expanded pool list */}
      {expanded && (
        <tr className="border-b border-border-dim/30">
          <td colSpan={5} className="px-0 py-0">
            <div className="bg-[#0a0b0e] border-y border-border-dim/30">
              {relatedPools.length === 0 ? (
                <div className="px-12 py-4 text-xs text-muted italic">
                  No pools linked to this factory in the local cache.
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted uppercase tracking-wider border-b border-border-dim/30">
                      <th className="px-12 py-2 text-left font-medium">Pair</th>
                      <th className="px-3 py-2 text-left font-medium">Protocol</th>
                      <th className="px-3 py-2 text-right font-medium hidden md:table-cell">Fee</th>
                      <th className="px-5 py-2 text-right font-medium">Last Block</th>
                    </tr>
                  </thead>
                  <tbody>
                    {relatedPools.map((pool) => (
                      <tr
                        key={pool.pool_address}
                        className="border-b border-border-dim/20 last:border-0 hover:bg-white/2 transition-colors"
                      >
                        <td className="px-12 py-2.5 font-medium text-[#94a3b8]">
                          {pairLabel(pool)}
                          <span className="ml-2 text-muted/60 font-mono text-[10px]">
                            {formatAddress(pool.pool_address, 6)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge variant={(pool.protocol?.toLowerCase() as "v2" | "v3") ?? "muted"}>
                            {(pool.protocol ?? "?").toUpperCase()}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-muted hidden md:table-cell">
                          {pool.fee_bps != null ? `${pool.fee_bps / 100}%` : "—"}
                        </td>
                        <td className="px-5 py-2.5 text-right font-mono text-muted">
                          {pool.last_indexed_block ? formatNumber(pool.last_indexed_block) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function FactoriesPage() {
  const { toasts, addToast } = useToasts();

  const { data: factories, isLoading, mutate: mutateFactories } = useSWR<Factory[]>(
    `${BASE}/api/factories`,
    swrFetcher,
    { refreshInterval: 30000 }
  );

  const { data: pools } = useSWR<Pool[]>(`${BASE}/api/pools`, swrFetcher);

  const [form, setForm] = useState({
    factory_address: "",
    protocol: "v2",
    chain_id: "1",
  });
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await addFactory({
        factory_address: form.factory_address,
        protocol: form.protocol,
        chain_id: parseInt(form.chain_id),
      });
      addToast("success", `Factory registered: ${formatAddress(form.factory_address)}`);
      setForm({ factory_address: "", protocol: "v2", chain_id: "1" });
      setShowForm(false);
      mutateFactories();
    } catch (err: unknown) {
      addToast("error", err instanceof Error ? err.message : "Failed to register factory");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl space-y-6">
      <ToastStack toasts={toasts} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple/10 border border-purple/20 flex items-center justify-center">
            <FactoryIcon size={16} className="text-purple" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-[#e8eaf0]">Factories</h2>
            <p className="text-xs text-muted">{factories?.length ?? 0} registered</p>
          </div>
        </div>
        <Button
          variant={showForm ? "outline" : "primary"}
          size="sm"
          onClick={() => setShowForm(!showForm)}
        >
          <Plus size={14} />
          {showForm ? "Cancel" : "Add Factory"}
        </Button>
      </div>

      {/* Add factory form (inline) */}
      {showForm && (
        <Card glow>
          <CardHeader>
            <CardTitle>Register New Factory</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <div className="sm:col-span-1">
                  <Input
                    label="Factory Address"
                    placeholder="0x..."
                    value={form.factory_address}
                    onChange={(e) => setForm({ ...form, factory_address: e.target.value })}
                    required
                  />
                </div>
                <Select
                  label="Protocol"
                  value={form.protocol}
                  onChange={(e) => setForm({ ...form, protocol: e.target.value })}
                >
                  <option value="v2">Uniswap V2</option>
                  <option value="v3">Uniswap V3</option>
                  <option value="sushiswap">Sushiswap</option>
                  <option value="curve">Curve</option>
                </Select>
                <Input
                  label="Chain ID"
                  type="number"
                  placeholder="1"
                  value={form.chain_id}
                  onChange={(e) => setForm({ ...form, chain_id: e.target.value })}
                  required
                />
              </div>
              <Button type="submit" variant="primary" loading={loading}>
                <Plus size={14} /> Register Factory
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Factories table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-12 text-center text-muted text-sm">
              Loading factories...
            </div>
          ) : !factories || factories.length === 0 ? (
            <div className="py-16 text-center">
              <div className="w-12 h-12 rounded-2xl bg-border-dim/30 flex items-center justify-center mx-auto mb-3">
                <FactoryIcon size={20} className="text-muted" />
              </div>
              <p className="text-sm font-medium text-muted mb-1">No factories yet</p>
              <p className="text-xs text-muted/60">
                Register a factory to start auto-discovering pools.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted uppercase tracking-wider border-b border-border-dim">
                    <th className="px-5 py-3 text-left font-medium">Factory Address</th>
                    <th className="px-3 py-3 text-left font-medium">Protocol</th>
                    <th className="px-3 py-3 text-left font-medium hidden sm:table-cell">Chain</th>
                    <th className="px-3 py-3 text-right font-medium hidden md:table-cell">Last Block</th>
                    <th className="px-5 py-3 text-right font-medium">Pools</th>
                  </tr>
                </thead>
                <tbody>
                  {factories.map((factory) => (
                    <FactoryRow
                      key={factory.factory_address}
                      factory={factory}
                      pools={pools ?? []}
                    />
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
