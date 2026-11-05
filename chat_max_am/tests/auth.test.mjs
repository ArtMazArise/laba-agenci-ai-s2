import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const password = "test-workshop-password";
const secret = "test-only-secret-0123456789-abcdefghijklmnopqrstuvwxyz";

async function setup(t, overrides = {}, sharedDirectory, blobState = { value: null, version: 0, unavailable: false }) {
  const directory = sharedDirectory || await mkdtemp(path.join(os.tmpdir(), "max-auth-test-"));
  if (!sharedDirectory) t.after(() => rm(directory, { recursive: true, force: true }));
  const env = { CHAT_PASSWORD: password, CHAT_MAX_ATTEMPTS: "3", SESSION_SECRET: secret, AUTH_STATE_DIR: directory, NODE_ENV: "test", ...overrides };
  let now = Date.now();
  class Clock extends Date { static now() { return now; } }
  const context = vm.createContext({ process: { env, cwd: () => directory }, Buffer, Response, Request, URL, Date: Clock, AbortSignal, setTimeout, clearTimeout });
  const modules = new Map();
  let modelCalls = 0;
  const jokeCalls = [];
  const unexpectedModel = () => { modelCalls += 1; throw Error("Model must not be called"); };
  const sources = {
    "@/lib/auth": "../lib/auth.ts",
    "./auth-blob": "../lib/auth-blob.ts",
    "@/lib/login-jokes": "../lib/login-jokes.ts",
    login: "../app/api/login/route.ts",
    logout: "../app/api/logout/route.ts",
    chat: "../app/api/chat/route.ts",
  };
  class PreconditionFailed extends Error {}
  class MockAPICallError extends Error {
    constructor(statusCode) { super("PRIVATE_PROVIDER_DETAIL"); this.statusCode = statusCode; }
    static isInstance(error) { return error instanceof MockAPICallError; }
  }
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    let module;
    if (name.startsWith("node:")) {
      const builtin = await import(name);
      module = new vm.SyntheticModule(Object.keys(builtin), function () {
        for (const key of Object.keys(builtin)) this.setExport(key, builtin[key]);
      }, { context });
    } else if (name === "@vercel/blob") {
      module = new vm.SyntheticModule(["get", "put", "BlobPreconditionFailedError"], function () {
        this.setExport("BlobPreconditionFailedError", PreconditionFailed);
        this.setExport("get", async (_pathname, options) => {
          assert.equal(options.access, "private");
          assert.equal(options.useCache, false);
          if (blobState.unavailable) throw Error("Store unavailable");
          return blobState.value === null ? null : { statusCode: 200, stream: new Response(blobState.value).body, blob: { etag: String(blobState.version) } };
        });
        this.setExport("put", async (_pathname, value, options) => {
          assert.equal(options.access, "private");
          assert.equal(options.addRandomSuffix, false);
          if (blobState.unavailable) throw Error("Store unavailable");
          if (blobState.value !== null && !options.allowOverwrite) throw Error("Already exists");
          if (options.allowOverwrite && options.ifMatch !== String(blobState.version)) throw new PreconditionFailed();
          blobState.value = value;
          blobState.version += 1;
          return { etag: String(blobState.version) };
        });
      }, { context });
    } else if (sources[name]) {
      const source = await readFile(new URL(sources[name], import.meta.url), "utf8");
      module = new vm.SourceTextModule(ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText, { context, identifier: name });
    } else {
      const exports = name === "ai" ? ["APICallError", "convertToModelMessages", "streamText", "validateUIMessages", "generateText"]
        : name === "@ai-sdk/google" ? ["createGoogleGenerativeAI"]
        : name === "@openrouter/ai-sdk-provider" ? ["createOpenRouter"] : null;
      if (!exports) throw Error(`Unexpected import: ${name}`);
      module = new vm.SyntheticModule(exports, function () {
        for (const key of exports) this.setExport(key,
          key === "APICallError" ? MockAPICallError
          : key === "generateText" ? async (options) => {
            jokeCalls.push(options);
            if (env.TEST_JOKE_FAILURE === "429") throw new MockAPICallError(429);
            if (env.TEST_JOKE_FAILURE === "503") throw new MockAPICallError(503);
            if (env.TEST_JOKE_FAILURE === "empty-length") return { text: "", finishReason: "length" };
            if (env.TEST_JOKE_FAILURE === "analysis") return { text: 'Analyze the Request: private model analysis. {"joke":"Żart"}', finishReason: "stop" };
            if (env.TEST_JOKE_FAILURE === "too-long") return { text: JSON.stringify({ joke: "x".repeat(321) }), finishReason: "stop" };
            return { text: JSON.stringify({ joke: "Żart z atrapy AI" }), finishReason: "stop" };
          }
          : key.startsWith("create") ? () => (model) => ({ model }) : unexpectedModel);
      }, { context });
    }
    modules.set(name, module);
    await module.link(load);
    await module.evaluate();
    return module;
  }
  const auth = (await load("@/lib/auth")).namespace;
  const login = (await load("login")).namespace.POST;
  const logout = (await load("logout")).namespace.POST;
  const chat = (await load("chat")).namespace.POST;
  function request(route, body, cookie = "", origin = "http://localhost") {
    return new Request(`http://localhost/api/${route}`, { method: "POST", headers: { "content-type": "application/json", origin, cookie }, body: JSON.stringify(body) });
  }
  return {
    auth, directory, env, modelCalls: () => modelCalls, jokeCalls, blobState,
    login: (value, origin, previousJokeProvider) => login(request("login", { password: value, previousJokeProvider }, "", origin)),
    logout: (cookie) => logout(request("logout", {}, cookie)),
    chat: (cookie = "", provider = "openrouter", origin) => chat(request("chat", { provider, messages: [] }, cookie, origin)),
    advance: (milliseconds) => { now += milliseconds; },
  };
}

