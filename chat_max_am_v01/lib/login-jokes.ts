import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { APICallError, generateText } from "ai";
import { randomInt } from "node:crypto";

function readJoke(text: string): string | null {
  try {
    const value = JSON.parse(text.trim());
    if (!value || Object.keys(value).length !== 1 || typeof value.joke !== "string") return null;
    const joke = value.joke.trim();
    return joke.length > 0 && joke.length <= 320 ? joke : null;
  } catch { return null; }
}

// Wyłącznie stały tekst. Hasło ani żadne dane z formularza nie trafiają do modeli.
export async function generateLoginJokes(signal: AbortSignal, previousProvider?: "openrouter" | "google") {
  const providers = [
    { id: "openrouter", name: "MAX · OpenRouter", enabled: process.env.OPENROUTER_ENABLED, key: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL, create: createOpenRouter, maxTokens: 1024, timeoutMs: 30000 },
    { id: "google", name: "MAX · Gemini", enabled: process.env.GEMINI_ENABLED, key: process.env.GOOGLE_GENERATIVE_AI_API_KEY, model: process.env.GEMINI_MODEL, create: createGoogleGenerativeAI, maxTokens: 180, timeoutMs: 30000 },
  ];
  const active = providers.filter((provider) => provider.enabled?.trim().toLowerCase() !== "false");
  if (active.length === 0) return [];
  const selected = active.length === 1 ? active[0]
    : previousProvider ? active.find((provider) => provider.id !== previousProvider)!
    : active[randomInt(active.length)];
  return Promise.all([selected].map(async (provider) => {
    if (!provider.key?.trim() || !provider.model?.trim()) return { provider: provider.id, name: provider.name, text: "Żart niedostępny: brak klucza lub modelu w konfiguracji.", generated: false };
    const timeout = AbortSignal.timeout(provider.timeoutMs);
    try {
      const result = await generateText({
        model: provider.create({ apiKey: provider.key.trim() })(provider.model.trim()),
        system: 'Zwracaj wyłącznie obiekt JSON z jednym polem "joke" zawierającym gotowy żart. Bez Markdown, analizy, planu ani opisu rozumowania. Żart po polsku, maksymalnie 320 znaków.',
        prompt: 'Użytkownik pomylił hasło do warsztatowego chatbota MAX. Wymyśl łagodny, żartobliwie mroczny żart o szkieletach, czaszkach lub krypcie. Nie obrażaj użytkownika ani nie sugeruj hasła. Maksymalnie dwa zdania. Format odpowiedzi: {"joke":"gotowy żart"}.',
        providerOptions: provider.name === "MAX · OpenRouter" ? { openrouter: { reasoning: { effort: "none", exclude: true } } } : undefined,
        maxOutputTokens: provider.maxTokens,
        maxRetries: 0,
        abortSignal: AbortSignal.any([signal, timeout]),
      });
      if (!result.text.trim()) return {
        provider: provider.id, name: provider.name,
        text: result.finishReason === "length"
          ? "Żart niedostępny: model wyczerpał limit tokenów, zanim zwrócił tekst. Wybierz model bez rozbudowanego rozumowania."
          : "Żart niedostępny: model zakończył odpowiedź bez tekstu.",
        generated: false,
      };
      const joke = readJoke(result.text);
      if (!joke) return { provider: provider.id, name: provider.name, text: "Żart niedostępny: model nie zwrócił krótkiego żartu w oczekiwanym formacie.", generated: false };
      // Surowy tekst modelu nigdy nie trafia do interfejsu.
      return { provider: provider.id, name: provider.name, text: joke, generated: true };
    } catch (error) {
      let text = "Żart niedostępny: nie udało się połączyć z dostawcą modelu.";
      if (signal.aborted) text = "Pobieranie żartu zostało przerwane.";
      else if (timeout.aborted) text = `Żart niedostępny: model nie odpowiedział w ciągu ${provider.timeoutMs / 1000} sekund.`;
      else if (APICallError.isInstance(error)) {
        switch (error.statusCode) {
          case 401: case 403: text = "Żart niedostępny: dostawca odrzucił klucz lub dostęp do modelu."; break;
          case 402: text = "Żart niedostępny: dostawca zgłasza brak środków."; break;
          case 429: text = "Żart niedostępny: przekroczono limit zapytań dostawcy. Spróbuj później."; break;
          case 404: text = "Żart niedostępny: skonfigurowany model nie jest dostępny."; break;
          case 503: text = "Żart niedostępny: dostawca jest chwilowo przeciążony lub niedostępny. Spróbuj później."; break;
          default: text = `Żart niedostępny: dostawca zwrócił błąd HTTP ${error.statusCode ?? 502}.`;
        }
      }
      return { provider: provider.id, name: provider.name, text, generated: false };
    }
  }));
}
