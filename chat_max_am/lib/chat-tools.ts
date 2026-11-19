import type { ChatTiming, ChatRequestDiagnostics } from "./chat-timing";
import type { UIMessage } from "ai";
import { isChatResult, type ChatRequestMode } from "./chat-result";

export function messageResponseModel(message: Pick<UIMessage, "parts">): string | null | undefined {
  const part = [...message.parts].reverse().find((item) => item.type === "data-response-model");
  if (!part || !("data" in part) || !part.data || typeof part.data !== "object" || !("modelId" in part.data)) return;
  return typeof part.data.modelId === "string" && part.data.modelId.trim() ? part.data.modelId.trim() : null;
}

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
  if ((data.endpoint !== "/api/chat" && data.endpoint !== "/api/agent") || (data.provider !== "openrouter" && data.provider !== "google") || !["chat", "analysis", "duel"].includes(String(data.mode)) || typeof data.model !== "string" || typeof data.message !== "string" || typeof data.historyMessageCount !== "number" || !Number.isInteger(data.historyMessageCount) || data.historyMessageCount < 0 || !Array.isArray(data.toolCalls)) return;
  const safeInput = (input: unknown): Record<string, string | number | boolean | null> => {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    return Object.fromEntries(Object.entries(input).filter(([key, value]) => ["city", "startOffsetDays", "days", "currency", "date", "prompt", "query", "from", "to", "time", "fromZone", "toZone", "year", "month", "weatherCity", "cellHeight"].includes(key) && (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value))));
  };
  const toolCalls = data.toolCalls.flatMap((call) => call && typeof call === "object" && typeof call.name === "string" && /^[A-Za-z]\w{0,63}$/.test(call.name) && Number.isInteger(call.attempt) && call.attempt >= 1 && Number.isInteger(call.step) && call.step >= 0 ? [{ attempt: call.attempt, step: call.step, name: call.name, input: safeInput(call.input), effectiveInput: safeInput(call.effectiveInput) }] : []);
  const coords = data.location as Record<string, unknown> | null;
  const location = coords && typeof coords.latitude === "number" && Number.isFinite(coords.latitude) && Math.abs(coords.latitude) <= 90 && typeof coords.longitude === "number" && Number.isFinite(coords.longitude) && Math.abs(coords.longitude) <= 180 ? { latitude: coords.latitude, longitude: coords.longitude } : null;
  const policy = data.requestPolicy as Record<string, unknown> | undefined;
  const requestPolicy: ChatRequestDiagnostics["requestPolicy"] = policy && ["simple_chat", "agent", "analysis"].includes(String(policy.profile)) && typeof policy.timeoutMs === "number" && Number.isFinite(policy.timeoutMs) && policy.timeoutMs > 0 && policy.timeoutMs <= 60_000 && typeof policy.structuredOutput === "boolean" && Array.isArray(policy.toolNames) && policy.toolNames.every((name) => typeof name === "string" && /^[A-Za-z]\w{0,63}$/.test(name)) ? { profile: policy.profile as "simple_chat" | "agent" | "analysis", timeoutMs: policy.timeoutMs, structuredOutput: policy.structuredOutput, toolNames: policy.toolNames as string[] } : undefined;
  const f = data.failure as Record<string, unknown> | undefined;
  const failure: ChatRequestDiagnostics["failure"] = f && typeof f.code === "string" && /^[A-Z_]{1,64}$/.test(f.code) && (f.statusCode === null || typeof f.statusCode === "number" && Number.isInteger(f.statusCode) && f.statusCode >= 400 && f.statusCode <= 599) && (f.finishReason === null || typeof f.finishReason === "string" && /^[a-z-]{1,32}$/.test(f.finishReason)) && (f.stage === "before_tool" || f.stage === "after_tool") && Array.isArray(f.requiredTools) && f.requiredTools.every((v) => typeof v === "string" && /^[A-Za-z]\w{0,63}$/.test(v)) && typeof f.message === "string" && f.message.startsWith("MAX:") && f.message.length <= 1200 ? { ...(["thought_signature", "tool_schema", "tool_choice", "routing"].includes(String(f.providerHint)) ? { providerHint: f.providerHint as "thought_signature" | "tool_schema" | "tool_choice" | "routing" } : {}), code: f.code, statusCode: f.statusCode as number | null, finishReason: f.finishReason as string | null, stage: f.stage, requiredTools: f.requiredTools as string[], message: f.message } : undefined;
  return { endpoint: data.endpoint, provider: data.provider, model: data.model, mode: data.mode as ChatRequestDiagnostics["mode"], message: data.message, historyMessageCount: data.historyMessageCount, location, toolCalls, ...(requestPolicy ? { requestPolicy } : {}), ...(failure ? { failure } : {}), ...(Array.isArray(data.images) ? { images: data.images.flatMap((image) => image && typeof image.filename === "string" && typeof image.mediaType === "string" && typeof image.sizeBytes === "number" && Number.isFinite(image.sizeBytes) && image.sizeBytes >= 0 ? [{ filename: image.filename, mediaType: image.mediaType, sizeBytes: image.sizeBytes }] : []) } : {}) };
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
  const calendar = message.parts.some((part) => part.type === "data-generated-image" && part.data && typeof part.data === "object" && "renderer" in part.data && ["calendar-code", "calendar-hybrid"].includes(String(part.data.renderer)));
  const note = legacyNote || (review ? calendar ? "Do doprecyzowania przez użytkownika; sprawdź uwagi kalendarza." : "Wymagana weryfikacja przez pracownika." : "Brak");
  let copy = review === undefined ? text : `${text}\nDo sprawdzenia: ${note}\nneeds_review = ${review}`;
  const actualModel = message.role === "assistant" ? messageResponseModel(message) : undefined;
  if (actualModel !== undefined) copy += `\nModel: ${actualModel ?? "dostawca nie potwierdził identyfikatora"}`;
  const tools = message.role === "assistant" ? messageUsedTools(message) : [];
  if (tools.length) copy += `\nużyto: ${tools.join(", ")}`;
  if (message.role === "assistant" && messageHasSearchFallback(message)) copy += `\n${searchFallbackNotice(message)}`;
  for (const part of message.parts) {
    if (part.type !== "data-vision-description" || !part.data || typeof part.data !== "object") continue;
    const data = part.data as Record<string, unknown>;
    if ((data.provider !== "openrouter" && data.provider !== "google") || typeof data.draft !== "string") continue;
    copy += `\nOpis zdjęcia — ${data.provider === "google" ? "Gemini" : "OpenRouter"}: ${data.draft}\nModel: ${typeof data.modelId === "string" ? data.modelId : "dostawca nie potwierdził identyfikatora"}`;
  }
  for (const part of message.parts) {
    if (part.type === "data-generated-image") { const details = calendarDetailsText(part.data); if (details) copy += `\nWydarzenia i uwagi:\n${details}`; }
    if (part.type === "data-generated-image" && part.data && typeof part.data === "object" && "renderer" in part.data && part.data.renderer === "calendar-code") copy += "\nWykonanie: kod aplikacji — kalendarz. Wyróżniono weekendy; święta nie są oznaczone.";
    if (part.type === "data-generated-image" && part.data && typeof part.data === "object" && "renderer" in part.data && part.data.renderer === "calendar-hybrid") copy += `\nWykonanie: ilustracja AI + daty i podpisy nałożone kodem.\nModel ilustracji: ${"modelId" in part.data && typeof part.data.modelId === "string" ? part.data.modelId : "dostawca nie potwierdził"}`;
    if (part.type === "data-generated-image" && part.data && typeof part.data === "object" && "requestedBy" in part.data) {
      const provider = part.data.requestedBy;
      if (provider === "openrouter" || provider === "google") copy += `\nZlecił: MAX · ${provider === "google" ? "Gemini" : "OpenRouter"}`;
    }
  }
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