function cookieOf(response) { return response.headers.get("set-cookie").split(";")[0]; }

test("poprawne hasło: podpisane cookie bez hasła, sesja 8h, HttpOnly i SameSite", async (t) => {
  const app = await setup(t);
  const response = await app.login(password);
  assert.equal(response.status, 200);
  const header = response.headers.get("set-cookie");
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Max-Age=28800/);
  assert.doesNotMatch(header, /Secure/);
  const cookie = cookieOf(response);
  const token = cookie.slice(cookie.indexOf("=") + 1);
  const payload = Buffer.from(token.split(".")[0], "base64url").toString();
  assert.doesNotMatch(payload, /password|secret|test-workshop/);
  assert.equal(await app.auth.hasSession(token), true);
  assert.equal((await app.chat(cookie)).status, 503); // Brak API key: sesja przeszła, model nie.
  assert.equal(app.modelCalls(), 0);
});

test("bez sesji: /api/chat odmawia obu dostawcom przed wywołaniem SDK", async (t) => {
  const app = await setup(t);
  for (const provider of ["openrouter", "google"]) assert.equal((await app.chat("", provider)).status, 401);
  assert.equal(app.modelCalls(), 0);
});

test("błędne hasło: dokładnie trzy próby, żarty aktywnych MAX-ów, później blokada", async (t) => {
  const app = await setup(t);
  for (const remaining of [2, 1, 0]) {
    const response = await app.login("wrong");
    assert.equal(response.status, remaining ? 401 : 429);
    const body = await response.json();
    assert.equal(body.remaining, remaining);
    assert.equal(body.jokes.length, 1);
    assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.equal((await app.login(password)).status, 429);
  app.advance(15 * 60 * 1000 + 1);
  assert.equal((await app.login(password)).status, 200);
  assert.equal(app.modelCalls(), 0);
});

test("wyłączony Gemini nie opowiada żartu", async (t) => {
  const app = await setup(t, { GEMINI_ENABLED: "false" });
  const body = await (await app.login("wrong")).json();
  assert.equal(body.jokes.length, 1);
  assert.match(body.jokes[0].name, /OpenRouter/);
});

test("limit przeżywa nową instancję i nie opiera się na cookie ani pamięci procesu", async (t) => {
  const first = await setup(t);
  await first.login("wrong");
  await first.login("wrong");
  const second = await setup(t, {}, first.directory);
  assert.equal((await second.login("wrong")).status, 429);
  assert.equal((await first.login(password)).status, 429);
});

test("równoległe zgadywanie: atomowy limit trzech prób", async (t) => {
  const app = await setup(t);
  const responses = await Promise.all(Array.from({ length: 8 }, () => app.login("wrong")));
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.deepEqual(bodies.map((body) => body.remaining).sort(), [0, 0, 0, 0, 0, 0, 1, 2]);
  assert.equal((await app.login(password)).status, 429);
});

test("wyjście usuwa cookie i unieważnia skopiowany token na serwerze", async (t) => {
  const app = await setup(t);
  const cookie = cookieOf(await app.login(password));
  const response = await app.logout(cookie);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await app.chat(cookie)).status, 401);
  assert.equal(app.modelCalls(), 0);
});

