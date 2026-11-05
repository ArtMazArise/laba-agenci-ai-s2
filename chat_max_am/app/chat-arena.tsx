"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent } from "react";

import { createDuelPause, runDuel } from "@/lib/duel";
import LogoutButton from "./logout-button";
import HauntedScene, { Skull } from "./haunted-scene";

const authenticatedFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.status === 401) window.location.replace("/");
  return response;
};

const transports = {
  openrouter: new DefaultChatTransport({ api: "/api/chat", body: { provider: "openrouter" }, fetch: authenticatedFetch }),
  google: new DefaultChatTransport({ api: "/api/chat", body: { provider: "google" }, fetch: authenticatedFetch }),
};

function useMaxChat(provider: "openrouter" | "google") {
  const lastReply = useRef<string | null>(null);
  const chat = useChat({
    id: provider,
    transport: transports[provider],
    onFinish: ({ message, isAbort, isError, isDisconnect }) => {
      lastReply.current = isAbort || isError || isDisconnect ? null : message.parts
        .filter((part) => part.type === "text").map((part) => part.text).join("");
    },
    onError: () => { lastReply.current = null; },
  });
  return {
    ...chat,
    isBusy: chat.status === "submitted" || chat.status === "streaming",
    async reply(text: string) {
      lastReply.current = null;
      await chat.sendMessage({ text }, { body: { mode: "duel" } });
      return lastReply.current;
    },
  };
}

type MaxChat = ReturnType<typeof useMaxChat>;
type Provider = "openrouter" | "google";
type EnabledProviders = Record<Provider, boolean>;

function ChatPanel({ chat, title, dueling, canDuel, onStartDuel }: {
  chat: MaxChat;
  title: string;
  dueling: boolean;
  canDuel: boolean;
  onStartDuel: (text: string) => boolean;
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
    void chat.sendMessage({ text: draft.trim() });
    setDraft("");
  }

  return <div className="chat-panel">
    <div className="chat-topbar"><span><Skull /> {title}</span><span className="status">{chat.isBusy ? "PRZYWOŁUJE SŁOWA…" : "KRYPTA OTWARTA"}</span></div>
    <section ref={conversationRef} className="conversation" role="log" aria-label={`Rozmowa: ${title}`} aria-live="polite" aria-busy={chat.isBusy}>
      {chat.messages.map((item) => <div className={`message message-${item.role}`} key={item.id}>
        <span className="message-author">{item.role === "user" ? "Wiadomość" : title}</span>
        {item.parts.map((part, index) => part.type === "text" ? <span key={index}>{part.text}</span> : null)}
      </div>)}
    </section>
    <div className="panel-feedback">
      {chat.isBusy && <p className="chat-feedback" role="status">{chat.status === "submitted" ? "MAX budzi się w krypcie…" : "MAX pisze z zaświatów…"}</p>}
      {chat.error && <p className="chat-feedback chat-error" role="alert">{chat.error.message.startsWith("MAX:") ? chat.error.message : "Nie udało się połączyć z MAX-em. Sprawdź połączenie i spróbuj ponownie."}</p>}
    </div>
    <form onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor={`draft-${chat.id}`}>Wiadomość do {title}</label>
      <input id={`draft-${chat.id}`} placeholder="Napisz do tego MAX-a…" value={draft} onChange={(event) => setDraft(event.target.value)} disabled={chat.isBusy || dueling} autoComplete="off" />
      <div className="chat-actions">
        <button type="submit" disabled={!draft.trim() || chat.isBusy || dueling}>Ślij</button>
        <button type="button" className="secondary-button" disabled={!draft.trim() || !canDuel || dueling} title="Zaczyna ten MAX. Oba czaty muszą być aktywne i gotowe." onClick={() => {
          if (onStartDuel(draft.trim())) setDraft("");
        }}>Pojedynek!</button>
      </div>
    </form>
  </div>;
}