const escapeClipboardHtml = (text: string) => text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export function calendarDetailsText(value: unknown): string {
  if (!value || typeof value !== "object" || !("calendarDetails" in value)) return "";
  const details = value.calendarDetails;
  if (!details || typeof details !== "object") return "";
  const data = details as Record<string, unknown>, lines: string[] = [];
  if (Array.isArray(data.events)) for (const event of data.events.slice(0, 200)) {
    if (!event || typeof event !== "object" || typeof event.label !== "string" || typeof event.sourceDate !== "string") continue;
    let text = `${event.sourceDate}: ${event.label}`;
    if (typeof event.time === "string" && event.time) text += ` · ${event.time} ${typeof event.timeZone === "string" && event.timeZone ? event.timeZone : "BRAK STREFY"}`;
    if (typeof event.warsawTime === "string") text += ` → Warszawa: ${event.warsawDate} ${event.warsawTime}`;
    if (typeof event.conversionWarning === "string") text += ` · ${event.conversionWarning}`;
    lines.push(text);
  }
  if (data.weatherRequested === true && typeof data.weatherDaysCount === "number") lines.push(`Pogoda (${typeof data.weatherCity === "string" ? data.weatherCity : "wybrana miejscowość"}): potwierdzone dane dla ${data.weatherDaysCount} dni; pozostałe oznaczono BRAK DANYCH.`);
  if (Array.isArray(data.warnings)) for (const warning of data.warnings.slice(0, 200)) if (typeof warning === "string") lines.push(warning);
  return lines.join("\n");
}

