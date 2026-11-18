"use client";

import { copyClipboardContent } from "@/lib/clipboard";
import { useEffect, useRef, useState } from "react";

export default function CopyButton({ text, label = "Kopiuj", html, imageUrl, imageOnly }: { text: string; label?: string; html?: string; imageUrl?: string; imageOnly?: boolean }) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const [errorText, setErrorText] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    setStatus("copying");
    try {
      await copyClipboardContent({ text, html, imageUrl, imageOnly });
      setStatus("copied");
    } catch (error) { setStatus("error"); setErrorText(error instanceof Error && !["NotAllowedError", "SecurityError"].includes(error.name) ? error.message : "Przeglądarka zablokowała zapis do schowka."); }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus("idle"), 2500);
  }

  return <button type="button" className="copy-button" onClick={() => void copy()} disabled={status === "copying" || (!text.trim() && !imageUrl && !html)} title={status === "error" ? errorText : html || imageUrl ? "Kopiuje także grafikę. Sposób wklejenia zależy od programu docelowego." : label}>
    <span aria-live="polite">{status === "copying" ? "Kopiuję…" : status === "copied" ? "Skopiowano" : status === "error" ? "Nie skopiowano" : label}</span>
  </button>;
}
