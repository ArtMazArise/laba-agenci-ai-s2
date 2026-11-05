"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent } from "react";

import { createDuelPause, runDuel } from "@/lib/duel";
import { chatConfig } from "@/config/chat";

const transports = {
  openrouter: new DefaultChatTransport({ api: "/api/chat", body: { provider: "openrouter" } }),
  google: new DefaultChatTransport({ api: "/api/chat", body: { provider: "google" } }),
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

function Skull({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 100 110" fill="none" aria-hidden="true">
    <path d="M50 8C24 8 10 25 10 47c0 17 9 28 22 32v18h36V79c13-4 22-15 22-32C90 25 76 8 50 8Z" fill="currentColor" />
    <path d="M23 43c0-7 18-5 18 4s-18 16-18-4Zm54 0c0-7-18-5-18 4s18 16 18-4ZM50 59l-7 13h14Z" fill="#090a0c" />
    <path d="M41 83v15m9-15v15m9-15v15" stroke="#090a0c" strokeWidth="4" />
  </svg>;
}

function Skeleton({ className }: { className: string }) {
  return <div className={`skeleton ${className}`}>
    <Skull className="skeleton-head" />
    <svg className="skeleton-body" viewBox="0 0 160 290" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M80 10v104m-30 7 30 19 30-19M50 121l5 26h50l5-26M54 157l-17 59 8 60m61-119 17 59-8 60M45 276H28m87 0h17" />
      <g className="skeleton-arm"><path d="M49 22 24 70l-8 53m-5 0 5 12 8-12" /></g>
      <g className="skeleton-arm right-arm"><path d="m111 22 25 48 8 53m-8 0 8 12 5-12" /></g>
      <path d="M48 23Q80 4 112 23M48 39q32 23 64 0M49 58q31 23 62 0M53 78q27 21 54 0" strokeWidth="7" />
    </svg>
  </div>;
}

function ChatPanel({ chat, title, dueling }: { chat: MaxChat; title: string; dueling: boolean }) {
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
      <button type="submit" disabled={!draft.trim() || chat.isBusy || dueling}>Ślij</button>
    </form>
    {chat.isBusy && !dueling && <button className="panel-stop" onClick={() => void chat.stop()}>Zatrzymaj odpowiedź</button>}
  </div>;
}

export default function Home() {
  const openrouter = useMaxChat("openrouter");
  const google = useMaxChat("google");
  const [message, setMessage] = useState("");
  const [dueling, setDueling] = useState(false);
  const [paused, setPaused] = useState(false);
  const [selection, setActive] = useState({ openrouter: chatConfig.openrouter.enabled, google: chatConfig.google.enabled });
  const active = { openrouter: selection.openrouter && chatConfig.openrouter.enabled, google: selection.google && chatConfig.google.enabled };
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

  function sendBoth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim() || busy || duelController.current || activeCount === 0) return;
    const text = message.trim();
    setMessage("");
    if (active.openrouter) void openrouter.sendMessage({ text });
    if (active.google) void google.sendMessage({ text });
  }

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

  async function startDuel() {
    if (!message.trim() || busy || duelController.current || activeCount !== 2) return;
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
    const initialPrompt = message.trim();
    setMessage("");
    try {
      await runDuel({
        initialPrompt,
        responders: [openrouter.reply, google.reply],
        signal: controller.signal,
        onTurn: setTurns,
        waitForResume: gate.wait,
      });
    } catch {
      if (!controller.signal.aborted) setDuelError("Pojedynek zatrzymany: błąd lub brak odpowiedzi. Sprawdź komunikaty w oknach czatu.");
    } finally {
      if (duelController.current === controller) {
        duelController.current = null;
        pauseControl.current = null;
        setDueling(false);
        setPaused(false);
      }
    }
  }

  return <>
    <div className="haunted-scene" aria-hidden="true">
      <Skeleton className="skeleton-left" /><Skeleton className="skeleton-right" />
      <Skull className="floating-skull skull-one" /><Skull className="floating-skull skull-two" /><Skull className="floating-skull skull-three" />
    </div>
    <main className="arena">
      <header>
        <p className="eyebrow"><span /> PO DRUGIEJ STRONIE EKRANU</p>
        <h1>Jestem <span>MAX</span>, od AM</h1>
        <p className="subtitle">Twoja krypta. Wybierz jednego MAX-a lub zaproś obu do pojedynku.</p>
      </header>
      <div className="arena-controls">
        <fieldset className="provider-toggles" disabled={busy || dueling}>
          <legend>Aktywne czaty</legend>
          <label><input type="checkbox" checked={active.openrouter} disabled={!chatConfig.openrouter.enabled} onChange={(event) => setActive((previous) => ({ ...previous, openrouter: event.target.checked }))} /> OpenRouter{!chatConfig.openrouter.enabled && " · wyłączony w konfiguracji"}</label>
          <label><input type="checkbox" checked={active.google} disabled={!chatConfig.google.enabled} onChange={(event) => setActive((previous) => ({ ...previous, google: event.target.checked }))} /> Gemini{!chatConfig.google.enabled && " · wyłączony w konfiguracji"}</label>
        </fieldset>
        <form className="shared-form" onSubmit={sendBoth}>
          <label className="sr-only" htmlFor="shared-message">Wiadomość do obu lub temat pojedynku</label>
          <input id="shared-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder={activeCount === 2 ? "Wiadomość do obu lub temat pojedynku…" : "Napisz do aktywnego MAX-a…"} disabled={busy || dueling || activeCount === 0} autoComplete="off" />
          <div className="arena-actions">
            <button type="submit" disabled={!message.trim() || busy || dueling || activeCount === 0}>{activeCount === 2 ? "Ślij do obu" : "Ślij"}</button>
            {activeCount === 2 && <button className="secondary-button" type="button" onClick={() => void startDuel()} disabled={!message.trim() || busy || dueling}>Rozpocznij pojedynek</button>}
          </div>
        </form>
        <div className="duel-info">
          <p role="status">{dueling ? `${paused ? busy ? "Pauza po bieżącej odpowiedzi" : "Pojedynek wstrzymany" : "Pojedynek trwa"} · ukończone wypowiedzi: ${turns}` : activeCount === 0 ? "Włącz przynajmniej jeden czat powyżej." : activeCount === 1 ? "Tryb jednego czatu. Zaznacz drugi model, aby uruchomić pojedynek." : turns ? `Pojedynek zakończony · wypowiedzi: ${turns}` : "Pojedynek: odpowiadają sobie na zmianę, aż klikniesz Stop lub wystąpi błąd."}</p>
          {dueling && <div className="arena-actions"><button className="secondary-button" onClick={togglePause}>{paused ? "Kontynuuj" : "Pauza"}</button><button className="stop-button" onClick={stopDuel}>Stop</button></div>}
        </div>
        <p className="usage-note">Każda odpowiedź zużywa limit API; przy płatnych modelach także środki. Pojedynek trwa do zatrzymania, a historia rośnie z każdą turą.</p>
        {duelError && <p className="chat-feedback chat-error" role="alert">{duelError}</p>}
      </div>
      <div className="chat-grid" data-count={activeCount} style={{ "--chat-height": `${chatHeight}px` } as CSSProperties}>
        {active.openrouter && <ChatPanel chat={openrouter} title="MAX · OpenRouter" dueling={dueling} />}
        {active.google && <ChatPanel chat={google} title="MAX · Gemini" dueling={dueling} />}
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
