import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source = await readFile(new URL('../lib/chat-timing.ts', import.meta.url), 'utf8');
export async function loadTimingModule(context) {
  const module = new vm.SourceTextModule(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, { context });
  await module.link(() => { throw Error('Unexpected timing import'); });
  return module;
}
