import { loadPublicToolsModule } from "./public-tools-helper.mjs";
import { loadSettingsModule } from "./settings-helper.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as ai from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

// Prawdziwy SDK i provider, wyłącznie lokalne atrapy odpowiedzi HTTP. Bez sieci i sekretów.
const valid = { category: "support", priority: "normal", draft: "Napisz proszę, jaki komunikat widzisz.", needs_review: true };
const routeSource = await readFile(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const schemaSource = await readFile(new URL("../lib/chat-result.ts", import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;

async function setup({ text = JSON.stringify(valid), reason = "stop", providerError = false, disconnected = false, unsupportedWarning = false, publicConfig = {}, citations = [], streamErrorCode, googleQuotaFirst = false, quotaAfterPreview = false, fallbackText, groundingQueries = [], toolCall, toolInput = {}, publicFetch } = {}) {
  const requests = [];
  const router = createOpenRouter({
    apiKey: "test-only-key",
    fetch: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      if (providerError) return new Response(JSON.stringify({ error: { message: "PRIVATE_PROVIDER_DETAILS" } }), { status: providerError === true ? 503 : providerError, headers: { "content-type": "application/json" } });
      if (disconnected) return new Response(new ReadableStream({ start(controller) { controller.error(new Error("PRIVATE_PROVIDER_DETAILS")); } }), { headers: { "content-type": "text/event-stream" } });
      if (streamErrorCode) return new Response(`data: ${JSON.stringify({ error: { code: streamErrorCode, message: "PRIVATE_PROVIDER_DETAILS", metadata: { raw: "PRIVATE_RAW_DETAILS" } } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
      if (toolCall && requests.length === 1) {
        const chunks = [{ id: "test", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: toolCall, arguments: JSON.stringify(toolInput) } }] }, finish_reason: null }] }, { id: "test", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }];
        return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
      }
      const chunks = [

        ...[text.slice(0, 55), text.slice(55)].filter(Boolean).map((content) => ({ id: "test", choices: [{ index: 0, delta: { content, annotations: citations.map((c) => ({ type: "url_citation", url_citation: { url: c.url, title: c.title, start_index: 0, end_index: 10 } })) }, finish_reason: null }] })),
        { id: "test", choices: [{ index: 0, delta: {}, finish_reason: reason === "content-filter" ? "content_filter" : reason }] },
      ];
      return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    },
  });
  let googleAttempts = 0;
  const google = new MockLanguageModelV3({ doStream: async () => {
    googleAttempts++;
    const quotaError = () => new ai.APICallError({ message: "PRIVATE_QUOTA_DETAILS", url: "http://test", requestBodyValues: {}, statusCode: 429 });
    if (googleQuotaFirst && googleAttempts === 1 && !quotaAfterPreview) throw quotaError();
    const currentText = googleQuotaFirst && googleAttempts > 1 && fallbackText !== undefined ? fallbackText : text;
    if (providerError) throw new ai.APICallError({ message: "PRIVATE_PROVIDER_DETAILS", url: "http://test", requestBodyValues: {}, statusCode: providerError === true ? 503 : providerError });
    return { stream: new ReadableStream({ start(controller) {
    if (disconnected) { controller.error(new Error("PRIVATE_PROVIDER_DETAILS")); return; }
    controller.enqueue({ type: "stream-start", warnings: unsupportedWarning ? [{ type: "unsupported", feature: "responseFormat" }] : [] });
    if (toolCall && googleAttempts === 1) {
      controller.enqueue({ type: "tool-call", toolCallId: "call-1", toolName: toolCall, input: JSON.stringify(toolInput) });
      controller.enqueue({ type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 20 } } });
      controller.close(); return;
    }
    for (const [index, citation] of citations.entries()) controller.enqueue({ type: "source", sourceType: "url", id: `s${index}`, ...citation });
    controller.enqueue({ type: "text-start", id: "t" });
    controller.enqueue({ type: "text-delta", id: "t", delta: currentText });
    controller.enqueue({ type: "text-end", id: "t" });
    if (googleQuotaFirst && googleAttempts === 1 && quotaAfterPreview) {
      controller.enqueue({ type: "error", error: quotaError() });
      controller.enqueue({ type: "finish", finishReason: { unified: "error", raw: "error" }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 20 } } });
      controller.close(); return;
    }
    controller.enqueue({ type: "finish", finishReason: { unified: reason, raw: reason }, providerMetadata: groundingQueries.length ? { google: { groundingMetadata: { webSearchQueries: groundingQueries } } } : undefined, usage: { inputTokens: { total: 10 }, outputTokens: { total: 20 } } });
    controller.close();
  } }) }; } });
  const context = vm.createContext({ Response, Request, URL, URLSearchParams, AbortSignal, fetch: publicFetch ?? (() => { throw Error("Unexpected public API call"); }), process: { env: { OPENROUTER_API_KEY: "test-only-key", OPENROUTER_MODEL: "test/model", GOOGLE_GENERATIVE_AI_API_KEY: "test-google", GEMINI_MODEL: "test-google-model" } } });
  const settings = await loadSettingsModule(context, publicConfig);
  const publicTools = await loadPublicToolsModule(context);
  const schema = new vm.SourceTextModule(compile(schemaSource), { context });
  await schema.link(() => {});
  const aiModule = new vm.SyntheticModule(Object.keys(ai), function () { for (const key of Object.keys(ai)) this.setExport(key, ai[key]); }, { context });
  const routerModule = new vm.SyntheticModule(["createOpenRouter"], function () { this.setExport("createOpenRouter", () => router); }, { context });
  const googleModule = new vm.SyntheticModule(["createGoogleGenerativeAI"], function () { this.setExport("createGoogleGenerativeAI", () => Object.assign(() => google, { tools: createGoogleGenerativeAI({ apiKey: "fake-key" }).tools })); }, { context });
  const auth = new vm.SyntheticModule(["requireSession"], function () { this.setExport("requireSession", async () => null); }, { context });
  const route = new vm.SourceTextModule(compile(routeSource), { context });
  await route.link((name) => ({ "@/lib/public-tools": publicTools, "@/lib/settings": settings, ai: aiModule, "@/lib/chat-result": schema, "@/lib/auth": auth, "@openrouter/ai-sdk-provider": routerModule, "@ai-sdk/google": googleModule })[name]);
  await route.evaluate();
  return {
    requests, google, schema: schema.namespace,
    async post(provider = "openrouter", messages = [{ id: "u", role: "user", parts: [{ type: "text", text: "Nie mogę się zalogować." }] }], mode = "chat", location) {
      const response = await route.namespace.POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, messages, mode, ...(location !== undefined ? { location } : {}) }) }));
      const text = await response.text();
      const chunks = text.split("\n").filter((line) => line.startsWith("data: ") && !line.includes("[DONE]")).map((line) => JSON.parse(line.slice(6)));
      return { response, chunks, text };
    },
  };
}

test("OpenRouter i Gemini: prawdziwy SDK waliduje JSON, przesyła podgląd i zatwierdzony wynik", async () => {
  for (const provider of ["openrouter", "google"]) {
    const app = await setup();
    const { response, chunks } = await app.post(provider);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/event-stream/);
    assert.ok(chunks.some((c) => c.type === "data-chat-preview"));
    assert.deepEqual(chunks.find((c) => c.type === "data-chat-result")?.data, valid);
    assert.ok(!chunks.some((c) => c.type === "error"));
    if (provider === "openrouter") {
      const format = app.requests[0].response_format;
      assert.equal(format.type, "json_schema");
      assert.equal(format.json_schema.strict, true);
      assert.equal(format.json_schema.schema.additionalProperties, false);
      assert.deepEqual(format.json_schema.schema.required, ["category", "priority", "draft", "needs_review"]);
      assert.deepEqual(format.json_schema.schema.properties, {
        category: { type: "string", enum: ["sales", "support", "billing", "unknown"] },
        priority: { type: "string", enum: ["normal", "high"] },
        draft: { type: "string" },
        needs_review: { type: "boolean" },
      });
    } else assert.equal(app.google.doStreamCalls[0].responseFormat.type, "json");
  }
});

test("oba modele przyjmują nowe kategorie billing i unknown", async () => {
  for (const provider of ["openrouter", "google"]) {
    for (const category of ["billing", "unknown"]) {
      const data = { ...valid, category };
      const app = await setup({ text: JSON.stringify(data) });
      const { chunks } = await app.post(provider);
      assert.deepEqual(chunks.find((chunk) => chunk.type === "data-chat-result")?.data, data);
    }
  }
});

test("odmowa, ucięcie, błędny JSON i schemat nie tworzą zatwierdzonej odpowiedzi", async () => {
  for (const provider of ["openrouter", "google"]) {
    for (const [options, expected] of [
      [{ text: "", reason: "content-filter" }, /odmówił/],
      [{ text: '{"draft":"Część', reason: "length" }, /ucięta/],
      [{ text: "To nie jest JSON" }, /JSON.*schematem/],
      [{ text: JSON.stringify({ ...valid, needs_review: "true" }) }, /JSON.*schematem/],
      [{ text: JSON.stringify({ ...valid, priority: "urgent" }) }, /JSON.*schematem/],
      [{ text: JSON.stringify({ ...valid, extra: "niedozwolone" }) }, /JSON.*schematem/],
    ]) {
      const app = await setup(options);
      const { chunks, text } = await app.post(provider);
      assert.match(chunks.find((c) => c.type === "error")?.errorText ?? "", expected);
      assert.ok(!chunks.some((c) => c.type === "data-chat-result"));
      assert.doesNotMatch(text, /PRIVATE_PROVIDER_DETAILS/);
    }
  }
});

test("błąd OpenRouter jest czytelny, bez ponownego żądania i szczegółów dostawcy", async () => {
  const app = await setup({ providerError: true });
  const { chunks, text } = await app.post();
  assert.match(chunks.find((c) => c.type === "error")?.errorText ?? "", /przeciążony|niedostępny/);
  assert.doesNotMatch(text, /PRIVATE_PROVIDER_DETAILS|test-only-key/);
  assert.equal(app.requests.length, 1);
});

test("historia przekazuje zatwierdzony JSON, pomija niedokończone podglądy", async () => {
  const app = await setup();
  await app.post("openrouter", [
    { id: "u1", role: "user", parts: [{ type: "text", text: "Pierwsze pytanie" }] },
    { id: "a1", role: "assistant", parts: [{ type: "data-chat-result", data: valid }] },
    { id: "bad", role: "assistant", parts: [{ type: "data-chat-preview", data: "Niepełna odpowiedź" }] },
    { id: "u2", role: "user", parts: [{ type: "text", text: "Kolejne pytanie" }] },
  ]);
  const messages = app.requests[0].messages;
  assert.ok(messages.some((m) => m.role === "assistant" && m.content === JSON.stringify(valid)));
  assert.doesNotMatch(JSON.stringify(messages), /Niepełna odpowiedź/);
});

test("analiza obu dostawców używa schematu i oznacza tryb; nie zmienia modelu", async () => {
  for (const provider of ["openrouter", "google"]) {
    const app = await setup();
    const { chunks } = await app.post(provider, undefined, "analysis");
    assert.equal(chunks.find((c) => c.type === "data-chat-mode")?.data, "analysis");
    assert.deepEqual(chunks.find((c) => c.type === "data-chat-result")?.data, valid);
    if (provider === "openrouter") {
      assert.equal(app.requests[0].provider.require_parameters, true);
      assert.equal(app.requests[0].model, "test/model");
      assert.equal(app.requests[0].response_format.type, "json_schema");
    } else assert.equal(app.google.doStreamCalls[0].responseFormat.type, "json");
  }
});

test("analiza odrzuca braki pól, złe typy, kategorie, dodatkowe pola i niekompletny strumień", async () => {
  for (const provider of ["openrouter", "google"]) {
    const missing = { ...valid }; delete missing.draft;
    for (const options of [
      { text: JSON.stringify(missing) },
      { text: JSON.stringify({ ...valid, needs_review: "false" }) },
      { text: JSON.stringify({ ...valid, category: "other" }) },
      { text: JSON.stringify({ ...valid, extra: 1 }) },
      { text: "Niepoprawny JSON" },
      { text: '{"draft":"Część', reason: "length" },
      { text: "", reason: "content-filter" },
      { reason: "other" },
      { disconnected: true },
    ]) {
      const app = await setup(options);
      const { chunks, text } = await app.post(provider, undefined, "analysis");
      assert.ok(chunks.some((c) => c.type === "error"));
      assert.ok(!chunks.some((c) => c.type === "data-chat-result"));
      assert.doesNotMatch(text, /PRIVATE_PROVIDER_DETAILS/);
    }
  }
});

test("nieobsługiwany tryb analizy podaje nazwę zmiennej modelu, bez podmiany modelu i ponowień", async () => {
  for (const provider of ["openrouter", "google"]) {
    for (const status of [400, 404, 422, 501]) {
      const app = await setup({ providerError: status });
      const { chunks, text } = await app.post(provider, undefined, "analysis");
      const error = chunks.find((c) => c.type === "error")?.errorText ?? "";
      assert.match(error, /nie obsługuje analizy z JSON Schema/);
      assert.match(error, new RegExp(provider === "google" ? "GEMINI_MODEL" : "OPENROUTER_MODEL"));
      assert.match(error, /nie został zmieniony automatycznie/);
      assert.equal(provider === "google" ? app.google.doStreamCalls.length : app.requests.length, 1);
      assert.doesNotMatch(text, /PRIVATE_PROVIDER_DETAILS|test-only-key/);
      assert.ok(!chunks.some((c) => c.type === "data-chat-result"));
    }
  }
});

test("ostrzeżenie SDK o braku structured output nie staje się poprawnym wynikiem analizy", async () => {
  const app = await setup({ unsupportedWarning: true });
  const { chunks } = await app.post("google", undefined, "analysis");
  assert.match(chunks.find((c) => c.type === "error")?.errorText ?? "", /GEMINI_MODEL/);
  assert.ok(!chunks.some((c) => c.type === "data-chat-result"));
});

test("API używa modelu z config.json, a false w pliku blokuje obu dostawców mimo env", async () => {
  const app = await setup({ publicConfig: { OPENROUTER_MODEL: "file/model" } });
  const { chunks } = await app.post();
  assert.ok(chunks.some((chunk) => chunk.type === "data-chat-result"));
  assert.equal(app.requests[0].model, "file/model");
  const disabled = await setup({ publicConfig: { OPENROUTER_ENABLED: false, GEMINI_ENABLED: false } });
  for (const provider of ["openrouter", "google"]) {
    // Tu odpowiedź nie jest SSE, bo konfiguracja blokuje wywołanie przed SDK.
    const result = await disabled.post(provider);
    assert.equal(result.response.status, 403);
    assert.match(result.text, /wyłączony/);
  }
  assert.equal(disabled.requests.length, 0);
  assert.equal(disabled.google.doStreamCalls.length, 0);
});

test("źródła przechodzą przez prawdziwy SDK do przeglądarki z datą odbioru, w każdym trybie", async () => {
  for (const provider of ["openrouter", "google"]) {
    for (const mode of ["chat", "analysis", "duel"]) {
      const citation = { url: "https://example.com/current", title: "Aktualne informacje" };
      const app = await setup({ citations: [citation] });
      const { chunks } = await app.post(provider, undefined, mode);
      const source = chunks.find((chunk) => chunk.type === "source-url");
      assert.equal(source?.url, citation.url);
      assert.equal(source.title, citation.title);
      assert.deepEqual(chunks.find((c) => c.type === "data-used-tools")?.data, [provider === "google" ? "google_search" : "web_search"]);
      const stamp = chunks.find((chunk) => chunk.type === "data-source-fetched" && chunk.data.sourceId === source.sourceId);
      assert.ok(Number.isFinite(Date.parse(stamp?.data.fetchedAt)));
      if (mode !== "duel") assert.ok(chunks.some((chunk) => chunk.type === "data-chat-result"));
      if (provider === "openrouter") {
        assert.deepEqual(app.requests[0].tools.find((tool) => tool.type === "openrouter:web_search"), { type: "openrouter:web_search", max_results: 3, engine: "native" });
      } else assert.ok(app.google.doStreamCalls[0].tools.some((tool) => tool.id === "google.google_search"));
    }
  }
});

test("błędy OpenRouter wewnątrz SSE HTTP 200 zachowują kod i nie wyciekają do przeglądarki", async () => {
  for (const [code, expected] of [[400, /HTTP 400.*narzędzia i format JSON Schema/], [402, /Brak środków/], [429, /HTTP 429/], [503, /przeciążony|niedostępny/]]) {
    const app = await setup({ streamErrorCode: code });
    const { chunks, text } = await app.post();
    assert.match(chunks.find((chunk) => chunk.type === "error")?.errorText ?? "", expected);
    assert.ok(!chunks.some((chunk) => chunk.type === "data-chat-result"));
    assert.doesNotMatch(text, /PRIVATE_PROVIDER_DETAILS|PRIVATE_RAW_DETAILS|test-only-key/);
    assert.equal(app.requests.length, 1);
  }
});

test("Gemini 429: jedna próba bez narzędzi, ten sam model i historia, jawny brak wyszukiwania", async () => {
  for (const mode of ["chat", "analysis", "duel"]) {
    const data = { category: "unknown", priority: "normal", draft: "Nie mogę teraz sprawdzić aktualnego kursu euro.", needs_review: true };
    const app = await setup({ googleQuotaFirst: true, fallbackText: mode === "duel" ? data.draft : JSON.stringify(data) });
    const { chunks, text } = await app.post("google", undefined, mode);
    assert.equal(app.google.doStreamCalls.length, 2);
    const [first, second] = app.google.doStreamCalls;
    assert.ok(first.tools.some((tool) => tool.id === "google.google_search"));
    assert.ok(!second.tools?.length);
    assert.deepEqual(first.prompt.filter((p) => p.role !== "system"), second.prompt.filter((p) => p.role !== "system"));
    assert.match(second.prompt[0].content, /Wyszukiwarka jest wyłączona/);
    assert.match(second.prompt[0].content, /nie podawaj kursu, aktualnej ceny ani źródła z pamięci/);
    assert.ok(chunks.some((c) => c.type === "data-search-fallback" && c.data === "quota"));
    assert.ok(!chunks.some((c) => c.type === "source-url" || c.type === "error"));
    if (mode !== "duel") assert.deepEqual(chunks.find((c) => c.type === "data-chat-result")?.data, data);
    else assert.equal(chunks.find((c) => c.type === "text-delta")?.delta, data.draft);
    assert.doesNotMatch(text, /PRIVATE_QUOTA_DETAILS/);
  }
});

test("Gemini: 429 także bez wyszukiwania kończy się błędem po dwóch próbach, bez pozornego wyniku", async () => {
  const app = await setup({ providerError: 429 });
  const { chunks, text } = await app.post("google");
  assert.equal(app.google.doStreamCalls.length, 2);
  assert.match(chunks.find((c) => c.type === "error")?.errorText ?? "", /limit także bez wyszukiwania/);
  assert.ok(!chunks.some((c) => c.type === "data-chat-result"));
  assert.doesNotMatch(text, /PRIVATE_PROVIDER_DETAILS/);
});

test("fallback usuwa niepełny podgląd i nie przenosi źródeł nieudanej próby", async () => {
  const app = await setup({ googleQuotaFirst: true, quotaAfterPreview: true, citations: [{ url: "https://example.org/old", title: "Stare źródło" }] });
  const { chunks } = await app.post("google");
  assert.equal(app.google.doStreamCalls.length, 2);
  assert.ok(chunks.some((c) => c.type === "data-chat-preview" && c.data === ""));
  assert.ok(chunks.some((c) => c.type === "data-chat-result"));
  assert.ok(!chunks.some((c) => c.type === "source-url" || c.type === "data-source-fetched" || c.type === "data-used-tools"));
});

test("błędny JSON drugiej próby Gemini nadal podlega walidacji", async () => {
  const app = await setup({ googleQuotaFirst: true, fallbackText: '{"draft":"brak pozostałych pól"}' });
  const { chunks } = await app.post("google");
  assert.equal(app.google.doStreamCalls.length, 2);
  assert.ok(chunks.some((c) => c.type === "error"));
  assert.ok(!chunks.some((c) => c.type === "data-chat-result"));
});

test("lista narzędzi nie wynika z samej konfiguracji i można ją wyłączyć", async () => {
  for (const provider of ["openrouter", "google"]) {
    const unused = await setup();
    assert.ok(!(await unused.post(provider)).chunks.some((c) => c.type === "data-used-tools"));
    const hidden = await setup({ publicConfig: { CHAT_SHOW_USED_TOOLS: false }, citations: [{ url: "https://example.org", title: "Źródło" }] });
    const { chunks } = await hidden.post(provider);
    assert.ok(chunks.some((c) => c.type === "source-url"));
    assert.ok(!chunks.some((c) => c.type === "data-used-tools"));
  }
});

test("Gemini raportuje wyszukiwanie potwierdzone metadanymi, także bez linków", async () => {
  const app = await setup({ groundingQueries: ["aktualne informacje"] });
  const { chunks } = await app.post("google");
  assert.deepEqual(chunks.find((c) => c.type === "data-used-tools")?.data, ["google_search"]);
  assert.ok(!chunks.some((c) => c.type === "source-url"));
});


test("aktualnyCzas: prawdziwe function calling i kolejny krok dla obu providerów", async () => {
  for (const provider of ["openrouter", "google"]) {
    const app = await setup({ toolCall: "aktualnyCzas" });
    const { chunks } = await app.post(provider, [{ id: "u", role: "user", parts: [{ type: "text", text: "Która jest DOKŁADNIE godzina z ms?" }] }]);
    assert.ok(!chunks.some((c) => c.type === "error"), JSON.stringify(chunks));
    assert.deepEqual(chunks.find((c) => c.type === "data-used-tools")?.data, ["aktualnyCzas"]);
    assert.ok(chunks.some((c) => c.type === "data-chat-result"));
    const calls = provider === "google" ? app.google.doStreamCalls : app.requests;
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].toolChoice ?? calls[0].tool_choice, provider === "google" ? { type: "tool", toolName: "aktualnyCzas" } : { type: "function", function: { name: "aktualnyCzas" } });
    assert.ok(!calls[1].tools?.length);
    assert.equal(calls[0].responseFormat ?? calls[0].response_format, undefined);
    assert.equal((calls[1].responseFormat ?? calls[1].response_format)?.type, provider === "google" ? "json" : "json_schema");
    assert.match(JSON.stringify(calls[1]), /Europe\/Warsaw/);
    assert.match(JSON.stringify(calls[0]), /aktualnyCzas jest dostępne i wymagane/);
  }
});

test("NBP: wymuszone narzędzie, prawdziwy SDK, lokalne dane i źródło", async () => {
  for (const provider of ["openrouter", "google"]) {
    let fetches = 0;
    const app = await setup({ toolCall: "kursWalutyNBP", toolInput: { currency: "EUR", date: "" }, publicFetch: async (url) => {
      fetches++;
      assert.match(String(url), /^https:\/\/api.nbp.pl\/api\/exchangerates\/rates\/a\/eur/);
      return new Response(JSON.stringify({ code: "EUR", rates: [{ mid: 4.25, no: "test/A", effectiveDate: "2026-11-13" }] }), { headers: { "content-type": "application/json" } });
    } });
    const { chunks } = await app.post(provider, [{ id: "u", role: "user", parts: [{ type: "text", text: "Jaki jest dziś kurs euro?" }] }]);
    assert.ok(!chunks.some((c) => c.type === "error"), JSON.stringify(chunks));
    assert.equal(fetches, 1);
    assert.deepEqual(chunks.find((c) => c.type === "data-used-tools")?.data, ["kursWalutyNBP"]);
    assert.ok(chunks.some((c) => c.type === "source-url" && c.url.includes("api.nbp.pl")));
    assert.ok(chunks.some((c) => c.type === "data-source-fetched"));
  }
});

test("zwykłe pytanie o godzinę nie uruchamia narzędzia czasu ani wyszukiwarki", async () => {
  for (const provider of ["openrouter", "google"]) {
    const app = await setup();
    const { chunks } = await app.post(provider, [{ id: "u", role: "user", parts: [{ type: "text", text: "Która jest godzina?" }] }]);
    assert.ok(!chunks.some((c) => c.type === "data-used-tools"));
    const call = provider === "google" ? app.google.doStreamCalls[0] : app.requests[0];
    assert.ok(!call.tools?.length);
  }
});

test('pogoda: brak lokalizacji pyta, następne miasto ponownie wymusza narzędzie', async () => {
  for (const provider of ['openrouter', 'google']) {
    const question = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Jaka jest dziś pogoda?' }] };
    const first = await setup({ toolCall: 'pogodaOpenMeteo', toolInput: { city: '', startOffsetDays: 0, days: 1 } });
    const response = await first.post(provider, [question]);
    assert.ok(!response.chunks.some((c) => c.type === 'error'), JSON.stringify(response.chunks));
    assert.deepEqual(response.chunks.find((c) => c.type === 'data-used-tools')?.data, ['pogodaOpenMeteo']);
    assert.ok(!response.chunks.some((c) => c.type === 'source-url'));
    const app = await setup({ toolCall: 'pogodaOpenMeteo', toolInput: { city: 'Warszawa', startOffsetDays: 0, days: 1 }, publicFetch: async (url) => new Response(JSON.stringify(String(url).includes('geocoding') ? { results: [{ name: 'Warszawa', country: 'Polska', latitude: 52.23, longitude: 21.01 }] } : { timezone: 'Europe/Warsaw', daily: { time: ['2026-11-15'], temperature_2m_min: [2], temperature_2m_max: [10], precipitation_sum: [0], weather_code: [3] } })) });
    const { chunks } = await app.post(provider, [question, { id: 'a1', role: 'assistant', parts: [{ type: 'data-chat-result', data: { ...valid, draft: 'Dla jakiej miejscowości sprawdzić pogodę?' } }] }, { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Warszawa' }] }]);
    assert.ok(!chunks.some((c) => c.type === 'error'), JSON.stringify(chunks));
    assert.deepEqual(chunks.find((c) => c.type === 'data-used-tools')?.data, ['pogodaOpenMeteo']);
    assert.ok(chunks.some((c) => c.type === 'source-url' && c.url.includes('open-meteo.com')));
  }
});

test('awaria NBP trafia do modelu jako czytelny wynik narzędzia, bez fałszywego źródła', async () => {
  const app = await setup({ toolCall: 'kursWalutyNBP', toolInput: { currency: 'EUR', date: '' }, publicFetch: async () => new Response('', { status: 503 }) });
  const { chunks } = await app.post('google', [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Kurs EUR?' }] }]);
  assert.ok(!chunks.some((c) => c.type === 'error'));
  assert.ok(!chunks.some((c) => c.type === 'source-url'));
  assert.match(JSON.stringify(app.google.doStreamCalls[1]), /NBP jest niedostępny/);
});


test('zwykła godzina po dokładnej: narzędzia wyłączone, ostatnie pytanie ma własne zasady', async () => {
  for (const provider of ['openrouter', 'google']) {
    const app = await setup();
    const { chunks } = await app.post(provider, [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Która jest DOKŁADNIE godzina? Podaj ms.' }] },
      { id: 'a1', role: 'assistant', parts: [{ type: 'data-chat-result', data: { ...valid, draft: 'Godzina: 12:00:00.432 CET.' } }] },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Która jest godzina?' }] },
    ]);
    const call = provider === 'google' ? app.google.doStreamCalls[0] : app.requests[0];
    assert.ok(!call.tools?.length);
    assert.match(JSON.stringify(call), /Dostępne narzędzia w tym żądaniu: brak/);
    assert.match(JSON.stringify(call), /Nie dodawaj milisekund/);
    assert.ok(!chunks.some((c) => c.type === 'data-used-tools'));
  }
});

test('pominięcie wymaganego narzędzia nie staje się pozornie poprawnym wynikiem', async () => {
  for (const provider of ['openrouter', 'google']) {
    const app = await setup({ text: JSON.stringify({ ...valid, draft: 'Narzędzie dokładnego czasu jest niedostępne.' }) });
    const { chunks } = await app.post(provider, [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Która jest DOKŁADNIE godzina? Podaj ms.' }] }]);
    assert.ok(!chunks.some((c) => c.type === 'data-chat-result'));
    assert.match(chunks.find((c) => c.type === 'error')?.errorText, /Model pominął wymagane narzędzie/);
  }
});


test('lokalizacja requestu trafia do pogody obu providerów; bez pytania o miasto', async () => {
  for (const provider of ['openrouter', 'google']) {
    let fetches = 0;
    const app = await setup({ toolCall: 'pogodaOpenMeteo', toolInput: { city: '', startOffsetDays: 0, days: 1 }, publicFetch: async (url) => {
      fetches++;
      assert.equal(new URL(url).hostname, 'api.open-meteo.com');
      assert.equal(new URL(url).searchParams.get('latitude'), '52.235');
      return new Response(JSON.stringify({ timezone: 'Europe/Warsaw', daily: { time: ['2026-11-15'], temperature_2m_min: [2], temperature_2m_max: [10], precipitation_sum: [0], weather_code: [3] } }));
    } });
    const { chunks } = await app.post(provider, [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Jaka jest dziś pogoda?' }] }], 'chat', { latitude: 52.234567, longitude: 21.012345 });
    assert.ok(!chunks.some((c) => c.type === 'error'), JSON.stringify(chunks));
    assert.equal(fetches, 1);
    assert.deepEqual(chunks.find((c) => c.type === 'data-used-tools')?.data, ['pogodaOpenMeteo']);
    assert.ok(chunks.some((c) => c.type === 'source-url'));
  }
});

test('nieprawidłowa lokalizacja jest odrzucona przed modelem', async () => {
  const app = await setup();
  const { response } = await app.post('openrouter', undefined, 'chat', { latitude: 100, longitude: 21 });
  assert.equal(response.status, 400);
  assert.equal(app.requests.length, 0);
});

test('porównanie EUR obu AI otrzymuje dwa kursy, obliczenia i dwa źródła po jednym tool call', async () => {
  for (const provider of ['openrouter', 'google']) {
    const urls = [];
    const app = await setup({ toolCall: 'kursWalutyNBP', toolInput: { currency: 'EUR', date: '' }, publicFetch: async (url) => {
      urls.push(url);
      const historical = url.includes('/2026-10-16/');
      return new Response(JSON.stringify({ code: 'EUR', rates: [{ mid: historical ? 4 : 4.5, no: historical ? 'test-old/A' : 'test-new/A', effectiveDate: historical ? '2026-10-16' : '2026-11-13' }] }));
    } });
    const { chunks } = await app.post(provider, [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'Porównaj kurs EUR z 2026-10-16 z bieżącym, podaj zmianę.' }] }]);
    assert.ok(!chunks.some((c) => c.type === 'error'), JSON.stringify(chunks));
    assert.equal(urls.length, 2);
    assert.ok(urls.some((url) => url.includes('/2026-10-16/')));
    const calls = provider === 'google' ? app.google.doStreamCalls : app.requests;
    assert.equal(calls.length, 2);
    const finalRequest = JSON.stringify(calls[1]);
    for (const expected of ['historical', 'current', 'changePLN', 'changePercent', '12.5']) assert.ok(finalRequest.includes(expected), expected);
    assert.equal(chunks.filter((c) => c.type === 'source-url').length, 2);
    assert.deepEqual(chunks.find((c) => c.type === 'data-used-tools')?.data, ['kursWalutyNBP']);
  }
});
