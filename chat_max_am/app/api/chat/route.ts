import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  APICallError,
  convertToModelMessages,
  streamText,
  validateUIMessages,
  type UIMessage,
} from "ai";

export const runtime = "nodejs";
export const maxDuration = 60;

function publicError(error: unknown, provider: "openrouter" | "google"): string {
  const name = provider === "google" ? "Gemini" : "OpenRouter";
  if (APICallError.isInstance(error)) {
    switch (error.statusCode) {
      case 401:
      case 403:
        return `MAX: ${name} odrzucił dostęp. Sprawdź właściwy klucz w .env.local.`;
      case 402:
        return `MAX: Brak środków na koncie ${name}. Sprawdź saldo konta.`;
      case 404:
        return `MAX: Model jest niedostępny. Sprawdź ${provider === "google" ? "GEMINI_MODEL" : "OPENROUTER_MODEL"} w .env.local.`;
      case 429:
        return `MAX: ${name} zgłasza limit zapytań. Poczekaj i sprawdź dostępny limit konta.`;
    }
  }
  return `MAX: Połączenie z ${name} nie powiodło się lub odpowiedź została przerwana. Spróbuj ponownie; sprawdź konfigurację i dostępność modelu.`;
}

export async function POST(request: Request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response("MAX: Nieprawidłowy format rozmowy.", { status: 400 });
  }
  const provider: unknown = body?.provider ?? "openrouter";
  if (provider !== "openrouter" && provider !== "google") {
    return new Response("MAX: Nieznany dostawca modelu.", { status: 400 });
  }
  const enabled = provider === "google" ? process.env.GEMINI_ENABLED : process.env.OPENROUTER_ENABLED;
  if (enabled?.trim().toLowerCase() === "false") {
    return new Response("MAX: Ten dostawca jest wyłączony w .env.local.", { status: 403 });
  }
  const duel = body?.mode === "duel";
  const apiKey = (provider === "google" ? process.env.GOOGLE_GENERATIVE_AI_API_KEY : process.env.OPENROUTER_API_KEY)?.trim();
  const model = (provider === "google" ? process.env.GEMINI_MODEL : process.env.OPENROUTER_MODEL)?.trim();

  if (!apiKey || !model) {
    return new Response(
      `MAX: Brakuje konfiguracji. Uzupełnij ${provider === "google" ? "GOOGLE_GENERATIVE_AI_API_KEY i GEMINI_MODEL" : "OPENROUTER_API_KEY i OPENROUTER_MODEL"} w .env.local, a następnie uruchom serwer ponownie.`,
      { status: 503 },
    );
  }

  let messages: UIMessage[];
  try {
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
    const selectedModel = provider === "google"
      ? createGoogleGenerativeAI({ apiKey })(model)
      : createOpenRouter({ apiKey })(model);
    const result = streamText({
      model: selectedModel,
      system: "Jesteś MAX, od AM. Pisz po polsku, krótko i pomocnie. Masz żartobliwy, mroczny styl: krypta, czaszki i szkielety to Twoje ulubione metafory. Żartuj łagodnie, bez obrażania rozmówcy. Najpierw odpowiadaj konkretnie, a humor traktuj jako dodatek. Korzystaj z historii rozmowy. Nie udawaj wykonanych czynności ani wiedzy, której nie masz. "
        + (provider === "google" ? "Występujesz jako MAX Gemini, mistrz suchego humoru. " : "Występujesz jako MAX OpenRouter, teatralny gospodarz krypty. ")
        + (duel ? "Trwa żartobliwy pojedynek z drugim MAX-em. Odpowiadaj na jego argument, dodawaj własny i drocz się z nim bez obelg. Najwyżej 2–3 krótkie zdania. Nie pisz wypowiedzi za przeciwnika." : ""),
      messages: await convertToModelMessages(messages),
      abortSignal: request.signal,
      maxRetries: 0,
      // Nie zapisuj surowych błędów dostawcy, które mogą zawierać dane żądania.
      onError: () => {},
    });

    return result.toUIMessageStreamResponse({
      onError: (error) => publicError(error, provider),
    });
  } catch (error) {
    return new Response(publicError(error, provider), { status: 502 });
  }
}
