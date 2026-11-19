"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage, type FileUIPart } from "ai";
import { useEffect, useId, useRef, useState, type ClipboardEvent, type CSSProperties, type FormEvent, type PointerEvent, type ReactNode, type RefObject } from "react";

import { createDuelPause, runDuel } from "@/lib/duel";
import type { WeatherLocation } from "@/lib/public-tools";
import type { ChatRequestMode } from "@/lib/chat-result";
import ImageAttachments, { useImageAttachments, prepareImagePart } from "./image-attachments";
import LogoutButton from "./logout-button";
import HauntedScene, { Skull } from "./haunted-scene";
import BuildInfo, { type AppInfo } from "./build-info";
import { DEFAULT_VISION_QUESTION } from "@/lib/chat-images";
import imagePrompts from "../config/image-prompts.json";
import SaveImageButton from "./save-image-button";
import CopyButton from "./copy-button";
import { submitOnEnter } from "@/lib/form-submit";
import { assistantPresentation, broadcastMessage, formatCombinedConversation, formatConversation, formatMessage, messageText, clientMessageText, messageResult, retryLastChatRequest, analyzeClientMessage, formatResponseTime, messageSources, formatSourceDate, messageHasSearchFallback, messageUsedTools, searchFallbackNotice, messageTiming, messageRequest, messageResponseModel, sendWithWeatherLocation, completeWeatherQuestion, messageImageUrls, formatMessageHtml, calendarDetailsText } from "@/lib/chat-tools";

const authenticatedFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.status === 401) window.location.replace("/");
  return response;
};

