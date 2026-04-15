import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: "#0f1117",
        card: "#13161e",
        "border-dim": "#1e2132",
        cyan: "#00d4ff",
        purple: "#8b5cf6",
        green: "#00ff87",
        muted: "#64748b",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      boxShadow: {
        "cyan-glow": "0 0 12px rgba(0, 212, 255, 0.4)",
        "purple-glow": "0 0 12px rgba(139, 92, 246, 0.4)",
        "green-glow": "0 0 12px rgba(0, 255, 135, 0.4)",
        "neon-border": "0 0 0 1px rgba(0, 212, 255, 0.3), 0 0 8px rgba(0, 212, 255, 0.15)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
