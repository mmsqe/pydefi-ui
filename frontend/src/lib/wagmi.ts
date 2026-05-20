import { createConfig, http } from "wagmi";
import { mainnet, sepolia, base, arbitrum, polygon } from "wagmi/chains";
import { injected } from "wagmi/connectors";

// Override mainnet's transport via NEXT_PUBLIC_MAINNET_RPC_URL — set this to
// http://127.0.0.1:8545 when developing against an anvil mainnet fork so that
// useWaitForTransactionReceipt sees txs the wallet broadcasted to the fork.
const MAINNET_RPC =
  process.env.NEXT_PUBLIC_MAINNET_RPC_URL || "https://cloudflare-eth.com";

export const config = createConfig({
  chains: [mainnet, sepolia, base, arbitrum, polygon],
  connectors: [injected()],
  ssr: true, // defer reconnection until after hydration to avoid SSR mismatch
  transports: {
    [mainnet.id]:  http(MAINNET_RPC),
    [sepolia.id]:  http("https://rpc.sepolia.org"),
    [base.id]:     http("https://mainnet.base.org"),
    [arbitrum.id]: http("https://arb1.arbitrum.io/rpc"),
    [polygon.id]:  http("https://polygon-rpc.com"),
  },
});
