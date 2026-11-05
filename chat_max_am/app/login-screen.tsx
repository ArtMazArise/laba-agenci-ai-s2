"use client";

import { useEffect, useState, type FormEvent } from "react";
import HauntedScene from "./haunted-scene";

export default function LoginScreen({ unavailable, learningMode = false }: { unavailable?: string; learningMode?: boolean }) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [jokes, setJokes] = useState<{ name: string; text: string; generated: boolean }[]>([]);
  const [refreshToRetry, setRefreshToRetry] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  async function enter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || pending || seconds > 0 || refreshToRetry || unavailable) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      setPassword("");
      const data = await response.json();
      if (response.ok) { window.location.replace("/"); return; }
      setError(data.error || "Nie udało się wejść do krypty.");
      setJokes(data.jokes || []);
      setRetryAt(data.retryAt || 0);
      setRefreshToRetry(!!data.refreshToRetry);
    } catch { setPassword(""); setError("Nie udało się połączyć. Spróbuj ponownie."); }
    finally { setPending(false); }
  }

  return <>
    <HauntedScene className="login-scene" />
    <main className="login-page">
    <div className="login-card">
      <p className="eyebrow">MAX · KRYPTA WARSZTATOWA</p>
      <h1>Wpisz hasło</h1>
      <p className="subtitle">{learningMode ? "Trzy próby. Potem F5 — i szkielety dają kolejną szansę." : "Trzy próby. Potem szkielety zamykają drzwi na kwadrans."}</p>
      <form onSubmit={enter}>
        <label className="sr-only" htmlFor="workshop-password">Hasło warsztatowe</label>
        <input id="workshop-password" type="password" name="password" autoComplete="current-password" maxLength={512} value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending || !!unavailable || seconds > 0 || refreshToRetry} required autoFocus />
        <button disabled={!password || pending || !!unavailable || seconds > 0 || refreshToRetry}>{pending ? "Chwila…" : "Wejdź"}</button>
      </form>
      {(unavailable || error) && <p className="chat-feedback chat-error" role="alert">{unavailable || error}</p>}
      {seconds > 0 && <p className="chat-feedback" role="status">Ponowna próba za {Math.ceil(seconds / 60)} min.</p>}
      <p className="usage-note">Po błędnym haśle aktywne AI wymyślają żarty — zużywa to ich limit API.</p>
      {pending && <p className="chat-feedback" role="status">Sprawdzam hasło. Po pomyłce przywołuję żarty MAX-ów…</p>}
      {jokes.length > 0 && <div className="login-jokes" aria-live="polite">{jokes.map((joke) => <p key={joke.name}><strong>{joke.name}{joke.generated ? " · AI" : " · komunikat"}:</strong> {joke.text}</p>)}</div>}
    </div>
  </main>
  </>;
}
