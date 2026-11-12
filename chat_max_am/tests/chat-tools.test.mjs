import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../lib/chat-tools.ts", import.meta.url), "utf8");
const toolsContext = vm.createContext({});
const schemaModule = new vm.SourceTextModule(ts.transpileModule(await readFile(new URL("../lib/chat-result.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText, { context: toolsContext });
await schemaModule.link(() => {});
const module = new vm.SourceTextModule(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText, { context: toolsContext });
await module.link((name) => { if (name === "./chat-result") return schemaModule; throw Error("Unexpected runtime import"); });
await module.evaluate();
const { parseTestQuestions, messageText, formatMessage, formatConversation, formatCombinedConversation, broadcastMessage } = module.namespace;

test("kopiuj z JSON: wiadomość i cały czat zawierają szkic oraz zatwierdzony obiekt", () => {
  const data = { category: "support", priority: "normal", draft: "Jaki komunikat widzisz?", needs_review: true };
  const user = { id: "u", role: "user", parts: [{ type: "text", text: "Nie mogę się zalogować." }] };
  const reply = { id: "a", role: "assistant", parts: [{ type: "data-chat-result", data }] };
  assert.equal(formatMessage(reply, "MAX", true), `MAX: ${data.draft}\nJSON:\n${JSON.stringify(data, null, 2)}`);
  assert.equal(formatMessage(user, "MAX", true), formatMessage(user, "MAX"));
  assert.equal(formatConversation([user, reply], "MAX", true), `${formatMessage(user, "MAX")}\n${"-".repeat(63)}\n${formatMessage(reply, "MAX", true)}`);
  assert.doesNotMatch(formatConversation([user, reply], "MAX"), /JSON:|needs_review/);
  const preview = { id: "p", role: "assistant", parts: [{ type: "data-chat-preview", data: "Częściowa odpowiedź" }] };
  assert.equal(formatConversation([preview], "MAX", true), "");
});

test("kopiuj całość z JSON zachowuje wspólne pytanie raz i kolejność obu modeli", () => {
  const question = { id: "u", role: "user", metadata: { sharedTurnId: "t" }, parts: [{ type: "text", text: "Pomocy" }] };
  const data = { category: "support", priority: "high", draft: "Odpowiedź Routera", needs_review: true };
  const reply = { id: "a", role: "assistant", parts: [{ type: "data-chat-result", data }] };
  const gemini = { id: "g", role: "assistant", parts: [{ type: "data-chat-result", data: { ...data, draft: "Odpowiedź Gemini" } }] };
  const combined = formatCombinedConversation([question, reply], [question, gemini], true);
  assert.equal(combined.match(/Ty: Pomocy/g).length, 1);
  assert.equal(combined.match(/JSON:/g).length, 2);
  assert.ok(combined.indexOf("MAX · OpenRouter") < combined.indexOf("MAX · Gemini"));
  assert.match(combined, /"needs_review": true/);
  const single = formatCombinedConversation([question, reply], [], true);
  assert.equal(single.match(/JSON:/g).length, 1);
  assert.doesNotMatch(single, /MAX · Gemini/);
});

test("JSON w czacie: pokazuje i kopiuje tylko zatwierdzony draft, pomija podgląd", () => {
  const result = { category: "support", priority: "high", draft: "Napisz proszę, jaki komunikat widzisz.", needs_review: true };
  const message = { id: "a", role: "assistant", parts: [{ type: "data-chat-preview", data: "Niepełny szkic" }, { type: "data-chat-result", data: result }] };
  assert.equal(messageText(message), result.draft);
  assert.equal(module.namespace.messageResult(message), result);
  assert.equal(formatMessage(message, "MAX"), `MAX: ${result.draft}`);
  assert.equal(messageText({ parts: message.parts.slice(0, 1) }), "");
  assert.equal(formatConversation([{ ...message, parts: message.parts.slice(0, 1) }], "MAX"), "");
  assert.equal(messageText({ parts: [{ type: "data-chat-result", data: { ...result, needs_review: "true" } }] }), "");
});

test("schemat odrzuca brakujące pola, puste szkice, nieznane wartości i nadmiarowe klucze", () => {
  const valid = { category: "sales", priority: "normal", draft: "Dziękuję za wiadomość.", needs_review: false };
  const { isChatResult } = schemaModule.namespace;
  assert.equal(isChatResult(valid), true);
  for (const value of [null, [], {}, { ...valid, category: "billing" }, { ...valid, priority: "urgent" }, { ...valid, draft: " " }, { ...valid, draft: "x".repeat(4001) }, { ...valid, needs_review: 1 }, { ...valid, extra: 1 }]) assert.equal(isChatResult(value), false);
  for (const key of Object.keys(valid)) {
    const missing = { ...valid }; delete missing[key];
    assert.equal(isChatResult(missing), false);
  }
});

test("widok klienta i kopie zawierają szkic bez notatki; metadane są oddzielne", () => {
  const text = "Kategoria: support  \nSzkic: Napisz proszę, jaki komunikat pojawia się podczas logowania.  \nDo sprawdzenia: przyczyna problemu.  \nneeds_review = true";
  const result = module.namespace.assistantPresentation(text);
  assert.equal(result.text, "Napisz proszę, jaki komunikat pojawia się podczas logowania.");
  assert.equal(result.category, "support");
  assert.equal(result.review, "true");
  const question = { id: "u1", role: "user", parts: [{ type: "text", text: "Nie mogę się zalogować." }] };
  const reply = { id: "a1", role: "assistant", parts: [{ type: "text", text }] };
  for (const copy of [formatMessage(reply, "MAX"), formatConversation([question, reply], "MAX"), formatCombinedConversation([question, reply], [])]) {
    assert.match(copy, /Napisz proszę/);
    assert.doesNotMatch(copy, /Kategoria|Szkic:|Do sprawdzenia|needs_review/);
  }
  for (let length = 0; length <= text.length; length++) {
    const partial = module.namespace.assistantPresentation(text.slice(0, length));
    assert.ok(result.text.startsWith(partial.text));
  }
  assert.equal(module.namespace.assistantPresentation("Zwykła odpowiedź pojedynku.").text, "Zwykła odpowiedź pojedynku.");
});

test("pytania JSON: pusta lista, błędy, polskie znaki, powtórzenia", () => {
  for (const value of ["{}", '{"questions":[]}']) {
    const parsed = parseTestQuestions(value);
    assert.equal(parsed.questions.length, 0);
    assert.equal(parsed.invalid, false);
  }
  for (const value of [undefined, "", "  ", '[]', '{"questions":["test",1]}', '{"questions":"test"}', 'not JSON']) assert.equal(parseTestQuestions(value).invalid, true);
  const parsed = parseTestQuestions('{"questions":[" Kim jesteś? ","", "Kim jesteś?", "Która jest godzina?"]}');
  assert.equal(parsed.questions.join("|"), "Kim jesteś?|Która jest godzina?");
  assert.equal(parsed.invalid, false);
});

test("kopiowanie: autor i wiadomość; cały czat zachowuje kolejność i pomija rozumowanie", () => {
  const user = { id: "1", role: "user", parts: [{ type: "text", text: "Kim jesteś?" }] };
  const assistant = { id: "2", role: "assistant", parts: [{ type: "reasoning", text: "Ukryte rozumowanie" }, { type: "text", text: "Jestem MAX.\nWitaj!" }] };
  const empty = { id: "3", role: "assistant", parts: [] };
  assert.equal(messageText(assistant), "Jestem MAX.\nWitaj!");
  assert.equal(formatMessage(user, "MAX · Gemini"), "Ty: Kim jesteś?");
  assert.equal(formatConversation([user, assistant, empty], "MAX · Gemini"), `Ty: Kim jesteś?\n${"-".repeat(63)}\nMAX · Gemini: Jestem MAX.\nWitaj!`);
});

test("wspólna wiadomość uruchamia oba zaznaczone modele równocześnie", async () => {
  const calls = [];
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const sender = (provider) => async (text) => { calls.push(`${provider}:${text}`); await waiting; };
  const pending = broadcastMessage("  Co tu robisz?  ", { openrouter: true, google: true }, { openrouter: sender("openrouter"), google: sender("google") });
  assert.deepEqual(calls, ["openrouter:Co tu robisz?", "google:Co tu robisz?"]);
  release();
  assert.equal((await pending).length, 2);
});

test("wspólna wiadomość pomija niezaznaczony model i pusty tekst", async () => {
  const calls = [];
  const senders = { openrouter: async () => { calls.push("openrouter"); }, google: async () => { calls.push("google"); } };
  await broadcastMessage("Test", { openrouter: false, google: true }, senders);
  await broadcastMessage(" ", { openrouter: true, google: true }, senders);
  await broadcastMessage("Test", { openrouter: false, google: false }, senders);
  assert.deepEqual(calls, ["google"]);
});

test("błąd jednego modelu nie blokuje wiadomości do drugiego", async () => {
  let googleCalled = false;
  const results = await broadcastMessage("Test", { openrouter: true, google: true }, {
    openrouter: async () => { throw Error("Offline"); },
    google: async () => { googleCalled = true; },
  });
  assert.equal(googleCalled, true);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "fulfilled");
});


test("wiadomości nie zawierają nadmiarowych pustych linii", () => {
  assert.equal(messageText({ parts: [{ type: "text", text: "\nPierwsza linia\r\n\r\n  \nDruga linia\n\n" }] }), "Pierwsza linia\nDruga linia");
});


test("kopiuj całość: wspólne pytanie raz, potem OpenRouter i Gemini", () => {
  const question = (id, group, time) => ({ id, role: "user", metadata: { sharedTurnId: group, sentAt: time }, parts: [{ type: "text", text: "Kim jesteś?" }] });
  const answer = (id, text) => ({ id, role: "assistant", parts: [{ type: "text", text }] });
  const router = [question("r1", "shared1", 1), answer("r2", "Router 1"), question("r3", "shared2", 2), answer("r4", "Router 2")];
  const gemini = [question("g1", "shared1", 1), answer("g2", "Gemini 1"), question("g3", "shared2", 2), answer("g4", "Gemini 2")];
  const result = formatCombinedConversation(router, gemini).split(`\n${"-".repeat(63)}\n`);
  assert.deepEqual(result, ["Ty: Kim jesteś?", "MAX · OpenRouter: Router 1", "MAX · Gemini: Gemini 1", "Ty: Kim jesteś?", "MAX · OpenRouter: Router 2", "MAX · Gemini: Gemini 2"]);
});

test("kopiuj całość: brak odpowiedzi nie tworzy pustego wpisu; pojedyncze pytania pozostają osobno", () => {
  const question = (id, time) => ({ id, role: "user", metadata: { sentAt: time }, parts: [{ type: "text", text: "Test" }] });
  const answer = (id, text) => ({ id, role: "assistant", parts: [{ type: "text", text }] });
  const result = formatCombinedConversation([question("r1", 2), answer("r2", "Router")], [question("g1", 1), answer("g2", "Gemini"), question("g3", 3)]);
  assert.deepEqual(result.split(`\n${"-".repeat(63)}\n`), ["Ty: Test", "MAX · Gemini: Gemini", "Ty: Test", "MAX · OpenRouter: Router", "Ty: Test"]);
});

test("wspólne pytanie z odpowiedzią tylko Gemini pomija OpenRouter", () => {
  const question = (id) => ({ id, role: "user", metadata: { sharedTurnId: "shared", sentAt: 1 }, parts: [{ type: "text", text: "Test" }] });
  const gemini = { id: "reply", role: "assistant", parts: [{ type: "text", text: "Odpowiedź" }] };
  assert.equal(formatCombinedConversation([question("r")], [question("g"), gemini]), `Ty: Test\n${"-".repeat(63)}\nMAX · Gemini: Odpowiedź`);
});

async function questionLoader(flag, contents) {
  let reads = 0;
  const context = vm.createContext({ process: { env: { CHAT_TEST_QUESTIONS_ENABLED: flag, CHAT_TEST_QUESTIONS: '["IGNOROWANE"]' }, cwd: () => "/project" } });
  const loaderSource = await readFile(new URL("../lib/test-questions.ts", import.meta.url), "utf8");
  const loader = new vm.SourceTextModule(ts.transpileModule(loaderSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText, { context });
  const filesystem = new vm.SyntheticModule(["readFile"], function () {
    this.setExport("readFile", async (filename) => {
      reads += 1;
      assert.equal(filename, "/project/config/test-questions.json");
      if (contents === undefined) throw Error("File not found");
      return contents;
    });
  }, { context });
  const paths = new vm.SyntheticModule(["default"], function () { this.setExport("default", { join: (...parts) => parts.join("/") }); }, { context });
  const parser = new vm.SyntheticModule(["parseTestQuestions"], function () { this.setExport("parseTestQuestions", parseTestQuestions); }, { context });
  await loader.link((name) => {
    if (name === "node:fs/promises") return filesystem;
    if (name === "node:path") return paths;
    if (name === "./chat-tools") return parser;
    throw Error(`Unexpected import ${name}`);
  });
  await loader.evaluate();
  const result = await loader.namespace.loadTestQuestions();
  return { result, reads };
}

test("wyłączona lista nie odczytuje pliku ani starego JSON z env", async () => {
  for (const flag of [undefined, "", "false", " FALSE "]) {
    const { result, reads } = await questionLoader(flag, "invalid JSON");
    assert.equal(reads, 0);
    assert.equal(result.questions.length, 0);
    assert.equal(result.invalid, false);
  }
});

test("włączona lista odczytuje prawdziwy plik z obiektem i pytaniem o pizzę", async () => {
  const contents = await readFile(new URL("../config/test-questions.json", import.meta.url), "utf8");
  const { result, reads } = await questionLoader(" TRUE ", contents);
  assert.equal(reads, 1);
  assert.equal(result.invalid, false);
  assert.equal(result.questions.length, 12);
  assert.ok(result.questions.includes("Daj przepis na dobrą pizzę"));
});

test("brak lub błędny plik pytań pokazuje błąd; pusty obiekt jest poprawny", async () => {
  for (const contents of [undefined, "", "bad JSON", "[]"]) {
    assert.equal((await questionLoader("true", contents)).result.invalid, true);
  }
  const { result } = await questionLoader("true", "{}");
  assert.equal(result.invalid, false);
  assert.equal(result.questions.length, 0);
});