test("podmieniony i wygasły token są odrzucane", async (t) => {
  const app = await setup(t);
  const cookie = cookieOf(await app.login(password));
  assert.equal((await app.chat(cookie + "tampered")).status, 401);
  app.advance(8 * 60 * 60 * 1000 + 1);
  assert.equal((await app.chat(cookie)).status, 401);
});

test("zmiana hasła unieważnia dotychczasowe sesje", async (t) => {
  const app = await setup(t);
  const cookie = cookieOf(await app.login(password));
  app.env.CHAT_PASSWORD = "new-test-password";
  assert.equal((await app.chat(cookie)).status, 401);
});

test("brak konfiguracji i krótki secret blokują wejście i chat", async (t) => {
  for (const env of [{ CHAT_PASSWORD: "" }, { SESSION_SECRET: "" }, { SESSION_SECRET: "short" }, { NODE_ENV: "production", AUTH_STATE_DIR: "" }]) {
    const app = await setup(t, env);
    assert.equal((await app.login(password)).status, 503);
    assert.equal((await app.chat()).status, 503);
    assert.equal(app.modelCalls(), 0);
  }
});

test("produkcja: cookie Secure, gdy skonfigurowano magazyn; obcy Origin odrzucony", async (t) => {
  const app = await setup(t, { NODE_ENV: "production" });
  assert.equal((await app.login(password, "https://evil.example")).status, 403);
  const response = await app.login(password);
  assert.match(response.headers.get("set-cookie"), /; Secure/);
  assert.equal((await app.chat(cookieOf(response), "openrouter", "https://evil.example")).status, 403);
  assert.equal(app.modelCalls(), 0);
});

test("uszkodzony magazyn blokuje dostęp zamiast resetować licznik", async (t) => {
  const app = await setup(t);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(app.directory, "state.json"), "broken");
  assert.equal((await app.login(password)).status, 503);
  assert.equal(app.modelCalls(), 0);
});


test("tryb nauki: trzy próby, odświeżenie zeruje je bez czekania", async (t) => {
  const app = await setup(t, { NODE_ENV: "development" });
  for (let i = 0; i < 3; i++) {
    const response = await app.login("wrong");
    const body = await response.json();
    assert.equal(body.retryAt, 0);
    if (i === 2) { assert.equal(body.refreshToRetry, true); assert.match(body.error, /ZABLOKOWANO/); assert.doesNotMatch(body.error, /F5|kolejne/); }
  }
  assert.equal((await app.login(password)).status, 429);
  await app.auth.resetLearningAttempts(); // Ten sam kod jest wywoływany przy F5 na ekranie hasła.
  assert.equal((await app.login(password)).status, 200);
});

test("tryb nauki nie działa w produkcji nawet z flagą true", async (t) => {
  const app = await setup(t, { NODE_ENV: "production", AUTH_LEARNING_MODE: "true" });
  for (let i = 0; i < 3; i++) await app.login("wrong");
  await app.auth.resetLearningAttempts();
  assert.equal((await app.login(password)).status, 429);
});

