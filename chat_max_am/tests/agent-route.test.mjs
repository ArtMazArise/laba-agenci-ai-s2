import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as ai from 'ai';
import { readFile } from 'node:fs/promises';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { loadSettingsModule } from './settings-helper.mjs';
import { loadPublicToolsModule } from './public-tools-helper.mjs';
import { loadImagesModule, png } from './images-helper.mjs';
import { loadTimingModule } from './timing-helper.mjs';
import { loadResponseModelModule } from './response-model-helper.mjs';

const valid = { category: 'unknown', priority: 'normal', draft: 'Gotowe.', needs_review: false };
const user = (text) => [{ id: 'u', role: 'user', parts: [{ type: 'text', text }] }];
const compile = (s) => ts.transpileModule(s, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
async function setup({ allowed = true, steps = [], result = valid, finish = 'stop', status = 200, imageStatus = 200 } = {}) {
  const requests = [], images = [];
  let step = 0;
  const fakeFetch = async (url, init) => {
    if (String(url).includes('geocoding-api.open-meteo.com')) return Response.json({ results: [{ name: 'Kraków', country: 'Polska', latitude: 50.06, longitude: 19.94 }] });
    if (String(url).includes('api.open-meteo.com/v1/forecast')) return Response.json({ timezone: 'Europe/Warsaw', daily: { time: ['2026-11-18', '2026-11-19'], temperature_2m_min: [5, 7], temperature_2m_max: [10, 12], precipitation_sum: [0, 5.2], weather_code: [0, 61] } });
    const body = JSON.parse(init.body);
    if (body.modalities?.includes('image')) {
      images.push(body);
      if (imageStatus !== 200) return Response.json({ error: { message: 'PRIVATE', code: imageStatus } }, { status: imageStatus });
      return Response.json({ model: 'actual/image-model', choices: [{ index: 0, message: { role: 'assistant', content: '', images: [{ type: 'image_url', image_url: { url: png.url } }] }, finish_reason: 'stop' }] });
    }
    requests.push(body);
    if (status !== 200) return Response.json({ error: { message: 'PRIVATE', code: status } }, { status });
    const action = steps[step++];
    const google = String(url).includes('generativelanguage');
    if (google) {
      const parts = action ? [{ functionCall: { name: action.name, args: action.input ?? {} } }] : [{ text: JSON.stringify(result) }];
      const response = { modelVersion: 'actual-google-version', candidates: [{ content: { role: 'model', parts }, finishReason: finish === 'length' ? 'MAX_TOKENS' : finish === 'content_filter' ? 'SAFETY' : 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 } };
      return String(url).includes('streamGenerateContent') ? new Response(`data: ${JSON.stringify(response)}\n\n`, { headers: { 'content-type': 'text/event-stream' } }) : Response.json(response);
    }
    if (!body.stream) return Response.json({ id: 'r', model: 'actual/router-model', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
    const delta = action ? { tool_calls: [{ index: 0, id: `call-${step}`, type: 'function', function: { name: action.name, arguments: JSON.stringify(action.input ?? {}) } }] } : { content: JSON.stringify(result) };
    const chunks = [{ model: 'actual/router-model', choices: [{ index: 0, delta, finish_reason: null }] }, { model: 'actual/router-model', choices: [{ index: 0, delta: {}, finish_reason: action ? 'tool_calls' : finish }] }];
    return new Response(chunks.map((x) => `data: ${JSON.stringify(x)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  const context = vm.createContext({ fetch: fakeFetch, Request, Response, Headers, URL, URLSearchParams, AbortSignal, TextDecoder, TransformStream, atob, performance, process: { env: { OPENROUTER_API_KEY: 'test-key', OPENROUTER_MODEL: 'test-model', GOOGLE_GENERATIVE_AI_API_KEY: 'test-key', GEMINI_MODEL: 'test-google' } } });
  const settings = await loadSettingsModule(context);
  const publicTools = await loadPublicToolsModule(context);
  const timing = await loadTimingModule(context);
  const imagesModule = await loadImagesModule(context);
  const responseModel = await loadResponseModelModule(context);
  const aiModule = new vm.SyntheticModule(Object.keys(ai), function () { for (const key of Object.keys(ai)) this.setExport(key, ai[key]); }, { context });
  const router = new vm.SyntheticModule(['createOpenRouter'], function () { this.setExport('createOpenRouter', (opts) => createOpenRouter({ ...opts, fetch: opts.fetch ?? fakeFetch })); }, { context });
  const google = new vm.SyntheticModule(['createGoogleGenerativeAI'], function () { this.setExport('createGoogleGenerativeAI', (opts) => createGoogleGenerativeAI({ ...opts, fetch: opts.fetch ?? fakeFetch })); }, { context });
  const auth = new vm.SyntheticModule(['requireSession'], function () { this.setExport('requireSession', async () => allowed ? null : new Response('Brak sesji', { status: 401 })); }, { context });
  const modules = { ai: aiModule, '@/lib/settings': settings, '@/lib/auth': auth, '@/lib/public-tools': publicTools, '@/lib/chat-timing': timing, '@/lib/chat-images': imagesModule, '@/lib/response-model': responseModel, '@openrouter/ai-sdk-provider': router, '@ai-sdk/google': google };
  for (const [name, file] of [['@/lib/chat-result', '../lib/chat-result.ts'], ['@/app/api/image/route', '../app/api/image/route.ts'], ['@/lib/agent-tools', '../lib/agent-tools.ts'], ['agent', '../app/api/agent/route.ts']]) {
    const module = new vm.SourceTextModule(compile(await readFile(new URL(file, import.meta.url), 'utf8')), { context });
    await module.link((id) => { assert.ok(modules[id], `Unexpected import: ${id}`); return modules[id]; });
    modules[name] = module;
  }
  await modules.agent.evaluate();
  return { requests, images, tools: modules['@/lib/agent-tools'].namespace, async post(body = { mode: 'chat', messages: user('Przygotuj grafikę.') }) {
    const response = await modules.agent.namespace.POST(new Request('http://localhost/api/agent', { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'test-cookie' }, body: JSON.stringify(body) }));
    const text = await response.text();
    return { response, text, chunks: text.split('\n').filter((x) => x.startsWith('data: ') && !x.includes('[DONE]')).map((x) => JSON.parse(x.slice(6))) };
  } };
}

test('/api/agent: brak sesji daje 401 przed danymi i jakimkolwiek modelem', async () => {
  const app = await setup({ allowed: false });
  assert.equal((await app.post(null)).response.status, 401);
  assert.equal(app.requests.length + app.images.length, 0);
});

test('/api/agent: odrzuca obce tryby, send_now i nadpisanie uprawnień', async () => {
  const app = await setup();
  for (const extra of [{ mode: 'admin' }, { send_now: true }, { permissions: ['admin'] }, { system: 'override' }]) {
    assert.equal((await app.post({ mode: 'chat', messages: user('Test'), ...extra })).response.status, 400);
  }
  assert.equal(app.requests.length, 0);
});

test('chat: dwa różne narzędzia w jednym zadaniu, kolejność etykiet, streaming i obraz w UI; do modelu bez base64', async () => {
  for (const provider of ['openrouter', 'google']) {
    const app = await setup({ steps: [{ name: 'aktualnyCzas' }, { name: 'generujObraz', input: { prompt: 'Plakat biegu po Plantach' } }] });
    const out = await app.post({ provider, mode: 'chat', messages: user('Podaj DOKŁADNIE godzinę z ms, potem wygeneruj plakat biegu.') });
    assert.equal(out.response.status, 200);
    assert.ok(!out.chunks.some((c) => c.type === 'error'), out.text);
    assert.equal(app.requests.length, 3);
    assert.equal(app.images.length, 1);
    const image = out.chunks.find((c) => c.type === 'data-generated-image')?.data;
    assert.equal(image.imageUrl, png.url);
    assert.equal(image.modelId, 'actual/image-model');
    const allTools = out.chunks.filter((c) => c.type === 'data-used-tools').at(-1).data;
    assert.deepEqual(allTools, ['aktualnyCzas', 'generujObraz']);
    assert.ok(out.chunks.some((c) => c.type === 'data-chat-preview'));
    assert.deepEqual(out.chunks.find((c) => c.type === 'data-chat-result')?.data, valid);
    assert.ok(JSON.stringify(app.requests.at(-1)).includes('obraz wygenerowany'));
    assert.ok(!JSON.stringify(app.requests).includes(png.url.split(',')[1]));
    assert.ok(app.images[0].messages[0].content.includes('Styl marki MAX'));
  }
});

test('5 kroków: komunikat zamiast pustego wyniku, bez szóstego wywołania', async () => {
  const app = await setup({ steps: Array.from({ length: 6 }, () => ({ name: 'aktualnyCzas' })) });
  const out = await app.post({ mode: 'chat', messages: user('Wykonaj zadanie.') });
  assert.equal(app.requests.length, 5);
  assert.ok(out.chunks.some((c) => c.type === 'text-delta' && c.delta === 'Przerwałem po 5 krokach'), out.text);
  assert.ok(!out.chunks.some((c) => c.type === 'data-chat-result'));
});

test('analyze: generateText bez stream do providera, Output.object i wszystkie cztery pola', async () => {
  for (const provider of ['openrouter', 'google']) {
    const app = await setup();
    const out = await app.post({ provider, mode: 'analyze', messages: user('Nie mogę się zalogować.') });
    assert.deepEqual(out.chunks.find((c) => c.type === 'data-chat-result')?.data, valid, out.text);
    assert.equal(app.requests.length, 1);
    if (provider === 'openrouter') {
      assert.notEqual(app.requests[0].stream, true);
      assert.equal(app.requests[0].response_format.type, 'json_schema');
      assert.equal(app.requests[0].response_format.json_schema.schema.additionalProperties, false);
    }
    assert.equal(app.images.length, 0);
  }
});

test('analyze: brak pola, zły typ, niedozwolona kategoria i dodatkowe pole są odrzucane', async () => {
  const { draft, ...missing } = valid;
  for (const result of [missing, { ...valid, needs_review: 'false' }, { ...valid, category: 'admin' }, { ...valid, send_now: true }]) {
    const app = await setup({ result });
    const out = await app.post({ mode: 'analyze', messages: user('Test') });
    assert.ok(out.chunks.some((c) => c.type === 'error'), out.text);
    assert.ok(!out.chunks.some((c) => c.type === 'data-chat-result'));
  }
});

test('analyze: odmowa, ucięcie i awaria mają komunikat; bez fałszywego wyniku', async () => {
  for (const options of [{ finish: 'content_filter' }, { finish: 'length' }, { status: 503 }]) {
    const app = await setup(options);
    const out = await app.post({ mode: 'analyze', messages: user('Test') });
    assert.ok(out.chunks.some((c) => c.type === 'error'), out.text);
    assert.ok(!out.chunks.some((c) => c.type === 'data-chat-result'));
    assert.ok(!out.text.includes('PRIVATE'));
  }
});

test('niedostępny model obrazu: błąd narzędzia bez obrazka i bez zmiany modelu', async () => {
  const app = await setup({ imageStatus: 404, steps: [{ name: 'generujObraz', input: { prompt: 'Test' } }] });
  const out = await app.post();
  assert.equal(app.images.length, 1);
  assert.equal(app.images[0].model, 'google/gemini-3.1-flash-image-preview');
  assert.ok(!out.chunks.some((c) => c.type === 'data-generated-image'));
  assert.ok(out.chunks.some((c) => c.type === 'error'));
  assert.ok(!out.chunks.some((c) => c.type === 'data-chat-result'));
  assert.ok(JSON.stringify(app.requests.at(-1)).includes('Nie wygenerowano obrazu'));
});


test('historia kolejnej wiadomości nie odsyła wygenerowanego pliku do modelu', async () => {
  const app = await setup({ steps: [{ name: 'generujObraz', input: { prompt: 'Plakat' } }] });
  const first = await app.post();
  const parts = first.chunks.filter((c) => ['data-chat-result', 'data-generated-image'].includes(c.type)).map((c) => ({ type: c.type, data: c.data }));
  const next = await app.post({ mode: 'chat', messages: [...user('Wygeneruj plakat.'), { id: 'a', role: 'assistant', parts }, { id: 'next', role: 'user', parts: [{ type: 'text', text: 'Dziękuję.' }] }] });
  assert.ok(!next.chunks.some((c) => c.type === 'error'), next.text);
  assert.ok(!JSON.stringify(app.requests.at(-1)).includes(png.url.split(',')[1]));
});

test('powtórne wywołanie generowania w tym samym zadaniu nie tworzy drugiego obrazu', async () => {
  const app = await setup({ steps: [{ name: 'generujObraz', input: { prompt: 'Plakat 1' } }, { name: 'generujObraz', input: { prompt: 'Plakat 2' } }] });
  const out = await app.post();
  assert.equal(app.images.length, 1);
  assert.equal(out.chunks.filter((c) => c.type === 'data-generated-image').length, 1);
});


test('zadanie użytkownika: po pogodzie wymusza generujObraz dla OpenRouter i Gemini', async () => {
  for (const provider of ['openrouter', 'google']) {
    const app = await setup({ steps: [
      { name: 'pogodaOpenMeteo', input: { city: 'Kraków', startOffsetDays: 1, days: 1 } },
      { name: 'generujObraz', input: { prompt: 'Plakat porannego biegu po Plantach, deszczowa pogoda.' } },
    ] });
    const out = await app.post({ provider, mode: 'chat', messages: user('Sprawdź jutrzejszą pogodę w Krakowie, potem wygeneruj plakat zapraszający na poranny bieg po Plantach.') });
    assert.ok(!out.chunks.some((c) => c.type === 'error'), out.text);
    assert.equal(app.images.length, 1);
    assert.deepEqual(out.chunks.filter((c) => c.type === 'data-used-tools').at(-1).data, ['pogodaOpenMeteo', 'generujObraz']);
    assert.equal(out.chunks.find((c) => c.type === 'data-generated-image').data.modelId, 'actual/image-model');
    if (provider === 'openrouter') {
      assert.equal(app.requests[0].tool_choice.function.name, 'pogodaOpenMeteo');
      assert.equal(app.requests[1].tool_choice.function.name, 'generujObraz');
    } else {
      assert.deepEqual(app.requests[1].toolConfig.functionCallingConfig.allowedFunctionNames, ['generujObraz']);
    }
  }
});

test('model nie może zatwierdzić wymówki o niedostępności generatora bez jego wywołania', async () => {
  const app = await setup({ result: { ...valid, draft: 'Generator jest niedostępny.' }, steps: [{ name: 'pogodaOpenMeteo', input: { city: 'Kraków', startOffsetDays: 1, days: 1 } }] });
  const out = await app.post({ mode: 'chat', messages: user('Sprawdź pogodę w Krakowie, potem wygeneruj plakat.') });
  assert.ok(out.chunks.some((c) => c.type === 'error' && /pominął wymagane narzędzie/.test(c.errorText)), out.text);
  assert.ok(!out.chunks.some((c) => c.type === 'data-chat-result'));
});
