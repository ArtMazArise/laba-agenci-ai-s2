import type { ChatTiming, ChatRequestDiagnostics } from "./chat-timing";
import type { UIMessage } from "ai";
import { isChatResult, type ChatRequestMode } from "./chat-result";

export function messageTiming(message: Pick<UIMessage, "parts">): ChatTiming | undefined {
  const part = [...message.parts].reverse().find((item) => item.type === "data-timing");
  if (!part || !("data" in part) || !part.data || typeof part.data !== "object") return;
  const data = part.data as Record<string, unknown>;
  const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const keys = ["totalMs", "modelBeforeToolMs", "toolMs", "modelAfterToolMs", "overheadMs"] as const;
  if (keys.some((key) => !valid(data[key])) || !Array.isArray(data.steps) || !Array.isArray(data.tools)) return;
  const steps = data.steps.flatMap((item) => item && typeof item === "object" && [item.attempt, item.step, item.modelMs, item.toolMs, item.totalMs].every(valid) ? [{ attempt: item.attempt, step: item.step, modelMs: item.modelMs, toolMs: item.toolMs, totalMs: item.totalMs }] : []);
  const tools = data.tools.flatMap((item) => item && typeof item === "object" && typeof item.name === "string" && /^[A-Za-z]\w{0,63}$/.test(item.name) && [item.attempt, item.step, item.durationMs].every(valid) && typeof item.success === "boolean" ? [{ name: item.name, attempt: item.attempt, step: item.step, durationMs: item.durationMs, success: item.success }] : []);
  return { totalMs: data.totalMs as number, modelBeforeToolMs: data.modelBeforeToolMs as number, toolMs: data.toolMs as number, modelAfterToolMs: data.modelAfterToolMs as number, overheadMs: data.overheadMs as number, steps, tools };
}

export function messageRequest(message: Pick<UIMessage, "parts">): ChatRequestDiagnostics | undefined {
  const part = [...message.parts].reverse().find((item) => item.type === "data-request");
  if (!part || !("data" in part) || !part.data || typeof part.data !== "object") return;
  const data = part.data as Record<string, unknown>;
  if (data.endpoint !== "/api/chat" || (data.provider !== "openrouter" && data.provider !== "google") || !["chat", "analysis", "duel"].includes(String(data.mode)) || typeof data.model !== "string" || typeof data.message !== "string" || typeof data.historyMessageCount !== "number" || !Number.isInteger(data.historyMessageCount) || data.historyMessageCount < 0 || !Array.isArray(data.toolCalls)) return;
  const safeInput = (input: unknown): Record<string, string | number | boolean | null> => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    return Object.fromEntries(Object.entries(input).filter(([key, value]) => ["city", "startOffsetDays", "days", "currency", "date"].includes(key) && (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value))));
  };
  const toolCalls = data.toolCalls.flatMap((call) => call && typeof call === "object" && typeof call.name === "string" && /^[A-Za-z]\w{0,63}$/.test(call.name) && Number.isInteger(call.attempt) && call.attempt >= 1 && Number.isInteger(call.step) && call.step >= 0 ? [{ attempt: call.attempt, step: call.step, name: call.name, input: safeInput(call.input), effectiveInput: safeInput(call.effectiveInput) }] : []);
  const coords = data.location as Record<string, unknown> | null;
  const location = coords && typeof coords.latitude === "number" && Number.isFinite(coords.latitude) && Math.abs(coords.latitude) <= 90 && typeof coords.longitude === "number" && Number.isFinite(coords.longitude) && Math.abs(coords.longitude) <= 180 ? { latitude: coords.latitude, longitude: coords.longitude } : null;
  return { endpoint: "/api/chat", provider: data.provider, model: data.model, mode: data.mode as ChatRequestDiagnostics["mode"], message: data.message, historyMessageCount: data.historyMessageCount, location, toolCalls };
}

export function formatResponseTime(milliseconds?: number) {
  if (milliseconds === undefined || !Number.isFinite(milliseconds) || milliseconds < 0) return "";
  const rounded = Math.round(milliseconds);
  return rounded < 1000 ? `${rounded} ms` : `${(rounded / 1000).toLocaleString("pl-PL", { maximumFractionDigits: 2 })} s`;
}

