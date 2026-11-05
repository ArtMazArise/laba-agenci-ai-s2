import { cookieHeader, logout, requestSession, sameOrigin } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Żądanie musi pochodzić z tej strony." }, { status: 403 });
  try {
    await logout(requestSession(request));
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store", "Set-Cookie": cookieHeader("", 0) } });
  } catch {
    return Response.json({ error: "Nie udało się unieważnić sesji. Spróbuj ponownie." }, { status: 503, headers: { "Cache-Control": "no-store", "Set-Cookie": cookieHeader("", 0) } });
  }
}
