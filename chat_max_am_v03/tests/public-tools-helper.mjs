import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { tool, jsonSchema } from "ai";

const source = await readFile(new URL("../lib/public-tools.ts", import.meta.url), "utf8");
export async function loadPublicToolsModule(context) {
  const module = new vm.SourceTextModule(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, { context });
  const ai = new vm.SyntheticModule(["tool", "jsonSchema"], function () {
    this.setExport("tool", tool);
    this.setExport("jsonSchema", jsonSchema);
  }, { context });
  await module.link((name) => { if (name === "ai") return ai; throw Error(`Unexpected public-tools import: ${name}`); });
  return module;
}