test("adres Next 0.0.0.0: Origin jest porównywany z Host przeglądarki", async (t) => {
  const app = await setup(t);
  assert.equal(app.auth.sameOrigin(new Request("http://0.0.0.0:3000/api/login", { headers: { host: "localhost:3000", origin: "http://localhost:3000" } })), true);
  assert.equal(app.auth.sameOrigin(new Request("http://0.0.0.0:3000/api/login", { headers: { host: "localhost:3000", origin: "http://evil.example" } })), false);
  assert.equal(app.auth.sameOrigin(new Request("http://0.0.0.0:3000/api/login", { headers: { host: "localhost:3000", origin: "http://localhost:3001" } })), false);
});

test("błędne hasło generuje tylko jeden żart, bez hasła w prompcie", async (t) => {
  const app = await setup(t, { OPENROUTER_API_KEY: "mock-router-key", OPENROUTER_MODEL: "mock-router-model", GOOGLE_GENERATIVE_AI_API_KEY: "mock-google-key", GEMINI_MODEL: "mock-google-model" });
  const response = await app.login("wrong-sensitive-password");
  const body = await response.json();
  assert.equal(body.jokes.length, 1);
  assert.ok(body.jokes.every((joke) => joke.generated === true));
  assert.equal(app.jokeCalls.length, 1);
  for (const options of app.jokeCalls) {
    assert.doesNotMatch(options.prompt, /wrong-sensitive-password|test-workshop-password|mock-router-key|mock-google-key/);
    assert.equal(options.maxRetries, 0);
  }
  await app.login("wrong");
  await app.login("wrong");
  assert.equal(app.jokeCalls.length, 3);
  await app.login("wrong");
  assert.equal(app.jokeCalls.length, 3); // Blokada nie generuje kolejnych żartów.
  assert.equal(app.modelCalls(), 0); // Nadal zero wywołań czatu.
});


test("Vercel: prywatny Blob przechowuje sesję i unieważnienie między instancjami", async (t) => {
  const env = { NODE_ENV: "production", VERCEL: "1", AUTH_STATE_DIR: "", BLOB_READ_WRITE_TOKEN: "mock-blob-token" };
  const first = await setup(t, env);
  const cookie = cookieOf(await first.login(password));
  const second = await setup(t, env, first.directory, first.blobState);
  const token = cookie.slice(cookie.indexOf("=") + 1);
  assert.equal(await second.auth.hasSession(token), true);
  assert.equal((await second.logout(cookie)).status, 200);
  assert.equal((await first.chat(cookie)).status, 401);
  assert.equal(first.modelCalls() + second.modelCalls(), 0);
});

test("Vercel: równoległe próby nie omijają limitu dzięki ETag", async (t) => {
  const env = { NODE_ENV: "production", VERCEL: "1", AUTH_STATE_DIR: "", BLOB_READ_WRITE_TOKEN: "mock-blob-token" };
  const first = await setup(t, env);
  const second = await setup(t, env, first.directory, first.blobState);
  const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => (index % 2 ? first : second).login("wrong")));
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.deepEqual(bodies.map((body) => body.remaining).sort(), [0, 0, 0, 0, 0, 0, 1, 2]);
  assert.equal((await first.login(password)).status, 429);
});

test("Vercel: brak tokenu lub awaria Blob blokują dostęp", async (t) => {
  const missing = await setup(t, { NODE_ENV: "production", VERCEL: "1" });
  assert.equal((await missing.login(password)).status, 503);
  const failed = await setup(t, { NODE_ENV: "production", VERCEL: "1", BLOB_READ_WRITE_TOKEN: "mock-blob-token" });
  failed.blobState.unavailable = true;
  assert.equal((await failed.login(password)).status, 503);
  assert.equal(failed.modelCalls(), 0);
});


