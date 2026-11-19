import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { loadImagesModule, png } from './images-helper.mjs';
const module = await loadImagesModule(vm.createContext({ atob }));
await module.evaluate();
const { imageByteLength, validateChatImages } = module.namespace;
const message = (files) => ({ role: 'user', parts: files });

test('PNG przechodzi walidację i ma prawidłowy rozmiar po dekodowaniu', () => {
  assert.equal(imageByteLength(png), Buffer.from(png.url.split(',')[1], 'base64').length);
  validateChatImages([message([png])]);
});

test('obrazy: zły format, zewnętrzne URL, podmieniony MIME i wadliwe base64 są odrzucane', () => {
  for (const file of [{ ...png, url: 'https://private.example/image.png' }, { ...png, url: 'file:///private' }, { ...png, mediaType: 'image/svg+xml' }, { ...png, url: 'data:image/png;base64,xxxx*===' }, { ...png, mediaType: 'image/jpeg', url: png.url.replace('image/png', 'image/jpeg') }]) assert.throws(() => imageByteLength(file));
});

test('limity liczby i rozmiaru zdjęć oraz zakaz załączników podszywających się pod AI', () => {
  assert.throws(() => validateChatImages([message(Array(4).fill(png))]), /maksymalnie 3/);
  assert.throws(() => validateChatImages([{ role: 'assistant', parts: [png] }]), /użytkownika/);
  const oversized = { ...png, url: 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(1_500_001)]).toString('base64') };
  assert.throws(() => imageByteLength(oversized), /1,5 MB/);
  const big = { ...png, url: 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(1_299_992)]).toString('base64') };
  assert.throws(() => validateChatImages([message([big]), message([big])]), /2,5 MB/);
});
