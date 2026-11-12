import type { UIMessage } from "ai";
import { isChatResult } from "./chat-result";

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
  return withJson && result ? `${text}\nJSON:\n${JSON.stringify(result, null, 2)}` : text;
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