export default function ChatArena({ enabled }: { enabled: EnabledProviders }) {
  const openrouter = useMaxChat("openrouter");
  const google = useMaxChat("google");
  const [dueling, setDueling] = useState(false);
  const [paused, setPaused] = useState(false);
  const [selection, setActive] = useState(enabled);
  const active = { openrouter: selection.openrouter && enabled.openrouter, google: selection.google && enabled.google };
  const [chatHeight, setChatHeight] = useState(600);
  const resizeStart = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  const pauseControl = useRef<ReturnType<typeof createDuelPause> | null>(null);
  const [turns, setTurns] = useState(0);
  const [duelError, setDuelError] = useState("");
  const duelController = useRef<AbortController | null>(null);
  const busy = openrouter.isBusy || google.isBusy;
  const activeCount = Number(active.openrouter) + Number(active.google);

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
    if (!text.trim() || busy || duelController.current || activeCount !== 2) return false;
    const controller = new AbortController();
    duelController.current = controller;
    const gate = createDuelPause();
    pauseControl.current = gate;
    setPaused(false);
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
      waitForResume: gate.wait,
    }).catch(() => {
      if (!controller.signal.aborted) setDuelError("Pojedynek zatrzymany: błąd lub brak odpowiedzi. Sprawdź komunikaty w oknach czatu.");
    }).finally(() => {
      if (duelController.current === controller) {
        duelController.current = null;
        pauseControl.current = null;
        setDueling(false);
        setPaused(false);
      }
    });
    return true;
  }

  return <>
    <HauntedScene />
    <main className="arena">
      <header>
        <LogoutButton beforeLogout={stopDuel} />
        <p className="eyebrow"><span /> PO DRUGIEJ STRONIE EKRANU</p>
        <h1>Jestem <span>MAX</span>, od AM</h1>
        <p className="subtitle">Twoja krypta. Wybierz jednego MAX-a lub zaproś obu do pojedynku.</p>
      </header>
      <div className="arena-controls">
        <fieldset className="provider-toggles" disabled={busy || dueling}>
          <legend>Aktywne czaty</legend>
          <label><input type="checkbox" checked={active.openrouter} disabled={!enabled.openrouter} onChange={(event) => setActive((previous) => ({ ...previous, openrouter: event.target.checked }))} /> OpenRouter{!enabled.openrouter && " · wyłączony w konfiguracji"}</label>
          <label><input type="checkbox" checked={active.google} disabled={!enabled.google} onChange={(event) => setActive((previous) => ({ ...previous, google: event.target.checked }))} /> Gemini{!enabled.google && " · wyłączony w konfiguracji"}</label>
        </fieldset>
      </div>
      <div className="chat-grid" data-count={activeCount} style={{ "--chat-height": `${chatHeight}px` } as CSSProperties}>
        {active.openrouter && <ChatPanel chat={openrouter} title="MAX · OpenRouter" dueling={dueling} canDuel={activeCount === 2 && !busy} onStartDuel={(text) => startDuel("openrouter", text)} />}
        {active.google && <ChatPanel chat={google} title="MAX · Gemini" dueling={dueling} canDuel={activeCount === 2 && !busy} onStartDuel={(text) => startDuel("google", text)} />}
      </div>
      <div className="duel-controls">
        <p className="duel-status" role="status">{dueling ? `${paused ? busy ? "Pauza po bieżącej odpowiedzi" : "Pojedynek wstrzymany" : "Pojedynek trwa"} · ukończone wypowiedzi: ${turns}` : activeCount === 0 ? "Włącz przynajmniej jeden czat powyżej." : activeCount === 1 ? "Tryb jednego czatu. Zaznacz drugi model, aby uruchomić pojedynek." : turns ? `Pojedynek zakończony · wypowiedzi: ${turns}` : "Wpisz temat pod wybranym czatem i kliknij Pojedynek! — ten MAX zacznie."}</p>
        <div className="duel-buttons">
          <button className="secondary-button" onClick={togglePause} disabled={!dueling}>{paused ? "Kontynuuj" : "Pauza"}</button>
          <button className="stop-button" onClick={stopDuel} disabled={!dueling && !busy}>Stop</button>
        </div>
        <p className="usage-note">Każda odpowiedź zużywa limit API; przy płatnych modelach także środki. Pojedynek trwa do zatrzymania, a historia rośnie z każdą turą.</p>
        {duelError && <p className="chat-feedback chat-error" role="alert">{duelError}</p>}
      </div>
      {activeCount > 0 && <div className="chat-resizer" role="slider" tabIndex={0} aria-label="Wysokość czatów" aria-orientation="vertical" aria-valuemin={360} aria-valuemax={1400} aria-valuenow={chatHeight} aria-valuetext={`${chatHeight} pikseli`} onPointerDown={beginResize} onPointerMove={resizeChats} onPointerUp={endResize} onPointerCancel={endResize} onLostPointerCapture={() => { resizeStart.current = null; }} onKeyDown={(event) => {
        if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          setChatHeight((height) => event.key === "Home" ? 360 : event.key === "End" ? 1400 : Math.min(1400, Math.max(360, height + (event.key === "ArrowUp" ? 20 : -20))));
        }
      }}><span />Przeciągnij, aby zmienić wysokość {activeCount === 2 ? "obu czatów" : "czatu"} · {chatHeight} px</div>}
      <p className="footer-note">Tylko Ty, mrok i dwa głosy z zaświatów.</p>
    </main>
  </>;
}
