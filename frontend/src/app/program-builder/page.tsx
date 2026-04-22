"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useUrlRestoreOnce, useUrlWrite } from "@/lib/use-url-state";
import { useAccount } from "wagmi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ArrowLeftRight,
  RefreshCcw,
  Link2,
  Shield,
  Plus,
  Play,
  Trash2,
  ChevronDown,
  ChevronUp,
  Loader,
  Code,
  Wifi,
  ArrowUp,
  ArrowDown,
  Terminal,
} from "lucide-react";
import { fetchPools } from "@/lib/api";
import type { Pool } from "@/lib/types";

// ── Block catalogue ───────────────────────────────────────────────────────────

const BLOCK_DEFS = [
  {
    type: "wrap_eth",
    label: "Wrap ETH",
    icon: RefreshCcw,
    color: "#627EEA",
    desc: "WETH.deposit() — convert native ETH to WETH",
  },
  {
    type: "unwrap_weth",
    label: "Unwrap WETH",
    icon: RefreshCcw,
    color: "#a78bfa",
    desc: "WETH.withdraw() — redeem WETH back to ETH",
  },
  {
    type: "approve",
    label: "Approve",
    icon: Shield,
    color: "#00d4ff",
    desc: "ERC-20 token.approve(spender, uint256.max)",
  },
  {
    type: "transfer",
    label: "Transfer",
    icon: Link2,
    color: "#f43f5e",
    desc: "ERC-20 token.transfer(recipient, amount)",
  },
  {
    type: "swap",
    label: "Swap",
    icon: ArrowLeftRight,
    color: "#8b5cf6",
    desc: "Multi-hop token swap compiled to DeFiVM bytecode",
  },
  {
    type: "cctp_bridge",
    label: "CCTP Bridge",
    icon: Wifi,
    color: "#f59e0b",
    desc: "Circle CCTP v2 depositForBurnWithHook cross-chain transfer",
  },
  {
    type: "call_contract",
    label: "Call Contract",
    icon: Code,
    color: "#64748b",
    desc: "Arbitrary contract call with optional ETH value",
  },
] as const;

type BlockType = (typeof BLOCK_DEFS)[number]["type"];

interface BlockConfig {
  // wrap_eth / unwrap_weth
  amount?: string;
  // approve
  token?: string;
  spender?: string;
  // transfer
  recipient?: string;
  // swap
  token_in?: string;
  token_out?: string;
  amount_in?: string;
  slippage_bps?: string;
  // cctp_bridge
  destination_chain?: string;
  cctp_amount?: string;
  // call_contract
  contract_address?: string;
  calldata?: string;
  call_value?: string;
}

interface DAGSwap { type: "swap"; token_out: string; pool_address: string; protocol: string; fee_bps: number; }
interface DAGSplit { type: "split"; token_out: string; legs: { fraction_bps: number; actions: DAGAction[] }[]; }
type DAGAction = DAGSwap | DAGSplit;
interface RouteDAGData { token_in: string; actions: DAGAction[]; }

interface QuoteState {
  loading: boolean;
  amount_out_human?: string;
  price_impact?: string;
  dag?: RouteDAGData;
  error?: string;
}

