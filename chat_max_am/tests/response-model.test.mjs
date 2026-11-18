import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { loadResponseModelModule } from './response-model-helper.mjs';
const module = await loadResponseModelModule(vm.createContext({ Response, TextDecoder, TransformStream }));
await module.evaluate();

test('identyfikator modelu z podzielonych SSE OpenRouter i Google, bez zmiany treści', async () => {
  for (const key of ['model', 'modelVersion']) {
    const models = [];
    const text = `data: {"${key}":"actual/model-version","choices":[]}\n\ndata: [DONE]\n\n`;
    const bytes = new TextEncoder().encode(text);
    const wrapped = module.namespace.captureModelFetch(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 17)); controller.enqueue(bytes.slice(17)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } }), (model) => models.push(model));
    const response = await wrapped('http://fake');
    assert.equal(await response.text(), text);
    assert.deepEqual(models, ['actual/model-version']);
  }
});

test('brak modelu w API nie jest zastępowany skonfigurowaną nazwą', async () => {
  const models = [];
  const wrapped = module.namespace.captureModelFetch(async () => new Response('data: {"text":"hello"}\n\n', { headers: { 'content-type': 'text/event-stream' } }), (model) => models.push(model));
  await (await wrapped('http://fake')).text();
  assert.deepEqual(models, []);
});
