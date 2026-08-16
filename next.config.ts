import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // yahoo-finance2 is a server-only Node library; keep it out of the client bundle.
  serverExternalPackages: ["yahoo-finance2"],
};

export default nextConfig;
