import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/api/:path*",
      },
    ];
  },
  webpack(config, { webpack }) {
    // wagmi bundles connectors (porto, baseAccount, coinbaseWallet, safe, walletconnect)
    // whose peer deps are not installed. We only use injected(), so replace every
    // missing package with an empty stub using NormalModuleReplacementPlugin, which
    // intercepts at the resolution level (more reliable than resolve.alias for subpaths).
    const stub = path.join(__dirname, "src/lib/porto-stub.js");
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^(porto|porto\/internal|@base-org\/account|@coinbase\/wallet-sdk|@metamask\/connect-evm|@safe-global\/safe-apps-provider|@safe-global\/safe-apps-sdk|@walletconnect\/ethereum-provider)$/,
        stub
      )
    );
    return config;
  },
};

export default nextConfig;
