"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type FormEvent, type PointerEvent, type ReactNode, type RefObject } from "react";

import { createDuelPause, runDuel } from "@/lib/duel";
import type { WeatherLocation } from "@/lib/public-tools";
import type { ChatRequestMode } from "@/lib/chat-result";
import LogoutButton from "./logout-button";
import HauntedScene, { Skull } from "./haunted-scene";
import BuildInfo, { type AppInfo } from "./build-info";
import CopyButton from "./copy-button";
import { assistantPresentation, broadcastMessage, formatCombinedConversation, formatConversation, formatMessage, messageText, clientMessageText, messageResult, retryLastChatRequest, analyzeClientMessage, formatResponseTime, messageSources, formatSourceDate, messageHasSearchFallback, messageUsedTools, searchFallbackNotice, messageTiming, messageRequest, sendWithWeatherLocation, completeWeatherQuestion } from "@/lib/chat-tools";

const authenticatedFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.status === 401) window.location.replace("/");
  return response;
};

const transports = {
  openrouter: new DefaultChatTransport({ api: "/api/chat", body: { provider: "openrouter" }, fetch: authenticatedFetch }),
  google: new DefaultChatTransport({ api: "/api/chat", body: { provider: "google" }, fetch: authenticatedFetch }),
};

function pasteMessage(event: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>, setValue: (value: string) => void) {
  const pasted = event.clipboardData.getData("text/plain");
  const cleaned = pasted.replace(/^\s*Ty:\s*/, "");
  if (cleaned === pasted) return;
  event.preventDefault();
  const input = event.currentTarget;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const text = input.tagName === "TEXTAREA" ? cleaned : cleaned.replace(/\r\n?|\n/g, " ");
  setValue(input.value.slice(0, start) + text + input.value.slice(end));
  requestAnimationFrame(() => input.setSelectionRange(start + text.length, start + text.length));
}

function useMaxChat(provider: "openrouter" | "google", mode: "chat" | "analysis", id: string = provider, location?: WeatherLocation) {
  const startedAt = useRef<number | null>(null);
  const [responseTimes, setResponseTimes] = useState<Record<string, number>>({});
  const lastReply = useRef<string | null>(null);
  const lastMode = useRef<ChatRequestMode>("chat");
  const lastLocation = useRef<WeatherLocation | undefined>(undefined);
  const retrying = useRef(false);
  const chat = useChat({
    id,
    transport: transports[provider],
    onFinish: ({ message, isAbort, isError, isDisconnect }) => {
      if (!isAbort && !isError && !isDisconnect && startedAt.current !== null) {
        const duration = performance.now() - startedAt.current;
        setResponseTimes((previous) => ({ ...previous, [message.id]: duration }));
      }
      startedAt.current = null;
      lastReply.current = isAbort || isError || isDisconnect ? null : message.parts
        .filter((part) => part.type === "text").map((part) => part.text).join("");
    },
    onError: () => { lastReply.current = null; startedAt.current = null; },
  });
  return {
    ...chat,
    responseTimes,
    isBusy: chat.status === "submitted" || chat.status === "streaming",
    clearConversation() {
      chat.setMessages([]);
      chat.clearError();
      lastReply.current = null;
      lastMode.current = "chat";
      startedAt.current = null;
      setResponseTimes({});
    },
    async sendText(text: string, sharedTurnId?: string, sentAt = Date.now()) {
      lastMode.current = mode;
      lastLocation.current = location;
      startedAt.current = performance.now();
      await chat.sendMessage({ text, metadata: { sentAt, ...(sharedTurnId ? { sharedTurnId } : {}) } }, { body: { mode, ...(location ? { location } : {}) } });
    },
    async retryLastRequest() {
      if (retrying.current || chat.status !== "error" || !chat.error) return;
      retrying.current = true;
      lastReply.current = null;
      startedAt.current = performance.now();
      try { await retryLastChatRequest(chat, lastMode.current, lastLocation.current); }
      finally { retrying.current = false; }
    },
    async reply(text: string) {
      lastMode.current = "duel";
      lastLocation.current = location;
      startedAt.current = performance.now();
      lastReply.current = null;
      await chat.sendMessage({ text, metadata: { sentAt: Date.now() } }, { body: { mode: "duel", ...(location ? { location } : {}) } });
      return lastReply.current;
    },
  };
}

type MaxChat = ReturnType<typeof useMaxChat>;
type Provider = "openrouter" | "google";
type EnabledProviders = Record<Provider, boolean>;
type ModelNames = Partial<Record<Provider, string>>;

function PanelHeading({ title, modelName, chat, responseTime, children }: {
  title: string;
  modelName?: string;
  chat: Pick<MaxChat, "status" | "error">;
  responseTime?: number;
  children: ReactNode;
}) {
  const state = chat.error || chat.status === "error" ? "BŁĄD"
    : chat.status === "submitted" ? "MYŚLI"
    : chat.status === "streaming" ? "PRZETWARZA" : "OTWARTA";
  return <div className="chat-topbar">
    <div className="panel-identity">
      <Skull />
      <div className="panel-labels">
        <span className="panel-title">{title}<ResponseTime milliseconds={responseTime} /></span>
        <span className="model-name" title="Model ustawiony w konfiguracji">{modelName || "model nieustawiony"}</span>
      </div>
    </div>
    <div className="panel-state" role="status" data-state={chat.status}>
      <span>KRYPTA</span><span>{state}</span>
    </div>
    <div className="panel-header-actions">{children}</div>
  </div>;
}

