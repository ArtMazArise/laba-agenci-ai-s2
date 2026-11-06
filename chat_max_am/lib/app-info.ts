import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { version } from "../package.json";
import type { AppInfo } from "../app/build-info";

async function latestLocalChange() {
  const root = process.cwd();
  let latest = 0;
  async function inspect(name: string) {
    const filename = path.join(root, name);
    const info = await stat(filename);
    if (info.isDirectory()) {
      for (const entry of await readdir(filename, { withFileTypes: true })) {
        if (!entry.isSymbolicLink() && !entry.name.startsWith(".")) await inspect(path.join(name, entry.name));
      }
    } else latest = Math.max(latest, info.mtimeMs);
  }
  // Wyłącznie pliki źródłowe. Bez czytania .env i katalogów stanu/sesji.
  for (const name of ["app", "lib", "scripts", "tests", "package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "README.md", "DEPLOY.md"]) {
    await inspect(name).catch(() => {});
  }
  return latest ? new Date(latest) : null;
}

export async function getAppInfo(): Promise<AppInfo> {
  const onVercel = process.env.VERCEL === "1";
  const localChange = onVercel ? null : await latestLocalChange();
  const rawDate = localChange || process.env.NEXT_PUBLIC_APP_UPDATED_AT;
  const date = rawDate ? new Date(rawDate) : null;
  return {
    version: version.split(".").slice(1).map((part) => part.padStart(2, "0")).join("."),
    updatedAt: date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("pl-PL", {
      timeZone: "Europe/Warsaw", dateStyle: "short", timeStyle: "short",
    }).format(date) : "brak danych",
    dateKind: localChange ? "zmiana" : process.env.NEXT_PUBLIC_APP_DATE_KIND || "build",
    location: onVercel ? process.env.VERCEL_ENV === "preview" ? "Vercel · podgląd" : "Vercel · produkcja" : "Lokalnie",
  };
}
