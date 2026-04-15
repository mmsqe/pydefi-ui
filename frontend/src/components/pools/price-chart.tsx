"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { PoolHistory } from "@/lib/types";
import { formatNumber } from "@/lib/utils";

interface PriceChartProps {
  data: PoolHistory;
  token0Symbol?: string;
  token1Symbol?: string;
}

interface TooltipPayloadEntry {
  value: number;
  dataKey: string;
}

function CustomTooltip({
  active,
  payload,
  label,
  token0Symbol,
  token1Symbol,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string | number;
  token0Symbol?: string;
  token1Symbol?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-card border border-border-dim rounded-xl px-4 py-3 shadow-xl min-w-[160px]">
      <p className="text-xs text-muted mb-2">Block {label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan" />
          <span className="text-xs text-[#94a3b8]">
            {token0Symbol}/{token1Symbol}
          </span>
          <span className="text-xs font-mono text-cyan ml-auto">
            {formatNumber(p.value, 6)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function PriceChart({ data, token0Symbol = "TKN0", token1Symbol = "TKN1" }: PriceChartProps) {
  const chartData = data
    .filter((d) => d.price != null)
    .map((d) => ({
      block: d.block_number,
      price: d.price ?? 0,
    }))
    .slice(-200);

  if (chartData.length === 0) {
    return (
      <div className="h-56 flex flex-col items-center justify-center text-muted gap-2">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <path
            d="M8 36 L16 24 L22 28 L30 16 L38 20 L44 10"
            stroke="#1e2132"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <p className="text-sm">No price history available</p>
      </div>
    );
  }

  const prices = chartData.map((d) => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const midPrice = (minPrice + maxPrice) / 2;

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 8, right: 12, bottom: 8, left: 0 }}
        >
          <defs>
            <linearGradient id="cyanGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#00d4ff" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#00d4ff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="#1e2132"
            vertical={false}
          />
          <XAxis
            dataKey="block"
            tick={{ fontSize: 10, fill: "#64748b" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#64748b" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => formatNumber(v, 3)}
            width={60}
          />
          <Tooltip
            content={
              <CustomTooltip
                token0Symbol={token0Symbol}
                token1Symbol={token1Symbol}
              />
            }
          />
          <ReferenceLine
            y={midPrice}
            stroke="#1e2132"
            strokeDasharray="4 4"
          />
          <Line
            type="monotone"
            dataKey="price"
            stroke="#00d4ff"
            strokeWidth={1.5}
            dot={false}
            activeDot={{
              r: 4,
              fill: "#00d4ff",
              stroke: "#0a0b0e",
              strokeWidth: 2,
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