function UsedTools({ message }: { message: UIMessage }) {
  const tools = messageUsedTools(message);
  return tools.length ? <small className="message-metadata">użyto: {tools.join(", ")}</small> : null;
}

function Sources({ message }: { message: UIMessage }) {
  const fallback = messageHasSearchFallback(message);
  const sources = messageSources(message);
  if (!sources.length && !fallback) return null;
  return <>
    {fallback && <p className="message-metadata">{searchFallbackNotice(message)}</p>}
    {sources.length > 0 && <div className="message-sources"><h4>Źródła</h4><ul>{sources.map((source) => <li key={source.url}>
      <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
      <small>pobrano: {formatSourceDate(source.fetchedAt)}</small>
    </li>)}</ul></div>}
  </>;
}

function TimingDetails({ message }: { message: UIMessage }) {
  const timing = messageTiming(message);
  const request = messageRequest(message);
  if (!timing && !request) return null;
  const text = JSON.stringify({ ...(request ? { request } : {}), ...(timing ? { timing } : {}) }, null, 2);
  return <div className="message-json message-metadata"><details><summary>Żądanie i czasy (JSON)</summary><p>Żądanie zawiera wiadomość i argumenty narzędzi, bez nagłówków, kluczy i instrukcji serwerowej. input to argumenty modelu, effectiveInput to argumenty użyte przez aplikację. </p><p>Czasy serwera w ms. Etapy modelu obejmują sieć, kolejkę i generowanie. Natywne wyszukiwanie jest wliczone w czas modelu; toolMs mierzy wykonanie naszych funkcji. Suma czasów równoległych narzędzi może przekraczać toolMs.</p><pre>{text}</pre></details><CopyButton text={text} /></div>;
}

function ResponseTime({ milliseconds }: { milliseconds?: number }) {
  const label = formatResponseTime(milliseconds);
  return label ? <small className="response-time" title="Czas od wysłania zapytania do odebrania pełnej odpowiedzi, wraz z walidacją">· {label}</small> : null;
}

function AnalysisWorkspace({ active, enabled, modelNames, setActive, onBusyChange, location }: {
  active: EnabledProviders;
  enabled: EnabledProviders;
  modelNames: ModelNames;
  setActive: (value: EnabledProviders | ((previous: EnabledProviders) => EnabledProviders)) => void;
  onBusyChange: (busy: boolean) => void;
  location?: WeatherLocation;
}) {
  const openrouter = useMaxChat("openrouter", "analysis", "analysis-openrouter", location);
  const google = useMaxChat("google", "analysis", "analysis-google", location);
  const [clientMessage, setClientMessage] = useState("");
  const sending = useRef(false);
  const busy = openrouter.isBusy || google.isBusy;
  const activeCount = Number(active.openrouter) + Number(active.google);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => { void openrouter.stop(); void google.stop(); }, [openrouter.stop, google.stop]);

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientMessage.trim() || !activeCount || busy || sending.current) return;
    sending.current = true;
    try { await analyzeClientMessage(clientMessage, active, { openrouter, google }, crypto.randomUUID()); }
    finally { sending.current = false; }
  }

  return <section className="analysis-workspace" aria-labelledby="analysis-title">
    <h2 id="analysis-title">Analiza wiadomości Studio NovaMAX</h2>
    <p className="subtitle">Wklej wiadomość klienta. Otrzymasz kategorię, priorytet i szkic odpowiedzi.</p>
    <form className="analysis-form" onSubmit={(event) => void analyze(event)}>
      <label htmlFor="analysis-client-message">Wiadomość klienta</label>
      <textarea id="analysis-client-message" rows={7} value={clientMessage} onChange={(event) => setClientMessage(event.target.value)} onPaste={(event) => pasteMessage(event, setClientMessage)} disabled={busy} placeholder="Wklej wiadomość klienta…" />
      <fieldset className="provider-toggles" disabled={busy}>
        <legend>Analizuj przez</legend>
        <label><input type="checkbox" checked={active.openrouter} disabled={!enabled.openrouter} onChange={(event) => setActive((previous) => ({ ...previous, openrouter: event.target.checked }))} /> OpenRouter</label>
        <label><input type="checkbox" checked={active.google} disabled={!enabled.google} onChange={(event) => setActive((previous) => ({ ...previous, google: event.target.checked }))} /> Gemini</label>
      </fieldset>
      <button type="submit" disabled={busy || !activeCount || !clientMessage.trim()}>{busy ? "Analizowanie…" : "Analizuj wiadomość"}</button>
    </form>
    <div className="analysis-copy-controls">
      <CopyButton text={formatCombinedConversation(openrouter.messages, google.messages, false, { openrouter: openrouter.responseTimes, google: google.responseTimes })} label="Kopiuj całość" />
    </div>
    {!activeCount && <p className="chat-feedback">Włącz przynajmniej jeden model.</p>}
    <div className="analysis-results" data-count={activeCount}>
      {([["openrouter", openrouter, "MAX · OpenRouter"], ["google", google, "MAX · Gemini"]] as const).filter(([provider]) => active[provider]).map(([provider, chat, title]) => {
        const reply = [...chat.messages].reverse().find((message) => message.role === "assistant");
        const result = reply && messageResult(reply);
        const preview = reply?.parts.find((part) => part.type === "data-chat-preview");
        const previewText = chat.isBusy && preview && "data" in preview && typeof preview.data === "string" ? preview.data : "";
        return <article className="chat-panel analysis-panel" key={provider} aria-label={`Analiza: ${title}`}>
          <PanelHeading title={title} modelName={modelNames[provider]} chat={chat} responseTime={reply ? chat.responseTimes[reply.id] : undefined}>
            <CopyButton text={result && reply ? formatMessage(reply, title, false, chat.responseTimes[reply.id]) : ""} />
            <button type="button" className="copy-button" disabled={chat.isBusy || !chat.messages.length} onClick={chat.clearConversation}>Wyczyść</button>
          </PanelHeading>
          <div className="analysis-result-body" aria-live="polite" aria-busy={chat.isBusy}>
            {result ? <>
              <dl className="analysis-metadata">
                <div><dt>Kategoria</dt><dd>{result.category}</dd></div>
                <div><dt>Priorytet</dt><dd>{result.priority}</dd></div>
                <div><dt>Sprawdzenie</dt><dd>{result.needs_review ? "Wymagane" : "Niewymagane"}</dd></div>
              </dl>
              <h3>Szkic odpowiedzi</h3><p className="analysis-draft">{result.draft}</p>
              <p className="message-metadata">To nadal szkic, także gdy sprawdzenie nie jest wymagane.</p>
              {reply && <UsedTools message={reply} />}
              {reply && <Sources message={reply} />}
            </> : chat.isBusy ? <><p>MAX myśli… sprawdza wiadomość…</p><p className="analysis-draft">{previewText}</p><small>Wynik w trakcie sprawdzania.</small></>
              : !chat.error && <p className="message-metadata">Tutaj pojawi się wynik analizy.</p>}
            {chat.error && <div className="chat-feedback chat-error chat-retry" role="alert"><span>{chat.error.message.startsWith("MAX:") ? chat.error.message : "Analiza została przerwana lub wystąpił błąd dostawcy."}</span><button type="button" className="copy-button" disabled={chat.isBusy} onClick={() => void chat.retryLastRequest()}>Ponów</button></div>}
          </div>
        </article>;
      })}
    </div>
  </section>;
}