interface CanvasBlock {
  id: string;
  type: BlockType;
  config: BlockConfig;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function defFor(type: BlockType) {
  return BLOCK_DEFS.find((d) => d.type === type)!;
}

function blockLabel(block: CanvasBlock): string {
  const def = defFor(block.type);
  const c = block.config;
  switch (block.type) {
    case "wrap_eth":   return c.amount ? `Wrap ${c.amount} ETH → WETH` : def.label;
    case "unwrap_weth": return c.amount ? `Unwrap ${c.amount} WETH → ETH` : def.label;
    case "approve":    return c.token && c.spender ? `Approve ${c.token} → ${c.spender.slice(0, 8)}…` : def.label;
    case "transfer":   return c.token && c.recipient ? `Transfer ${c.amount ?? "?"} ${c.token} → ${c.recipient.slice(0, 8)}…` : def.label;
    case "swap":       return c.token_in && c.token_out ? `Swap ${c.amount_in ?? "?"} ${c.token_in} → ${c.token_out}` : def.label;
    case "cctp_bridge": return c.destination_chain ? `CCTP → ${c.destination_chain}` : def.label;
    case "call_contract": return c.contract_address ? `Call ${c.contract_address.slice(0, 10)}…` : def.label;
  }
}

const CCTP_CHAINS: Record<string, { label: string; domain: number }> = {
  "Arbitrum Sepolia": { label: "Arbitrum Sepolia", domain: 3 },
  "Base Sepolia":     { label: "Base Sepolia",     domain: 6 },
  "Optimism Sepolia": { label: "Optimism Sepolia", domain: 2 },
  "Mainnet":          { label: "Ethereum",         domain: 0 },
  "Arbitrum":         { label: "Arbitrum One",     domain: 3 },
};

// ── Pseudo-bytecode assembler ─────────────────────────────────────────────────

function renderDagActions(actions: DAGAction[], lines: string[], indent: string): void {
  for (const action of actions) {
    if (action.type === "swap") {
      lines.push(`${indent}via ${action.protocol} pool  fee=${action.fee_bps / 100}%`);
    } else if (action.type === "split") {
      lines.push(`${indent}SPLIT →`);
      for (const leg of action.legs) {
        const pct = (leg.fraction_bps / 100).toFixed(0);
        lines.push(`${indent}  leg ${pct}%:`);
        renderDagActions(leg.actions, lines, indent + "    ");
      }
    }
  }
}

function assemblePseudo(
  blocks: CanvasBlock[],
  quotes: Record<string, QuoteState>,
): string {
  if (blocks.length === 0) return "; (empty program)";
  const lines: string[] = [];
  blocks.forEach((b, i) => {
    const c = b.config;
    lines.push(`; ── Step ${i + 1}: ${blockLabel(b)} ──`);
    switch (b.type) {
      case "wrap_eth":
        lines.push(`CALL  WETH.deposit()  value=${c.amount ?? "?"} ETH`);
        lines.push(`POP`);
        break;
      case "unwrap_weth":
        lines.push(`CALL  WETH.withdraw(amount=${c.amount ?? "?"})`);
        lines.push(`POP`);
        break;
      case "approve":
        lines.push(`CALL  ${c.token ?? "TOKEN"}.approve(`);
        lines.push(`        spender=${c.spender ?? "?"},`);
        lines.push(`        amount=UINT256_MAX`);
        lines.push(`      )`);
        lines.push(`POP`);
        break;
      case "transfer":
        lines.push(`CALL  ${c.token ?? "TOKEN"}.transfer(`);
        lines.push(`        recipient=${c.recipient ?? "?"},`);
        lines.push(`        amount=${c.amount ?? "?"}`);
        lines.push(`      )`);
        lines.push(`POP`);
        break;
      case "swap": {
        const q = quotes[b.id];
        const minOut = q?.amount_out_human
          ? ` → ~${parseFloat(q.amount_out_human).toPrecision(5)} ${c.token_out} (${c.slippage_bps ?? "50"} bps slippage)`
          : "";
        const hasSplit = q?.dag?.actions.some((a) => a.type === "split");
        lines.push(`; build_${hasSplit ? "execution_program_for_dag" : "hops_program"}(${hasSplit ? "dag" : "swap_route_to_hops(route, defi_vm, sender)"})`);
        lines.push(`SWAP  ${c.amount_in ?? "?"} ${c.token_in ?? "?"} → ${c.token_out ?? "?"}${minOut}`);
        if (q?.dag) {
          renderDagActions(q.dag.actions, lines, "        ");
        }
        lines.push(`POP`);
        break;
      }
      case "cctp_bridge": {
        const domain = c.destination_chain ? (CCTP_CHAINS[c.destination_chain]?.domain ?? "?") : "?";
        lines.push(`CALL  CCTP.depositForBurnWithHook(`);
        lines.push(`        amount=${c.cctp_amount ?? "from stack"},`);
        lines.push(`        destinationDomain=${domain},`);
        lines.push(`        burnToken=USDC`);
        lines.push(`      )`);
        lines.push(`POP`);
        break;
      }
      case "call_contract":
        lines.push(`CALL  ${c.contract_address ?? "0x?"}(`);
        lines.push(`        data=${c.calldata ? c.calldata.slice(0, 18) + "…" : "0x"},`);
        lines.push(`        value=${c.call_value ?? "0"} ETH`);
        lines.push(`      )`);
        lines.push(`POP`);
        break;
    }
    lines.push("");
  });
  return lines.join("\n");
}

// ── Config form for a single block ────────────────────────────────────────────

function BlockConfigForm({
  block,
  symbols,
  quote,
  onChange,
}: {
  block: CanvasBlock;
  symbols: string[];
  quote: QuoteState | undefined;
  onChange: (id: string, patch: Partial<BlockConfig>) => void;
}) {
  const c = block.config;
  const set = (patch: Partial<BlockConfig>) => onChange(block.id, patch);

  const inputCls =
    "w-full bg-[#0d1117] border border-border-dim rounded-lg px-2.5 py-1.5 text-xs text-[#e8eaf0] focus:outline-none focus:border-cyan/40";
  const labelCls = "text-[10px] text-muted uppercase tracking-wider block mb-1";

  switch (block.type) {
    case "wrap_eth":
    case "unwrap_weth":
      return (
        <div>
          <label className={labelCls}>Amount ({block.type === "wrap_eth" ? "ETH" : "WETH"})</label>
          <input type="number" min="0" step="any" placeholder="0.1"
            value={c.amount ?? ""} onChange={(e) => set({ amount: e.target.value })}
            className={inputCls} />
        </div>
      );

    case "approve":
      return (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Token</label>
            <select value={c.token ?? ""} onChange={(e) => set({ token: e.target.value })}
              className={inputCls + " appearance-none"}>
              <option value="">Select token</option>
              {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Spender address</label>
            <input type="text" placeholder="0x…" value={c.spender ?? ""}
              onChange={(e) => set({ spender: e.target.value })} className={inputCls} />
          </div>
        </div>
      );

    case "transfer":
      return (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Token</label>
            <select value={c.token ?? ""} onChange={(e) => set({ token: e.target.value })}
              className={inputCls + " appearance-none"}>
              <option value="">Select</option>
              {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Amount</label>
            <input type="number" min="0" step="any" placeholder="1.0" value={c.amount ?? ""}
              onChange={(e) => set({ amount: e.target.value })} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Recipient</label>
            <input type="text" placeholder="0x…" value={c.recipient ?? ""}
              onChange={(e) => set({ recipient: e.target.value })} className={inputCls} />
          </div>
        </div>
      );

    case "swap":
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Token in</label>
              <select value={c.token_in ?? ""} onChange={(e) => set({ token_in: e.target.value })}
                className={inputCls + " appearance-none"}>
                <option value="">Select</option>
                {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Token out</label>
              <select value={c.token_out ?? ""} onChange={(e) => set({ token_out: e.target.value })}
                className={inputCls + " appearance-none"}>
                <option value="">Select</option>
                {symbols.filter((s) => s !== c.token_in).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Amount in</label>
              <input type="number" min="0" step="any" placeholder="1.0" value={c.amount_in ?? ""}
                onChange={(e) => set({ amount_in: e.target.value })} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Slippage (bps)</label>
              <input type="number" min="0" max="10000" step="1" placeholder="50" value={c.slippage_bps ?? ""}
                onChange={(e) => set({ slippage_bps: e.target.value })} className={inputCls} />
            </div>
            {/* Quote preview */}
            <div className="flex flex-col justify-end">
              {quote?.loading && (
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <Loader size={11} className="animate-spin" /> quoting…
                </span>
              )}
              {quote?.error && !quote.loading && (
                <span className="text-[10px] text-red-400 leading-tight">{quote.error}</span>
              )}
              {quote?.amount_out_human && !quote.loading && (
                <span className="text-xs text-green-400 font-mono">
                  ≈ {parseFloat(quote.amount_out_human).toPrecision(6)} {c.token_out}
                  {quote.price_impact && quote.price_impact !== "NaN" && (
                    <span className="text-muted ml-1 text-[10px]">
                      ({(parseFloat(quote.price_impact) * 100).toFixed(2)}% impact)
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
          {/* Split route legs */}
          {quote?.dag && !quote.loading && (() => {
            const splitAction = quote.dag!.actions.find((a): a is DAGSplit => a.type === "split");
            if (!splitAction) return null;
            return (
              <div className="rounded-lg border border-white/5 bg-[#0a0b0e] p-2.5 space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-muted mb-1.5">Split route</p>
                {splitAction.legs.map((leg, li) => (
                  <div key={li} className="flex items-start gap-2">
                    <span className="text-[10px] font-mono font-bold w-10 flex-shrink-0"
                      style={{ color: "#a78bfa" }}>
                      {(leg.fraction_bps / 100).toFixed(0)}%
                    </span>
                    <div className="flex flex-col gap-0.5">
                      {leg.actions.filter((a): a is DAGSwap => a.type === "swap").map((s, si) => (
                        <span key={si} className="text-[10px] text-[#94a3b8] font-mono">
                          {s.protocol}  fee={s.fee_bps / 100}%
                          <span className="text-muted ml-1.5">{s.pool_address.slice(0, 10)}…</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      );

    case "cctp_bridge":
      return (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Destination chain</label>
            <select value={c.destination_chain ?? ""} onChange={(e) => set({ destination_chain: e.target.value })}
              className={inputCls + " appearance-none"}>
              <option value="">Select chain</option>
              {Object.keys(CCTP_CHAINS).map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Amount (USDC) — leave blank for stack</label>
            <input type="number" min="0" step="any" placeholder="from stack" value={c.cctp_amount ?? ""}
              onChange={(e) => set({ cctp_amount: e.target.value })} className={inputCls} />
          </div>
        </div>
      );

    case "call_contract":
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Contract address</label>
              <input type="text" placeholder="0x…" value={c.contract_address ?? ""}
                onChange={(e) => set({ contract_address: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>ETH value</label>
              <input type="number" min="0" step="any" placeholder="0" value={c.call_value ?? ""}
                onChange={(e) => set({ call_value: e.target.value })} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Calldata (hex)</label>
            <input type="text" placeholder="0x..." value={c.calldata ?? ""}
              onChange={(e) => set({ calldata: e.target.value })} className={inputCls + " font-mono"} />
          </div>
        </div>
      );
  }
}

// ── URL serialization ─────────────────────────────────────────────────────────

const BLOCK_FIELD_ORDER: Record<BlockType, (keyof BlockConfig)[]> = {
  wrap_eth:      ["amount"],
  unwrap_weth:   ["amount"],
  approve:       ["token", "spender"],
  transfer:      ["token", "amount", "recipient"],
  swap:          ["token_in", "token_out", "amount_in", "slippage_bps"],
  cctp_bridge:   ["destination_chain", "cctp_amount"],
  call_contract: ["contract_address", "call_value", "calldata"],
};

function serializeBlock(block: CanvasBlock): string {
  const fields = BLOCK_FIELD_ORDER[block.type];
  const values = fields.map((f) => block.config[f] ?? "");
  while (values.length > 0 && values[values.length - 1] === "") values.pop();
  return [block.type, ...values].join(":");
}

function deserializeBlock(s: string): { type: BlockType; config: BlockConfig } | null {
  const parts = s.split(":");
  const type = parts[0] as BlockType;
  const fields = BLOCK_FIELD_ORDER[type];
  if (!fields) return null;
  const config: BlockConfig = {};
  fields.forEach((f, i) => { if (parts[i + 1]) config[f] = parts[i + 1]; });
  return { type, config };
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProgramBuilderPage() {
  const { address: walletAddress } = useAccount();

  const [blocks, setBlocks] = useState<CanvasBlock[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pools, setPools] = useState<Pool[]>([]);
  const [quotes, setQuotes] = useState<Record<string, QuoteState>>({});
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [sender, setSender] = useState("");
  const [senderError, setSenderError] = useState(false);
  const [invalidBlockId, setInvalidBlockId] = useState<string | null>(null);
  const quoteTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // ── URL state sync ───────────────────────────────────────────────────────────

  useUrlRestoreOnce((p) => {
    const steps = p.getAll("step");
    const s = p.get("sender");
    if (steps.length === 0 && !s) return;
    if (steps.length > 0) {
      const restored: CanvasBlock[] = steps
        .map(deserializeBlock)
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .map((item) => ({
          id: `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: item.type,
          config: item.config,
        }));
      if (restored.length > 0) setBlocks(restored);
    }
    if (s) setSender(s);
  });

  useUrlWrite(() => {
    const p = new URLSearchParams();
    for (const block of blocks) p.append("step", serializeBlock(block));
    if (sender) p.set("sender", sender);
    return p;
  }, [blocks, sender]);

  // Load pools once for token symbol lists
  useEffect(() => {
    fetchPools().then(setPools).catch(() => {});
  }, []);

  // Sync sender from connected wallet (user can still override manually)
  useEffect(() => {
    if (walletAddress) {
      setSender(walletAddress);
      setSenderError(false);
    }
  }, [walletAddress]);

  const symbols = useMemo(() => {
    const set = new Set<string>();
    for (const p of pools) {
      set.add(p.token0_symbol);
      set.add(p.token1_symbol);
    }
    return Array.from(set).sort();
  }, [pools]);

  // Full token metadata keyed by symbol — used to send TokenRef objects to the API.
  const tokenNodes = useMemo(() => {
    const map: Record<string, { address: string; symbol: string; decimals: number; chain_id: number }> = {};
    for (const p of pools) {
      map[p.token0_symbol] ??= { address: p.token0_address, symbol: p.token0_symbol, decimals: p.token0_decimals, chain_id: p.chain_id };
      map[p.token1_symbol] ??= { address: p.token1_address, symbol: p.token1_symbol, decimals: p.token1_decimals, chain_id: p.chain_id };
    }
    return map;
  }, [pools]);

  // ── Block mutations ──────────────────────────────────────────────────────

  const addBlock = useCallback((type: BlockType) => {
    const id = `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    let config: BlockConfig = {};
    if (type === "swap" && blocks.length > 0) {
      const prev = blocks[blocks.length - 1];
      if (prev.type === "wrap_eth") {
        config = { token_in: "WETH" };
      } else if (prev.type === "swap" && prev.config.token_out) {
        config = { token_in: prev.config.token_out };
      }
    }
    setBlocks((bs) => [...bs, { id, type, config }]);
    setExpanded(id);
  }, [blocks]);

  const removeBlock = useCallback((id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    setExpanded((e) => (e === id ? null : e));
    setQuotes((q) => { const next = { ...q }; delete next[id]; return next; });
  }, []);

  const moveBlock = useCallback((id: string, dir: -1 | 1) => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }, []);

  const updateConfig = useCallback((id: string, patch: Partial<BlockConfig>) => {
    setInvalidBlockId((prev) => (prev === id ? null : prev));
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, config: { ...b.config, ...patch } } : b))
    );
  }, []);

  // ── Auto-quote for swap blocks ───────────────────────────────────────────

  useEffect(() => {
    for (const block of blocks) {
      if (block.type !== "swap") continue;
      const { token_in, token_out, amount_in } = block.config;
      const id = block.id;

      if (quoteTimers.current[id]) clearTimeout(quoteTimers.current[id]);

      if (!token_in || !token_out || !amount_in || parseFloat(amount_in) <= 0) {
        setQuotes((q) => {
          const next = { ...q };
          delete next[id];
          return next;
        });
        continue;
      }

      quoteTimers.current[id] = setTimeout(async () => {
        const tokIn = tokenNodes[token_in];
        const tokOut = tokenNodes[token_out];
        if (!tokIn || !tokOut) return;

        setQuotes((q) => ({ ...q, [id]: { loading: true } }));
        try {
          const res = await fetch("/api/swap/quote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token_in: tokIn,
              token_out: tokOut,
              amount_in,
            }),
          });
          if (!res.ok) {
            const text = await res.text().catch(() => res.statusText);
            let detail = text;
            try { detail = JSON.parse(text).detail ?? text; } catch { /* ignore */ }
            throw new Error(detail);
          }
          const data = await res.json();
          setQuotes((q) => ({
            ...q,
            [id]: {
              loading: false,
              amount_out_human: data.amount_out_human,
              price_impact: data.price_impact,
              dag: data.dag,
            },
          }));
        } catch (e: unknown) {
          setQuotes((q) => ({
            ...q,
            [id]: { loading: false, error: e instanceof Error ? e.message : String(e) },
          }));
        }
      }, 500);
    }
    // Cleanup timers on unmount
    const timers = quoteTimers.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, tokenNodes]);

  // ── Run / build ──────────────────────────────────────────────────────────

  const handleRun = useCallback(async () => {
    if (blocks.length === 0) return;

    const swapBlocks = blocks.filter((b) => b.type === "swap");
    if (swapBlocks.length === 0) {
      setRunResult({ ok: false, message: "No Swap block in program. Add a Swap block to build calldata." });
      return;
    }
    const swapBlock = swapBlocks[0];
    const { token_in: symIn, token_out: symOut, amount_in, slippage_bps } = swapBlock.config;

    // Highlight incomplete swap block and expand it for the user to fix
    if (!symIn || !symOut || !amount_in || parseFloat(amount_in) <= 0) {
      setInvalidBlockId(swapBlock.id);
      setExpanded(swapBlock.id);
      setRunResult({ ok: false, message: "Swap block is incomplete — fill in token_in, token_out, and amount_in." });
      return;
    }

    // Highlight missing sender input
    if (!sender.trim()) {
      setSenderError(true);
      setRunResult({ ok: false, message: "Connect your wallet or enter a sender address." });
      return;
    }

    const tokIn = tokenNodes[symIn];
    const tokOut = tokenNodes[symOut];
    if (!tokIn || !tokOut) {
      setInvalidBlockId(swapBlock.id);
      setExpanded(swapBlock.id);
      setRunResult({ ok: false, message: `Unknown token symbol: ${!tokIn ? symIn : symOut}` });
      return;
    }

    setInvalidBlockId(null);
    setSenderError(false);
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch("/api/swap/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token_in: tokIn,
          token_out: tokOut,
          amount_in,
          slippage_bps: slippage_bps ? parseInt(slippage_bps) : 50,
          sender: sender.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRunResult({ ok: false, message: data.detail ?? res.statusText });
      } else {
        setRunResult({ ok: true, message: JSON.stringify(data, null, 2) });
      }
    } catch (e: unknown) {
      setRunResult({ ok: false, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
    }
  }, [blocks, tokenNodes, sender]);

  const pseudocode = useMemo(() => assemblePseudo(blocks, quotes), [blocks, quotes]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-[#e8eaf0] mb-1">DeFi Program Builder</h2>
        <p className="text-sm text-muted">
          Compose pydefi VM operations into a multi-step on-chain program
        </p>
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4" style={{ minHeight: 520 }}>
        {/* Block Palette */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Operations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 p-3">
            {BLOCK_DEFS.map((def) => {
              const Icon = def.icon;
              return (
                <button
                  key={def.type}
                  onClick={() => addBlock(def.type as BlockType)}
                  className="w-full flex items-start gap-2.5 p-2.5 rounded-xl border border-border-dim hover:border-opacity-60 transition-all text-left group"
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: `${def.color}15`, border: `1px solid ${def.color}30` }}
                  >
                    <Icon size={13} style={{ color: def.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-[#e8eaf0]">{def.label}</p>
                    <p className="text-[10px] text-muted mt-0.5 leading-tight">{def.desc}</p>
                  </div>
                  <Plus size={11} className="text-muted group-hover:text-cyan transition-colors flex-shrink-0 mt-1" />
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Canvas */}
        <Card className="lg:col-span-3 flex flex-col">
          <CardHeader>
            <CardTitle>Canvas</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted">{blocks.length} step{blocks.length !== 1 ? "s" : ""}</span>
              <input
                type="text"
                placeholder="Sender wallet 0x…"
                value={sender}
                onChange={(e) => { setSender(e.target.value); setSenderError(false); }}
                className={cn(
                  "bg-[#0d1117] border rounded-lg px-2.5 py-1 text-xs text-[#e8eaf0] focus:outline-none font-mono w-52 transition-colors",
                  senderError && !sender.trim()
                    ? "border-red-500/70 focus:border-red-500"
                    : "border-border-dim focus:border-cyan/40"
                )}
              />
              <button
                onClick={handleRun}
                disabled={running || blocks.length === 0}
                className={cn(
                  "flex items-center gap-1.5 text-xs px-3 py-1 rounded-lg border transition-all",
                  blocks.length === 0
                    ? "border-border-dim text-muted opacity-40 cursor-not-allowed"
                    : "border-green-500/30 text-green-400 hover:bg-green-500/10"
                )}
              >
                {running ? <Loader size={11} className="animate-spin" /> : <Play size={11} />}
                Build & Execute
              </button>
            </div>
          </CardHeader>

          <CardContent className="flex-1 p-3">
            {blocks.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center min-h-64">
                <div className="w-14 h-14 rounded-2xl bg-border-dim/30 flex items-center justify-center mb-3">
                  <Plus size={22} className="text-muted" />
                </div>
                <p className="text-sm font-medium text-muted mb-1">Canvas is empty</p>
                <p className="text-xs text-muted/60">Click an operation from the palette to add it</p>
              </div>
            ) : (
              <div className="space-y-2">
                {blocks.map((block, index) => {
                  const def = defFor(block.type);
                  const Icon = def.icon;
                  const isExpanded = expanded === block.id;
                  return (
                    <div key={block.id} className="relative">
                      {/* Connector */}
                      {index < blocks.length - 1 && (
                        <div
                          className="absolute left-[18px] top-full w-0.5 h-2 z-10"
                          style={{ backgroundColor: `${def.color}35` }}
                        />
                      )}

                      <div
                        className="border rounded-xl transition-all"
                        style={{
                          backgroundColor: `${def.color}06`,
                          borderColor:
                            invalidBlockId === block.id
                              ? "#ef444460"
                              : isExpanded
                              ? `${def.color}40`
                              : `${def.color}18`,
                        }}
                      >
                        {/* Header row — click anywhere to toggle */}
                        <div
                          className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer select-none"
                          onClick={() => setExpanded((e) => (e === block.id ? null : block.id))}
                        >
                          {/* Step number */}
                          <div
                            className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold font-mono flex-shrink-0"
                            style={{ backgroundColor: `${def.color}20`, color: def.color, border: `1px solid ${def.color}30` }}
                          >
                            {index + 1}
                          </div>

                          <Icon size={13} style={{ color: def.color }} className="flex-shrink-0" />

                          <span className="text-xs font-medium text-[#e8eaf0] flex-1 min-w-0 truncate">
                            {blockLabel(block)}
                          </span>

                          {/* Quote badge */}
                          {block.type === "swap" && quotes[block.id]?.amount_out_human && !quotes[block.id]?.loading && (
                            <span className="text-[10px] text-green-400 font-mono">
                              ≈{parseFloat(quotes[block.id].amount_out_human!).toPrecision(4)} {block.config.token_out}
                            </span>
                          )}
                          {block.type === "swap" && quotes[block.id]?.dag?.actions.some((a) => a.type === "split") && !quotes[block.id]?.loading && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded-md flex items-center gap-1"
                              style={{ backgroundColor: "#8b5cf615", color: "#a78bfa", border: "1px solid #8b5cf630" }}
                            >
                              split ↓
                            </span>
                          )}
                          {block.type === "swap" && quotes[block.id]?.loading && (
                            <Loader size={11} className="animate-spin text-muted" />
                          )}

                          {/* Controls */}
                          <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => moveBlock(block.id, -1)} disabled={index === 0}
                              className="p-1 rounded hover:bg-white/5 text-muted disabled:opacity-20 transition-colors">
                              <ArrowUp size={11} />
                            </button>
                            <button onClick={() => moveBlock(block.id, 1)} disabled={index === blocks.length - 1}
                              className="p-1 rounded hover:bg-white/5 text-muted disabled:opacity-20 transition-colors">
                              <ArrowDown size={11} />
                            </button>
                            <button
                              onClick={() => setExpanded((e) => (e === block.id ? null : block.id))}
                              className="p-1 rounded hover:bg-white/5 text-muted transition-colors"
                            >
                              {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            </button>
                            <button onClick={() => removeBlock(block.id)}
                              className="p-1 rounded hover:bg-red-500/10 text-muted hover:text-red-400 transition-colors">
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>

                        {/* Expanded config form */}
                        {isExpanded && (
                          <div className="px-3 pb-3 border-t border-white/5 pt-3">
                            <BlockConfigForm
                              block={block}
                              symbols={symbols}
                              quote={quotes[block.id]}
                              onChange={updateConfig}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Add more hint */}
                <div className="flex items-center gap-2.5 p-2.5 rounded-xl border border-dashed border-border-dim text-muted hover:border-cyan/20 transition-colors">
                  <Plus size={13} className="ml-8" />
                  <span className="text-xs">Add operation from palette</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Program Preview */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-cyan" />
            <CardTitle>Program Preview</CardTitle>
          </div>
          <p className="text-xs text-muted">Pseudo-bytecode assembled from canvas steps</p>
        </CardHeader>
        <CardContent className="p-0">
          <pre className="p-4 text-[11px] font-mono text-[#94a3b8] leading-5 overflow-x-auto bg-[#0a0b0e] rounded-b-xl whitespace-pre">
            {pseudocode}
          </pre>
        </CardContent>
      </Card>

      {/* Run result */}
      {runResult && (
        <Card>
          <CardContent className="py-3 px-4">
            <p className={cn("text-xs font-mono", runResult.ok ? "text-green-400" : "text-amber-400")}>
              {runResult.message}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
