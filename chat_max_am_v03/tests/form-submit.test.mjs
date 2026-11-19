import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../lib/form-submit.ts', import.meta.url), 'utf8');
const module = new vm.SourceTextModule(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText);
await module.link(() => { throw Error('Unexpected import'); });
await module.evaluate();
function press(overrides = {}) {
  let prevented = 0, submissions = 0;
  module.namespace.submitOnEnter({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, preventDefault: () => prevented++, currentTarget: { form: { requestSubmit: () => submissions++ } }, ...overrides });
  return { prevented, submissions };
}
test('Enter uruchamia formularz raz i blokuje domyślną nową linię', () => assert.deepEqual(press(), { prevented: 1, submissions: 1 }));
test('Shift+Enter, zwykłe znaki i pisanie IME nie wysyłają formularza', () => {
  for (const event of [{ shiftKey: true }, { key: 'a' }, { nativeEvent: { isComposing: true } }]) assert.deepEqual(press(event), { prevented: 0, submissions: 0 });
});
