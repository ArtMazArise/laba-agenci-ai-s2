import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as ai from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

// Prawdziwy SDK i provider, wyłącznie lokalne atrapy odpowiedzi HTTP. Bez sieci i sekretów.
const valid = { category: "support", priority: "normal", draft: "Napisz proszę, jaki komunikat widzisz.", needs_review: true };
const routeSource = await readFile(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const schemaSource = await readFile(new URL("../lib/chat-result.ts", import.meta.url), "utf8");
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;

async function setup({ text = JSON.stringify(valid), reason = "stop", providerError = false, disconnected = false, unsupportedWarning = false } = {}) {
  const requests = [];
  const router = createOpenRouter({
    apiKey: "test-only-key",
    fetch: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      if (providerError) return new Response(JSON.stringify({ error: { message: "PRIVATE_PROVIDER_DETAILS" } }), { status: providerError === true ? 503 : providerError, headers: { "content-type": "application/json" } });
      if (disconnected) return new Response(new ReadableStream({ start(controller) { controller.error(new Error("PRIVATE_PROVIDER_DETAILS")); } }), { headers: { "content-type": "text/event-stream" } });
      const chunks = [
        ...[text.slice(0, 55), text.slice(55)].filter(Boolean).map((content) => ({ id: "test", choices: [{ index: 0, delta: { content }, finish_reason: null }] })),
        { id: "test", choices: [{ index: 0, delta: {}, finish_reason: reason === "content-filter" ? "content_filter" : reason }] },
      ];
      return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    },
  });
  const google = new MockLanguageModelV3({ doStream: async () => {
    if (providerError) throw new ai.APICallError({ message: "PRIVATE_PROVIDER_DETAILS", url: "http://test", requestBodyValues: {}, statusCode: providerError === true ? 503 : providerError });
    return { stream: new ReadableStream({ start(controller) {
    if (disconnected) { controller.error(new Error("PRIVATE_PROVIDER_DETAILS")); return; }
    controller.enqueue({ type: "stream-start", warnings: unsupportedWarning ? [{ type: "unsupported", feature: "responseFormat" }] : [] });
    controller.enqueue({ type: "text-start", id: "t" });
    controller.enqueue({ type: "text-delta", id: "t", delta: text });
    controller.enqueue({ type: "text-end", id: "t" });
    controller.enqueue({ type: "finish", finishReason: { unified: reason, raw: reason }, usage: { inputTokens: { total: 10 }, outputTokens: { total: 20 } } });
    controller.close();
  } }) }; } });
  const context = vm.createContext({ Response, Request, process: { env: { OPENROUTER_API_KEY: "test-only-key", OPENROUTER_MODEL: "test/model", GOOGLE_GENERATIVE_AI_API_KEY: "test-google", GEMINI_MODEL: "test-google-model" } } });
  const schema = new vm.SourceTextModule(compile(schemaSource), { context });
  await schema.link(() => {});
  const aiModule = new vm.SyntheticModule(Object.keys(ai), function () { for (const key of Object.keys(ai)) this.setExport(key, ai[key]); }, { context });
  const routerModule = new vm.SyntheticModule(["createOpenRouter"], function () { this.setExport("createOpenRouter", () => router); }, { context });
  const googleModule = new vm.SyntheticModule(["createGoogleGenerativeAI"], function () { this.setExport("createGoogleGenerativeAI", () => () => google); }, { context });
  const auth = new vm.SyntheticModule(["requireSession"], function () { this.setExport("requireSession", async () => null); }, { context });
  const route = new vm.SourceTextModule(compile(routeSource), { context });
  await route.link((name) => ({ ai: aiModule, "@/lib/chat-result": schema, "@/lib/auth": auth, "@openrouter/ai-sdk-provider": routerModule, "@ai-sdk/google": googleModule })[name]);
  await route.evaluate();
  return {
    requests, google, schema: schema.namespace,
    async post(provider = "openrouter", messages = [{ id: "u", role: "user", parts: [{ type: "text", text: "Nie mogę się zalogować." }] }], mode = "chat") {
      const response = await route.namespace.POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, messages, mode }) }));
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
