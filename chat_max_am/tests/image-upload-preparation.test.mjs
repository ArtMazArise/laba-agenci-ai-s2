import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import * as react from 'react';
import * as jsx from 'react/jsx-runtime';
import { loadImagesModule } from './images-helper.mjs';

const source = await readFile(new URL('../app/image-attachments.tsx', import.meta.url), 'utf8');
const context = vm.createContext({ atob, FileReader: class { constructor() { assert.fail('Nie wolno odczytywać nieprawidłowego pliku'); } }, createImageBitmap: () => assert.fail('Nie wolno dekodować zbyt dużego pliku'), fetch: () => assert.fail('Nie wolno wysyłać pliku') });
const images = await loadImagesModule(context);
const runtime = (values) => new vm.SyntheticModule(Object.keys(values), function () { for (const [key, value] of Object.entries(values)) this.setExport(key, value); }, { context });
const reactModule = runtime(react), jsxModule = runtime(jsx);
const module = new vm.SourceTextModule(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { context });
await module.link((name) => ({ react: reactModule, 'react/jsx-runtime': jsxModule, '@/lib/chat-images': images })[name]);
await module.evaluate();

test('PDF jest odrzucany w przygotowaniu przeglądarki, przed odczytem i wysłaniem', async () => {
  await assert.rejects(module.namespace.prepareImagePart({ type: 'application/pdf', name: 'test.pdf', size: 1000 }), /PNG, JPG lub WebP/);
});

test('plik ponad 4 MB jest odrzucany przed dekodowaniem i wysłaniem', async () => {
  await assert.rejects(module.namespace.prepareImagePart({ type: 'image/png', name: 'test.png', size: 4 * 1024 * 1024 + 1 }), /maksymalnie 4 MB/);
});
