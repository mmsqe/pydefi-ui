"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { swrFetcher, addV2Pool, addV3Pool, addFactory, runBackfill } from "@/lib/api";
import {
  formatAddress,
  formatNumber,
  chainName,
  pairLabel,
} from "@/lib/utils";
import type { Stats, Pool } from "@/lib/types";
import {
  Activity,
  Plus,
  Play,
  CheckCircle,
  XCircle,
  Loader2,
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
          className={`flex items-start gap-2 px-4 py-3 rounded-xl border text-sm max-w-sm shadow-lg backdrop-blur-md ${
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

export default function IndexerPage() {
  const { toasts, addToast } = useToasts();

  const { data: stats } = useSWR<Stats>(`${BASE}/api/stats`, swrFetcher, { refreshInterval: 10000 });
  const { data: pools, mutate: mutatePools } = useSWR<Pool[]>(`${BASE}/api/pools`, swrFetcher);

  // V2 form state
  const blankPool = { pool_address: "", protocol: "", token0_address: "", token0_symbol: "", token0_decimals: "18", token1_address: "", token1_symbol: "", token1_decimals: "18", chain_id: "1", fee_bps: "30" };
  const [v2Form, setV2Form] = useState({ ...blankPool, protocol: "UniswapV2" });
  const [v2Loading, setV2Loading] = useState(false);

  // V3 form state
  const [v3Form, setV3Form] = useState({ ...blankPool, protocol: "UniswapV3", fee_bps: "5" });
  const [v3Loading, setV3Loading] = useState(false);

  // Factory form state
  const [factoryForm, setFactoryForm] = useState({ factory_address: "", protocol: "v2", chain_id: "1" });
  const [factoryLoading, setFactoryLoading] = useState(false);

  // Backfill form state
  const [backfillForm, setBackfillForm] = useState({ pool_address: "", from_block: "", to_block: "", batch_size: "1000" });
  const [backfillLoading, setBackfillLoading] = useState(false);

  const handleAddV2 = async (e: React.FormEvent) => {
    e.preventDefault();
    setV2Loading(true);
    try {
      await addV2Pool({
        pool_address: v2Form.pool_address,
        protocol: v2Form.protocol,
        token0_address: v2Form.token0_address,
        token0_symbol: v2Form.token0_symbol,
        token0_decimals: parseInt(v2Form.token0_decimals),
        token1_address: v2Form.token1_address,
        token1_symbol: v2Form.token1_symbol,
        token1_decimals: parseInt(v2Form.token1_decimals),
        chain_id: parseInt(v2Form.chain_id),
        fee_bps: parseInt(v2Form.fee_bps),
      });
      addToast("success", `V2 pool registered: ${formatAddress(v2Form.pool_address)}`);
      setV2Form({ ...blankPool, protocol: "UniswapV2" });
      mutatePools();
    } catch (err: unknown) {
      addToast("error", err instanceof Error ? err.message : "Failed to add V2 pool");
    } finally {
      setV2Loading(false);
    }
  };

  const handleAddV3 = async (e: React.FormEvent) => {
    e.preventDefault();
    setV3Loading(true);
    try {
      await addV3Pool({
        pool_address: v3Form.pool_address,
        protocol: v3Form.protocol,
        token0_address: v3Form.token0_address,
        token0_symbol: v3Form.token0_symbol,
        token0_decimals: parseInt(v3Form.token0_decimals),
        token1_address: v3Form.token1_address,
        token1_symbol: v3Form.token1_symbol,
        token1_decimals: parseInt(v3Form.token1_decimals),
        chain_id: parseInt(v3Form.chain_id),
        fee_bps: parseInt(v3Form.fee_bps),
      });
      addToast("success", `V3 pool registered: ${formatAddress(v3Form.pool_address)}`);
      setV3Form({ ...blankPool, protocol: "UniswapV3", fee_bps: "5" });
      mutatePools();
    } catch (err: unknown) {
      addToast("error", err instanceof Error ? err.message : "Failed to add V3 pool");
    } finally {
      setV3Loading(false);
    }
  };

  const handleAddFactory = async (e: React.FormEvent) => {
    e.preventDefault();
    setFactoryLoading(true);
    try {
      await addFactory({
        factory_address: factoryForm.factory_address,
        protocol: factoryForm.protocol,
        chain_id: parseInt(factoryForm.chain_id),
      });
      addToast("success", `Factory registered: ${formatAddress(factoryForm.factory_address)}`);
      setFactoryForm({ factory_address: "", protocol: "v2", chain_id: "1" });
    } catch (err: unknown) {
      addToast("error", err instanceof Error ? err.message : "Failed to add factory");
    } finally {
      setFactoryLoading(false);
    }
  };

  const handleBackfill = async (e: React.FormEvent) => {
    e.preventDefault();
    setBackfillLoading(true);
    try {
      const result = await runBackfill({
        pool_address: backfillForm.pool_address || undefined,
        from_block: parseInt(backfillForm.from_block),
        to_block: backfillForm.to_block ? parseInt(backfillForm.to_block) : undefined,
        batch_size: parseInt(backfillForm.batch_size),
      });
      addToast("success", result.message ?? "Backfill started");
    } catch (err: unknown) {
      addToast("error", err instanceof Error ? err.message : "Backfill failed");
    } finally {
      setBackfillLoading(false);
    }
  };

  return (
    <div className="max-w-7xl space-y-6">
      <ToastStack toasts={toasts} />

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Pools", value: stats?.pools ?? 0, color: "text-cyan" },
          { label: "Factories", value: stats?.factories ?? 0, color: "text-purple" },
          { label: "V2 Events", value: stats?.v2_events ?? 0, color: "text-green" },
          { label: "V3 Events", value: stats?.v3_events ?? 0, color: "text-cyan" },
        ].map(({ label, value, color }) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle>{label}</CardTitle>
              <Activity size={13} className="text-muted" />
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold font-mono ${color}`}>
                {formatNumber(value)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Forms row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Register Pool */}
        <Card>
          <CardHeader>
            <CardTitle>Register Pool</CardTitle>
            <Plus size={14} className="text-muted" />
          </CardHeader>
          <CardContent>
            {/* Protocol toggle */}
            <div className="flex gap-2 mb-4">
              <Badge variant="v2">V2</Badge>
              <Badge variant="v3">V3</Badge>
            </div>

            {/* V2 form */}
            <form onSubmit={handleAddV2} className="space-y-3 mb-6 pb-6 border-b border-border-dim">
              <p className="text-xs font-semibold text-muted uppercase tracking-wider">Uniswap V2 Pool</p>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Pool Address" placeholder="0x..." value={v2Form.pool_address} onChange={(e) => setV2Form({ ...v2Form, pool_address: e.target.value })} required />
                <Input label="Protocol" placeholder="UniswapV2" value={v2Form.protocol} onChange={(e) => setV2Form({ ...v2Form, protocol: e.target.value })} required />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Input label="Token 0 Address" placeholder="0x..." value={v2Form.token0_address} onChange={(e) => setV2Form({ ...v2Form, token0_address: e.target.value })} required />
                <Input label="Symbol" placeholder="USDC" value={v2Form.token0_symbol} onChange={(e) => setV2Form({ ...v2Form, token0_symbol: e.target.value })} required />
                <Input label="Decimals" type="number" value={v2Form.token0_decimals} onChange={(e) => setV2Form({ ...v2Form, token0_decimals: e.target.value })} required />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Input label="Token 1 Address" placeholder="0x..." value={v2Form.token1_address} onChange={(e) => setV2Form({ ...v2Form, token1_address: e.target.value })} required />
                <Input label="Symbol" placeholder="WETH" value={v2Form.token1_symbol} onChange={(e) => setV2Form({ ...v2Form, token1_symbol: e.target.value })} required />
                <Input label="Decimals" type="number" value={v2Form.token1_decimals} onChange={(e) => setV2Form({ ...v2Form, token1_decimals: e.target.value })} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Chain ID" type="number" placeholder="1" value={v2Form.chain_id} onChange={(e) => setV2Form({ ...v2Form, chain_id: e.target.value })} required />
                <Input label="Fee (bps)" type="number" placeholder="30" value={v2Form.fee_bps} onChange={(e) => setV2Form({ ...v2Form, fee_bps: e.target.value })} required />
              </div>
              <Button type="submit" variant="outline" size="sm" loading={v2Loading}>
                <Plus size={13} /> Register V2
              </Button>
            </form>

            {/* V3 form */}
            <form onSubmit={handleAddV3} className="space-y-3">
              <p className="text-xs font-semibold text-muted uppercase tracking-wider">Uniswap V3 Pool</p>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Pool Address" placeholder="0x..." value={v3Form.pool_address} onChange={(e) => setV3Form({ ...v3Form, pool_address: e.target.value })} required />
                <Input label="Protocol" placeholder="UniswapV3" value={v3Form.protocol} onChange={(e) => setV3Form({ ...v3Form, protocol: e.target.value })} required />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Input label="Token 0 Address" placeholder="0x..." value={v3Form.token0_address} onChange={(e) => setV3Form({ ...v3Form, token0_address: e.target.value })} required />
                <Input label="Symbol" placeholder="USDC" value={v3Form.token0_symbol} onChange={(e) => setV3Form({ ...v3Form, token0_symbol: e.target.value })} required />
                <Input label="Decimals" type="number" value={v3Form.token0_decimals} onChange={(e) => setV3Form({ ...v3Form, token0_decimals: e.target.value })} required />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Input label="Token 1 Address" placeholder="0x..." value={v3Form.token1_address} onChange={(e) => setV3Form({ ...v3Form, token1_address: e.target.value })} required />
                <Input label="Symbol" placeholder="WETH" value={v3Form.token1_symbol} onChange={(e) => setV3Form({ ...v3Form, token1_symbol: e.target.value })} required />
                <Input label="Decimals" type="number" value={v3Form.token1_decimals} onChange={(e) => setV3Form({ ...v3Form, token1_decimals: e.target.value })} required />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Select label="Fee Tier (bps)" value={v3Form.fee_bps} onChange={(e) => setV3Form({ ...v3Form, fee_bps: e.target.value })}>
                  <option value="1">0.01%</option>
                  <option value="5">0.05%</option>
                  <option value="30">0.30%</option>
                  <option value="100">1.00%</option>
                </Select>
                <Input label="Chain ID" type="number" placeholder="1" value={v3Form.chain_id} onChange={(e) => setV3Form({ ...v3Form, chain_id: e.target.value })} required />
              </div>
              <Button type="submit" variant="primary" size="sm" loading={v3Loading}>
                <Plus size={13} /> Register V3
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Register Factory */}
        <Card>
          <CardHeader>
            <CardTitle>Register Factory</CardTitle>
            <Plus size={14} className="text-muted" />
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddFactory} className="space-y-3">
              <Input
                label="Factory Address"
                placeholder="0x..."
                value={factoryForm.factory_address}
                onChange={(e) => setFactoryForm({ ...factoryForm, factory_address: e.target.value })}
                required
              />
              <div className="grid grid-cols-2 gap-3">
                <Select
                  label="Protocol"
                  value={factoryForm.protocol}
                  onChange={(e) => setFactoryForm({ ...factoryForm, protocol: e.target.value })}
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
                  value={factoryForm.chain_id}
                  onChange={(e) => setFactoryForm({ ...factoryForm, chain_id: e.target.value })}
                  required
                />
              </div>
              <Button type="submit" variant="primary" loading={factoryLoading}>
                <Plus size={14} /> Register Factory
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {/* Backfill section */}
      <Card>
        <CardHeader>
          <CardTitle>Backfill Events</CardTitle>
          <Play size={14} className="text-muted" />
        </CardHeader>
        <CardContent>
          <form onSubmit={handleBackfill}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              <Input
                label="From Block"
                type="number"
                placeholder="e.g. 19000000"
                value={backfillForm.from_block}
                onChange={(e) => setBackfillForm({ ...backfillForm, from_block: e.target.value })}
                required
              />
              <Input
                label="To Block (optional)"
                type="number"
                placeholder="latest"
                value={backfillForm.to_block}
                onChange={(e) => setBackfillForm({ ...backfillForm, to_block: e.target.value })}
              />
              <Input
                label="Batch Size"
                type="number"
                placeholder="1000"
                value={backfillForm.batch_size}
                onChange={(e) => setBackfillForm({ ...backfillForm, batch_size: e.target.value })}
              />
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium uppercase tracking-wider text-muted">
                  Pool (optional)
                </label>
                <select
                  value={backfillForm.pool_address}
                  onChange={(e) => setBackfillForm({ ...backfillForm, pool_address: e.target.value })}
                  className="w-full bg-surface border border-border-dim rounded-xl px-3 py-2.5 text-sm text-[#e8eaf0] focus:outline-none focus:border-cyan/40 transition-all"
                >
                  <option value="">All pools</option>
                  {(pools ?? []).map((p) => (
                    <option key={p.pool_address} value={p.pool_address}>
                      {pairLabel(p)} ({formatAddress(p.pool_address, 4)})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Button type="submit" variant="primary" loading={backfillLoading}>
              {backfillLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              Run Backfill
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Registered pools table */}
      <Card>
        <CardHeader>
          <CardTitle>Registered Pools</CardTitle>
          <span className="text-xs text-muted font-mono">{pools?.length ?? 0} total</span>
        </CardHeader>
        <CardContent className="p-0">
          {!pools || pools.length === 0 ? (
            <div className="px-5 py-10 text-center text-muted text-sm">
              No pools registered yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted uppercase tracking-wider border-b border-border-dim">
                    <th className="px-5 py-2.5 text-left font-medium">Pair</th>
                    <th className="px-3 py-2.5 text-left font-medium">Protocol</th>
                    <th className="px-3 py-2.5 text-left font-medium hidden sm:table-cell">Chain</th>
                    <th className="px-3 py-2.5 text-right font-medium hidden md:table-cell">Last Block</th>
                    <th className="px-5 py-2.5 text-right font-medium">Address</th>
                  </tr>
                </thead>
                <tbody>
                  {pools.map((pool) => (
                    <tr
                      key={pool.pool_address}
                      className="border-b border-border-dim/50 last:border-0 hover:bg-white/2 transition-colors"
                    >
                      <td className="px-5 py-3 font-medium text-[#e8eaf0]">
                        {pairLabel(pool)}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={(pool.protocol?.toLowerCase() as "v2" | "v3") ?? "muted"}>
                          {(pool.protocol ?? "?").toUpperCase()}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-muted text-xs hidden sm:table-cell">
                        {chainName(pool.chain_id)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono text-muted text-xs hidden md:table-cell">
                        {pool.last_indexed_block ? formatNumber(pool.last_indexed_block) : "—"}
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs text-muted">
                        {formatAddress(pool.pool_address, 6)}
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
