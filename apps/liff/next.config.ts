import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
// Next loads .env.local before this file. Hostname only, e.g. dev-alice.example.com.
const devTunnelHost = process.env.DEV_TUNNEL_HOST?.trim();

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
  allowedDevOrigins: devTunnelHost ? [devTunnelHost] : [],
};

export default nextConfig;
