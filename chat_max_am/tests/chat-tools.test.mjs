import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../lib/chat-tools.ts", import.meta.url), "utf8");
const module = new vm.SourceTextModule(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText, { context: vm.createContext({}) });
await module.link(() => { throw Error("Unexpected runtime import"); });
await module.evaluate();
const { parseTestQuestions, messageText, formatMessage, formatConversation, formatCombinedConversation, broadcastMessage } = module.namespace;

test("pytania JSON: pusta lista, błędy, polskie znaki, powtórzenia", () => {
  for (const value of [undefined, "", "  ", "[]"]) {
    const parsed = parseTestQuestions(value);
    assert.equal(parsed.questions.length, 0);
    assert.equal(parsed.invalid, false);
  }
  for (const value of ['{"question":"test"}', '["test", 1]', 'not JSON']) assert.equal(parseTestQuestions(value).invalid, true);
  const parsed = parseTestQuestions('[" Kim jesteś? ","", "Kim jesteś?", "Która jest godzina?"]');
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
