import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { withBlobState } from "./auth-blob";

export const SESSION_COOKIE = "max_session";
export const SESSION_SECONDS = 8 * 60 * 60;
const LOCKOUT_MS = 15 * 60 * 1000;

type Config = { password: string; secret: string; directory: string; blobToken?: string };
type Session = { expires: number; passwordTag: string };
type State = { failures: number; resetAt: number; sessions: Record<string, Session> };

function config(): Config | null {
  const password = process.env.CHAT_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  const directory = process.env.AUTH_STATE_DIR?.trim();
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!password?.trim() || password.length > 512 || !secret || secret.length < 32) return null;
  // Vercel używa prywatnego Blob. Przy własnym serwerze można nadal podać
  // trwały katalog współdzielony przez wszystkie instancje.
  if (process.env.VERCEL === "1" && !blobToken) return null;
  if (process.env.NODE_ENV === "production" && !directory && !blobToken) return null;
  if (directory && !path.isAbsolute(directory)) return null;
  return { password, secret, directory: directory || path.join(process.cwd(), ".auth-state"), blobToken };
}

export function isAuthConfigured() { return config() !== null; }

export function getMaxAttempts() {
  const limit = Number(process.env.CHAT_MAX_ATTEMPTS);
  return Number.isInteger(limit) && limit >= 1 && limit <= 100 ? limit : 5;
}

export function isLearningMode() {
  return process.env.NODE_ENV === "development" && process.env.AUTH_LEARNING_MODE?.trim().toLowerCase() !== "false";
}

export async function resetLearningAttempts() {
  if (!isLearningMode()) return;
  const settings = config();
  if (settings) await withState(settings, (state) => { state.failures = 0; state.resetAt = 0; });
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function equal(a: string, b: string) {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

async function withState<T>(settings: Config, change: (state: State) => T): Promise<T> {
  if (settings.blobToken) return withBlobState(settings.blobToken, change);
  await mkdir(settings.directory, { recursive: true, mode: 0o700 });
  const lock = path.join(settings.directory, "lock");
  let acquired = false;
  for (let i = 0; i < 80; i++) {
    try { await mkdir(lock, { mode: 0o700 }); acquired = true; break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  if (!acquired) throw new Error("Auth storage busy");
  const filename = path.join(settings.directory, "state.json");
  const temporary = path.join(settings.directory, `${randomBytes(16).toString("hex")}.tmp`);
  try {
    let state: State;
    try {
      state = JSON.parse(await readFile(filename, "utf8"));
      if (!Number.isInteger(state.failures) || state.failures < 0 || !Number.isFinite(state.resetAt)
        || !state.sessions || typeof state.sessions !== "object" || Array.isArray(state.sessions)) throw new Error("Invalid auth storage");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      state = { failures: 0, resetAt: 0, sessions: {} };
    }
    const now = Date.now();
    if (state.resetAt <= now) { state.failures = 0; state.resetAt = 0; }
    for (const [id, session] of Object.entries(state.sessions)) {
      if (!session || !Number.isFinite(session.expires) || session.expires <= now) delete state.sessions[id];
    }
    const result = change(state);
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600, flag: "wx" });
    await rename(temporary, filename);
    return result;
  } finally {
    await rm(temporary, { force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

function decode(token: string | undefined, settings: Config): { sid: string; exp: number } | null {
  if (!token || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !equal(parts[1], sign(parts[0], settings.secret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (typeof payload.sid !== "string" || !/^[a-f0-9]{48}$/.test(payload.sid)
      || !Number.isInteger(payload.exp) || payload.exp <= Date.now() || payload.exp > Date.now() + SESSION_SECONDS * 1000) return null;
    return payload;
  } catch { return null; }
}

export async function hasSession(token: string | undefined) {
  const settings = config();
  if (!settings) return false;
  const payload = decode(token, settings);
  if (!payload) return false;
  return withState(settings, (state) => {
    const session = state.sessions[payload.sid];
    return session?.expires === payload.exp && equal(session.passwordTag, sign(`password:${settings.password}`, settings.secret));
  });
}

export function requestSession(request: Request) {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
}

export async function requireSession(request: Request): Promise<Response | null> {
  if (!isAuthConfigured()) return new Response("MAX: Logowanie nie jest skonfigurowane. Sprawdź CHAT_PASSWORD, SESSION_SECRET i magazyn sesji.", { status: 503, headers: { "Cache-Control": "no-store" } });
  try {
    if (await hasSession(requestSession(request))) {
      if (!sameOrigin(request)) return new Response("MAX: Żądanie musi pochodzić z tej strony.", { status: 403, headers: { "Cache-Control": "no-store" } });
      return null;
    }
    return new Response("MAX: Sesja wygasła lub nie jesteś zalogowany. Wpisz hasło na stronie głównej.", { status: 401, headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response("MAX: Magazyn sesji jest niedostępny. Dostęp zablokowany.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

type LoginResult = { ok: true; token: string } | { ok: false; remaining: number; retryAt: number; attempted: boolean };

export async function login(password: string): Promise<LoginResult> {
  const settings = config();
  if (!settings) throw new Error("Auth not configured");
  return withState(settings, (state) => {
    const maxAttempts = getMaxAttempts();
    if (state.failures >= maxAttempts) return { ok: false, remaining: 0, retryAt: isLearningMode() ? 0 : state.resetAt, attempted: false };
    if (!equal(password, settings.password)) {
      if (state.failures === 0) state.resetAt = isLearningMode() ? Number.MAX_SAFE_INTEGER : Date.now() + LOCKOUT_MS;
      state.failures += 1;
      return { ok: false, remaining: maxAttempts - state.failures, retryAt: state.failures >= maxAttempts && !isLearningMode() ? state.resetAt : 0, attempted: true };
    }
    // Sukces nie resetuje globalnego limitu błędnych prób innych osób.
    const sid = randomBytes(24).toString("hex");
    const exp = Date.now() + SESSION_SECONDS * 1000;
    state.sessions[sid] = { expires: exp, passwordTag: sign(`password:${settings.password}`, settings.secret) };
    const payload = Buffer.from(JSON.stringify({ sid, exp })).toString("base64url");
    return { ok: true, token: `${payload}.${sign(payload, settings.secret)}` };
  });
}

export async function logout(token: string | undefined) {
  const settings = config();
  if (!settings) return;
  const payload = decode(token, settings);
  if (payload) await withState(settings, (state) => { delete state.sessions[payload.sid]; });
}

export function cookieHeader(token = "", maxAge = SESSION_SECONDS) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function sameOrigin(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false;
    const parsed = new URL(origin);
    const host = request.headers.get("host") || new URL(request.url).host;
    // Next.js może używać 0.0.0.0 w request.url. Host to adres, pod którym
    // przeglądarka naprawdę otworzyła stronę; porównanie nadal uwzględnia port.
    return ["http:", "https:"].includes(parsed.protocol) && parsed.origin === origin
      && parsed.host.toLowerCase() === host.trim().toLowerCase();
  } catch { return false; }
}
