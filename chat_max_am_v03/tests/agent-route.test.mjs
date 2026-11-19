import { ImageResponse } from "next/og.js";
import { createElement } from "react";
import { deflateSync } from "node:zlib";
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
async function setup({ allowed = true, steps = [], result = valid, finish = 'stop', status = 200, imageStatus = 200, signed = false, errorMessage = 'PRIVATE', stall = false, stallBody = false, timeoutScale, googleModel = 'test-google' } = {}) {
  const requests = [], images = [], timeouts = [];
  let step = 0;
  const fakeFetch = async (url, init) => {
    if (String(url).includes('nagerholidays.com/api/v4/')) return Response.json([{ date: '2026-12-25', name: 'Christmas Day', countryCode: 'PL', nationalHoliday: true, holidayTypes: ['Public'], subdivisionCodes: null }]);
    if (String(url).includes('geocoding-api.open-meteo.com')) return Response.json({ results: [{ name: 'Kraków', country: 'Polska', latitude: 50.06, longitude: 19.94 }] });
    if (String(url).includes('api.open-meteo.com/v1/forecast')) return Response.json({ timezone: 'Europe/Warsaw', daily: { time: ['2026-11-18', '2026-11-19'], temperature_2m_min: [5, 7], temperature_2m_max: [10, 12], precipitation_sum: [0, 5.2], weather_code: [0, 61] } });
    const body = JSON.parse(init.body);
    if (body.modalities?.includes('image')) {
      images.push(body);
      if (imageStatus !== 200) return Response.json({ error: { message: 'PRIVATE', code: imageStatus } }, { status: imageStatus });
      return Response.json({ model: 'actual/image-model', choices: [{ index: 0, message: { role: 'assistant', content: '', images: [{ type: 'image_url', image_url: { url: png.url } }] }, finish_reason: 'stop' }] });
    }
    requests.push(body);
    if (stall) return new Promise((_resolve, reject) => {
      if (init.signal.aborted) reject(init.signal.reason);
      else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
    if (stallBody) return new Response(new ReadableStream({ start(controller) {
      if (init.signal.aborted) controller.error(init.signal.reason);
      else init.signal.addEventListener('abort', () => controller.error(init.signal.reason), { once: true });
    } }), { headers: { 'content-type': 'text/event-stream' } });
    if (status !== 200) return Response.json({ error: { message: errorMessage, code: status } }, { status });
    const action = steps[step++];
    const google = String(url).includes('generativelanguage');
    if (google) {
      const parts = action ? [{ functionCall: { name: action.name, args: action.input ?? {} } }] : [{ text: JSON.stringify(result) }];
      const response = { modelVersion: 'actual-google-version', candidates: [{ content: { role: 'model', parts }, finishReason: finish === 'length' ? 'MAX_TOKENS' : finish === 'content_filter' ? 'SAFETY' : 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 } };
      return String(url).includes('streamGenerateContent') ? new Response(`data: ${JSON.stringify(response)}\n\n`, { headers: { 'content-type': 'text/event-stream' } }) : Response.json(response);
    }
    if (!body.stream) return Response.json({ id: 'r', model: 'actual/router-model', choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } });
    const delta = action ? { ...(signed && signed !== 'late' ? { reasoning_details: [{ type: 'reasoning.encrypted', data: 'synthetic-signature', id: `call-${step}`, format: 'google-gemini-v1', index: 0 }] } : {}), tool_calls: [{ index: 0, id: `call-${step}`, type: 'function', function: { name: action.name, arguments: JSON.stringify(action.input ?? {}) } }] } : { content: JSON.stringify(result) };
    const chunks = [{ model: 'actual/router-model', choices: [{ index: 0, delta, finish_reason: null }] }, { model: 'actual/router-model', choices: [{ index: 0, delta: signed === 'late' && action ? { reasoning_details: [{ type: 'reasoning.encrypted', data: 'synthetic-signature', id: `call-${step}`, format: 'google-gemini-v1', index: 0 }] } : {}, finish_reason: action ? 'tool_calls' : finish }] }];
    return new Response(chunks.map((x) => `data: ${JSON.stringify(x)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  };
  const context = vm.createContext({ fetch: fakeFetch, Buffer, Request, Response, Headers, URL, URLSearchParams, AbortSignal, TextDecoder, TransformStream, atob, performance, process: { env: { OPENROUTER_API_KEY: 'test-key', OPENROUTER_MODEL: 'test-model', GOOGLE_GENERATIVE_AI_API_KEY: 'test-key', GEMINI_MODEL: googleModel } } });
  const settings = await loadSettingsModule(context);
  const publicTools = await loadPublicToolsModule(context);
  const timing = await loadTimingModule(context);
  const imagesModule = await loadImagesModule(context);
  const responseModel = await loadResponseModelModule(context);
  const aiModule = new vm.SyntheticModule(Object.keys(ai), function () { for (const key of Object.keys(ai)) this.setExport(key, (key === 'streamText' || key === 'generateText') && timeoutScale ? (options) => { timeouts.push(options.timeout); return ai[key]({ ...options, timeout: timeoutScale }); } : ai[key]); }, { context });
  const router = new vm.SyntheticModule(['createOpenRouter'], function () { this.setExport('createOpenRouter', (opts) => createOpenRouter({ ...opts, fetch: opts.fetch ?? fakeFetch })); }, { context });
  const google = new vm.SyntheticModule(['createGoogleGenerativeAI'], function () { this.setExport('createGoogleGenerativeAI', (opts) => createGoogleGenerativeAI({ ...opts, fetch: opts.fetch ?? fakeFetch })); }, { context });
  const auth = new vm.SyntheticModule(['requireSession'], function () { this.setExport('requireSession', async () => allowed ? null : new Response('Brak sesji', { status: 401 })); }, { context });
  const zlib = new vm.SyntheticModule(["deflateSync"], function () { this.setExport("deflateSync", deflateSync); }, { context });
  const reactModule = new vm.SyntheticModule(['createElement'], function () { this.setExport('createElement', createElement); }, { context });
  const ogModule = new vm.SyntheticModule(['ImageResponse'], function () { this.setExport('ImageResponse', ImageResponse); }, { context });
  const modules = { react: reactModule, 'next/og': ogModule, "node:zlib": zlib, ai: aiModule, '@/lib/settings': settings, '@/lib/auth': auth, '@/lib/public-tools': publicTools, '@/lib/chat-timing': timing, '@/lib/chat-images': imagesModule, '@/lib/response-model': responseModel, '@openrouter/ai-sdk-provider': router, '@ai-sdk/google': google };
  for (const [name, file] of [['@/lib/chat-result', '../lib/chat-result.ts'], ['@/app/api/image/route', '../app/api/image/route.ts'], ['./calendar-image', '../lib/calendar-image.ts'], ['./calendar-events', '../lib/calendar-events.ts'], ['./calendar-weather', '../lib/calendar-weather.ts'], ['./calendar-poster', '../lib/calendar-poster.ts'], ['@/lib/agent-tools', '../lib/agent-tools.ts'], ['agent', '../app/api/agent/route.ts']]) {
    const module = new vm.SourceTextModule(compile(await readFile(new URL(file, import.meta.url), 'utf8')), { context });
    await module.link((id) => { assert.ok(modules[id], `Unexpected import: ${id}`); return modules[id]; });
    modules[name] = module;
  }
  await modules.agent.evaluate();
  return { requests, images, timeouts, fetch: fakeFetch, tools: modules['@/lib/agent-tools'].namespace, async post(body = { mode: 'chat', messages: user('Przygotuj grafikę.') }) {
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
  const app = await setup({ steps: Array.from({ length: 6 }, () => ({ name: 'przeliczStrefyCzasowe', input: { date: '2032-05-04', time: '16:00', fromZone: 'Europe/Warsaw', toZone: 'Asia/Seoul' } })) });
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

test('obraz zachowuje osobno dokładny tekst użytkownika i opis przygotowany przez model', async () => {
  const original = '  Huzia na juzia!!\nBez zmian tekstu.  ';
  const description = 'Dynamiczna scena w stylu MAX.';
  const app = await setup({ steps: [{ name: 'generujObraz', input: { prompt: description } }] });
  const messages = user('Wygeneruj obraz: Huzia na juzia!!');
  messages[0].metadata = { originalImagePrompt: original };
  const out = await app.post({ mode: 'chat', messages });
  const image = out.chunks.find((c) => c.type === 'data-generated-image')?.data;
  assert.equal(image.userPrompt, original);
  assert.equal(image.prompt, description);
  assert.ok(app.images[0].messages[0].content.includes(description));
  assert.ok(!app.images[0].messages[0].content.includes(original));
});

test('obraz ze zwykłego czatu ma pełne polecenie z wiadomości, bez podstawiania opisu AI', async () => {
  const original = 'Wygeneruj obraz: Plakat na bieg po Plantach.';
  const app = await setup({ steps: [{ name: 'generujObraz', input: { prompt: 'Opis AI dla grafiki.' } }] });
  const out = await app.post({ mode: 'chat', messages: user(original) });
  assert.equal(out.chunks.find((c) => c.type === 'data-generated-image')?.data.userPrompt, original);
});

test('tryb bez przerabiania: oba AI przekazują identyczny tekst i styl, mimo innych argumentów modelu', async () => {
  const original = '  Koń na żółwiu!\nDokładnie mój tekst.  ';
  const effectivePrompts = [];
  for (const [provider, rewritten] of [['openrouter', 'Opis A przerobiony przez AI'], ['google', 'Inny opis B']]) {
    const app = await setup({ steps: [{ name: 'generujObraz', input: { prompt: rewritten } }] });
    const messages = user('Wygeneruj obraz: Koń na żółwiu!');
    messages[0].metadata = { originalImagePrompt: original, exactImagePrompt: true };
    const out = await app.post({ provider, mode: 'chat', messages });
    assert.ok(!out.chunks.some((c) => c.type === 'error'), out.text);
    const image = out.chunks.find((c) => c.type === 'data-generated-image').data;
    assert.equal(image.prompt, original);
    assert.equal(image.userPrompt, original);
    assert.ok(!image.effectivePrompt.includes(rewritten));
    assert.ok(image.effectivePrompt.includes(JSON.stringify(original)));
    effectivePrompts.push(app.images[0].messages[0].content);
    const call = out.chunks.find((c) => c.type === 'data-request').data.toolCalls.find((c) => c.name === 'generujObraz');
    assert.equal(call.input.prompt, rewritten);
    assert.equal(call.effectiveInput.prompt, original);
  }
  assert.equal(effectivePrompts[0], effectivePrompts[1]);
});

test('tryb bez zmian bez poprawnego oryginału jest blokowany przed modelem', async () => {
  for (const originalImagePrompt of [undefined, '', ' ', 'x'.repeat(501)]) {
    const app = await setup();
    const messages = user('Wygeneruj obraz: test');
    messages[0].metadata = { exactImagePrompt: true, originalImagePrompt };
    const out = await app.post({ mode: 'chat', messages });
    assert.equal(out.response.status, 400);
    assert.equal(app.requests.length + app.images.length, 0);
  }
});


test('agent wybiera dniWolnePL i przekazuje jego źródło dla obu dostawców', async () => {
  for (const provider of ['openrouter', 'google']) {
    const app = await setup({ steps: [{ name: 'dniWolnePL', input: { from: '2026-12-25', to: '' } }] });
    const out = await app.post({ provider, mode: 'chat', messages: user('Czy 25 grudnia 2026 jest dniem wolnym w Polsce?') });
    assert.ok(!out.chunks.some((c) => c.type === 'error'), out.text);
    assert.deepEqual(out.chunks.filter((c) => c.type === 'data-used-tools').at(-1).data, ['dniWolnePL']);
    assert.ok(out.chunks.some((c) => c.type === 'source-url' && c.url.includes('nagerholidays.com')));
    if (provider === 'openrouter') assert.notEqual(app.requests[0].tool_choice?.type, 'function');
    else assert.equal(app.requests[0].toolConfig?.functionCallingConfig?.allowedFunctionNames, undefined);
  }
});

test('zwykłe pytanie o konsultację nie wymusza kalendarza ani innych narzędzi', async () => {
  const app = await setup();
  const out = await app.post({ mode: 'chat', messages: user('Ile trwa konsultacja online?') });
  assert.equal(app.requests.length, 1);
  assert.ok(!out.chunks.some((c) => c.type === 'data-used-tools'));
  assert.ok(out.chunks.some((c) => c.type === 'data-chat-result'));
});

test('drugie narzędzie własne: agent wybiera przeliczenie stref bez narzędzia kalendarza i API walut', async () => {
  for (const provider of ['openrouter', 'google']) {
    const app = await setup({ steps: [{ name: 'przeliczStrefyCzasowe', input: { date: '2026-11-20', time: '16:00', fromZone: 'Europe/Warsaw', toZone: 'America/New_York' } }] });
    const out = await app.post({ provider, mode: 'chat', messages: user('Konsultacja jest 20 listopada 2026 o 16:00 w Warszawie. Jaka to godzina w Nowym Jorku?') });
    assert.ok(!out.chunks.some((c) => c.type === 'error'), out.text);
    assert.deepEqual(out.chunks.filter((c) => c.type === 'data-used-tools').at(-1).data, ['przeliczStrefyCzasowe']);
    const data = out.chunks.find((c) => c.type === 'data-request').data;
    assert.equal(data.toolCalls[0].input.toZone, 'America/New_York');
    assert.equal(data.toolCalls.length, 1);
    assert.equal(app.images.length, 0);
    if (provider === 'openrouter') assert.notEqual(app.requests[0].tool_choice?.type, 'function');
  }
});

test('kalendarz: obaj agenci zlecają ilustrację AI i nakładają wszystkie dni kodem', async () => {
  for (const provider of ['openrouter', 'google']) {
    const app = await setup({ steps: [{ name: 'generujKalendarz', input: { year: 2027, month: 0 } }] });
    const out = await app.post({ provider, mode: 'chat', messages: user('Wygeneruj obraz kalendarza na cały rok 2027.') });
    assert.ok(!out.chunks.some((c) => c.type === 'error'), out.text);
    const image = out.chunks.find((c) => c.type === 'data-generated-image').data;
    assert.equal(image.renderer, 'calendar-hybrid');
    assert.equal(image.dayCount, 365);
    assert.ok(image.imageUrl.startsWith('data:image/png;base64,'));
    assert.equal(image.modelId, 'actual/image-model');
    assert.equal(app.images.length, 1);
    assert.deepEqual(out.chunks.filter((c) => c.type === 'data-used-tools').at(-1).data, ['generujKalendarz', 'generujObraz']);
    assert.equal(app.requests.length, 1);
    assert.ok(!JSON.stringify(app.requests).includes(image.imageUrl.split(',')[1]));
  }
});
test('generujObraz nie wysyła kalendarza do modelu graficznego', async () => {
  const app = await setup();
  const tool = app.tools.createImageAgentTool(new Request('http://localhost/api/agent'));
  const result = await tool.execute({ prompt: 'Kalendarz na rok 2027' }, { toolCallId: 't', messages: [] });
  assert.equal(result.ok, false);
  assert.match(result.error, /generujKalendarz/);
  assert.equal(app.images.length, 0);
});

test('brak obrazu kalendarza nie jest zatwierdzany jako gotowy wynik', async () => {
  const app = await setup();
  const out = await app.post({ mode: 'chat', messages: user('Wygeneruj kalendarz na 2027 rok.') });
  assert.ok(out.chunks.some((c) => c.type === 'error'));
  assert.ok(!out.chunks.some((c) => c.type === 'data-chat-result'));
});
test('brak roku pozwala doprecyzować, a zakaz generowania nie wymusza kalendarza', async () => {
  for (const text of ['Wygeneruj kalendarz.', 'Nie generuj kalendarza na 2027 rok. Ile trwa konsultacja?']) {
    const app = await setup();
    const out = await app.post({ mode: 'chat', messages: user(text) });
    assert.ok(!out.chunks.some((c) => c.type === 'error'), out.text);
    assert.ok(!out.chunks.some((c) => c.type === 'data-generated-image'));
    assert.equal(app.images.length, 0);
  }
});

test('kalendarz z literówką i dodatkami działa dla obu AI; pytanie o braki wraca do użytkownika', async () => {
  for (const provider of ['openrouter', 'google']) {
    const input = { year: 2032, month: 5, events: [{ date: '2032-05-08', label: 'Osoba A', kind: 'birthday' }], recurrence: { startDate: '2032-05-01', everyDays: 3, time: '16:00', locations: [{ label: 'Strefa A', timeZone: 'Asia/Seoul' }], repeatLocations: true }, weatherCity: 'Miasto testowe' };
    const app = await setup({ result: { category: 'unknown', priority: 'normal', draft: 'Nie obsługuję dodatków, sprawę powinien sprawdzić pracownik.', needs_review: true }, steps: [{ name: 'generujKalendarz', input }] });
    const out = await app.post({ provider, mode: 'chat', messages: user('Wygeneruj kalenradz na maj 2032r. Dodaj urodziny osoby A dnia 8 maja i spotkania co trzeci dzień od 1 maja, pierwsze w strefie A o 16 czasu lokalnego, z pogodą.') });
    assert.ok(!out.chunks.some((c) => c.type === 'error'), out.text);
    const image = out.chunks.find((c) => c.type === 'data-generated-image').data;
    assert.equal(image.dayCount, 31);
    assert.equal(image.annotationCount, 12);
    assert.equal(image.calendarDetails.missingLocations.length, 10);
    assert.ok(image.calendarDetails.events.slice(2).some((event) => event.missingZone));
    const answer = out.chunks.find((c) => c.type === 'data-chat-result').data;
    assert.match(answer.draft, /Podaj pozostałe miasta/);
    assert.ok(!answer.draft.includes('pracownik'));
    assert.equal(answer.needs_review, true);
    assert.equal(app.images.length, 1);
    if (provider === 'openrouter') assert.equal(app.requests[0].tool_choice.function.name, 'generujKalendarz');
  }
});
test('model nie może pominąć zamówionych wydarzeń i oddać gołego kalendarza', async () => {
  const app = await setup({ steps: [{ name: 'generujKalendarz', input: { year: 2032, month: 5 } }] });
  const out = await app.post({ mode: 'chat', messages: user('Wygeneruj kalendarz na maj 2032, dodaj urodziny osoby A.') });
  assert.ok(out.chunks.some((c) => c.type === 'error'));
  assert.ok(!out.chunks.some((c) => c.type === 'data-generated-image'));
  assert.ok(!out.chunks.some((c) => c.type === 'data-chat-result'));
});

test('brak miejscowości pogody daje pytanie w czacie i zachowuje kalendarz', async () => {
  const app = await setup({ steps: [{ name: 'generujKalendarz', input: { year: 2032, month: 5, weatherCity: '' } }] });
  const out = await app.post({ mode: 'chat', messages: user('Wygeneruj kalendarz na maj 2032 z pogodą.') });
  assert.ok(out.chunks.some((c) => c.type === 'data-generated-image'));
  const answer = out.chunks.find((c) => c.type === 'data-chat-result').data;
  assert.match(answer.draft, /Podaj miejscowość/);
  assert.ok(!answer.draft.includes('pracownik'));
});

test('poprawka kalendarza bez ponownego roku zachowuje kontekst i wymusza narzędzie', async () => {
  const input = { year: 2032, month: 5, events: [{ date: '2032-05-08', label: 'Osoba A', kind: 'birthday' }] };
  for (const provider of ['google', 'openrouter']) {
    const app = await setup({ steps: [{ name: 'generujKalendarz', input }] });
    const messages = [...user('Wygeneruj kalendarz na maj 2032, dodaj urodziny osoby A dnia 8 maja.'), { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'Kalendarz gotowy.' }] }, { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Popraw kalendarz, dodaj obie godziny i nazwy miast.' }] }];
    const out = await app.post({ provider, mode: 'chat', messages });
    assert.ok(!out.chunks.some((c) => c.type === 'error'), out.text);
    assert.equal(out.chunks.find((c) => c.type === 'data-generated-image').data.annotationCount, 1);
    if (provider === 'openrouter') assert.equal(app.requests[0].tool_choice.function.name, 'generujKalendarz');
  }
});

test('zgoda na wybór miast nie pozwala oddać brakujących miejsc ani pętli pierwszego miasta', async () => {
  const incomplete = { year: 2032, month: 5, recurrence: { startDate: '2032-05-01', everyDays: 10, time: '16:00', locations: [{ label: 'Miasto A', timeZone: 'Asia/Seoul' }], repeatLocations: true } };
  const app = await setup({ steps: [{ name: 'generujKalendarz', input: incomplete }] });
  const out = await app.post({ mode: 'chat', messages: user('Wygeneruj kalendarz na maj 2032. Spotkania co 10 dni, wybierz miasta dla wszystkich spotkań.') });
  assert.ok(!out.chunks.some((c) => c.type === 'data-generated-image'));
  assert.ok(out.chunks.some((c) => c.type === 'error'));
});

test('pełna wybrana lista miejsc tworzy wydarzenia z lokalną i warszawską godziną', async () => {
  const locations = ['Asia/Seoul', 'Europe/London', 'America/New_York', 'Europe/Warsaw'].map((timeZone, i) => ({ label: `Miasto ${i + 1}`, timeZone }));
  const input = { year: 2032, month: 5, recurrence: { startDate: '2032-05-01', everyDays: 10, time: '16:00', locations } };
  const app = await setup({ steps: [{ name: 'generujKalendarz', input }] });
  const out = await app.post({ mode: 'chat', messages: user('Wygeneruj kalendarz na maj 2032. Spotkania co 10 dni, wylosuj miasta dla wszystkich terminów.') });
  const image = out.chunks.find((c) => c.type === 'data-generated-image').data;
  assert.equal(image.calendarDetails.missingLocations.length, 0);
  assert.equal(image.annotationCount, 4);
  assert.ok(image.calendarDetails.events.every((event) => event.time === '16:00' && event.warsawTime && event.label.includes('Miasto')));
});

test('OpenRouter: kalendarz ma wymuszone function calling, zgodny routing i bez JSON Schema w kroku narzędzia', async () => {
  const app = await setup({ steps: [{ name: 'generujKalendarz', input: { year: 2032, month: 5 } }] });
  const out = await app.post({ mode: 'chat', messages: user('Wygeneruj kalendarz na maj 2032.') });
  const first = app.requests[0];
  assert.equal(first.provider.require_parameters, true);
  assert.equal(first.tool_choice.function.name, 'generujKalendarz');
  assert.deepEqual(first.tools.map((t) => t.function.name), ['generujKalendarz']);
  assert.equal(first.response_format, undefined);
  assert.equal(app.requests.length, 1);
  assert.deepEqual(Object.keys(out.chunks.find((c) => c.type === 'data-chat-result').data).sort(), ['category', 'draft', 'needs_review', 'priority']);
  assert.ok(out.chunks.some((c) => c.type === 'data-generated-image'));
});

test('OpenRouter: odmowa HTTP przed narzędziem nie daje pustej odpowiedzi ani nie ukrywa statusu', async () => {
  const app = await setup({ status: 400 });
  const out = await app.post({ mode: 'chat', messages: user('Wygeneruj kalendarz na maj 2032.') });
  const failure = out.chunks.find((c) => c.type === 'data-request').data.failure;
  assert.equal(failure.statusCode, 400);
  assert.equal(failure.stage, 'before_tool');
  assert.deepEqual(failure.requiredTools, ['generujKalendarz']);
  assert.match(failure.message, /HTTP 400/);
  assert.ok(out.chunks.some((c) => c.type === 'text-delta' && c.delta.includes('HTTP 400')));
  assert.ok(!out.chunks.some((c) => c.type === 'data-chat-result' || c.type === 'data-generated-image'));
  assert.ok(!out.text.includes('PRIVATE'));
  assert.equal(app.requests.length, 1);
});

test('OpenRouter: pominięte narzędzie ma osobny kod diagnostyczny i komunikat w rozmowie', async () => {
  const app = await setup();
  const out = await app.post({ mode: 'chat', messages: user('Wygeneruj kalendarz na maj 2032.') });
  const failure = out.chunks.find((c) => c.type === 'data-request').data.failure;
  assert.equal(failure.code, 'CHAT_TOOL_NOT_USED');
  assert.equal(failure.finishReason, 'stop');
  assert.equal(failure.statusCode, null);
  assert.ok(out.chunks.some((c) => c.type === 'text-delta' && c.delta.includes('pominął')));
  assert.ok(!out.chunks.some((c) => c.type === 'data-chat-result'));
});

test('kalendarz z dokładnym cyklem nie wywołuje zegara; zwiększenie komórek wymaga nowego PNG', async () => {
  const input = { year: 2032, month: 5, recurrence: { startDate: '2032-05-01', everyDays: 3, time: '16:00', locations: [] } };
  const original = 'Wygeneruj kalendarz na maj 2032. Spotkania dokładnie co trzeci dzień, o godzinie 16:00 czasu lokalnego.';
  const app = await setup({ steps: [{ name: 'generujKalendarz', input }] });
  const out = await app.post({ mode: 'chat', messages: user(original) });
  assert.deepEqual(out.chunks.find((c) => c.type === 'data-request').data.toolCalls.map((t) => t.name), ['generujKalendarz']);
  const first = out.chunks.find((c) => c.type === 'data-generated-image').data;
  const next = await setup({ steps: [{ name: 'generujKalendarz', input: { ...input, cellHeight: 300 } }] });
  const modified = await next.post({ mode: 'chat', messages: [...user(original), { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'Kalendarz gotowy.' }] }, { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Zwiększ wysokość każdej komórki.' }] }] });
  const second = modified.chunks.find((c) => c.type === 'data-generated-image').data;
  assert.ok(second.height > first.height);
  assert.equal(second.cellHeight, 300);
  assert.notEqual(second.imageUrl, first.imageUrl);
});

test('wskazane drugie i ostatnie miejsce są sprawdzane przed wyrenderowaniem kalendarza', async () => {
  const input = { year: 2032, month: 5, recurrence: { startDate: '2032-05-01', everyDays: 10, time: '16:00', locations: [{ label: 'Aster', timeZone: 'Asia/Seoul' }, { label: 'Beryl', timeZone: 'Europe/London' }, { label: 'Losowe', timeZone: 'Europe/Rome' }, { label: 'Cyrkon', timeZone: 'Europe/Warsaw' }] } };
  const question = 'Wygeneruj kalendarz na maj 2032. Spotkania co 10 dni. Pierwsze w Aster, drugie w Beryl, ostatnie w Cyrkon. Pozostałe miasta wylosuj.';
  const app = await setup({ steps: [{ name: 'generujKalendarz', input }] });
  assert.ok((await app.post({ mode: 'chat', messages: user(question) })).chunks.some((c) => c.type === 'data-generated-image'));
  const bad = await setup({ steps: [{ name: 'generujKalendarz', input: { ...input, recurrence: { ...input.recurrence, locations: input.recurrence.locations.map((location, i) => i === 1 ? { ...location, label: 'Inne' } : location) } } }] });
  assert.ok(!(await bad.post({ mode: 'chat', messages: user(question) })).chunks.some((c) => c.type === 'data-generated-image'));
});

test('OpenRouter: SDK zachowuje podpis Gemini pomiędzy narzędziem a odpowiedzią JSON', async () => {
  const app = await setup({ signed: 'late', steps: [{ name: 'aktualnyCzas', input: {} }] });
  const out = await app.post({ mode: 'chat', messages: user('Która jest dokładnie godzina? Podaj wynik w ms.') });
  assert.ok(!out.chunks.some((c) => c.type === 'error'), out.text);
  const call = app.requests[1].messages.find((message) => message.role === 'assistant' && message.tool_calls);
  assert.equal(call.reasoning_details[0].data, 'synthetic-signature');
});

test('rozpoznanie błędu podpisu nie ujawnia surowego komunikatu dostawcy', async () => {
  const app = await setup({ status: 400, errorMessage: 'PRIVATE: Function call is missing a thought_signature.' });
  const out = await app.post({ mode: 'chat', messages: user('Wygeneruj kalendarz na maj 2032.') });
  assert.equal(out.chunks.find((c) => c.type === 'data-request').data.failure.providerHint, 'thought_signature');
  assert.ok(out.chunks.some((c) => c.type === 'text-delta' && c.delta.includes('podpis')));
  assert.ok(!out.text.includes('PRIVATE'));
});

test('OpenRouter: schemat kalendarza nie rozbudowuje gramatyki limitami tablic i tekstów', async () => {
  const app = await setup({ steps: [{ name: 'generujKalendarz', input: { year: 2032, month: 5 } }] });
  const out = await app.post({ mode: 'chat', messages: user('Wygeneruj kalendarz na maj 2032.') });
  const schema = app.requests[0].tools[0].function.parameters;
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!['minItems', 'maxItems', 'minLength', 'maxLength'].includes(key), key);
      walk(child);
    }
  };
  walk(schema);
  assert.equal(schema.properties.events.type, 'array');
  assert.equal(schema.properties.recurrence.properties.locations.items.type, 'object');
  assert.ok(out.chunks.some((c) => c.type === 'data-generated-image'));
});

test('uproszczony schemat transportu nie osłabia limitów kalendarza na serwerze', async () => {
  const event = { date: '2032-05-08', label: 'Osoba A', kind: 'birthday' };
  for (const extra of [
    { events: Array.from({ length: 101 }, () => event) },
    { events: [{ ...event, label: 'A'.repeat(81) }] },
    { weatherCity: 'A'.repeat(101) },
    { recurrence: { startDate: '2032-05-01', everyDays: 3, time: '16:00', locations: Array.from({ length: 101 }, () => ({ label: 'Miasto A', timeZone: 'Europe/Warsaw' })) } },
    { send_now: true },
  ]) {
    const app = await setup({ steps: [{ name: 'generujKalendarz', input: { year: 2032, month: 5, ...extra } }] });
    const out = await app.post({ mode: 'chat', messages: user('Wygeneruj kalendarz na maj 2032.') });
    assert.ok(!out.chunks.some((c) => c.type === 'data-generated-image' || c.type === 'data-chat-result'));
    assert.ok(out.chunks.some((c) => c.type === 'error'));
  }
});

test('gotowy kalendarz kończy zadanie bez dodatkowej generacji tekstu dla obu providerów', async () => {
  for (const provider of ['google', 'openrouter']) {
    const app = await setup({ steps: [{ name: 'generujKalendarz', input: { year: 2032, month: 5 } }] });
    const out = await app.post({ provider, mode: 'chat', messages: user('Wygeneruj kalendarz na maj 2032.') });
    assert.equal(app.requests.length, 1);
    assert.ok(out.chunks.some((c) => c.type === 'data-generated-image'));
    assert.match(out.chunks.find((c) => c.type === 'data-chat-result').data.draft, /Kalendarz jest gotowy/);
    assert.ok(!out.chunks.some((c) => c.type === 'error'));
  }
});

test('poprawny kalendarz w piątym kroku nie jest przykrywany komunikatem limitu', async () => {
  const bad = { name: 'generujKalendarz', input: { year: 2032, month: 5 } };
  const good = { name: 'generujKalendarz', input: { year: 2032, month: 5, events: [{ date: '2032-05-08', kind: 'birthday', label: 'Osoba A' }] } };
  const app = await setup({ steps: [bad, bad, bad, bad, good] });
  const out = await app.post({ provider: 'google', mode: 'chat', messages: user('Wygeneruj kalendarz na maj 2032, dodaj urodziny osoby A dnia 8 maja.') });
  assert.equal(app.requests.length, 5);
  assert.ok(out.chunks.some((c) => c.type === 'data-generated-image'));
  assert.ok(out.chunks.some((c) => c.type === 'data-chat-result'));
  assert.ok(!out.text.includes('Przerwałem po 5 krokach'));
});

test('pięć niepoprawnych wywołań kalendarza pokazuje powód i diagnostykę bez udawanego sukcesu', async () => {
  const app = await setup({ steps: Array.from({ length: 5 }, () => ({ name: 'generujKalendarz', input: { year: 2032, month: 5 } })) });
  const out = await app.post({ provider: 'google', mode: 'chat', messages: user('Wygeneruj kalendarz na maj 2032, dodaj urodziny osoby A dnia 8 maja.') });
  assert.equal(app.requests.length, 5);
  assert.match(out.text, /Przerwałem po 5 krokach/);
  assert.match(out.text, /nieprawidłowe parametry kalendarza/);
  assert.equal(out.chunks.find((c) => c.type === 'data-request').data.failure.code, 'STEP_LIMIT');
  assert.ok(out.chunks.some((c) => c.type === 'data-timing'));
  assert.ok(!out.chunks.some((c) => c.type === 'data-generated-image' || c.type === 'data-chat-result'));
});

test('kalendarz używa modelu obrazów i zwraca jego rzeczywisty identyfikator oraz złożony PNG', async () => {
  const app = await setup({ steps: [{ name: 'generujKalendarz', input: { year: 2032, month: 5, artPrompt: 'Fantazyjna nocna ilustracja, dekoracyjne sylwetki, bez napisów.' } }] });
  const out = await app.post({ mode: 'chat', messages: user('Wygeneruj fantazyjny kalendarz na maj 2032.') });
  const picture = out.chunks.find((c) => c.type === 'data-generated-image').data;
  assert.equal(app.images.length, 1);
  assert.equal(picture.renderer, 'calendar-hybrid');
  assert.equal(picture.modelId, 'actual/image-model');
  assert.notEqual(picture.imageUrl, png.url);
  assert.equal(picture.width, 1800);
  assert.ok(app.images[0].messages[0].content.includes('Fantazyjna nocna ilustracja'));
  assert.ok(out.chunks.filter((c) => c.type === 'data-used-tools').at(-1).data.includes('generujObraz'));
});

test('awaria generowania ilustracji nie wraca po cichu do szablonu i nie powtarza płatnej operacji', async () => {
  const action = { name: 'generujKalendarz', input: { year: 2032, month: 5 } };
  const app = await setup({ imageStatus: 503, steps: [action, action, action, action, action] });
  const out = await app.post({ mode: 'chat', messages: user('Wygeneruj kalendarz na maj 2032.') });
  assert.equal(app.images.length, 1);
  assert.equal(app.requests.length, 1);
  assert.ok(!out.chunks.some((c) => c.type === 'data-generated-image' || c.type === 'data-chat-result'));
  assert.match(out.text, /Nie udało się wygenerować obrazu/);
  assert.ok(!out.text.includes('PRIVATE'));
});

test('Co tu robisz: oba providery dostają krótki prompt, JSON i zero narzędzi w jednym kroku', async () => {
  for (const provider of ['google', 'openrouter']) {
    const app = await setup();
    const out = await app.post({ provider, mode: 'chat', messages: user('Co tu robisz?') });
    assert.ok(!out.chunks.some((c) => c.type === 'error'), out.text);
    assert.equal(app.requests.length, 1);
    assert.ok(!app.requests[0].tools?.length);
    assert.deepEqual(out.chunks.find((c) => c.type === 'data-request').data.toolCalls, []);
    const policy = out.chunks.find((c) => c.type === 'data-request').data.requestPolicy;
    assert.equal(policy.profile, 'simple_chat');
    assert.equal(policy.timeoutMs, 20000);
    assert.deepEqual(policy.toolNames, []);
    assert.ok(policy.structuredOutput);
    const system = provider === 'google' ? JSON.stringify(app.requests[0].systemInstruction) : app.requests[0].messages[0].content;
    assert.ok(system.length < 2000);
    assert.ok(!system.includes('generujKalendarz'));
    assert.deepEqual(out.chunks.find((c) => c.type === 'data-chat-result').data, valid);
  }
});

test('porównanie payloadów Gemini: zwykły, narzędzia z JSON, poprawiony prosty czat', async () => {
  const plain = await setup();
  await ai.generateText({ model: createGoogleGenerativeAI({ apiKey: 'test-key', fetch: plain.fetch })('test-google'), prompt: 'Co tu robisz?', maxRetries: 0 });
  assert.ok(!plain.requests[0].tools?.length);
  assert.equal(plain.requests[0].generationConfig?.responseMimeType, undefined);
  const withTools = await setup();
  await ai.generateText({ model: createGoogleGenerativeAI({ apiKey: 'test-key', fetch: withTools.fetch })('test-google'), prompt: 'Co tu robisz?', maxRetries: 0,
    tools: { aktualnyCzas: ai.tool({ description: 'Zegar testowy', inputSchema: ai.jsonSchema({ type: 'object', properties: {} }), execute: () => 'test' }) },
    output: ai.Output.object({ schema: ai.jsonSchema({ type: 'object', properties: { category: { type: 'string' }, priority: { type: 'string' }, draft: { type: 'string' }, needs_review: { type: 'boolean' } }, required: ['category', 'priority', 'draft', 'needs_review'], additionalProperties: false }) }),
  });
  assert.ok(withTools.requests[0].tools[0].functionDeclarations.length > 0);
  assert.equal(withTools.requests[0].generationConfig.responseMimeType, 'application/json');
  const fixed = await setup();
  await fixed.post({ provider: 'google', mode: 'chat', messages: user('Co tu robisz?') });
  assert.ok(!fixed.requests[0].tools?.length);
  assert.equal(fixed.requests[0].generationConfig.responseMimeType, 'application/json');
});

test('Gemini: timeout przed nagłówkami i przy pustym streamie kończy odpowiedź z diagnostyką', { timeout: 5000 }, async () => {
  for (const stalled of [{ stall: true }, { stallBody: true }]) {
    const app = await setup({ ...stalled, timeoutScale: 25 });
    const out = await app.post({ provider: 'google', mode: 'chat', messages: user('Co tu robisz?') });
    assert.equal(app.requests.length, 1);
    assert.deepEqual(app.timeouts, [20000]);
    const failure = out.chunks.find((c) => c.type === 'data-request').data.failure;
    assert.equal(failure.code, 'CHAT_TIMEOUT');
    assert.match(failure.message, /20 s/);
    assert.ok(out.chunks.some((c) => c.type === 'error'));
    assert.ok(!out.chunks.some((c) => c.type === 'data-chat-result'));
    assert.ok(!out.chunks.some((c) => c.type === 'data-search-fallback'));
  }
});

test('Gemini: prosty czat nie ponawia 429 ani nie pozoruje przełączenia wyszukiwania', async () => {
  const app = await setup({ status: 429 });
  const out = await app.post({ provider: 'google', mode: 'chat', messages: user('Co tu robisz?') });
  assert.equal(app.requests.length, 1);
  assert.ok(!out.chunks.some((c) => c.type === 'data-search-fallback'));
  assert.equal(out.chunks.find((c) => c.type === 'data-request').data.failure.statusCode, 429);
});

test('Gemini: wywołanie zegara mimo braku narzędzi nie wykonuje go ani nie tworzy pętli', async () => {
  const app = await setup({ steps: [{ name: 'aktualnyCzas', input: {} }] });
  const out = await app.post({ provider: 'google', mode: 'chat', messages: user('Co tu robisz?') });
  assert.equal(app.requests.length, 1);
  assert.deepEqual(out.chunks.find((c) => c.type === 'data-timing').data.tools, []);
  assert.ok(!out.chunks.some((c) => c.type === 'data-chat-result'));
});