function ChatPanel({ chat, title, modelName, mode, dueling, canDuel, onStartDuel, onSendText }: {
  chat: MaxChat;
  title: string;
  modelName?: string;
  mode: "chat" | "analysis";
  dueling: boolean;
  canDuel: boolean;
  onStartDuel: (text: string) => boolean;
  onSendText: (text: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const conversationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const area = conversationRef.current;
    if (area) area.scrollTop = area.scrollHeight;
  }, [chat.messages, chat.status]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.trim() || chat.isBusy || dueling) return;
    void onSendText(draft.trim());
    setDraft("");
  }

  return <div className="chat-panel">
    <PanelHeading title={title} modelName={modelName} chat={chat}>
      <CopyButton text={formatConversation(chat.messages, title, false, chat.responseTimes)} label="Kopiuj czat" /><CopyButton text={formatConversation(chat.messages, title, true, chat.responseTimes)} label="Kopiuj czat z JSON" /><button type="button" className="copy-button clear-chat-button" disabled={chat.isBusy || dueling || (!chat.messages.length && !chat.error)} aria-label={`Wyczyść ${title}`} onClick={() => { if (!chat.isBusy && !dueling) chat.clearConversation(); }}>Wyczyść</button>
    </PanelHeading>
    <section ref={conversationRef} className="conversation" role="log" aria-label={`Rozmowa: ${title}`} aria-live="polite" aria-busy={chat.isBusy}>
      {chat.messages.map((item) => {
        const result = messageResult(item);
        const isAnalysis = item.parts.some((part) => part.type === "data-chat-mode" && part.data === "analysis");
        const preview = item.parts.find((part) => part.type === "data-chat-preview");
        const previewText = chat.isBusy && item === chat.messages.at(-1) && preview && "data" in preview && typeof preview.data === "string" ? preview.data : "";
        const presentation = item.role === "assistant" && !result ? assistantPresentation(messageText(item)) : { text: messageText(item), category: undefined, review: undefined };
        return <div className="conversation-entry" key={item.id}><div className={`message message-${item.role}`}>
          <div className="message-heading"><span className="message-author">{item.role === "user" ? "Ty" : title}{item.role === "assistant" && <ResponseTime milliseconds={chat.responseTimes[item.id]} />}</span><div className="message-copy-controls"><CopyButton text={clientMessageText(item).trim() ? formatMessage(item, title, false, chat.responseTimes[item.id]) : ""} /><CopyButton text={clientMessageText(item).trim() ? formatMessage(item, title, true, chat.responseTimes[item.id]) : ""} label="Kopiuj z JSON" /></div></div>
          {isAnalysis && <small className="message-metadata">Szkic odpowiedzi</small>}
          <span>{presentation.text || previewText}</span>
          {!chat.isBusy && !result && preview && <small className="message-metadata">Odpowiedź nie została zatwierdzona.</small>}
          {!result && previewText && <small className="message-metadata">Odpowiedź w trakcie sprawdzania…</small>}
          {result ? <small className="message-metadata">{isAnalysis
            ? `Kategoria: ${result.category} · Priorytet: ${result.priority} · Sprawdzenie: ${result.needs_review ? "wymagane" : "niewymagane"} — nadal szkic`
            : `${result.category} · ${result.priority} · ${String(result.needs_review)}`}</small>
            : (presentation.category || presentation.review) && <small className="message-metadata">{[presentation.category, presentation.review].filter(Boolean).join(" · ")}</small>}
          {item.role === "assistant" && <UsedTools message={item} />}
          {item.role === "assistant" && clientMessageText(item).trim() && <Sources message={item} />}
          {result && <div className="message-json message-metadata"><details><summary>JSON</summary><pre>{JSON.stringify(result, null, 2)}</pre></details><CopyButton text={JSON.stringify(result, null, 2)} /></div>}
          {item.role === "assistant" && <TimingDetails message={item} />}
        </div></div>;
      })}
    </section>
    <div className="panel-feedback">
      {chat.isBusy && <p className="chat-feedback" role="status">{chat.status === "submitted" ? "MAX budzi się w krypcie…" : "MAX pisze z zaświatów…"}</p>}
      {chat.error && <div className="chat-feedback chat-error chat-retry" role="alert"><span>{chat.error.message.startsWith("MAX:") ? chat.error.message : "Nie udało się połączyć z MAX-em. Sprawdź połączenie i spróbuj ponownie."}</span><button type="button" className="copy-button" disabled={chat.isBusy || dueling || !chat.messages.some((message) => message.role === "user")} onClick={() => { if (!dueling) void chat.retryLastRequest(); }}>Ponów</button></div>}
    </div>
    <form onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor={`draft-${chat.id}`}>Wiadomość do {title}</label>
      <input id={`draft-${chat.id}`} placeholder="Napisz do tego MAX-a…" value={draft} onChange={(event) => setDraft(event.target.value)} onPaste={(event) => pasteMessage(event, setDraft)} disabled={chat.isBusy || dueling} autoComplete="off" />
      <div className="chat-actions">
        <button type="submit" disabled={!draft.trim() || chat.isBusy || dueling}>{mode === "analysis" ? "Analizuj" : "Ślij"}</button>
        <button type="button" className="secondary-button" disabled={mode === "analysis" || !draft.trim() || !canDuel || dueling} title="Zaczyna ten MAX. Oba czaty muszą być aktywne i gotowe." onClick={() => {
          if (onStartDuel(draft.trim())) setDraft("");
        }}>Pojedynek!</button>
      </div>
    </form>
  </div>;
}