test("żart OpenRouter ma większy budżet; brak tekstu i HTTP 429 mają odrębne komunikaty", async (t) => {
  const env = { OPENROUTER_API_KEY: "mock-router-key", OPENROUTER_MODEL: "mock-router-model", GEMINI_ENABLED: "false" };
  const app = await setup(t, env);
  assert.equal((await app.login("wrong")).status, 401);
  assert.equal(app.jokeCalls[0].maxOutputTokens, 1024);
  const limited = await setup(t, { ...env, TEST_JOKE_FAILURE: "empty-length" });
  const empty = await (await limited.login("wrong")).json();
  assert.equal(empty.jokes[0].generated, false);
  assert.match(empty.jokes[0].text, /limit tokenów/);
  const throttled = await setup(t, { ...env, TEST_JOKE_FAILURE: "429" });
  const error = await (await throttled.login("wrong")).json();
  assert.match(error.jokes[0].text, /limit zapytań/);
  assert.doesNotMatch(error.jokes[0].text, /PRIVATE_PROVIDER_DETAIL|mock-router-key/);
});


test("interfejs dostaje wyłącznie pole krótkiego żartu, nigdy surową analizę modelu", async (t) => {
  const env = { OPENROUTER_API_KEY: "mock-router-key", OPENROUTER_MODEL: "mock-router-model", GEMINI_ENABLED: "false" };
  const valid = await setup(t, env);
  const joke = await (await valid.login("wrong")).json();
  assert.equal(joke.jokes[0].text, "Żart z atrapy AI");
  assert.equal(valid.jokeCalls[0].providerOptions.openrouter.reasoning.exclude, true);
  assert.equal(valid.jokeCalls[0].providerOptions.openrouter.reasoning.effort, "none");
  for (const failure of ["analysis", "too-long"]) {
    const app = await setup(t, { ...env, TEST_JOKE_FAILURE: failure });
    const response = await (await app.login("wrong")).json();
    assert.equal(response.jokes[0].generated, false);
    assert.match(response.jokes[0].text, /oczekiwanym formacie/);
    assert.doesNotMatch(JSON.stringify(response), /Analyze the Request|private model analysis/);
  }
});


test("jeden żart: losowy pierwszy MAX, potem drugi i znowu pierwszy", async (t) => {
  const app = await setup(t, { OPENROUTER_API_KEY: "mock-router-key", OPENROUTER_MODEL: "mock-router-model", GOOGLE_GENERATIVE_AI_API_KEY: "mock-google-key", GEMINI_MODEL: "mock-google-model" });
  const first = await (await app.login("wrong")).json();
  assert.ok(["openrouter", "google"].includes(first.jokeProvider));
  const second = await (await app.login("wrong", undefined, first.jokeProvider)).json();
  const third = await (await app.login("wrong", undefined, second.jokeProvider)).json();
  assert.notEqual(first.jokeProvider, second.jokeProvider);
  assert.equal(third.jokeProvider, first.jokeProvider);
  for (const body of [first, second, third]) assert.equal(body.jokes.length, 1);
  assert.equal(app.jokeCalls.length, 3);
});


test("domyślnie pięć prób; env zmienia limit i komunikat końcowy", async (t) => {
  for (const [setting, limit] of [[undefined, 5], ["2", 2], ["0", 5], ["invalid", 5]]) {
    const app = await setup(t, { CHAT_MAX_ATTEMPTS: setting });
    assert.equal(app.auth.getMaxAttempts(), limit);
    for (let used = 1; used <= limit; used++) {
      const response = await app.login("wrong");
      const body = await response.json();
      assert.equal(body.remaining, limit - used);
      assert.equal(body.error, `Błędne hasło — ${used}/${limit} prób${used === limit ? " — ZABLOKOWANO" : ""}`);
      assert.doesNotMatch(body.error, /F5|kolejne/);
    }
    assert.equal((await app.login(password)).status, 429);
  }
});

test("Gemini HTTP 503 pokazuje przejściową niedostępność bez ponowień", async (t) => {
  const app = await setup(t, { OPENROUTER_ENABLED: "false", GOOGLE_GENERATIVE_AI_API_KEY: "mock-google-key", GEMINI_MODEL: "mock-google-model", TEST_JOKE_FAILURE: "503" });
  const body = await (await app.login("wrong")).json();
  assert.equal(body.jokes[0].generated, false);
  assert.match(body.jokes[0].text, /chwilowo przeciążony lub niedostępny/);
  assert.equal(app.jokeCalls.length, 1);
});
