import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { png } from './images-helper.mjs';
const source = await readFile(new URL('../lib/image-download.ts', import.meta.url), 'utf8');
async function setup(overrides = {}) {
  const context = vm.createContext({ window: {}, fetch: async (url) => {
    assert.equal(url, png.url);
    return new Response(Buffer.from(url.split(',')[1], 'base64'), { headers: { 'content-type': 'image/png' } });
  }, ...overrides });
  const module = new vm.SourceTextModule(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, { context });
  await module.link(() => { throw Error('Unexpected download import'); });
  await module.evaluate();
  return module.namespace;
}
const now = new Date('2026-11-15T12:30:00Z');

test('nazwa obrazu: bez ścieżek, polskich znaków, z datą Warszawy i właściwym rozszerzeniem', async () => {
  const app = await setup();
  const info = app.imageDownloadInfo(png.url, 'Opis: Żółta czaszka MAX / logo', now);
  assert.equal(info.filename, 'max-zolta-czaszka-max-logo-20261115-133000.png');
  assert.equal(info.extension, '.png');
  assert.ok(app.imageDownloadInfo(png.url.replace('image/png', 'image/jpeg'), 'Logo', now).filename.endsWith('.jpg'));
  assert.throws(() => app.imageDownloadInfo('https://private.example/file.png', 'Logo', now), /Nieprawidłowy obraz/);
});

test('okno zapisu podpowiada Pobrane, nazwę i typ; zapisuje oryginalne bajty', async () => {
  let options, saved, closed = false;
  const app = await setup({ window: { showSaveFilePicker: async (value) => { options = value; return { createWritable: async () => ({ write: async (blob) => { saved = blob; }, close: async () => { closed = true; } }) }; } } });
  assert.equal(await app.saveImageToDevice(png.url, 'Logo', now), 'saved');
  assert.equal(options.startIn, 'downloads');
  assert.equal(options.suggestedName, 'max-logo-20261115-133000.png');
  assert.equal(options.types[0].accept['image/png'][0], '.png');
  assert.deepEqual(Buffer.from(await saved.arrayBuffer()), Buffer.from(png.url.split(',')[1], 'base64'));
  assert.equal(closed, true);
});

test('anulowanie okna nie uruchamia pobrania ani nie udaje zapisu', async () => {
  const app = await setup({ window: { showSaveFilePicker: async () => { const error = new Error('cancelled'); error.name = 'AbortError'; throw error; } }, fetch: () => assert.fail('Anulowano przed odczytem pliku') });
  assert.equal(await app.saveImageToDevice(png.url, 'Logo', now), 'cancelled');
});

test('fallback pobierania zachowuje nazwę pliku, klika link i sprząta obiektowy URL', async () => {
  let clicked = false, removed = false, revoked;
  const anchor = { click() { clicked = true; }, remove() { removed = true; } };
  const app = await setup({ document: { createElement: (tag) => { assert.equal(tag, 'a'); return anchor; }, body: { appendChild: (node) => assert.equal(node, anchor) } }, URL: { createObjectURL: () => 'blob:test', revokeObjectURL: (url) => { revoked = url; } }, setTimeout: (callback) => { callback(); return 1; } });
  assert.equal(await app.saveImageToDevice(png.url, 'Logo', now), 'downloaded');
  assert.equal(anchor.download, 'max-logo-20261115-133000.png');
  assert.equal(clicked, true);
  assert.equal(removed, true);
  assert.equal(revoked, 'blob:test');
});
