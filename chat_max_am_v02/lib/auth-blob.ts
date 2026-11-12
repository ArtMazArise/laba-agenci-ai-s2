import { BlobPreconditionFailedError, get, put } from "@vercel/blob";

type State = {
  failures: number;
  resetAt: number;
  sessions: Record<string, { expires: number; passwordTag: string }>;
};

// Prywatny stan techniczny: identyfikatory sesji i licznik prób, bez kluczy i hasła.
const pathname = "auth/workshop-state.json";

export async function withBlobState<T>(token: string, change: (state: State) => T): Promise<T> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const blob = await get(pathname, { access: "private", token, useCache: false });
    if (blob && (blob.statusCode !== 200 || !blob.stream)) throw new Error("Auth storage unavailable");
    const state: State = blob ? await new Response(blob.stream).json() : { failures: 0, resetAt: 0, sessions: {} };
    if (!Number.isInteger(state.failures) || state.failures < 0 || !Number.isFinite(state.resetAt)
      || !state.sessions || typeof state.sessions !== "object" || Array.isArray(state.sessions)) throw new Error("Invalid auth storage");
    const before = JSON.stringify(state);
    const now = Date.now();
    if (state.resetAt <= now) { state.failures = 0; state.resetAt = 0; }
    for (const [id, session] of Object.entries(state.sessions)) {
      if (!session || !Number.isFinite(session.expires) || session.expires <= now) delete state.sessions[id];
    }
    const result = change(state);
    const after = JSON.stringify(state);
    // Weryfikacja sesji zwykle wymaga tylko świeżego odczytu, bez zapisu.
    if (blob && before === after) return result;
    try {
      await put(pathname, after, {
        access: "private", token, addRandomSuffix: false,
        contentType: "application/json",
        allowOverwrite: !!blob,
        ...(blob ? { ifMatch: blob.blob.etag } : {}),
      });
      return result;
    } catch (error) {
      // Dwie instancje mogą tworzyć pierwszy plik naraz. Druga ponownie czyta
      // stan; istniejącego pliku nigdy nie nadpisuje bez zgodnego ETag.
      if (blob && !(error instanceof BlobPreconditionFailedError)) throw error;
      if (attempt === 9) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 + Math.random() * 50));
    }
  }
  throw new Error("Auth storage conflict");
}
