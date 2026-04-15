"use client";

import useSWR from "swr";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { swrFetcher } from "@/lib/api";
import { formatNumber, formatAddress, chainName, pairLabel } from "@/lib/utils";
import type { Stats, Pool } from "@/lib/types";
import {
  Waves,
  Factory,
  Zap,
  Cpu,
  Blocks,
  TrendingUp,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const PIE_COLORS = ["#00d4ff", "#8b5cf6", "#00ff87", "#f59e0b", "#f43f5e"];

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: "cyan" | "purple" | "green" | "muted";
}

function StatCard({ label, value, icon, color = "cyan" }: StatCardProps) {
  const colorMap = {
    cyan: "text-cyan shadow-[0_0_12px_rgba(0,212,255,0.3)]",
    purple: "text-purple shadow-[0_0_12px_rgba(139,92,246,0.3)]",
    green: "text-green shadow-[0_0_12px_rgba(0,255,135,0.3)]",
    muted: "text-muted",
  };

  return (
    <Card glow className="flex-1 min-w-[160px]">
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        <div className="text-muted">{icon}</div>
      </CardHeader>
      <CardContent>
        <p
          className={`text-3xl font-bold font-mono ${colorMap[color]}`}
        >
          {formatNumber(typeof value === "number" ? value : parseFloat(String(value)) || 0)}
        </p>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useSWR<Stats>(
    `${BASE}/api/stats`,
    swrFetcher,
    { refreshInterval: 15000 }
  );

  const { data: pools, isLoading: poolsLoading } = useSWR<Pool[]>(
    `${BASE}/api/pools`,
    swrFetcher,
    { refreshInterval: 30000 }
  );

  // Build protocol breakdown
  const protocolMap: Record<string, number> = {};
  pools?.forEach((p) => {
    const key = (p.protocol ?? "unknown").toLowerCase();
    protocolMap[key] = (protocolMap[key] ?? 0) + 1;
  });
  const pieData = Object.entries(protocolMap).map(([name, value]) => ({
    name: name.toUpperCase(),
    value,
  }));

  const recentPools = [...(pools ?? [])].reverse().slice(0, 10);

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Stat cards row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard
          label="Total Pools"
          value={stats?.pools ?? 0}
          icon={<Waves size={16} />}
          color="cyan"
        />
        <StatCard
          label="Factories"
          value={stats?.factories ?? 0}
          icon={<Factory size={16} />}
          color="purple"
        />
        <StatCard
          label="V2 Events"
          value={stats?.v2_events ?? 0}
          icon={<Zap size={16} />}
          color="green"
        />
        <StatCard
          label="V3 Events"
          value={stats?.v3_events ?? 0}
          icon={<Cpu size={16} />}
          color="cyan"
        />
        <StatCard
          label="Latest Block"
          value={stats?.latest_block ?? 0}
          icon={<Blocks size={16} />}
          color="muted"
        />
      </div>

      {/* Middle row: pie + recent pools */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Protocol breakdown */}
        <Card glow>
          <CardHeader>
            <CardTitle>Protocol Breakdown</CardTitle>
            <TrendingUp size={14} className="text-muted" />
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted text-sm">
                {statsLoading || poolsLoading ? "Loading..." : "No data yet"}
              </div>
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={75}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {pieData.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={PIE_COLORS[index % PIE_COLORS.length]}
                          stroke="transparent"
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#13161e",
                        border: "1px solid #1e2132",
                        borderRadius: "12px",
                        fontSize: "12px",
                      }}
                    />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      formatter={(value) => (
                        <span style={{ color: "#94a3b8", fontSize: "11px" }}>
                          {value}
                        </span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent pools table */}
        <Card glow className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent Pools</CardTitle>
            <Link
              href="/pools"
              className="text-xs text-cyan hover:text-cyan/80 flex items-center gap-1 transition-colors"
            >
              View all <ArrowRight size={12} />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {poolsLoading ? (
              <div className="px-5 py-8 text-center text-muted text-sm">Loading pools...</div>
            ) : recentPools.length === 0 ? (
              <div className="px-5 py-8 text-center text-muted text-sm">No pools indexed yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted uppercase tracking-wider border-b border-border-dim">
                      <th className="px-5 py-2 text-left font-medium">Pair</th>
                      <th className="px-3 py-2 text-left font-medium">Protocol</th>
                      <th className="px-3 py-2 text-left font-medium hidden sm:table-cell">Chain</th>
                      <th className="px-3 py-2 text-right font-medium hidden md:table-cell">Fee</th>
                      <th className="px-3 py-2 text-right font-medium">Block</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentPools.map((pool) => (
                      <tr
                        key={pool.pool_address}
                        className="border-b border-border-dim/50 last:border-0 hover:bg-cyan/3 transition-colors row-hover cursor-pointer"
                        onClick={() => (window.location.href = `/pools/${pool.pool_address}`)}
                      >
                        <td className="px-5 py-3 font-medium text-[#e8eaf0]">
                          {pairLabel(pool)}
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant={(pool.protocol?.toLowerCase() as "v2" | "v3") ?? "muted"}>
                            {(pool.protocol ?? "?").toUpperCase()}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-muted hidden sm:table-cell">
                          {chainName(pool.chain_id)}
                        </td>
                        <td className="px-3 py-3 text-right text-muted font-mono hidden md:table-cell">
                          {pool.fee_bps != null ? `${pool.fee_bps / 100}%` : "—"}
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-muted">
                          {formatNumber(pool.last_indexed_block ?? 0)}
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
    </div>
  );
}
