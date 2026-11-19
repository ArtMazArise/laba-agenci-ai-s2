import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

// Zawsze własny obiekt konfiguracji i env testu; bez .env.local.
const source = await readFile(new URL("../lib/settings.ts", import.meta.url), "utf8");
export async function loadSettingsModule(context, config = {}) {
  const module = new vm.SourceTextModule(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText, { context });
  const file = new vm.SyntheticModule(["default"], function () { this.setExport("default", config); }, { context });
  await module.link((name) => {
    if (name === "../config.json") return file;
    throw Error(`Unexpected settings import: ${name}`);
  });
  return module;
}
