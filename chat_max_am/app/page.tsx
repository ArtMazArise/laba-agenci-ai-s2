import { getSetting } from "@/lib/settings";
import ChatArena from "./chat-arena";
import LoginScreen from "./login-screen";
import { cookies } from "next/headers";
import { getMaxAttempts, hasSession, isAuthConfigured, resetLearningAttempts, SESSION_COOKIE } from "@/lib/auth";
import { getDuelBatchSize } from "@/lib/duel";
import { getAppInfo } from "@/lib/app-info";
import { loadTestQuestions } from "@/lib/test-questions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const appInfo = await getAppInfo();
  const configured = isAuthConfigured();
  let authenticated = false;
  try {
    authenticated = configured && await hasSession((await cookies()).get(SESSION_COOKIE)?.value);
    if (!authenticated && configured) await resetLearningAttempts();
  } catch { return <LoginScreen appInfo={appInfo} maxAttempts={getMaxAttempts()} unavailable="Magazyn sesji jest niedostępny. Dostęp zablokowany." />; }
  if (!authenticated) return <LoginScreen appInfo={appInfo} maxAttempts={getMaxAttempts()} unavailable={configured ? undefined : "Logowanie jest zablokowane. Ustaw CHAT_PASSWORD i SESSION_SECRET. Vercel wymaga też prywatnego magazynu sesji Blob."} />;
  // Nazwy modeli są publiczną konfiguracją. Klucze API pozostają na serwerze.
  return <ChatArena appInfo={appInfo} modelNames={{
    openrouter: getSetting("OPENROUTER_MODEL")?.trim(),
    google: getSetting("GEMINI_MODEL")?.trim(),
  }} testQuestions={await loadTestQuestions()} roundsPerBatch={getDuelBatchSize(getSetting("CHAT_DUEL_ROUNDS"))} enabled={{
    openrouter: getSetting("OPENROUTER_ENABLED")?.trim().toLowerCase() !== "false",
    google: getSetting("GEMINI_ENABLED")?.trim().toLowerCase() !== "false",
  }} />;
}
