import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText } from "ai";

// Wyłącznie stały tekst. Hasło ani żadne dane z formularza nie trafiają do modeli.
export async function generateLoginJokes(signal: AbortSignal) {
  const providers = [
    { name: "MAX · OpenRouter", enabled: process.env.OPENROUTER_ENABLED, key: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL, create: createOpenRouter },
    { name: "MAX · Gemini", enabled: process.env.GEMINI_ENABLED, key: process.env.GOOGLE_GENERATIVE_AI_API_KEY, model: process.env.GEMINI_MODEL, create: createGoogleGenerativeAI },
  ];
  return Promise.all(providers.filter((provider) => provider.enabled?.trim().toLowerCase() !== "false").map(async (provider) => {
    if (!provider.key?.trim() || !provider.model?.trim()) return { name: provider.name, text: "Żart niedostępny: brak klucza lub modelu w konfiguracji.", generated: false };
    try {
      const result = await generateText({
        model: provider.create({ apiKey: provider.key.trim() })(provider.model.trim()),
        prompt: "Użytkownik pomylił hasło do warsztatowego chatbota MAX. Napisz po polsku jeden krótki, łagodny i żartobliwie mroczny żart o szkieletach, czaszkach lub krypcie. Nie obrażaj użytkownika. Nie sugeruj żadnego hasła. Maksymalnie dwa zdania, bez wstępu.",
        maxOutputTokens: 180,
        maxRetries: 0,
        abortSignal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      });
      if (!result.text.trim()) throw new Error("Empty joke");
      return { name: provider.name, text: result.text.trim(), generated: true };
    } catch {
      return { name: provider.name, text: "Żart niedostępny: model nie odpowiedział. Sprawdź limit i konfigurację dostawcy.", generated: false };
    }
  }));
}