const transports = {
  openrouter: new DefaultChatTransport({ api: "/api/agent", body: { provider: "openrouter" }, fetch: authenticatedFetch }),
  google: new DefaultChatTransport({ api: "/api/agent", body: { provider: "google" }, fetch: authenticatedFetch }),
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

function useMaxChat(provider: "openrouter" | "google", mode: "chat" | "analysis", id: string = provider, location?: WeatherLocation, onCompleted?: (message: UIMessage) => void) {
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
      if (!isAbort && !isError && !isDisconnect && messageResult(message)) onCompleted?.(message);
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
    async sendText(text: string, sharedTurnId?: string, sentAt = Date.now(), files: FileUIPart[] = [], originalImagePrompt?: string, exactImagePrompt = false) {
      lastMode.current = mode;
      lastLocation.current = location;
      startedAt.current = performance.now();
      await chat.sendMessage({ text, files, metadata: { sentAt, ...(originalImagePrompt !== undefined ? { originalImagePrompt, exactImagePrompt } : {}), ...(sharedTurnId ? { sharedTurnId } : {}) } }, { body: { mode: mode === "analysis" ? "analyze" : mode, ...(location ? { location } : {}) } });
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

function ToolBadges({ message }: { message: UIMessage }) {
  const labels: Record<string, string> = { web_search: "🔎 wyszukiwanie", google_search: "🔎 wyszukiwanie", generujObraz: "🎨 generujObraz", generujKalendarz: "🗓 generujKalendarz", pogodaKalendarzaOpenMeteo: "🌦 pogodaKalendarzaOpenMeteo", pogodaOpenMeteo: "🌦 pogodaOpenMeteo", kursWalutyNBP: "💱 kursWalutyNBP", aktualnyCzas: "🕒 aktualnyCzas", dniWolnePL: "📅 dniWolnePL", przeliczStrefyCzasowe: "🌍 przeliczStrefyCzasowe" };
  return <div className="tool-badges">{messageUsedTools(message).map((name) => <small className="tool-badge" key={name}>{labels[name] ?? name}</small>)}</div>;
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

function ActualModel({ message }: { message: UIMessage }) {
  const model = messageResponseModel(message);
  return model === undefined ? null : <small className="message-metadata">Model: {model ?? "dostawca nie potwierdził identyfikatora"}</small>;
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

function ChatImagePreview({ url }: { url: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [fullSize, setFullSize] = useState(false);
  return <>
    <button type="button" className="image-preview-button" aria-label="Powiększ obraz" onClick={() => { setFullSize(false); dialog.current?.showModal(); }}><img className="generated-image" src={url} alt="Wygenerowany obraz" /></button>
    <dialog ref={dialog} className="image-preview-dialog" aria-label="Podgląd obrazu" onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="generator-actions"><button type="button" className="copy-button" onClick={() => setFullSize(!fullSize)}>{fullSize ? "Dopasuj" : "Rozmiar oryginalny"}</button><button type="button" className="copy-button" onClick={() => dialog.current?.close()} autoFocus>Zamknij</button></div>
      <img className={fullSize ? "image-preview-original" : undefined} src={url} alt="Powiększenie obrazu" />
    </dialog>
  </>;
}

function AnalyzedImage({ url, index }: { url: string; index: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return <figure className="message-image-wrap analyzed-image">
    <button type="button" className="image-preview-button" onClick={() => dialog.current?.showModal()} aria-label={`Powiększ analizowane zdjęcie ${index + 1}`}>
      <img className="message-image analyzed-image-thumbnail" src={url} alt={`Analizowane zdjęcie ${index + 1}`} />
    </button>
    <figcaption><button type="button" className="copy-button" onClick={() => dialog.current?.showModal()}>Powiększ zdjęcie</button> <CopyButton text="" imageUrl={url} imageOnly label="Kopiuj obraz" /></figcaption>
    <dialog ref={dialog} className="image-preview-dialog" aria-label="Podgląd analizowanego zdjęcia">
      <button type="button" className="copy-button" onClick={() => dialog.current?.close()} autoFocus>Zamknij</button>
      <img src={url} alt={`Analizowane zdjęcie ${index + 1} — powiększenie`} />
    </dialog>
  </figure>;
}

function AnalysisWorkspace({ active, enabled, modelNames, setActive, onBusyChange, location, modeButtons }: {
  modeButtons: ReactNode;
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
  const [lastAnalysisWasImage, setLastAnalysisWasImage] = useState(false);
  const attachments = useImageAttachments();
  const sending = useRef(false);
  const busy = openrouter.isBusy || google.isBusy;
  const visionView = attachments.files.length > 0 || lastAnalysisWasImage;
  const activeCount = Number(active.openrouter) + Number(active.google);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => () => { void openrouter.stop(); void google.stop(); }, [openrouter.stop, google.stop]);

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((!clientMessage.trim() && !attachments.files.length) || !activeCount || busy || sending.current || attachments.reading) return;
    sending.current = true;
    const files = attachments.files;
    setLastAnalysisWasImage(files.length > 0);
    const sentAt = Date.now();
    attachments.clear();
    try { await analyzeClientMessage(clientMessage.trim() || DEFAULT_VISION_QUESTION, active, {
      openrouter: { clearConversation: openrouter.clearConversation, sendText: (text, turnId) => openrouter.sendText(text, turnId, sentAt, files) },
      google: { clearConversation: google.clearConversation, sendText: (text, turnId) => google.sendText(text, turnId, sentAt, files) },
    }, crypto.randomUUID()); }
    finally { sending.current = false; }
  }

  return <section className="analysis-workspace" aria-labelledby="analysis-title">
    <h2 id="analysis-title">{visionView ? "Analiza obrazu — Vision" : "Analiza wiadomości Studio NovaMAX"}</h2>
    <p className="subtitle">{visionView ? "Dodaj zdjęcie lub grafikę. Otrzymasz konkretny opis widocznych elementów, napisów i kompozycji." : "Wklej wiadomość klienta lub dodaj obraz do analizy."}</p>
    <form className="analysis-form" onSubmit={(event) => void analyze(event)}>
      <label htmlFor="analysis-client-message">{visionView ? "Pytanie do obrazu (opcjonalnie)" : "Wiadomość klienta"}</label>
      <textarea onKeyDown={submitOnEnter} id="analysis-client-message" rows={7} value={clientMessage} onChange={(event) => setClientMessage(event.target.value)} onPaste={(event) => { if (!attachments.paste(event)) pasteMessage(event, setClientMessage); }} disabled={busy} placeholder={visionView ? "Domyślnie: opis obrazu w trzech konkretnych punktach…" : "Wklej wiadomość klienta…"} />
      <ImageAttachments attachments={attachments} disabled={busy} />
      <fieldset className="provider-toggles" disabled={busy}>
        <legend>Analizuj przez</legend>
        <label><input type="checkbox" checked={active.openrouter} disabled={!enabled.openrouter} onChange={(event) => setActive((previous) => ({ ...previous, openrouter: event.target.checked }))} /> OpenRouter</label>
        <label><input type="checkbox" checked={active.google} disabled={!enabled.google} onChange={(event) => setActive((previous) => ({ ...previous, google: event.target.checked }))} /> Gemini</label>
      </fieldset>
      <div className="analysis-action-bar">
        {modeButtons}
      <button type="submit" disabled={busy || !activeCount || attachments.reading || (!clientMessage.trim() && !attachments.files.length)}>{busy ? "Analizowanie…" : attachments.files.length ? "Analizuj zdjęcie" : "Analizuj wiadomość"}</button>
    <div className="analysis-copy-controls">
      <CopyButton text={formatCombinedConversation(openrouter.messages, google.messages, false, { openrouter: openrouter.responseTimes, google: google.responseTimes })} html={formatCombinedConversation(openrouter.messages, google.messages, false, { openrouter: openrouter.responseTimes, google: google.responseTimes }, true)} label="Kopiuj całość" />
      <CopyButton text={formatCombinedConversation(openrouter.messages, google.messages, true, { openrouter: openrouter.responseTimes, google: google.responseTimes })} html={formatCombinedConversation(openrouter.messages, google.messages, true, { openrouter: openrouter.responseTimes, google: google.responseTimes }, true)} label="Kopiuj całość z JSON" />
      <button type="button" className="copy-button clear-chat-button" disabled={busy || (!openrouter.messages.length && !google.messages.length && !openrouter.error && !google.error)} onClick={() => { openrouter.clearConversation(); google.clearConversation(); setLastAnalysisWasImage(false); }}>Wyczyść</button>
    </div>
      </div>
    </form>
    {!activeCount && <p className="chat-feedback">Włącz przynajmniej jeden model.</p>}
    <div className="analysis-results" data-count={activeCount}>
      {([["openrouter", openrouter, "MAX · OpenRouter"], ["google", google, "MAX · Gemini"]] as const).filter(([provider]) => active[provider]).map(([provider, chat, title]) => {
        const reply = [...chat.messages].reverse().find((message) => message.role === "assistant");
        const result = reply && messageResult(reply);
        const analyzedMessage = [...chat.messages].reverse().find((message) => message.role === "user");
        const analyzedImages = analyzedMessage ? messageImageUrls(analyzedMessage) : [];
        const isVisionResult = analyzedImages.length > 0;
        const preview = reply?.parts.find((part) => part.type === "data-chat-preview");
        const previewText = chat.isBusy && preview && "data" in preview && typeof preview.data === "string" ? preview.data : "";
        return <article className="chat-panel analysis-panel" key={provider} aria-label={`Analiza: ${title}`}>
          <PanelHeading title={title} modelName={modelNames[provider]} chat={chat} responseTime={reply ? chat.responseTimes[reply.id] : undefined}>
            <CopyButton text={result && reply ? formatMessage(reply, title, false, chat.responseTimes[reply.id]) : ""} />
            <CopyButton text={result && reply ? formatMessage(reply, title, true, chat.responseTimes[reply.id]) : ""} label="Kopiuj z JSON" />
            <button type="button" className="copy-button" disabled={chat.isBusy || !chat.messages.length} onClick={chat.clearConversation}>Wyczyść</button>
          </PanelHeading>
          <div className="analysis-result-body" aria-live="polite" aria-busy={chat.isBusy}>
            <div className="analyzed-image-list">{analyzedImages.map((url, index) => <AnalyzedImage key={`${analyzedMessage?.id}-${index}`} url={url} index={index} />)}</div>
            {result ? <>
              {!isVisionResult && <dl className="analysis-metadata">
                <div><dt>Kategoria</dt><dd>{result.category}</dd></div>
                <div><dt>Priorytet</dt><dd>{result.priority}</dd></div>
                <div><dt>Sprawdzenie</dt><dd>{result.needs_review ? "Wymagane" : "Niewymagane"}</dd></div>
              </dl>}
              <h3>{isVisionResult ? "Opis zdjęcia" : "Szkic odpowiedzi"}</h3><p className="analysis-draft">{result.draft}</p>
              {!isVisionResult && <p className="message-metadata">To nadal szkic, także gdy sprawdzenie nie jest wymagane.</p>}
              {reply && <ActualModel message={reply} />}
              {reply && <UsedTools message={reply} />}
              {reply && <Sources message={reply} />}
              <div className="message-json message-metadata"><details><summary>JSON</summary><pre>{JSON.stringify(result, null, 2)}</pre></details><CopyButton text={JSON.stringify(result, null, 2)} /></div>
            </> : chat.isBusy ? <><p>MAX myśli… sprawdza wiadomość…</p><p className="analysis-draft">{previewText}</p><small>Wynik w trakcie sprawdzania.</small></>
              : !chat.error && <p className="message-metadata">Tutaj pojawi się wynik analizy.</p>}
            {chat.error && <div className="chat-feedback chat-error chat-retry" role="alert"><span>{chat.error.message.startsWith("MAX:") ? chat.error.message : "Analiza została przerwana lub wystąpił błąd dostawcy."}</span><button type="button" className="copy-button" disabled={chat.isBusy} onClick={() => void chat.retryLastRequest()}>Ponów</button></div>}
          </div>
        </article>;
      })}
    </div>
  </section>;
}

function GeneratorPromptDetails({ label, text }: { label: string; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <section className="generator-prompt-details">
    <button type="button" className="generator-prompt-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((previous) => !previous)}><strong>{expanded ? "▾" : "▸"} {label}</strong></button>
    <p id={id} className={expanded ? undefined : "is-collapsed"}>{text}</p>
    {expanded && <CopyButton text={text} />}
  </section>;
}

function CalendarDetails({ data }: { data: unknown }) {
  const text = calendarDetailsText(data);
  return text ? <details className="message-metadata image-effective-prompt"><summary>Wydarzenia i uwagi</summary><pre>{text}</pre><CopyButton text={text} /></details> : null;
}

function GeneratorPicture({ picture, onRemove, onDescription }: { picture: UIMessage; onRemove: () => void; onDescription: (provider: Provider, reply: UIMessage) => void }) {
  const images = messageImageUrls(picture);
  const generated = picture.parts.find((part) => part.type === "data-generated-image");
  const prompt = generated && "data" in generated && generated.data && typeof generated.data === "object" && "prompt" in generated.data && typeof generated.data.prompt === "string" ? generated.data.prompt : clientMessageText(picture).replace(/^Opis:\s*/i, "");
  const userPrompt = generated && "data" in generated && generated.data && typeof generated.data === "object" && "userPrompt" in generated.data && typeof generated.data.userPrompt === "string" ? generated.data.userPrompt : undefined;
  const hybridCalendar = generated && "data" in generated && generated.data && typeof generated.data === "object" && "renderer" in generated.data && generated.data.renderer === "calendar-hybrid";
  const isCalendar = hybridCalendar || generated && "data" in generated && generated.data && typeof generated.data === "object" && "renderer" in generated.data && generated.data.renderer === "calendar-code";
  const requestedBy = generated && "data" in generated && generated.data && typeof generated.data === "object" && "requestedBy" in generated.data ? generated.data.requestedBy : undefined;
  const requesterName = requestedBy === "openrouter" ? "MAX · OpenRouter" : requestedBy === "google" ? "MAX · Gemini" : "Generator";
  const effectivePrompt = generated && "data" in generated && generated.data && typeof generated.data === "object" && "effectivePrompt" in generated.data && typeof generated.data.effectivePrompt === "string" ? generated.data.effectivePrompt : undefined;
  const openrouter = useMaxChat("openrouter", "chat", `generator-vision-openrouter-${picture.id}`, undefined, (reply) => onDescription("openrouter", reply));
  const google = useMaxChat("google", "chat", `generator-vision-google-${picture.id}`, undefined, (reply) => onDescription("google", reply));
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const preparingRef = useRef(false);
  const busy = preparing || openrouter.isBusy || google.isBusy;
  useEffect(() => () => { void openrouter.stop(); void google.stop(); }, [openrouter.stop, google.stop]);
  async function describe(provider: Provider) {
    if (busy || preparingRef.current || !images[0]) return;
    preparingRef.current = true; setPreparing(true); setError("");
    try {
      const blob = await (await fetch(images[0])).blob();
      const file = await prepareImagePart(new File([blob], "wygenerowany-obraz", { type: blob.type }));
      const chat = provider === "openrouter" ? openrouter : google;
      chat.clearConversation();
      await chat.sendText(DEFAULT_VISION_QUESTION, undefined, Date.now(), [file]);
    } catch (error) { setError(error instanceof Error ? error.message : "Nie udało się opisać obrazu."); }
    finally { preparingRef.current = false; setPreparing(false); }
  }
  const text = formatMessage(picture, "Generator");
  return <article className="chat-panel generator-result">
    <h3 className="generator-requester">Zlecił: {requesterName}</h3>
    {userPrompt !== undefined ? <GeneratorPromptDetails label={userPrompt === prompt ? "Twoje polecenie — przekazane bez zmian" : "Twoje polecenie"} text={userPrompt} /> : <p className="message-metadata">Twoje polecenie: brak zapisu dla starszego wyniku.</p>}
    {userPrompt !== prompt && <GeneratorPromptDetails label={isCalendar ? "Kalendarz wyliczony przez aplikację" : "Opis przygotowany przez AI"} text={prompt} />}
    {images.map((url, index) => <figure className="message-image-wrap" key={index}>
      <img className="generated-image" src={url} alt={prompt} />
      <div className="generator-actions"><CopyButton text={text} html={formatMessageHtml(picture, "Generator")} imageUrl={images.length === 1 ? url : undefined} /><CopyButton text="" imageUrl={url} imageOnly label="Kopiuj obraz" /><SaveImageButton imageUrl={url} description={prompt} label="Pobierz" /><button type="button" className="copy-button" onClick={onRemove}>Usuń</button></div>
    </figure>)}
    {isCalendar ? <><small className="message-metadata">{hybridCalendar ? "Ilustracja: AI. Daty i czytelne podpisy: kod aplikacji." : "Wykonanie: kod aplikacji — poprawna siatka dni, bez modelu graficznego."} Święta nie są oznaczone.</small>{hybridCalendar && <ActualModel message={picture} />}</> : <ActualModel message={picture} />}
    {generated && "data" in generated && <CalendarDetails data={generated.data} />}
    <Sources message={picture} />
    {effectivePrompt && <details className="message-metadata image-effective-prompt"><summary>Pełny opis ze stylem MAX</summary><pre>{effectivePrompt}</pre><CopyButton text={effectivePrompt} /></details>}
    <div className="generator-actions"><button type="button" className="copy-button" disabled={busy} onClick={() => void describe("openrouter")}>Opisz — OpenRouter</button><button type="button" className="copy-button" disabled={busy} onClick={() => void describe("google")}>Opisz — Gemini</button></div>
    {error && <p className="questions-error" role="alert">{error}</p>}
    {busy && <p className="message-metadata" role="status">Analizuję obraz…</p>}
    {([["openrouter", openrouter, "OpenRouter"], ["google", google, "Gemini"]] as const).map(([provider, chat, title]) => {
      const reply = [...chat.messages].reverse().find((message) => message.role === "assistant");
      const result = reply && messageResult(reply);
      const saved = picture.parts.find((part) => part.type === "data-vision-description" && part.data && typeof part.data === "object" && "provider" in part.data && part.data.provider === provider);
      const savedData = saved && "data" in saved && saved.data && typeof saved.data === "object" ? saved.data as Record<string, unknown> : undefined;
      const draft = result?.draft ?? (typeof savedData?.draft === "string" ? savedData.draft : "");
      if (!draft && !chat.error) return null;
      return <div className="generator-vision-result" key={provider}>
        <h3>Opis zdjęcia — {title}</h3>
        {draft && <p>{draft}</p>}
        {result && reply ? <><ActualModel message={reply} /><CopyButton text={formatMessage(reply, title)} /></> : draft && <small className="message-metadata">Model: {typeof savedData?.modelId === "string" ? savedData.modelId : "dostawca nie potwierdził identyfikatora"}</small>}
        {chat.error && <p className="questions-error" role="alert">{chat.error.message}</p>}
      </div>;
    })}
  </article>;
}

function ChatPanel({ chat, title, modelName, mode, dueling, canDuel, onStartDuel, onSendText, generating, generationError }: {
  chat: MaxChat;
  title: string;
  modelName?: string;
  mode: "chat" | "analysis";
  dueling: boolean;
  canDuel: boolean;
  onStartDuel: (text: string) => boolean;
  onSendText: (text: string, files: FileUIPart[]) => Promise<void>;
  generating: boolean;
  generationError: string;
}) {
  const [draft, setDraft] = useState("");
  const attachments = useImageAttachments();
  const conversationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const area = conversationRef.current;
    if (area) area.scrollTop = area.scrollHeight;
  }, [chat.messages, chat.status]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((!draft.trim() && !attachments.files.length) || chat.isBusy || dueling || generating || attachments.reading) return;
    void onSendText(draft.trim(), attachments.files);
    setDraft("");
    attachments.clear();
  }

  return <div className="chat-panel">
    <PanelHeading title={title} modelName={modelName} chat={chat}>
      <CopyButton text={formatConversation(chat.messages, title, false, chat.responseTimes)} html={formatConversation(chat.messages, title, false, chat.responseTimes, true)} label="Kopiuj czat" /><CopyButton text={formatConversation(chat.messages, title, true, chat.responseTimes)} html={formatConversation(chat.messages, title, true, chat.responseTimes, true)} label="Kopiuj czat z JSON" /><button type="button" className="copy-button clear-chat-button" disabled={chat.isBusy || dueling || generating || (!chat.messages.length && !chat.error)} aria-label={`Wyczyść ${title}`} onClick={() => { if (!chat.isBusy && !dueling) chat.clearConversation(); }}>Wyczyść</button>
    </PanelHeading>
    <section ref={conversationRef} className="conversation" role="log" aria-label={`Rozmowa: ${title}`} aria-live="polite" aria-busy={chat.isBusy}>
      {chat.messages.map((item) => {
        const result = messageResult(item);
        const images = messageImageUrls(item);
        const canCopy = Boolean(clientMessageText(item).trim() || images.length);
        const singleImage = images.length === 1 ? images[0] : undefined;
        const isAnalysis = item.parts.some((part) => part.type === "data-chat-mode" && part.data === "analysis");
        const preview = item.parts.find((part) => part.type === "data-chat-preview");
        const previewText = chat.isBusy && item === chat.messages.at(-1) && preview && "data" in preview && typeof preview.data === "string" ? preview.data : "";
        const presentation = item.role === "assistant" && !result ? assistantPresentation(messageText(item)) : { text: messageText(item), category: undefined, review: undefined };
        return <div className="conversation-entry" key={item.id}><div className={`message message-${item.role}`}>
          <div className="message-heading"><span className="message-author">{item.role === "user" ? "Ty" : title}{item.role === "assistant" && <ResponseTime milliseconds={chat.responseTimes[item.id]} />}</span><div className="message-copy-controls"><CopyButton text={canCopy ? formatMessage(item, title, false, chat.responseTimes[item.id]) : ""} html={canCopy ? formatMessageHtml(item, title, false, chat.responseTimes[item.id]) : undefined} imageUrl={singleImage} /><CopyButton text={canCopy ? formatMessage(item, title, true, chat.responseTimes[item.id]) : ""} html={canCopy ? formatMessageHtml(item, title, true, chat.responseTimes[item.id]) : undefined} imageUrl={singleImage} label="Kopiuj z JSON" /></div></div>
          {isAnalysis && <small className="message-metadata">Szkic odpowiedzi</small>}
          {item.role === "user" && images.map((url, index) => <AnalyzedImage key={index} url={url} index={index} />)}
          {item.role === "assistant" && <ToolBadges message={item} />}
          <span>{presentation.text || previewText}</span>
          {!chat.isBusy && !result && preview && <small className="message-metadata">Odpowiedź nie została zatwierdzona.</small>}
          {!result && previewText && <small className="message-metadata">Odpowiedź w trakcie sprawdzania…</small>}
          {result ? <small className="message-metadata">{isAnalysis
            ? `Kategoria: ${result.category} · Priorytet: ${result.priority} · Sprawdzenie: ${result.needs_review ? "wymagane" : "niewymagane"} — nadal szkic`
            : `${result.category} · ${result.priority} · ${String(result.needs_review)}`}</small>
            : (presentation.category || presentation.review) && <small className="message-metadata">{[presentation.category, presentation.review].filter(Boolean).join(" · ")}</small>}
          {item.role === "assistant" && images.map((url, index) => <figure className="message-image-wrap" key={index}><ChatImagePreview url={url} /><CopyButton text="" imageUrl={url} imageOnly label="Kopiuj obraz" /><SaveImageButton imageUrl={url} description={clientMessageText(item)} />{(() => { const part = item.parts.find((part) => part.type === "data-generated-image" && part.data && typeof part.data === "object" && "imageUrl" in part.data && part.data.imageUrl === url); const data = part && "data" in part ? part.data as Record<string, unknown> : undefined; return data && <figcaption className="message-metadata">{data.renderer === "calendar-hybrid" ? `Ilustracja AI: ${typeof data.modelId === "string" ? data.modelId : "dostawca nie podał modelu"}. Daty i podpisy: kod aplikacji.` : data.renderer === "calendar-code" ? "Wykonanie: kod aplikacji — poprawna siatka dni. Wyróżniono weekendy; święta nie są oznaczone." : `Model obrazu: ${typeof data.modelId === "string" ? data.modelId : "dostawca nie podał"}`}</figcaption>; })()}</figure>)}
          {item.role === "assistant" && item.parts.filter((part) => part.type === "data-generated-image").map((part, index) => <CalendarDetails key={index} data={"data" in part ? part.data : undefined} />)}
          {item.role === "assistant" && <ActualModel message={item} />}
          {item.role === "assistant" && <UsedTools message={item} />}
          {item.role === "assistant" && clientMessageText(item).trim() && <Sources message={item} />}
          {result && <div className="message-json message-metadata"><details><summary>JSON</summary><pre>{JSON.stringify(result, null, 2)}</pre></details><CopyButton text={JSON.stringify(result, null, 2)} /></div>}
          {item.role === "assistant" && <TimingDetails message={item} />}
        </div></div>;
      })}
    </section>
    <div className="panel-feedback">
      {generating && <p className="chat-feedback" role="status">Generuję obraz…</p>}
      {generationError && <p className="chat-feedback chat-error" role="alert">{generationError}</p>}
      {chat.isBusy && <p className="chat-feedback" role="status">{chat.status === "submitted" ? "MAX budzi się w krypcie…" : "MAX pisze z zaświatów…"}</p>}
      {chat.error && <div className="chat-feedback chat-error chat-retry" role="alert"><span>{chat.error.message.startsWith("MAX:") ? chat.error.message : "Nie udało się połączyć z MAX-em. Sprawdź połączenie i spróbuj ponownie."}</span><button type="button" className="copy-button" disabled={chat.isBusy || dueling || generating || !chat.messages.some((message) => message.role === "user")} onClick={() => { if (!dueling) void chat.retryLastRequest(); }}>Ponów</button></div>}
    </div>
    <form onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor={`draft-${chat.id}`}>Wiadomość do {title}</label>
      <textarea rows={2} onKeyDown={submitOnEnter} id={`draft-${chat.id}`} placeholder="Napisz do tego MAX-a…" value={draft} onChange={(event) => setDraft(event.target.value)} onPaste={(event) => { if (!attachments.paste(event)) pasteMessage(event, setDraft); }} disabled={chat.isBusy || dueling || generating} autoComplete="off" />
      <div className="chat-actions">
        <button type="submit" disabled={(!draft.trim() && !attachments.files.length) || chat.isBusy || dueling || generating || attachments.reading}>{mode === "analysis" ? "Analizuj" : "Ślij"}</button>
        <button type="button" className="secondary-button" disabled={mode === "analysis" || !draft.trim() || !canDuel || dueling || attachments.reading || attachments.files.length > 0} title="Zaczyna ten MAX. Oba czaty muszą być aktywne i gotowe." onClick={() => {
          if (onStartDuel(draft.trim())) setDraft("");
        }}>Pojedynek!</button>
      </div>
      <ImageAttachments attachments={attachments} disabled={chat.isBusy || dueling || generating} />

    </form>
  </div>;
}

function QuestionPicker({ questions, value, onChange, disabled, inputRef, onPaste }: { questions: string[]; value: string; onChange: (value: string) => void; disabled: boolean; inputRef: RefObject<HTMLTextAreaElement | null>; onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void }) {
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
    <textarea rows={2} ref={inputRef} id="shared-question" role="combobox" aria-expanded={expanded} aria-controls="test-questions" aria-autocomplete="list" aria-activedescendant={expanded && highlighted >= 0 ? `test-question-${highlighted}` : undefined}
      value={value} onFocus={() => { setOpen(true); setFilter(false); }} onChange={(event) => { onChange(event.target.value); setFilter(true); setOpen(true); setHighlighted(-1); }}
      onPaste={onPaste}
      onKeyDown={(event) => {
        if (event.key === "Escape") { setOpen(false); setHighlighted(-1); }
        if ((expanded || event.altKey) && (event.key === "ArrowDown" || event.key === "ArrowUp") && questions.length) {
          event.preventDefault(); setOpen(true);
          const next = event.key === "ArrowDown" ? Math.min(highlighted + 1, visible.length - 1) : Math.max(highlighted - 1, 0);
          setHighlighted(next);
          document.getElementById(`test-question-${next}`)?.scrollIntoView({ block: "nearest" });
        }
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
          if (expanded && highlighted >= 0 && visible[highlighted]) { event.preventDefault(); choose(visible[highlighted]); }
          else { setOpen(false); submitOnEnter(event); }
        }
      }}
      placeholder={questions.length ? "Wpisz wiadomość lub wybierz z listy propozycji" : "Wpisz wiadomość do zaznaczonych czatów…"} disabled={disabled} autoComplete="off" />
    {value && <button type="button" className="clear-question" aria-label="Wyczyść wiadomość" title="Wyczyść" disabled={disabled} onClick={() => { onChange(""); setFilter(false); setHighlighted(-1); inputRef.current?.focus(); }}>×</button>}
    {questions.length > 0 && <button type="button" className="toggle-questions" aria-label={expanded ? "Zwiń pytania" : "Rozwiń pytania"} aria-expanded={expanded} aria-controls="test-questions" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => { setOpen(!expanded); setFilter(false); setHighlighted(-1); }}>▾</button>}
    {expanded && <ul id="test-questions" className="question-options" role="listbox" aria-label="Pytania testowe">
      {visible.map((question, index) => <li key={question} id={`test-question-${index}`} role="option" aria-selected={highlighted === index} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(question)}>{question}</li>)}
      {!visible.length && <li className="no-questions" role="presentation">Brak pasujących pytań — możesz wysłać własną wiadomość.</li>}
    </ul>}
  </div>;
}

export default function ChatArena({ enabled, modelNames = {}, roundsPerBatch = 5, appInfo, testQuestions = { questions: [], invalid: false } }: { enabled: EnabledProviders; modelNames?: ModelNames; roundsPerBatch?: number; appInfo: AppInfo; testQuestions?: { questions: string[]; invalid: boolean } }) {
  const [mode, setMode] = useState<"chat" | "analysis" | "generator">("chat");
  const [generatingImage, setGeneratingImage] = useState(false);
  const [imageError, setImageError] = useState("");
  const [generatorPrompt, setGeneratorPrompt] = useState("");
  const [exactImagePrompt, setExactImagePrompt] = useState(false);
  const [generatedPictures, setGeneratedPictures] = useState<UIMessage[]>([]);
  const imageGenerating = useRef(false);
  const archivedAgentImages = useRef(new Set<string>());
  const sharedAttachments = useImageAttachments();
  const [location, setLocation] = useState<WeatherLocation>();
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [pendingWeather, setPendingWeather] = useState<{ question: string; targets: EnabledProviders } | null>(null);
  const [customWeatherCity, setCustomWeatherCity] = useState("");
  const openrouter = useMaxChat("openrouter", "chat", "openrouter", location);
  const google = useMaxChat("google", "chat", "google", location);
  const generatorRouter = useMaxChat("openrouter", "chat", "generator-openrouter", location);
  const generatorGoogle = useMaxChat("google", "chat", "generator-google", location);
  useEffect(() => {
    const pictures = ([["openrouter", openrouter.messages], ["google", google.messages], ["openrouter", generatorRouter.messages], ["google", generatorGoogle.messages]] as const).flatMap(([requestedBy, messages]) => messages.flatMap((message, messageIndex) => message.parts.flatMap((part, index) => {
      if (part.type !== "data-generated-image" || !part.data || typeof part.data !== "object") return [];
      const data = part.data as Record<string, unknown>;
      const precedingUser = [...messages.slice(0, messageIndex)].reverse().find((item) => item.role === "user");
      const originalMetadata = precedingUser?.metadata as { originalImagePrompt?: unknown } | undefined;
      const userPrompt = typeof data.userPrompt === "string" ? data.userPrompt : typeof originalMetadata?.originalImagePrompt === "string" ? originalMetadata.originalImagePrompt : precedingUser ? clientMessageText(precedingUser) : undefined;
      const id = `agent-${requestedBy}-${message.id}-${index}`;
      if (typeof data.imageUrl !== "string" || archivedAgentImages.current.has(id)) return [];
      archivedAgentImages.current.add(id);
      return [{ id, role: "assistant" as const, parts: [
        { type: "text" as const, text: userPrompt === data.prompt ? `Twoje polecenie — przekazane bez zmian: ${userPrompt}` : `${userPrompt !== undefined ? `Twoje polecenie: ${userPrompt}\n` : ""}${data.renderer === "calendar-code" ? "Kalendarz wyliczony przez aplikację" : "Opis przygotowany przez AI"}: ${typeof data.prompt === "string" ? data.prompt : "Wygenerowana grafika"}` },
        { ...part, data: { ...data, requestedBy, userPrompt } },
        ...(data.renderer === "calendar-code" ? [] : [{ type: "data-response-model" as const, data: { modelId: typeof data.modelId === "string" ? data.modelId : null } }]),
        ...(Array.isArray(data.sources) ? data.sources.flatMap((source) => source && typeof source.url === "string" && /^https:\/\//.test(source.url) && typeof source.title === "string" && typeof source.fetchedAt === "string" ? [
          { type: "source-url" as const, sourceId: source.url, url: source.url, title: source.title },
          { type: "data-source-fetched" as const, data: { sourceId: source.url, fetchedAt: source.fetchedAt } },
        ] : []) : []),
      ] }];
    })));
    if (pictures.length) setGeneratedPictures((previous) => {
      const ids = new Set(previous.map((picture) => picture.id));
      const fresh = pictures.filter((picture) => !ids.has(picture.id));
      return fresh.length ? [...fresh, ...previous] : previous;
    });
  }, [openrouter.messages, google.messages, generatorRouter.messages, generatorGoogle.messages]);
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
  const sharedInput = useRef<HTMLTextAreaElement>(null);
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
  const busy = openrouter.isBusy || google.isBusy || generatingImage;
  const activeCount = Number(active.openrouter) + Number(active.google);
  const sharedDisabled = busy || dueling || sendingShared || sharedAttachments.reading || activeCount === 0;
  const weatherRequested = Boolean(pendingWeather);

  function clearAllConversations() {
    if (busy || duelController.current || sharedSending.current) return;
    openrouter.clearConversation();
    google.clearConversation();
    setPendingWeather(null);
    setCustomWeatherCity("");
    sharedAttachments.clear();
    setImageError("");
    setTurns(0);
    setDuelError("");
    setBatchQuestion(false);
    setPaused(false);
  }

  async function generatePicture(value: string) {
    if (busy || dueling || analysisBusy || imageGenerating.current || !activeCount) return;
    const prompt = value.replace(/^\s*Wygeneruj obraz\s*:\s*/i, "").trim();
    if (!prompt || prompt.length > 500) { setImageError("Opis obrazu musi mieć od 1 do 500 znaków."); return; }
    imageGenerating.current = true; setGeneratingImage(true); setImageError("");
    try {
      await broadcastMessage(`Wygeneruj obraz: ${prompt}`, active, {
        openrouter: async (text) => { generatorRouter.clearConversation(); await generatorRouter.sendText(text, undefined, Date.now(), [], value, exactImagePrompt); },
        google: async (text) => { generatorGoogle.clearConversation(); await generatorGoogle.sendText(text, undefined, Date.now(), [], value, exactImagePrompt); },
      });
    } catch (error) { setImageError(error instanceof Error ? error.message : "MAX: Nie udało się wygenerować obrazu."); }
    finally { imageGenerating.current = false; setGeneratingImage(false); }
  }

  async function sendShared(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendSharedText(sharedDraft);
  }

  async function submitToChats(text: string, targets: EnabledProviders, files: FileUIPart[] = []) {
    if (sharedDisabled || sharedSending.current) return;
    const selected = { openrouter: targets.openrouter && active.openrouter, google: targets.google && active.google };
    if (!selected.openrouter && !selected.google) return;
    sharedSending.current = true;
    setSendingShared(true);
    const sharedTurnId = crypto.randomUUID();
    const sentAt = Date.now();
    setPendingWeather(null);
    setSharedDraft("");
    sharedAttachments.clear();
    try {
      await broadcastMessage(text, selected, {
        openrouter: (value) => openrouter.sendText(value, sharedTurnId, sentAt, files),
        google: (value) => google.sendText(value, sharedTurnId, sentAt, files),
      });
    } finally { sharedSending.current = false; setSendingShared(false); }
  }

  async function sendSharedText(value: string) {
    if ((!value.trim() && !sharedAttachments.files.length) || sharedDisabled || sharedSending.current) return;
    if (sharedAttachments.files.length) { await submitToChats(value.trim() || "Opisz załączone zdjęcie.", active, sharedAttachments.files); return; }
    if (pendingWeather && /^(?:Radom|Warszawa|Zakopane|Gdańsk)$/i.test(value.trim())) { await chooseWeatherCity(value); return; }
    await sendWithWeatherLocation(value, Boolean(location), (question) => {
      setPendingWeather({ question, targets: { ...active } });
      setSharedDraft("");
    }, (question) => submitToChats(question, active));
  }

  async function sendPanelText(provider: Provider, value: string, files: FileUIPart[] = []) {
    if ((provider === "openrouter" ? openrouter : google).isBusy || dueling || sharedSending.current) return;
    if (files.length) { setPendingWeather(null); await (provider === "openrouter" ? openrouter : google).sendText(value.trim() || "Opisz załączone zdjęcie.", undefined, Date.now(), files); return; }
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
    <button type="button" className="chat-mode-button" aria-pressed={mode === "generator"} disabled={busy || dueling || sendingShared || analysisBusy} onClick={() => setMode("generator")}>Generator</button>
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
      <section hidden={mode !== "generator"} className="generator-workspace" aria-labelledby="generator-title">
        <h2 id="generator-title">Generator grafiki</h2>
        <p className="message-metadata">Styl marki MAX · stosowany automatycznie</p>
        <form className="analysis-form" onSubmit={(event) => { event.preventDefault(); void generatePicture(generatorPrompt); }}>
          <label htmlFor="generator-prompt">Opis obrazu</label>
          <textarea onKeyDown={submitOnEnter} id="generator-prompt" rows={2} maxLength={500} value={generatorPrompt} disabled={generatingImage} onChange={(event) => setGeneratorPrompt(event.target.value)} placeholder="Opisz grafikę, którą chcesz wygenerować…" />
          <small className="message-metadata">{generatorPrompt.length}/500 znaków</small>
          <div className="image-prompt-suggestions" aria-label="Podpowiedzi opisów grafiki">{imagePrompts.prompts.map((item) => <button key={item.label} type="button" className="copy-button" disabled={generatingImage} onClick={() => setGeneratorPrompt(item.prompt)}>{item.label}</button>)}</div>
          <fieldset className="provider-toggles" disabled={busy || dueling || analysisBusy || generatingImage}>
            <legend>Zleć generowanie przez</legend>
            <label><input type="checkbox" checked={active.openrouter} disabled={!enabled.openrouter} onChange={(event) => setActive((previous) => ({ ...previous, openrouter: event.target.checked }))} /> OpenRouter</label>
            <label><input type="checkbox" checked={active.google} disabled={!enabled.google} onChange={(event) => setActive((previous) => ({ ...previous, google: event.target.checked }))} /> Gemini</label>
          </fieldset>
          <small className="message-metadata">Każde zaznaczone AI zleca osobny obraz. Wybór jest wspólny z czatem.</small>
          <label className="exact-image-prompt"><input type="checkbox" checked={exactImagePrompt} disabled={busy || generatingImage || analysisBusy || dueling} onChange={(event) => setExactImagePrompt(event.target.checked)} /> Przekaż mój tekst bez zmian</label>
          {exactImagePrompt && <small className="message-metadata">Oba AI przekażą identyczny tekst. Styl MAX jest dodawany jednakowo.</small>}
          <div className="generator-actions">
            <button type="submit" className="generate-image-button" disabled={busy || dueling || analysisBusy || generatingImage || !activeCount || !generatorPrompt.trim()}>{generatingImage ? "Generuję obraz…" : "Generuj"}</button>
            <button type="button" className="copy-button" disabled={generatingImage} onClick={() => setGeneratorPrompt((testQuestions.questions.find((question) => /^Wygeneruj obraz:/i.test(question)) ?? "Wygeneruj obraz: Artystyczna czaszka wampira, dwa kolory, czarne tło").replace(/^Wygeneruj obraz:\s*/i, ""))}>Wstaw przykład</button>
          </div>
          {imageError && <p className="questions-error" role="alert">{imageError}</p>}
          {generatorRouter.error && <p className="questions-error" role="alert">OpenRouter: {generatorRouter.error.message}</p>}
          {generatorGoogle.error && <p className="questions-error" role="alert">Gemini: {generatorGoogle.error.message}</p>}
        </form>
        <div className="generator-toolbar">
          <div className="generator-actions">{generatedPictures.length > 0 && <>
            <CopyButton text={formatConversation(generatedPictures, "Generator")} html={formatConversation(generatedPictures, "Generator", false, {}, true)} label="Kopiuj całość" />
            <button type="button" className="copy-button" disabled={generatingImage} onClick={() => setGeneratedPictures([])}>Wyczyść</button>
          </>}</div>
          {modeButtons}
        </div>
        <div className="generator-results" role="log" aria-label="Wygenerowane grafiki" aria-busy={generatingImage}>
          {generatedPictures.map((picture) => <GeneratorPicture key={picture.id} picture={picture} onRemove={() => setGeneratedPictures((previous) => previous.filter((item) => item.id !== picture.id))} onDescription={(provider, reply) => {
            const result = messageResult(reply);
            if (!result) return;
            setGeneratedPictures((previous) => previous.map((item) => item.id !== picture.id ? item : { ...item, parts: [...item.parts.filter((part) => !(part.type === "data-vision-description" && part.data && typeof part.data === "object" && "provider" in part.data && part.data.provider === provider)), { type: "data-vision-description", data: { provider, draft: result.draft, modelId: messageResponseModel(reply) ?? null } }] }));
          }} />)}
        </div>
      </section>
      <div hidden={mode !== "analysis"}>
        <AnalysisWorkspace active={active} enabled={enabled} modelNames={modelNames} setActive={setActive} onBusyChange={setAnalysisBusy} location={location} modeButtons={modeButtons} />
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
          <QuestionPicker questions={testQuestions.questions} value={sharedDraft} onChange={setSharedDraft} disabled={sharedDisabled} inputRef={sharedInput} onPaste={(event) => { if (!sharedAttachments.paste(event)) pasteMessage(event, setSharedDraft); }} />
          <button type="submit" disabled={sharedDisabled || (!sharedDraft.trim() && !sharedAttachments.files.length)}>{sendingShared ? "Czekaj…" : mode === "analysis" ? "Analizuj" : "Wyślij"}</button>

          <ImageAttachments attachments={sharedAttachments} disabled={sharedDisabled} />
        </form>
        <div className="copy-clear-controls">
          <CopyButton text={formatCombinedConversation(openrouter.messages, google.messages, false, { openrouter: openrouter.responseTimes, google: google.responseTimes })} html={formatCombinedConversation(openrouter.messages, google.messages, false, { openrouter: openrouter.responseTimes, google: google.responseTimes }, true)} label="Kopiuj całość" />
          <CopyButton text={formatCombinedConversation(openrouter.messages, google.messages, true, { openrouter: openrouter.responseTimes, google: google.responseTimes })} html={formatCombinedConversation(openrouter.messages, google.messages, true, { openrouter: openrouter.responseTimes, google: google.responseTimes }, true)} label="Kopiuj całość z JSON" />
          <button type="button" className="copy-button clear-chat-button" disabled={busy || dueling || sendingShared || (!openrouter.messages.length && !google.messages.length && !openrouter.error && !google.error && !turns && !duelError)} onClick={clearAllConversations}>Wyczyść całość</button>
        </div>
        {imageError && <p className="questions-error" role="alert">{imageError}</p>}
        {testQuestions.invalid && <p className="questions-error" role="alert">Nie można odczytać listy z config/test-questions.json. Sprawdź plik i format JSON. Nadal możesz wpisać własną wiadomość.</p>}
      </div>
      <div className="chat-grid" data-count={activeCount} style={{ "--chat-height": `${chatHeight}px` } as CSSProperties}>
        {active.openrouter && <ChatPanel generating={generatingImage} generationError={imageError} onSendText={(text, files) => sendPanelText("openrouter", text, files)} chat={openrouter} title="MAX · OpenRouter" modelName={modelNames.openrouter} mode={mode === "analysis" ? "analysis" : "chat"} dueling={dueling} canDuel={activeCount === 2 && !busy && !sendingShared} onStartDuel={(text) => startDuel("openrouter", text)} />}
        {active.google && <ChatPanel generating={generatingImage} generationError={imageError} onSendText={(text, files) => sendPanelText("google", text, files)} chat={google} title="MAX · Gemini" modelName={modelNames.google} mode={mode === "analysis" ? "analysis" : "chat"} dueling={dueling} canDuel={activeCount === 2 && !busy && !sendingShared} onStartDuel={(text) => startDuel("google", text)} />}
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
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); }
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
