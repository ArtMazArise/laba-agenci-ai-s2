import type { UIMessage } from "ai";

export function parseTestQuestions(raw?: string): { questions: string[]; invalid: boolean } {
  if (!raw?.trim()) return { questions: [], invalid: false };
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return { questions: [], invalid: true };
    return { questions: [...new Set((value as string[]).map((item) => item.trim()).filter(Boolean))], invalid: false };
  } catch { return { questions: [], invalid: true }; }
}

export function messageText(message: Pick<UIMessage, "parts">) {
  return message.parts.filter((part) => part.type === "text").map((part) => part.text).join("")
    .replace(/\r\n?/g, "\n").replace(/\n(?:[\t ]*\n)+/g, "\n").trim();
}

export function formatMessage(message: Pick<UIMessage, "role" | "parts">, assistantName: string) {
  return `${message.role === "assistant" ? assistantName : "Ty"}: ${messageText(message)}`;
}

export function formatConversation(messages: UIMessage[], assistantName: string) {
  return messages.filter((message) => messageText(message).trim()).map((message) => formatMessage(message, assistantName)).join(`\n${"-".repeat(63)}\n`);
}

export function formatCombinedConversation(openrouter: UIMessage[], google: UIMessage[]) {
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
        const text = messageText(message);
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
