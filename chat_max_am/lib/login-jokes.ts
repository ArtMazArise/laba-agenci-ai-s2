import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { APICallError, generateText } from "ai";

// Wyłącznie stały tekst. Hasło ani żadne dane z formularza nie trafiają do modeli.
export async function generateLoginJokes(signal: AbortSignal) {
  const providers = [
    { name: "MAX · OpenRouter", enabled: process.env.OPENROUTER_ENABLED, key: process.env.OPENROUTER_API_KEY, model: process.env.OPENROUTER_MODEL, create: createOpenRouter, maxTokens: 1024, timeoutMs: 30000 },
    { name: "MAX · Gemini", enabled: process.env.GEMINI_ENABLED, key: process.env.GOOGLE_GENERATIVE_AI_API_KEY, model: process.env.GEMINI_MODEL, create: createGoogleGenerativeAI, maxTokens: 180, timeoutMs: 10000 },
  ];
  return Promise.all(providers.filter((provider) => provider.enabled?.trim().toLowerCase() !== "false").map(async (provider) => {
    if (!provider.key?.trim() || !provider.model?.trim()) return { name: provider.name, text: "Żart niedostępny: brak klucza lub modelu w konfiguracji.", generated: false };
    const timeout = AbortSignal.timeout(provider.timeoutMs);
    try {
      const result = await generateText({
        model: provider.create({ apiKey: provider.key.trim() })(provider.model.trim()),
        prompt: "Użytkownik pomylił hasło do warsztatowego chatbota MAX. Napisz po polsku jeden krótki, łagodny i żartobliwie mroczny żart o szkieletach, czaszkach lub krypcie. Nie obrażaj użytkownika. Nie sugeruj żadnego hasła. Maksymalnie dwa zdania, bez wstępu.",
        maxOutputTokens: provider.maxTokens,
        maxRetries: 0,
        abortSignal: AbortSignal.any([signal, timeout]),
      });
      if (!result.text.trim()) return {
        name: provider.name,
        text: result.finishReason === "length"
          ? "Żart niedostępny: model wyczerpał limit tokenów, zanim zwrócił tekst. Wybierz model bez rozbudowanego rozumowania."
          : "Żart niedostępny: model zakończył odpowiedź bez tekstu.",
        generated: false,
      };
      return { name: provider.name, text: result.text.trim(), generated: true };
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
          default: text = `Żart niedostępny: dostawca zwrócił błąd HTTP ${error.statusCode ?? 502}.`;
        }
      }
      return { name: provider.name, text, generated: false };
    }
  }));
}
