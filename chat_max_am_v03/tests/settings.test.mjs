import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { loadSettingsModule } from "./settings-helper.mjs";

async function setup(config, env = {}) {
  const module = await loadSettingsModule(vm.createContext({ process: { env } }), config);
  await module.evaluate();
  return module.namespace;
}

test("config.json wygrywa, brakujące parametry korzystają z env", async () => {
  const settings = await setup({ OPENROUTER_MODEL: "file/model", GEMINI_MODEL: "file-google", CHAT_DUEL_ROUNDS: 2 }, { OPENROUTER_MODEL: "env/model", GEMINI_MODEL: "env-google", CHAT_DUEL_ROUNDS: "9", CHAT_MAX_ATTEMPTS: "5" });
  assert.equal(settings.getSetting("OPENROUTER_MODEL"), "file/model");
  assert.equal(settings.getSetting("GEMINI_MODEL"), "file-google");
  assert.equal(settings.getSetting("CHAT_DUEL_ROUNDS"), "2");
  assert.equal(settings.getSetting("CHAT_MAX_ATTEMPTS"), "5");
  assert.equal(settings.getSetting("AUTH_STATE_DIR"), undefined);
});

test("false i puste wartości w pliku nie są zastępowane env", async () => {
  const settings = await setup({ OPENROUTER_ENABLED: false, GEMINI_ENABLED: true, OPENROUTER_MODEL: "" }, { OPENROUTER_ENABLED: "true", GEMINI_ENABLED: "false", OPENROUTER_MODEL: "env/model" });
  assert.equal(settings.getSetting("OPENROUTER_ENABLED"), "false");
  assert.equal(settings.getSetting("GEMINI_ENABLED"), "true");
  assert.equal(settings.getSetting("OPENROUTER_MODEL"), "");
});

test("pusty obiekt zachowuje starą konfigurację env", async () => {
  const env = { OPENROUTER_MODEL: "env/router", GEMINI_MODEL: "env/google", CHAT_TEST_QUESTIONS_ENABLED: "true", AUTH_LEARNING_MODE: "false", AUTH_STATE_DIR: "/test/state" };
  const settings = await setup({}, env);
  for (const [key, value] of Object.entries(env)) assert.equal(settings.getSetting(key), value);
});

test("sekrety i ustawienia platformy są niedozwolone w config.json i getSetting", async () => {
  for (const key of ["OPENROUTER_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "CHAT_PASSWORD", "SESSION_SECRET", "BLOB_READ_WRITE_TOKEN", "NODE_ENV", "VERCEL"]) {
    await assert.rejects(setup({ [key]: "private-test-value" }), /niedozwolony parametr/);
    const settings = await setup({}, { [key]: "private-test-value" });
    assert.throws(() => settings.getSetting(key), /nie jest publiczną konfiguracją/);
  }
});

test("plik odrzuca zły format, typ i nieprawidłowe limity", async () => {
  for (const config of [null, [], "JSON", { UNKNOWN_OPTION: true }, { CHAT_MAX_ATTEMPTS: 0 }, { CHAT_DUEL_ROUNDS: 101 }, { CHAT_DUEL_ROUNDS: 1.5 }, { OPENROUTER_MODEL: 123 }, { GEMINI_ENABLED: "false" }, { AUTH_STATE_DIR: null }]) {
    await assert.rejects(setup(config));
  }
});

test("projektowy config.json zawiera oba modele i tylko dozwolone parametry", async () => {
  const config = JSON.parse(await readFile(new URL("../config.json", import.meta.url), "utf8"));
  const settings = await setup(config);
  assert.ok(settings.getSetting("OPENROUTER_MODEL"));
  assert.ok(settings.getSetting("GEMINI_MODEL"));
});
