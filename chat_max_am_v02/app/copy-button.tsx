"use client";

import { useEffect, useRef, useState } from "react";

export default function CopyButton({ text, label = "Kopiuj" }: { text: string; label?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch { setStatus("error"); }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 2500);
  }

  return <button type="button" className="copy-button" onClick={() => void copy()} disabled={!text.trim()} title={status === "error" ? "Przeglądarka nie pozwoliła zapisać tekstu w schowku." : label}>
    <span aria-live="polite">{status === "copied" ? "Skopiowano" : status === "error" ? "Nie skopiowano" : label}</span>
  </button>;
}
