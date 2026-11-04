"use client";

import { useState, type FormEvent } from "react";

export default function Home() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<string[]>([]);

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text) return;
    setMessages((previous) => [...previous, text]);
    setMessage("");
  }

  return (
    <main>
      <h1>Jestem MAX, od AM</h1>
      <section className="conversation" role="log" aria-label="Rozmowa" aria-live="polite">
        {messages.map((text, index) => <p className="message" key={index}>{text}</p>)}
      </section>
      <form onSubmit={sendMessage}>
        <label className="sr-only" htmlFor="message">Wiadomość</label>
        <input id="message" name="message" placeholder="Napisz wiadomość…" value={message} onChange={(event) => setMessage(event.target.value)} autoComplete="off" />
        <button type="submit" disabled={!message.trim()}>Ślij</button>
      </form>
    </main>
  );
}
