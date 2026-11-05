import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Projekt używa TypeScript 5: sprawdzamy typy bezpośrednio przez jego API.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
