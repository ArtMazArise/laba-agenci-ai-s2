import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { png } from './images-helper.mjs';
const source = await readFile(new URL('../lib/clipboard.ts', import.meta.url), 'utf8');
async function setup(overrides = {}) {
  const calls = [];
  class Item { constructor(data) { this.data = data; } }
  const context = vm.createContext({ Blob, fetch: async (url) => {
    assert.equal(url, png.url);
    return new Response(Buffer.from(url.split(',')[1], 'base64'), { headers: { 'content-type': 'image/png' } });
  }, navigator: { clipboard: { writeText: async (text) => calls.push({ text }), write: async (items) => { await Promise.all(items.flatMap((item) => Object.values(item.data))); calls.push({ items }); } } }, ClipboardItem: Item, ...overrides });
  const module = new vm.SourceTextModule(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, { context });
  await module.link(() => { throw Error('Unexpected clipboard import'); });
  await module.evaluate();
  return { calls, copy: module.namespace.copyClipboardContent };
}

test('tekst zachowuje writeText, a sam obraz trafia do schowka jako PNG', async () => {
  const app = await setup();
  await app.copy({ text: 'Tekst' });
  assert.equal(app.calls[0].text, 'Tekst');
  await app.copy({ text: '', imageUrl: png.url, imageOnly: true });
  const data = app.calls[1].items[0].data;
  assert.deepEqual(Object.keys(data), ['image/png']);
  const blob = await data['image/png'];
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), Buffer.from(png.url.split(',')[1], 'base64'));
});

test('tekst i grafika są reprezentacjami jednego elementu schowka', async () => {
  const app = await setup();
  await app.copy({ text: 'Generator: obraz', html: `<p>Generator: obraz</p><img src="${png.url}">`, imageUrl: png.url });
  const data = app.calls[0].items[0].data;
  assert.equal(await data['text/plain'].text(), 'Generator: obraz');
  assert.match(await data['text/html'].text(), /<img/);
  assert.equal((await data['image/png']).type, 'image/png');
});

test('nieobsługiwany schowek obrazów i blokada nie udają sukcesu tekstowego', async () => {
  let writes = 0;
  const app = await setup({ ClipboardItem: undefined, navigator: { clipboard: { writeText: async () => writes++ } } });
  await assert.rejects(app.copy({ text: 'Opis', imageUrl: png.url }), /nie obsługuje kopiowania grafiki/);
  assert.equal(writes, 0);
  const denied = await setup({ navigator: { clipboard: { write: async () => { throw Error('permission denied'); } } } });
  await assert.rejects(denied.copy({ text: 'Opis', html: '<p>Opis</p>' }), /permission denied/);
});

test('zewnętrzne obrazy nie są pobierane przy kopiowaniu', async () => {
  const app = await setup({ fetch: () => assert.fail('Nie wolno pobierać zewnętrznego URL') });
  await assert.rejects(app.copy({ text: '', imageUrl: 'https://private.example/image.png', imageOnly: true }), /Nieprawidłowy obraz/);
});
