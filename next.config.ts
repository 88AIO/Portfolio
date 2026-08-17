import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-only Node libraries; keep them out of the client bundle.
  serverExternalPackages: ["yahoo-finance2", "snaptrade-typescript-sdk"],
};

export default nextConfig;
