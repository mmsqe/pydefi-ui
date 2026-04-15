"use client";

import { useRef, useState, useEffect } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { cn } from "@/lib/utils";
import { useSidebar } from "./sidebar-context";
import { Wallet, LogOut, ChevronDown, Loader } from "lucide-react";

interface TopbarProps {
  title?: string;
}

// Chain metadata keyed by chainId
const CHAIN_META: Record<number, { label: string; color: string }> = {
  1: { label: "ETH", color: "#627EEA" },
  11155111: { label: "Sepolia", color: "#627EEA" },
  8453: { label: "Base", color: "#0052FF" },
  42161: { label: "ARB", color: "#28A0F0" },
  137: { label: "POLY", color: "#8247E5" },
};

// Fallback badges when no wallet connected
const DEFAULT_CHAINS = [1, 11155111, 8453, 42161, 137];

function truncate(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function WalletButton() {
  const { address, isConnected, chain } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // Render a stable placeholder until client has hydrated so SSR and initial
  // client HTML match exactly (prevents React hydration mismatch).
  if (!mounted) {
    return (
      <div className="w-32 h-8 rounded-xl bg-card border border-border-dim animate-pulse" />
    );
  }

  // Close dropdown when clicking outside
  const handleBlur = (e: React.FocusEvent) => {
    if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false);
  };

  if (!isConnected) {
    return (
      <button
        onClick={() => connect({ connector: injected() })}
        disabled={isPending}
        className="flex items-center gap-2 bg-cyan/10 border border-cyan/25 rounded-xl px-3 py-1.5 text-xs font-semibold text-cyan hover:bg-cyan/15 hover:border-cyan/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? (
          <Loader size={13} className="animate-spin" />
        ) : (
          <Wallet size={13} />
        )}
        {isPending ? "Connecting…" : "Connect Wallet"}
      </button>
    );
  }

  const chainMeta = chain ? CHAIN_META[chain.id] : undefined;

  return (
    <div ref={ref} className="relative" onBlur={handleBlur} tabIndex={-1}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 bg-card border border-border-dim rounded-xl px-3 py-1.5 hover:border-cyan/30 transition-colors cursor-pointer group"
      >
        {/* Chain dot */}
        {chainMeta && (
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: chainMeta.color }}
          />
        )}
        {/* Avatar */}
        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-cyan/30 to-purple/30 border border-cyan/20 flex items-center justify-center text-[7px] font-bold text-cyan flex-shrink-0">
          0x
        </div>
        <span className="text-xs font-mono text-[#94a3b8] group-hover:text-[#e8eaf0] transition-colors">
          {truncate(address!)}
        </span>
        {chainMeta && (
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md hidden sm:inline"
            style={{
              backgroundColor: `${chainMeta.color}18`,
              color: chainMeta.color,
            }}
          >
            {chainMeta.label}
          </span>
        )}
        <ChevronDown
          size={11}
          className={cn(
            "text-muted transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-card border border-border-dim rounded-xl shadow-xl overflow-hidden z-50">
          {/* Address */}
          <div className="px-4 py-3 border-b border-border-dim/60">
            <p className="text-[10px] text-muted uppercase tracking-wider mb-1">Connected</p>
            <p className="text-xs font-mono text-[#e8eaf0] break-all">{address}</p>
          </div>
          {/* Network */}
          {chain && (
            <div className="px-4 py-2.5 border-b border-border-dim/60 flex items-center gap-2">
              {chainMeta && (
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: chainMeta.color }}
                />
              )}
              <span className="text-xs text-[#94a3b8]">{chain.name}</span>
            </div>
          )}
          {/* Disconnect */}
          <button
            onClick={() => { disconnect(); setOpen(false); }}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <LogOut size={13} />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export function Topbar({ title = "Dashboard" }: TopbarProps) {
  const { collapsed } = useSidebar();
  const { chain } = useAccount();

  return (
    <header
      className={cn(
        "fixed top-0 right-0 h-14 z-30 flex items-center px-4 bg-surface/80 backdrop-blur-md border-b border-border-dim transition-all duration-300",
        collapsed ? "left-16" : "left-60"
      )}
    >
      {/* Page title */}
      <div className="flex-1">
        <h1 className="text-sm font-semibold text-[#e8eaf0]">{title}</h1>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Chain badges — highlight active chain */}
        <div className="hidden md:flex items-center gap-1.5">
          {DEFAULT_CHAINS.map((id) => {
            const meta = CHAIN_META[id];
            if (!meta) return null;
            const active = chain?.id === id;
            return (
              <span
                key={id}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all",
                  active ? "opacity-100" : "opacity-30"
                )}
                style={{
                  backgroundColor: `${meta.color}15`,
                  borderColor: `${meta.color}30`,
                  color: meta.color,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: meta.color }}
                />
                {meta.label}
              </span>
            );
          })}
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-border-dim hidden md:block" />

        {/* Real wallet button */}
        <WalletButton />
      </div>
    </header>
  );
}