function QuestionPicker({ questions, value, onChange, disabled, inputRef }: { questions: string[]; value: string; onChange: (value: string) => void; disabled: boolean; inputRef: RefObject<HTMLInputElement | null> }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: globalThis.PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  const [highlighted, setHighlighted] = useState(-1);
  const visible = filter && value.trim() ? questions.filter((question) => question.toLocaleLowerCase("pl").includes(value.trim().toLocaleLowerCase("pl"))) : questions;
  const expanded = open && !disabled && questions.length > 0;
  function choose(question: string) {
    onChange(question);
    setOpen(false);
    setHighlighted(-1);
  }
  return <div ref={root} className="question-combo" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <input ref={inputRef} id="shared-question" role="combobox" aria-expanded={expanded} aria-controls="test-questions" aria-autocomplete="list" aria-activedescendant={expanded && highlighted >= 0 ? `test-question-${highlighted}` : undefined}
      value={value} onFocus={() => { setOpen(true); setFilter(false); }} onChange={(event) => { onChange(event.target.value); setFilter(true); setOpen(true); setHighlighted(-1); }}
      onPaste={(event) => pasteMessage(event, onChange)}
      onKeyDown={(event) => {
        if (event.key === "Escape") { setOpen(false); setHighlighted(-1); }
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && questions.length) {
          event.preventDefault(); setOpen(true);
          const next = event.key === "ArrowDown" ? Math.min(highlighted + 1, visible.length - 1) : Math.max(highlighted - 1, 0);
          setHighlighted(next);
          document.getElementById(`test-question-${next}`)?.scrollIntoView({ block: "nearest" });
        }
        if (event.key === "Enter") {
          if (expanded && highlighted >= 0 && visible[highlighted]) { event.preventDefault(); choose(visible[highlighted]); }
          else setOpen(false);
        }
      }}
      placeholder={questions.length ? "Wybierz pytanie lub wpisz wiadomość…" : "Wpisz wiadomość do zaznaczonych czatów…"} disabled={disabled} autoComplete="off" />
    {value && <button type="button" className="clear-question" aria-label="Wyczyść wiadomość" title="Wyczyść" disabled={disabled} onClick={() => { onChange(""); setFilter(false); setHighlighted(-1); inputRef.current?.focus(); }}>×</button>}
    {questions.length > 0 && <button type="button" className="toggle-questions" aria-label={expanded ? "Zwiń pytania" : "Rozwiń pytania"} aria-expanded={expanded} aria-controls="test-questions" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen(!expanded); setFilter(false); setHighlighted(-1); }}>▾</button>}
    {expanded && <ul id="test-questions" className="question-options" role="listbox" aria-label="Pytania testowe">
      {visible.map((question, index) => <li key={question} id={`test-question-${index}`} role="option" aria-selected={highlighted === index} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(question)}>{question}</li>)}
      {!visible.length && <li className="no-questions" role="presentation">Brak pasujących pytań — możesz wysłać własną wiadomość.</li>}
    </ul>}
  </div>;
}

