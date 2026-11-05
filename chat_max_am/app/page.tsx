import ChatArena from "./chat-arena";

export const dynamic = "force-dynamic";

export default function Home() {
  // Do przeglądarki trafiają tylko booleany, nigdy klucze API.
  return <ChatArena enabled={{
    openrouter: process.env.OPENROUTER_ENABLED?.trim().toLowerCase() !== "false",
    google: process.env.GEMINI_ENABLED?.trim().toLowerCase() !== "false",
  }} />;
}
