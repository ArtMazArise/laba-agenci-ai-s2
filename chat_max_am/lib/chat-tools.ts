import type { UIMessage } from "ai";
import { isChatResult, type ChatRequestMode } from "./chat-result";

export function formatResponseTime(milliseconds?: number) {
  if (milliseconds === undefined || !Number.isFinite(milliseconds) || milliseconds < 0) return "";
  const rounded = Math.round(milliseconds);
  return rounded < 1000 ? `${rounded} ms` : `${(rounded / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 2 })} s`;
}

export function messageSources(message: Pick<UIMessage, "parts">) {
  const sources: { url: string; title: string; fetchedAt?: string }[] = [];
  if (messageHasSearchFallback(message)) return sources;
  const seen = new Set<string>();
  for (const part of message.parts) {
    if (part.type !== "source-url") continue;
    let url: URL;
    try { url = new URL(part.url); } catch { continue; }
    if (!["http:", "https:"].includes(url.protocol) || seen.has(url.href)) continue;
    seen.add(url.href);
    const stamp = message.parts.find((p) => p.type === "data-source-fetched" && p.data && typeof p.data === "object" && "sourceId" in p.data && p.data.sourceId === part.sourceId);
    const fetchedAt = stamp && "data" in stamp && stamp.data && typeof stamp.data === "object" && "fetchedAt" in stamp.data && typeof stamp.data.fetchedAt === "string" ? stamp.data.fetchedAt : undefined;
    sources.push({ url: url.href, title: part.title?.trim() || url.hostname, fetchedAt });
  }
  return sources;
}

export function messageHasSearchFallback(message: Pick<UIMessage, "parts">) {
  return message.parts.some((part) => part.type === "data-search-fallback" && part.data === "quota");
}

export function formatSourceDate(iso?: string) {
  if (!iso || !Number.isFinite(new Date(iso).getTime())) return "brak danych";
  return new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", dateStyle: "short", timeStyle: "medium" }).format(new Date(iso));
}

export function parseTestQuestions(raw?: string): { questions: string[]; invalid: boolean } {
  if (!raw?.trim()) return { questions: [], invalid: true };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { questions: [], invalid: true };
    const questions = (value as Record<string, unknown>).questions;
    if (questions === undefined) return { questions: [], invalid: false };
    if (!Array.isArray(questions) || questions.some((item) => typeof item !== "string")) return { questions: [], invalid: true };
    return { questions: [...new Set((questions as string[]).map((item) => item.trim()).filter(Boolean))], invalid: false };
  } catch { return { questions: [], invalid: true }; }
}

export function messageText(message: Pick<UIMessage, "parts">) {
  const result = message.parts.find((part) => part.type === "data-chat-result");
  if (result && "data" in result && isChatResult(result.data)) return result.data.draft;
  return message.parts.filter((part) => part.type === "text").map((part) => part.text).join("")
    .replace(/\r\n?/g, "\n").replace(/\n(?:[\t ]*\n)+/g, "\n").trim();
}

export function messageResult(message: Pick<UIMessage, "parts">) {
  const part = message.parts.find((part) => part.type === "data-chat-result");
  return part && "data" in part && isChatResult(part.data) ? part.data : undefined;
}

function copyMessageText(message: Pick<UIMessage, "role" | "parts">, withJson: boolean) {
  const text = clientMessageText(message);
  const result = message.role === "assistant" ? messageResult(message) : undefined;
  const raw = messageText(message);
  const legacyReview = message.role === "assistant" ? raw.match(/(?:^|\n)needs_review\s*=\s*(true|false)\b/i)?.[1].toLowerCase() : undefined;
  const review = result?.needs_review ?? (legacyReview === undefined ? undefined : legacyReview === "true");
  const legacyNote = message.role === "assistant" && !result ? raw.match(/(?:^|\n)Do sprawdzenia(?: przez pracownika)?\s*:[ \t]*([\s\S]*?)(?=\nneeds_review\s*=|$)/i)?.[1].trim() : undefined;
  const note = legacyNote || (review ? "Wymagana weryfikacja przez pracownika." : "Brak");
  let copy = review === undefined ? text : `${text}\nDo sprawdzenia: ${note}\nneeds_review = ${review}`;
  if (message.role === "assistant" && messageHasSearchFallback(message)) copy += "\nBez wyszukiwania — limit API. Bieżące dane nie zostały zweryfikowane w internecie.";
  return withJson && result ? `${copy}\nJSON:\n${JSON.stringify(result, null, 2)}` : copy;
}

