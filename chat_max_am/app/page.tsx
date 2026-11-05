"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState, type FormEvent } from "react";

const transport = new DefaultChatTransport({ api: "/api/chat" });

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

export default function Home() {
  const [message, setMessage] = useState("");
  const { messages, sendMessage, status, error } = useChat({ transport });
  const isBusy = status === "submitted" || status === "streaming";
  const conversationRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const conversation = conversationRef.current;
    if (conversation) conversation.scrollTop = conversation.scrollHeight;
  }, [messages, status]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || isBusy) return;
    void sendMessage({ text });
    setMessage("");
  }

  return (
    <>
    <div className="haunted-scene" aria-hidden="true">
      <Skeleton className="skeleton-left" />
      <Skeleton className="skeleton-right" />
      <Skull className="floating-skull skull-one" />
      <Skull className="floating-skull skull-two" />
      <Skull className="floating-skull skull-three" />
    </div>
    <main>
      <header>
        <p className="eyebrow"><span /> PO DRUGIEJ STRONIE EKRANU</p>
        <h1>Jestem <span>MAX</span>, od AM</h1>
        <p className="subtitle">Masz odwagę napisać?</p>
      </header>
      <div className="chat-panel">
      <div className="chat-topbar"><span><Skull /> KRYPTA ROZMÓW</span><span className="status">{isBusy ? "MAX PRZYWOŁUJE SŁOWA…" : "MAX · OPENROUTER"}</span></div>
      <section ref={conversationRef} className="conversation" role="log" aria-label="Rozmowa" aria-live="polite" aria-busy={isBusy}>
        {messages.map((item) => (
          <div className={`message message-${item.role}`} key={item.id}>
            <span className="message-author">{item.role === "user" ? "Ty" : "MAX"}</span>
            {item.parts.map((part, index) => part.type === "text" ? <span key={index}>{part.text}</span> : null)}
          </div>
        ))}
      </section>
      {isBusy && <p className="chat-feedback" role="status">{status === "submitted" ? "MAX budzi się w krypcie…" : "MAX pisze z zaświatów…"}</p>}
      {error && <p className="chat-feedback chat-error" role="alert">{error.message.startsWith("MAX:") ? error.message : "Nie udało się połączyć z MAX-em. Sprawdź połączenie i spróbuj ponownie."}</p>}
      <form onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="message">Wiadomość</label>
        <input id="message" name="message" placeholder="Napisz wiadomość…" value={message} onChange={(event) => setMessage(event.target.value)} autoComplete="off" disabled={isBusy} />
        <button type="submit" disabled={isBusy || !message.trim()}>{isBusy ? "Czekaj…" : "Ślij"}</button>
      </form>
      </div>
      <p className="footer-note">Tylko Ty, mrok i Twoje wiadomości.</p>
    </main>
    </>
  );
}
