import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";

let lastCommit = "";
try {
  lastCommit = execFileSync("git", ["log", "-1", "--format=%cI", "--", "."], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
} catch { /* Bez historii Git pokażemy datę builda, zamiast udawać datę zmiany. */ }

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_UPDATED_AT: lastCommit || new Date().toISOString(),
    NEXT_PUBLIC_APP_DATE_KIND: lastCommit ? "zmiana" : "build",
  },
  experimental: {
    // Projekt używa TypeScript 5: sprawdzamy typy bezpośrednio przez jego API.
    useTypeScriptCli: false,
  },
};

export default nextConfig;
