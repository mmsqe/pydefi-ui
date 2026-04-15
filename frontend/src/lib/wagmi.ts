import { createConfig, http } from "wagmi";
import { mainnet, sepolia, base, arbitrum, polygon } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const config = createConfig({
  chains: [mainnet, sepolia, base, arbitrum, polygon],
  connectors: [injected()],
  ssr: true, // defer reconnection until after hydration to avoid SSR mismatch
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
    [base.id]: http(),
    [arbitrum.id]: http(),
    [polygon.id]: http(),
  },
});
