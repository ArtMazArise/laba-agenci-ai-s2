import { cookieHeader, isAuthConfigured, isLearningMode, login, sameOrigin } from "@/lib/auth";

import { generateLoginJokes } from "@/lib/login-jokes";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (!sameOrigin(request)) return Response.json({ error: "Żądanie musi pochodzić z tej strony." }, { status: 403, headers });
  if (!isAuthConfigured()) return Response.json({ error: "Logowanie jest zablokowane: uzupełnij CHAT_PASSWORD i SESSION_SECRET. Na Vercel podłącz prywatny magazyn sesji Blob." }, { status: 503, headers });
  let password: string;
  try {
    const body = await request.json();
    if (typeof body?.password !== "string" || body.password.length > 512) throw new Error("Invalid password");
    password = body.password;
  } catch { return Response.json({ error: "Wpisz hasło (maksymalnie 512 znaków)." }, { status: 400, headers }); }
  try {
    const result = await login(password);
    if (result.ok) return Response.json({ ok: true }, { headers: { ...headers, "Set-Cookie": cookieHeader(result.token) } });
    if (result.retryAt) headers["Retry-After"] = String(Math.max(1, Math.ceil((result.retryAt - Date.now()) / 1000)));
    const learning = isLearningMode();
    const jokes = result.attempted ? await generateLoginJokes(request.signal) : [];
    return Response.json({
      error: result.remaining ? `Błędne hasło. Pozostało prób: ${result.remaining}.` : learning ? "Trzy błędne próby. Naciśnij F5 — dostaniesz trzy kolejne." : "Trzy błędne próby. Krypta zablokowana na 15 minut od pierwszego błędu.",
      remaining: result.remaining, retryAt: result.retryAt, refreshToRetry: learning && result.remaining === 0, jokes,
    }, { status: result.remaining ? 401 : 429, headers });
  } catch {
    return Response.json({ error: "Magazyn sesji jest niedostępny. Logowanie zablokowane." }, { status: 503, headers });
  }
}