export function messageImageUrls(message: Pick<UIMessage, "parts">) {
  return [...new Set(message.parts.flatMap((part) => {
    const url = part.type === "file" ? part.url : part.type === "data-generated-image" && part.data && typeof part.data === "object" && "imageUrl" in part.data ? part.data.imageUrl : undefined;
    return typeof url === "string" && url.length <= 8_000_000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(url) ? [url] : [];
  }))];
}

export function formatMessageHtml(message: Pick<UIMessage, "role" | "parts">, assistantName: string, withJson = false, responseTime?: number) {
  const text = escapeClipboardHtml(formatMessage(message, assistantName, withJson, responseTime));
  const images = messageImageUrls(message).map((url) => `<p><img src="${url}" alt="Zdjęcie z rozmowy" style="max-width:100%;height:auto"></p>`).join("");
  return `<article><div style="white-space:pre-wrap">${text}</div>${images}</article>`;
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

export function formatConversation(messages: UIMessage[], assistantName: string, withJson = false, responseTimes: Record<string, number> = {}, asHtml = false) {
  return messages.filter((message) => messageText(message).trim() || messageImageUrls(message).length).map((message) => asHtml ? formatMessageHtml(message, assistantName, withJson, responseTimes[message.id]) : formatMessage(message, assistantName, withJson, responseTimes[message.id])).join(asHtml ? "<hr>" : `\n${"-".repeat(63)}\n`);
}

export function formatCombinedConversation(openrouter: UIMessage[], google: UIMessage[], withJson = false, responseTimes: Partial<Record<"openrouter" | "google", Record<string, number>>> = {}, asHtml = false) {
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
          current = { question: asHtml ? formatMessageHtml(message, "Ty", withJson) : messageText(message), sentAt: typeof metadata.sentAt === "number" && Number.isFinite(metadata.sentAt) ? metadata.sentAt : 0, order: groups.size, openrouter: [], google: [] };
          groups.set(key, current);
        }
      } else if (message.role === "assistant" && current) {
        const text = copyMessageText(message, withJson);
        if (text || messageImageUrls(message).length) current[provider].push(asHtml ? formatMessageHtml(message, provider === "openrouter" ? "MAX · OpenRouter" : "MAX · Gemini", withJson, responseTimes[provider]?.[message.id]) : formatMessage(message, provider === "openrouter" ? "MAX · OpenRouter" : "MAX · Gemini", withJson, responseTimes[provider]?.[message.id]));
      }
    }
  }
  return [...groups.values()].sort((a, b) => a.sentAt - b.sentAt || a.order - b.order).flatMap((group) => [
    ...(group.question ? [asHtml ? group.question : `Ty: ${group.question}`] : []),
    ...group.openrouter,
    ...group.google,
  ]).join(asHtml ? "<hr>" : `\n${"-".repeat(63)}\n`);
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

export async function dispatchImageCommand(text: string, generate: (prompt: string) => Promise<void>) {
  if (!/^\s*Wygeneruj obraz\s*:/i.test(text)) return false;
  await generate(text);
  return true;
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