export default function ChatArena({ enabled, modelNames = {}, roundsPerBatch = 5, appInfo, testQuestions = { questions: [], invalid: false } }: { enabled: EnabledProviders; modelNames?: ModelNames; roundsPerBatch?: number; appInfo: AppInfo; testQuestions?: { questions: string[]; invalid: boolean } }) {
  const [mode, setMode] = useState<"chat" | "analysis">("chat");
  const [location, setLocation] = useState<WeatherLocation>();
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [pendingWeather, setPendingWeather] = useState<{ question: string; targets: EnabledProviders } | null>(null);
  const [customWeatherCity, setCustomWeatherCity] = useState("");
  const openrouter = useMaxChat("openrouter", "chat", "openrouter", location);
  const google = useMaxChat("google", "chat", "google", location);
  function requestLocation() {
    if (locating) return;
    setLocationError("");
    if (!window.isSecureContext || !navigator.geolocation) { setLocationError("Lokalizacja wymaga HTTPS lub localhost oraz obsługi w przeglądarce. Możesz wpisać miasto w wiadomości."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setLocation({ latitude: Math.round(coords.latitude * 1000) / 1000, longitude: Math.round(coords.longitude * 1000) / 1000 });
      setLocating(false);
    }, (error) => {
      setLocationError(error.code === 1 ? "Przeglądarka lub system blokuje lokalizację. Kliknij ikonę po lewej stronie adresu strony i sprawdź uprawnienie „Lokalizacja”. Jeśli nadal jest blokada, sprawdź ustawienia lokalizacji systemu. Możesz też wpisać miasto w wiadomości." : error.code === 3 ? "Przekroczono czas pobierania lokalizacji. Spróbuj ponownie lub wpisz miasto." : "Nie udało się ustalić lokalizacji. Możesz wpisać miasto w wiadomości.");
      setLocating(false);
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  }
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [dueling, setDueling] = useState(false);
  const [paused, setPaused] = useState(false);
  const [batchQuestion, setBatchQuestion] = useState(false);
  const [sharedDraft, setSharedDraft] = useState("");
  const [sendingShared, setSendingShared] = useState(false);
  const sharedSending = useRef(false);
  const sharedInput = useRef<HTMLInputElement>(null);
  const [selection, setActive] = useState(enabled);
  const active = { openrouter: selection.openrouter && enabled.openrouter, google: selection.google && enabled.google };
  const [chatHeight, setChatHeight] = useState(600);
  const [heightDraft, setHeightDraft] = useState("600");
  useEffect(() => { setHeightDraft(String(chatHeight)); }, [chatHeight]);
  const resizeStart = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  const pauseControl = useRef<ReturnType<typeof createDuelPause> | null>(null);
  const [turns, setTurns] = useState(0);
  const [duelError, setDuelError] = useState("");
  const duelController = useRef<AbortController | null>(null);
  const busy = openrouter.isBusy || google.isBusy;
  const activeCount = Number(active.openrouter) + Number(active.google);
  const sharedDisabled = busy || dueling || sendingShared || activeCount === 0;
  const weatherRequested = Boolean(pendingWeather);

  function clearAllConversations() {
    if (busy || duelController.current || sharedSending.current) return;
    openrouter.clearConversation();
    google.clearConversation();
    setPendingWeather(null);
    setCustomWeatherCity("");
    setTurns(0);
    setDuelError("");
    setBatchQuestion(false);
    setPaused(false);
  }

  async function sendShared(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendSharedText(sharedDraft);
  }

  async function submitToChats(text: string, targets: EnabledProviders) {
    if (sharedDisabled || sharedSending.current) return;
    const selected = { openrouter: targets.openrouter && active.openrouter, google: targets.google && active.google };
    if (!selected.openrouter && !selected.google) return;
    sharedSending.current = true;
    setSendingShared(true);
    const sharedTurnId = crypto.randomUUID();
    const sentAt = Date.now();
    setPendingWeather(null);
    setSharedDraft("");
    try {
      await broadcastMessage(text, selected, {
        openrouter: (value) => openrouter.sendText(value, sharedTurnId, sentAt),
        google: (value) => google.sendText(value, sharedTurnId, sentAt),
      });
    } finally { sharedSending.current = false; setSendingShared(false); }
  }

  async function sendSharedText(value: string) {
    if (!value.trim() || sharedDisabled || sharedSending.current) return;
    if (pendingWeather && /^(?:Radom|Warszawa|Zakopane|Gdańsk)$/i.test(value.trim())) { await chooseWeatherCity(value); return; }
    await sendWithWeatherLocation(value, Boolean(location), (question) => {
      setPendingWeather({ question, targets: { ...active } });
      setSharedDraft("");
    }, (question) => submitToChats(question, active));
  }

  async function sendPanelText(provider: Provider, value: string) {
    if ((provider === "openrouter" ? openrouter : google).isBusy || dueling || sharedSending.current) return;
    await sendWithWeatherLocation(value, Boolean(location), (question) => {
      setPendingWeather({ question, targets: { openrouter: provider === "openrouter", google: provider === "google" } });
    }, async (question) => {
      setPendingWeather(null);
      await (provider === "openrouter" ? openrouter : google).sendText(question);
    });
  }

  async function chooseWeatherCity(city: string) {
    if (!pendingWeather || !city.trim() || sharedDisabled || analysisBusy) return;
    const selected = { openrouter: pendingWeather.targets.openrouter && active.openrouter, google: pendingWeather.targets.google && active.google };
    if (!selected.openrouter && !selected.google) return;
    await submitToChats(completeWeatherQuestion(pendingWeather.question, city), selected);
    setCustomWeatherCity("");
  }

  useEffect(() => {
    if (location && pendingWeather && !busy && !dueling && !sharedSending.current) void submitToChats(pendingWeather.question, pendingWeather.targets);
  }, [location]);

  useEffect(() => () => {
    duelController.current?.abort();
    void openrouter.stop();
    void google.stop();
  }, [openrouter.stop, google.stop]);

  function stopDuel() {
    duelController.current?.abort();
    void openrouter.stop();
    void google.stop();
    // Kontroler zostaje zajęty do zakończenia pętli, więc nie powstaną dwie pętle.
  }

  function togglePause() {
    if (!duelController.current) return;
    pauseControl.current?.setPaused(!paused);
    setPaused(!paused);
    if (paused) setBatchQuestion(false);
  }

  function stepChatHeight(delta: number) {
    const value = Number(heightDraft);
    const base = heightDraft.trim() && Number.isFinite(value) ? value : chatHeight;
    const height = Math.round(Math.min(1400, Math.max(360, base + delta)));
    setChatHeight(height);
    setHeightDraft(String(height));
  }

  function beginResize(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStart.current = { pointerId: event.pointerId, y: event.clientY, height: chatHeight };
  }

  function resizeChats(event: PointerEvent<HTMLDivElement>) {
    const start = resizeStart.current;
    if (start?.pointerId !== event.pointerId) return;
    setChatHeight(Math.round(Math.min(1400, Math.max(360, start.height + event.clientY - start.y))));
  }

  function endResize(event: PointerEvent<HTMLDivElement>) {
    if (resizeStart.current?.pointerId !== event.pointerId) return;
    resizeStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function startDuel(provider: Provider, text: string): boolean {
    if (!text.trim() || busy || sharedSending.current || duelController.current || activeCount !== 2) return false;
    const controller = new AbortController();
    duelController.current = controller;
    const gate = createDuelPause();
    pauseControl.current = gate;
    setPaused(false);
    setBatchQuestion(false);
    setDueling(true);
    setTurns(0);
    setDuelError("");
    openrouter.clearError();
    google.clearError();
    void runDuel({
      initialPrompt: text.trim(),
      responders: [openrouter.reply, google.reply],
      startIndex: provider === "google" ? 1 : 0,
      signal: controller.signal,
      onTurn: setTurns,
      roundsPerBatch,
      onBatchComplete: async () => {
        gate.setPaused(true);
        setPaused(true);
        setBatchQuestion(true);
        await gate.wait(controller.signal);
        return !controller.signal.aborted;
      },
      waitForResume: gate.wait,
    }).catch(() => {
      if (!controller.signal.aborted) setDuelError("Pojedynek zatrzymany: błąd lub brak odpowiedzi. Sprawdź komunikaty w oknach czatu.");
    }).finally(() => {
      if (duelController.current === controller) {
        duelController.current = null;
        pauseControl.current = null;
        setDueling(false);
        setPaused(false);
        setBatchQuestion(false);
      }
    });
    return true;
  }

  const modeButtons = <div className="chat-mode-buttons" role="group" aria-label="Tryb pracy">
    <button type="button" className="chat-mode-button" aria-pressed={mode === "chat"} disabled={busy || dueling || sendingShared || analysisBusy} onClick={() => setMode("chat")}>Zwykły czat</button>
    <button type="button" className="chat-mode-button" aria-pressed={mode === "analysis"} disabled={busy || dueling || sendingShared || analysisBusy} onClick={() => setMode("analysis")}>Analiza wiadomości</button>
  </div>;

  return <>
    <HauntedScene />
    <main className="arena">
      <header>
        <div className="arena-header-row">
          <p className="eyebrow"><span /> PO DRUGIEJ STRONIE EKRANU</p>
          <LogoutButton beforeLogout={stopDuel} />
        </div>
        <h1>Jestem <span>MAX</span>, od AM</h1>
        <p className="subtitle">Twoja krypta. Wybierz jednego MAX-a lub zaproś obu do pojedynku.</p>
      </header>
      {!weatherRequested && location && <div className="location-controls"><span>Lokalizacja do pogody ustawiona</span><button type="button" className="copy-button" disabled={busy || analysisBusy || dueling} onClick={() => { setLocation(undefined); setLocationError(""); }}>Usuń lokalizację</button></div>}
      {mode === "chat" && weatherRequested && <div className="location-controls" data-ready={Boolean(location)}>
        {!location && <span className="location-hint"><strong>Wybierz miejscowość do prognozy</strong> Kliknij miasto poniżej, wpisz własne lub użyj „Moja lokalizacja”.</span>}
        {pendingWeather && <p className="pending-weather-question" role="status">{pendingWeather.question}<small>Wybierz miejscowość — pytanie nie zostało jeszcze wysłane do AI.</small><button type="button" className="copy-button" onClick={() => setPendingWeather(null)}>Anuluj wybór</button></p>}
        <button type="button" className="secondary-button location-button" onClick={requestLocation} disabled={locating || busy || analysisBusy || dueling}>{locating ? "Ustalam lokalizację…" : location ? "📍 Zmień lokalizację" : "📍 Moja lokalizacja"}</button>
        {location && <><span role="status">Lokalizacja do pogody ustawiona</span><button type="button" className="copy-button" disabled={busy || analysisBusy || dueling} onClick={() => { setLocation(undefined); setLocationError(""); }}>Usuń lokalizację</button></>}
        {locationError && <span role="alert">{locationError}</span>}
        <div className="weather-city-replies" aria-label="Szybkie odpowiedzi z miejscowością">
          <span>Wyślij miejscowość do zaznaczonych czatów:</span>
          {["Radom", "Warszawa", "Zakopane", "Gdańsk"].map((city) => <button key={city} type="button" className="secondary-button" disabled={sharedDisabled || analysisBusy} onClick={() => void chooseWeatherCity(city)}>{city}</button>)}
        </div>
        <form className="weather-custom-city" onSubmit={(event) => { event.preventDefault(); void chooseWeatherCity(customWeatherCity); }}>
          <label className="sr-only" htmlFor="weather-custom-city">Inna miejscowość</label>
          <input id="weather-custom-city" value={customWeatherCity} onChange={(event) => setCustomWeatherCity(event.target.value)} placeholder="Inna miejscowość…" maxLength={100} disabled={sharedDisabled || analysisBusy} />
          <button type="submit" className="secondary-button" disabled={sharedDisabled || analysisBusy || !customWeatherCity.trim()}>Sprawdź pogodę</button>
        </form>
      </div>}
      <div hidden={mode !== "analysis"}>
        <AnalysisWorkspace active={active} enabled={enabled} modelNames={modelNames} setActive={setActive} onBusyChange={setAnalysisBusy} location={location} />
        <div className="duel-toolbar mode-toolbar">{modeButtons}</div>
      </div>
      <div hidden={mode !== "chat"}>
      <div className="arena-controls">
        <fieldset className="provider-toggles" disabled={busy || dueling || sendingShared}>
          <legend>Aktywne czaty</legend>
          <label><input type="checkbox" checked={active.openrouter} disabled={!enabled.openrouter} onChange={(event) => setActive((previous) => ({ ...previous, openrouter: event.target.checked }))} /> OpenRouter{!enabled.openrouter && " · wyłączony w konfiguracji"}</label>
          <label><input type="checkbox" checked={active.google} disabled={!enabled.google} onChange={(event) => setActive((previous) => ({ ...previous, google: event.target.checked }))} /> Gemini{!enabled.google && " · wyłączony w konfiguracji"}</label>
        </fieldset>
        <form className="shared-composer" onSubmit={(event) => void sendShared(event)}>
          <label className="sr-only" htmlFor="shared-question">Wiadomość do zaznaczonych czatów</label>
          <QuestionPicker questions={testQuestions.questions} value={sharedDraft} onChange={setSharedDraft} disabled={sharedDisabled} inputRef={sharedInput} />
          <button type="submit" disabled={sharedDisabled || !sharedDraft.trim()}>{sendingShared ? "Czekaj…" : mode === "analysis" ? "Analizuj" : "Wyślij"}</button>
        </form>
        <div className="copy-clear-controls">
          <CopyButton text={formatCombinedConversation(openrouter.messages, google.messages, false, { openrouter: openrouter.responseTimes, google: google.responseTimes })} label="Kopiuj całość" />
          <CopyButton text={formatCombinedConversation(openrouter.messages, google.messages, true, { openrouter: openrouter.responseTimes, google: google.responseTimes })} label="Kopiuj całość z JSON" />
          <button type="button" className="copy-button clear-chat-button" disabled={busy || dueling || sendingShared || (!openrouter.messages.length && !google.messages.length && !openrouter.error && !google.error && !turns && !duelError)} onClick={clearAllConversations}>Wyczyść całość</button>
        </div>
        {testQuestions.invalid && <p className="questions-error" role="alert">Nie można odczytać listy z config/test-questions.json. Sprawdź plik i format JSON. Nadal możesz wpisać własną wiadomość.</p>}
      </div>
      <div className="chat-grid" data-count={activeCount} style={{ "--chat-height": `${chatHeight}px` } as CSSProperties}>
        {active.openrouter && <ChatPanel onSendText={(text) => sendPanelText("openrouter", text)} chat={openrouter} title="MAX · OpenRouter" modelName={modelNames.openrouter} mode={mode} dueling={dueling} canDuel={activeCount === 2 && !busy && !sendingShared} onStartDuel={(text) => startDuel("openrouter", text)} />}
        {active.google && <ChatPanel onSendText={(text) => sendPanelText("google", text)} chat={google} title="MAX · Gemini" modelName={modelNames.google} mode={mode} dueling={dueling} canDuel={activeCount === 2 && !busy && !sendingShared} onStartDuel={(text) => startDuel("google", text)} />}
      </div>
      <div className="duel-controls">
        <p className="duel-status" role="status">{batchQuestion ? `Ukończono ${Math.floor(turns / 2)} rund. Czy chcesz kontynuować przez kolejne ${roundsPerBatch} rund?` : dueling ? `${paused ? busy ? "Pauza po bieżącej odpowiedzi" : "Pojedynek wstrzymany" : "Pojedynek trwa"} · ukończone rundy: ${Math.floor(turns / 2)} · wypowiedzi: ${turns}` : activeCount === 0 ? "Włącz przynajmniej jeden czat powyżej." : activeCount === 1 ? "Tryb jednego czatu. Zaznacz drugi model, aby uruchomić pojedynek." : turns ? `Pojedynek zakończony · rundy: ${Math.floor(turns / 2)} · wypowiedzi: ${turns}` : `Wpisz temat i kliknij Pojedynek! Automatyczna pauza co ${roundsPerBatch} rund.`}</p>
        <div className="duel-toolbar">
          {modeButtons}
          <div className="duel-buttons">
            <button className="secondary-button" onClick={togglePause} disabled={!dueling}>{batchQuestion ? `Tak, kolejne ${roundsPerBatch} rund` : paused ? "Kontynuuj" : "Pauza"}</button>
            <button className="stop-button" onClick={stopDuel} disabled={!dueling && !busy}>{batchQuestion ? "Nie, zakończ" : "Stop"}</button>
          </div>
        </div>
        <p className="usage-note">Runda to po jednej odpowiedzi obu MAX-ów. Każda odpowiedź zużywa limit API; przy płatnych modelach także środki. Po {roundsPerBatch} rundach następuje pauza i pytanie o kolejną partię.</p>
        {duelError && <p className="chat-feedback chat-error" role="alert">{duelError}</p>}
      </div>
      {activeCount > 0 && <div className="chat-height-controls"><div className="chat-resizer" role="slider" tabIndex={0} aria-label="Wysokość czatów" aria-orientation="vertical" aria-valuemin={360} aria-valuemax={1400} aria-valuenow={chatHeight} aria-valuetext={`${chatHeight} pikseli`} onPointerDown={beginResize} onPointerMove={resizeChats} onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={() => { resizeStart.current = null; }} onKeyDown={(event) => {
        if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          setChatHeight((height) => event.key === "Home" ? 360 : event.key === "End" ? 1400 : Math.min(1400, Math.max(360, height + (event.key === "ArrowUp" ? 200 : -200))));
        }
      }}><span />Przeciągnij, aby zmienić wysokość {activeCount === 2 ? "obu czatów" : "czatu"}</div>
        <label className="height-editor">Wysokość
          <span className="height-spinbox"><input type="number" min={360} max={1400} step={200} value={heightDraft} aria-label="Wysokość czatów w pikselach" onChange={(event) => {
            setHeightDraft(event.target.value);
            const height = event.target.valueAsNumber;
            if (Number.isFinite(height) && height >= 360 && height <= 1400) setChatHeight(Math.round(height));
          }} onBlur={() => {
            const value = Number(heightDraft);
            const height = heightDraft.trim() && Number.isFinite(value) ? Math.round(Math.min(1400, Math.max(360, value))) : chatHeight;
            setChatHeight(height);
            setHeightDraft(String(height));
          }} onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); stepChatHeight(event.key === "ArrowUp" ? 200 : -200); }
            if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
          }} />
          <span className="height-step-buttons">
            <button type="button" aria-label="Zwiększ wysokość o 200 pikseli" onClick={() => stepChatHeight(200)}>▴</button>
            <button type="button" aria-label="Zmniejsz wysokość o 200 pikseli" onClick={() => stepChatHeight(-200)}>▾</button>
          </span></span> px
        </label>
      </div>}
      </div>
      <p className="footer-note">Tylko Ty, mrok i dwa głosy z zaświatów.</p>
      <BuildInfo info={appInfo} />
    </main>
  </>;
}
