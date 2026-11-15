import fileConfig from "../config.json";

const kinds = {
  OPENROUTER_MODEL: "string",
  GEMINI_MODEL: "string",
  OPENROUTER_ENABLED: "boolean",
  GEMINI_ENABLED: "boolean",
  CHAT_MAX_ATTEMPTS: "number",
  CHAT_DUEL_ROUNDS: "number",
  CHAT_TEST_QUESTIONS_ENABLED: "boolean",
  CHAT_SHOW_USED_TOOLS: "boolean",
  AUTH_LEARNING_MODE: "boolean",
  AUTH_STATE_DIR: "string",
} as const;

export type SettingKey = keyof typeof kinds;
type PublicConfig = Partial<Record<SettingKey, string | number | boolean>>;

export function validatePublicConfig(value: unknown): PublicConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("config.json musi zawierać obiekt JSON.");
  for (const [key, entry] of Object.entries(value)) {
    if (!Object.hasOwn(kinds, key)) throw new Error("config.json zawiera niedozwolony parametr. Sekrety i ustawienia hostingu muszą pozostać w env.");
    if (typeof entry !== kinds[key as SettingKey]) throw new Error(`Nieprawidłowy typ parametru ${key} w config.json.`);
    if (kinds[key as SettingKey] === "number" && (!Number.isInteger(entry) || Number(entry) < 1 || Number(entry) > 100)) {
      throw new Error(`Parametr ${key} w config.json musi być liczbą całkowitą od 1 do 100.`);
    }
  }
  return value as PublicConfig;
}

const config = validatePublicConfig(fileConfig);

export function getSetting(key: SettingKey): string | undefined {
  // Ochrona także w runtime: ten mechanizm nigdy nie odczytuje sekretów.
  if (!Object.hasOwn(kinds, key)) throw new Error("Ten parametr nie jest publiczną konfiguracją.");
  return Object.hasOwn(config, key) ? String(config[key]).trim() : process.env[key];
}