export function messageSources(message: Pick<UIMessage, "parts">) {
  const sources: { url: string; title: string; fetchedAt?: string }[] = [];
  const seen = new Set<string>();
  for (const part of message.parts) {
    if (part.type !== "source-url") continue;
    if (messageHasSearchFallback(message) && !part.sourceId.startsWith("public:")) continue;
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

export function searchFallbackNotice(message: Pick<UIMessage, "parts">) {
  const direct = message.parts.some((part) => part.type === "source-url" && part.sourceId.startsWith("public:"));
  return `Bez wyszukiwania — limit API. ${direct ? "Dane pobrano bezpośrednio z publicznego API." : "Bieżące dane nie zostały zweryfikowane w internecie."}`;
}

export function messageUsedTools(message: Pick<UIMessage, "parts">) {
  const names = message.parts.flatMap((part) => part.type === "data-used-tools" && Array.isArray(part.data) ? part.data : []);
  return [...new Set(names.filter((name): name is string => typeof name === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)))];
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
  const tools = message.role === "assistant" ? messageUsedTools(message) : [];
  if (tools.length) copy += `\nużyto: ${tools.join(", ")}`;
  if (message.role === "assistant" && messageHasSearchFallback(message)) copy += `\n${searchFallbackNotice(message)}`;
  if (withJson && result) copy += `\nJSON:\n${JSON.stringify(result, null, 2)}`;
  const timing = withJson && message.role === "assistant" ? messageTiming(message) : undefined;
  const request = withJson && message.role === "assistant" ? messageRequest(message) : undefined;
  if (timing || request) copy += `\nDiagnostyka:\n${JSON.stringify({ ...(request ? { request } : {}), ...(timing ? { timing } : {}) }, null, 2)}`;
  return copy;
}

export function formatMessage(message: Pick<UIMessage, "role" | "parts">, assistantName: string, withJson = false, responseTime?: number) {
  const time = formatResponseTime(responseTime).replace(",", ".").replace(/\s/g, "");
  const author = message.role === "assistant" ? `${assistantName}${time ? `(${time})` : ""}` : "Ty";
  return `${author}: ${copyMessageText(message, withJson)}`;
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

export function formatConversation(messages: UIMessage[], assistantName: string, withJson = false, responseTimes: Record<string, number> = {}) {
  return messages.filter((message) => messageText(message).trim()).map((message) => formatMessage(message, assistantName, withJson, responseTimes[message.id])).join(`\n${"-".repeat(63)}\n`);
}

export function formatCombinedConversation(openrouter: UIMessage[], google: UIMessage[], withJson = false, responseTimes: Partial<Record<"openrouter" | "google", Record<string, number>>> = {}) {
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
        if (text) current[provider].push(formatMessage(message, provider === "openrouter" ? "MAX · OpenRouter" : "MAX · Gemini", withJson, responseTimes[provider]?.[message.id]));
      }
    }
  }
  return [...groups.values()].sort((a, b) => a.sentAt - b.sentAt || a.order - b.order).flatMap((group) => [
    ...(group.question ? [`Ty: ${group.question}`] : []),
    ...group.openrouter,
    ...group.google,
  ]).join(`\n${"-".repeat(63)}\n`);
}

export function weatherNeedsLocation(text: string, hasLocation: boolean) {
  if (hasLocation) return false;
  const plain = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
  if (!/pogod|prognoz|temperatur|bedzie padac|czy pada|opad|deszcz|snieg/.test(plain)) return false;
  if (/(?:miejscowosc|miasto)\s*:\s*\p{L}/u.test(plain) || /radom|warszaw|zakopan|gdansk|krakow|wroclaw|poznan|lodz|szczecin|lublin/.test(plain)) return false;
  const place = plain.match(/\b(?:w|we|dla)\s+(\p{L}[\p{L}-]*)/u)?.[1];
  return !place || /^(?:najbliz|przysz|tym|ten|te|ciagu|weekend|tygod|poniedzial|wtorek|srod|czwart|piatek|sobot|niedziel|dzien)/.test(place);
}

export function completeWeatherQuestion(question: string, city: string) {
  const original = question.replace(/^\s*(?:Miejscowość|Miasto)\s*:.*$/gim, "").trim();
  return `${original}\nMiejscowość: ${city.trim()}`;
}

export async function sendWithWeatherLocation(text: string, hasLocation: boolean, selectLocation: (question: string) => void, send: (text: string) => Promise<void>) {
  const question = text.trim();
  if (!question) return;
  if (weatherNeedsLocation(question, hasLocation)) { selectLocation(question); return; }
  await send(question);
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
  regenerate: (options: { body: { mode: ChatRequestMode; location?: { latitude: number; longitude: number } } }) => Promise<void>;
}, mode: ChatRequestMode, location?: { latitude: number; longitude: number }) {
  if (chat.status !== "error" || !chat.error || !chat.messages.some((message) => message.role === "user")) return;
  // regenerate zastępuje nieudaną odpowiedź bez dodawania ponownie pytania.
  await chat.regenerate({ body: { mode, ...(location ? { location } : {}) } });
}
