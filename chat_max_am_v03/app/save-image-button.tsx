"use client";

import { useState } from "react";
import { imageDownloadInfo, saveImageToDevice } from "@/lib/image-download";

export default function SaveImageButton({ imageUrl, description, label = "Zapisz obraz" }: { imageUrl: string; description: string; label?: string }) {
  const [created] = useState(() => new Date());
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "downloaded" | "error">("idle");
  const [error, setError] = useState("");
  const info = imageDownloadInfo(imageUrl, description, created);
  async function save() {
    setStatus("saving"); setError("");
    try {
      const result = await saveImageToDevice(imageUrl, description, created);
      setStatus(result === "cancelled" ? "idle" : result);
    } catch { setStatus("error"); setError("Nie udało się zapisać obrazu. Sprawdź uprawnienia pobierania lub wybierz inne miejsce zapisu."); }
  }
  return <span className="save-image-control"><button type="button" className="copy-button" disabled={status === "saving"} title={`Proponowana nazwa: ${info.filename}. Domyślnie: Pobrane (według możliwości i ustawień przeglądarki).`} onClick={() => void save()}>{status === "saving" ? "Zapisuję…" : status === "saved" ? "Zapisano" : status === "downloaded" ? "Pobieranie rozpoczęte" : label}</button>{error && <small role="alert">{error}</small>}</span>;
}
