import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  APICallError,
  convertToModelMessages,
  streamText,
  validateUIMessages,
  type UIMessage,
} from "ai";

export const runtime = "nodejs";
export const maxDuration = 60;

function publicError(error: unknown): string {
  if (APICallError.isInstance(error)) {
    switch (error.statusCode) {
      case 401:
      case 403:
        return "MAX: OpenRouter odrzucił dostęp. Sprawdź klucz w .env.local.";
      case 402:
        return "MAX: Brak środków na koncie OpenRouter. Sprawdź saldo konta.";
      case 404:
        return "MAX: Model jest niedostępny. Sprawdź OPENROUTER_MODEL w .env.local.";
      case 429:
        return "MAX: Zbyt wiele próśb do krypty. Poczekaj chwilę i spróbuj ponownie.";
    }
  }
  return "MAX: Połączenie z OpenRouter nie powiodło się lub odpowiedź została przerwana. Spróbuj ponownie; sprawdź konfigurację i dostępność modelu.";
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = process.env.OPENROUTER_MODEL?.trim();

  if (!apiKey || !model) {
    return new Response(
      "MAX: Brakuje konfiguracji. Uzupełnij OPENROUTER_API_KEY i OPENROUTER_MODEL w .env.local, a następnie uruchom serwer ponownie.",
      { status: 503 },
    );
  }

  let messages: UIMessage[];
  try {
    const body = await request.json();
    messages = await validateUIMessages({ messages: body?.messages });
    const lastMessage = messages.at(-1);
    if (
      messages.some((message) => message.role !== "user" && message.role !== "assistant") ||
      lastMessage?.role !== "user" ||
      !lastMessage.parts.some((part) => part.type === "text" && part.text.trim())
    ) {
      return new Response("MAX: Wpisz niepustą wiadomość. Historia może zawierać tylko rozmowę użytkownika z MAX-em.", { status: 400 });
    }
  } catch {
    return new Response("MAX: Nieprawidłowy format rozmowy. Odśwież stronę i spróbuj ponownie.", { status: 400 });
  }

  try {
    const openrouter = createOpenRouter({ apiKey });
    const result = streamText({
      model: openrouter(model),
      system: "Jesteś MAX, od AM. Pisz po polsku, krótko i pomocnie. Masz żartobliwy, mroczny styl: krypta, czaszki i szkielety to Twoje ulubione metafory. Żartuj łagodnie, bez obrażania rozmówcy. Najpierw odpowiadaj konkretnie, a humor traktuj jako dodatek. Korzystaj z historii rozmowy. Nie udawaj wykonanych czynności ani wiedzy, której nie masz.",
      messages: await convertToModelMessages(messages),
      abortSignal: request.signal,
      maxRetries: 0,
      // Nie zapisuj surowych błędów dostawcy, które mogą zawierać dane żądania.
      onError: () => {},
    });

    return result.toUIMessageStreamResponse({
      onError: publicError,
    });
  } catch (error) {
    return new Response(publicError(error), { status: 502 });
  }
}
