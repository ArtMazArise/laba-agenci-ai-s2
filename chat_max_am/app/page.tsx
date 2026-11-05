import ChatArena from "./chat-arena";
import LoginScreen from "./login-screen";
import { cookies } from "next/headers";
import { getMaxAttempts, hasSession, isAuthConfigured, resetLearningAttempts, SESSION_COOKIE } from "@/lib/auth";
import { getDuelBatchSize } from "@/lib/duel";

export const dynamic = "force-dynamic";

export default async function Home() {
  const configured = isAuthConfigured();
  let authenticated = false;
  try {
    authenticated = configured && await hasSession((await cookies()).get(SESSION_COOKIE)?.value);
    if (!authenticated && configured) await resetLearningAttempts();
  } catch { return <LoginScreen maxAttempts={getMaxAttempts()} unavailable="Magazyn sesji jest niedostępny. Dostęp zablokowany." />; }
  if (!authenticated) return <LoginScreen maxAttempts={getMaxAttempts()} unavailable={configured ? undefined : "Logowanie jest zablokowane. Ustaw CHAT_PASSWORD i SESSION_SECRET. Vercel wymaga też prywatnego magazynu sesji Blob."} />;
  // Do przeglądarki trafiają tylko booleany, nigdy klucze API.
  return <ChatArena roundsPerBatch={getDuelBatchSize(process.env.CHAT_DUEL_ROUNDS)} enabled={{
    openrouter: process.env.OPENROUTER_ENABLED?.trim().toLowerCase() !== "false",
    google: process.env.GEMINI_ENABLED?.trim().toLowerCase() !== "false",
  }} />;
}