export function formatMessage(message: Pick<UIMessage, "role" | "parts">, assistantName: string, withJson = false) {
  return `${message.role === "assistant" ? assistantName : "Ty"}: ${copyMessageText(message, withJson)}`;
}

export function assistantPresentation(text: string) {
  if (!text || "Kategoria:".startsWith(text) || /^Kategoria\s*:/i.test(text)) {
    const category = text.match(/^Kategoria\s*:\s*(sales|support|other)\b/i)?.[1].toLowerCase();
    const sketch = text.match(/(?:^|\n)Szkic\s*:[ \t]*([\s\S]*)/i)?.[1] ?? "";
    // Podczas streamingu nie pokazuj nawet części nagłówka notatki.
    const lines = sketch.split("\n");
    const end = lines.findIndex((line) => {
      const value = line.trim();
      return value !== "" && ("Do sprawdzenia:".toLowerCase().startsWith(value.toLowerCase()) || /^Do sprawdzenia\s*:|^needs_review\b/i.test(value));
    });
    return {
      text: (end < 0 ? lines : lines.slice(0, end)).join("\n").trim(),
      category,
      review: text.match(/(?:^|\n)needs_review\s*=\s*(true|false)\b/i)?.[1].toLowerCase(),
    };
  }
  return { text, category: undefined, review: undefined };
}

export function clientMessageText(message: Pick<UIMessage, "role" | "parts">) {
  const result = messageResult(message);
  if (result) return result.draft;
  const text = messageText(message);
  return message.role === "assistant" ? assistantPresentation(text).text : text;
}

export function formatConversation(messages: UIMessage[], assistantName: string, withJson = false) {
  return messages.filter((message) => messageText(message).trim()).map((message) => formatMessage(message, assistantName, withJson)).join(`\n${"-".repeat(63)}\n`);
}

export function formatCombinedConversation(openrouter: UIMessage[], google: UIMessage[], withJson = false) {
  type Group = { question: string; sentAt: number; order: number; openrouter: string[]; google: string[] };
  const groups = new Map<string, Group>();
  for (const [provider, messages] of [["openrouter", openrouter], ["google", google]] as const) {
    let current: Group | undefined;
    for (const message of messages) {
      if (message.role === "user") {
        const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata as Record<string, unknown> : {};
        const key = typeof metadata.sharedTurnId === "string" ? `shared:${metadata.sharedTurnId}` : `${provider}:${message.id}`;
        current = groups.get(key);
        if (!current) {
          current = { question: messageText(message), sentAt: typeof metadata.sentAt === "number" && Number.isFinite(metadata.sentAt) ? metadata.sentAt : 0, order: groups.size, openrouter: [], google: [] };
          groups.set(key, current);
        }
      } else if (message.role === "assistant" && current) {
        const text = copyMessageText(message, withJson);
        if (text) current[provider].push(text);
      }
    }
  }
  return [...groups.values()].sort((a, b) => a.sentAt - b.sentAt || a.order - b.order).flatMap((group) => [
    ...(group.question ? [`Ty: ${group.question}`] : []),
    ...group.openrouter.map((text) => `MAX · OpenRouter: ${text}`),
    ...group.google.map((text) => `MAX · Gemini: ${text}`),
  ]).join(`\n${"-".repeat(63)}\n`);
}

export async function broadcastMessage(text: string, active: Record<"openrouter" | "google", boolean>, senders: Record<"openrouter" | "google", (text: string) => Promise<void>>) {
  if (!text.trim()) return [];
  return Promise.allSettled((["openrouter", "google"] as const).filter((provider) => active[provider]).map((provider) => senders[provider](text.trim())));
}

export async function analyzeClientMessage(text: string, active: Record<"openrouter" | "google", boolean>, chats: Record<"openrouter" | "google", {
  clearConversation: () => void;
  sendText: (text: string, sharedTurnId?: string) => Promise<void>;
}>, turnId: string) {
  const sender = (provider: "openrouter" | "google") => async (value: string) => {
    chats[provider].clearConversation();
    await chats[provider].sendText(value, turnId);
  };
  return broadcastMessage(text, active, { openrouter: sender("openrouter"), google: sender("google") });
}

export async function retryLastChatRequest(chat: {
  status: string;
  error?: Error;
  messages: UIMessage[];
  regenerate: (options: { body: { mode: ChatRequestMode } }) => Promise<void>;
}, mode: ChatRequestMode) {
  if (chat.status !== "error" || !chat.error || !chat.messages.some((message) => message.role === "user")) return;
  // regenerate zastępuje nieudaną odpowiedź bez dodawania ponownie pytania.
  await chat.regenerate({ body: { mode } });
}
