import { createConfig, http } from "wagmi";
import { mainnet, sepolia, base, arbitrum, polygon } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const config = createConfig({
  chains: [mainnet, sepolia, base, arbitrum, polygon],
  connectors: [injected()],
  ssr: true, // defer reconnection until after hydration to avoid SSR mismatch
  transports: {
    [mainnet.id]:  http("https://cloudflare-eth.com"),
    [sepolia.id]:  http("https://rpc.sepolia.org"),
    [base.id]:     http("https://mainnet.base.org"),
    [arbitrum.id]: http("https://arb1.arbitrum.io/rpc"),
    [polygon.id]:  http("https://polygon-rpc.com"),
  },
});
