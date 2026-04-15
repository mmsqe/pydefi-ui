import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatAddress(addr: string, chars = 6): string {
  if (!addr || addr.length < chars * 2) return addr ?? "";
  return `${addr.slice(0, chars)}...${addr.slice(-chars + 2)}`;
}

export function formatNumber(n: number | string | undefined | null, precision = 4): string {
  if (n === undefined || n === null || n === "") return "—";
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return "—";
  if (num === 0) return "0";

  const abs = Math.abs(num);

  // Scientific notation for very large or very small
  if (abs > 0 && abs < 1e-6) return num.toExponential(2);
  if (abs >= 1e12) return num.toExponential(2);

  // Human-readable suffixes
  if (abs >= 1e9) return (num / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (num / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return num.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return num.toPrecision(precision).replace(/\.?0+$/, "");
}

export const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  56: "BSC",
  100: "Gnosis",
  137: "Polygon",
  250: "Fantom",
  324: "zkSync",
  8453: "Base",
  42161: "Arbitrum",
  42220: "Celo",
  43114: "Avalanche",
  11155111: "Sepolia",
  84532: "Base Sepolia",
  421614: "Arb Sepolia",
};

export const CHAIN_COLORS: Record<number, string> = {
  1: "#627EEA",
  10: "#FF0420",
  56: "#F3BA2F",
  137: "#8247E5",
  8453: "#0052FF",
  42161: "#28A0F0",
  11155111: "#7C83A0",
};

export function chainName(id: number): string {
  return CHAIN_NAMES[id] ?? `Chain ${id}`;
}

export function chainColor(id: number): string {
  return CHAIN_COLORS[id] ?? "#64748b";
}

export function protocolLabel(protocol: string): string {
  const map: Record<string, string> = {
    v2: "V2",
    v3: "V3",
    uniswap_v2: "Uni V2",
    uniswap_v3: "Uni V3",
    sushiswap: "Sushi",
    curve: "Curve",
  };
  return map[protocol] ?? protocol.toUpperCase();
}

export function pairLabel(pool: { token0_symbol?: string; token1_symbol?: string; token0_address?: string; token1_address?: string }): string {
  const t0 = pool.token0_symbol ?? (pool.token0_address ? formatAddress(pool.token0_address, 4) : "?");
  const t1 = pool.token1_symbol ?? (pool.token1_address ? formatAddress(pool.token1_address, 4) : "?");
  return `${t0} / ${t1}`;
}
