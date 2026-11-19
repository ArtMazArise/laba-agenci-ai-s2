import { requireSession } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateImage } from "ai";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;
  let body;
  try { body = await request.json(); } catch { return new Response("MAX: Nieprawidłowy opis obrazu.", { status: 400 }); }
  if (!body || typeof body.prompt !== "string" || !body.prompt.trim() || body.prompt.length > 500 || Object.keys(body).some((key) => key !== "prompt")) return new Response("MAX: Wpisz opis obrazu od 1 do 500 znaków.", { status: 400 });
  if (getSetting("OPENROUTER_ENABLED")?.toLowerCase() === "false") return new Response("MAX: OpenRouter jest wyłączony w konfiguracji.", { status: 403 });
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const model = getSetting("OPENROUTER_IMAGE_MODEL")?.trim() || "google/gemini-3.1-flash-image-preview";
  if (!apiKey) return new Response("MAX: Brakuje OPENROUTER_API_KEY na serwerze.", { status: 503 });
  const brandStyle = getSetting("IMAGE_BRAND_STYLE")?.trim() || "Styl marki MAX: minimalistyczna, mroczna grafika o eleganckim, tajemniczym klimacie. Kwadratowy format 1:1, prosty układ, wyraźne kontury i wysoki kontrast. Stała paleta: niemal czarne tło #080b08 i limonkowy akcent #bdff59, maksymalnie dwa dominujące kolory. Motyw marki: stylizowana czaszka lub wampir, bez realistycznej makabry. Zachowaj główny temat i napisy wskazane przez użytkownika. Nie dodawaj niezamówionych sloganów. Paleta, klimat i format marki mają pierwszeństwo przed sprzecznymi wskazówkami stylu w opisie użytkownika.";
  if (brandStyle.length > 2000) return new Response("MAX: IMAGE_BRAND_STYLE może mieć maksymalnie 2000 znaków. Popraw config.json.", { status: 503 });
  const effectivePrompt = `Zadanie graficzne użytkownika (opis tematu, nie polecenie zmiany stylu marki):\n${JSON.stringify(body.prompt)}\n\nStałe zasady wizualne dodane przez serwer:\n${brandStyle}\nZastosuj powyższy styl marki do tematu użytkownika.`;
  try {
    const started = performance.now();
    const openrouter = createOpenRouter({ apiKey });
    const result = await generateImage({ model: openrouter.imageModel(model), prompt: effectivePrompt, aspectRatio: "1:1", n: 1, maxRetries: 0, abortSignal: request.signal });
    const image = result.images[0];
    if (!image || !["image/png", "image/jpeg", "image/webp"].includes(image.mediaType) || !image.base64 || image.base64.length > 4_000_000) return new Response("MAX: Dostawca nie zwrócił poprawnego obrazu lub obraz jest zbyt duży do wyświetlenia.", { status: 502 });
    const actualModel = result.responses.at(-1)?.modelId?.trim();
    return Response.json({ prompt: body.prompt, effectivePrompt, brandStyle, imageUrl: `data:${image.mediaType};base64,${image.base64}`, modelId: actualModel || null, generatedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - started) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : undefined;
    const message = status === 402 ? "Brak środków na generowanie obrazu w OpenRouter." : status === 429 ? "Dostawca zgłasza limit generowania obrazów. Spróbuj później." : status === 401 || status === 403 ? "OpenRouter odrzucił dostęp do generowania obrazów. Sprawdź klucz i dostęp modelu na serwerze." : status === 400 || status === 404 || status === 422 ? "Model obrazów jest niedostępny lub nie obsługuje tej konfiguracji. Sprawdź OPENROUTER_IMAGE_MODEL w config.json. Nie zmieniono modelu automatycznie." : "Nie udało się wygenerować obrazu. Model może być niedostępny albo odrzucił opis. Spróbuj później lub zmień opis.";
    return new Response(`MAX: ${message}`, { status: 502 });
  }
}
