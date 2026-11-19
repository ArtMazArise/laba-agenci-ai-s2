"use client";

import { useRef, useState, type ClipboardEvent } from "react";
import type { FileUIPart } from "ai";
import { IMAGE_TYPES, MAX_UPLOAD_BYTES, MAX_IMAGE_BYTES, MAX_IMAGE_TOTAL_BYTES, MAX_IMAGES_PER_MESSAGE, imageByteLength } from "@/lib/chat-images";

async function prepareImage(file: File): Promise<File> {
  if (file.size > MAX_UPLOAD_BYTES) throw Error("Zdjęcie może mieć maksymalnie 4 MB.");
  if (file.size <= MAX_IMAGE_BYTES) return file;
  // Optymalizacja zapobiega przekroczeniu limitu żądania Vercel po kodowaniu base64.
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw Error("Nie udało się odczytać zdjęcia. Wybierz poprawny plik JPG, PNG lub WebP."); }
  try {
    for (const [dimension, quality] of [[1800, .85], [1500, .7], [1200, .55]]) {
      const ratio = Math.min(1, dimension / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) throw Error("Nie udało się przygotować zdjęcia.");
      context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= MAX_IMAGE_BYTES) return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
    }
    throw Error("Nie udało się zmniejszyć zdjęcia. Wybierz mniejszy plik.");
  } finally { bitmap.close(); }
}

export async function prepareImagePart(original: File): Promise<FileUIPart> {
  if (!IMAGE_TYPES.includes(original.type)) throw Error("Wybierz zdjęcie PNG, JPG lub WebP.");
  const file = await prepareImage(original);
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(Error("Nie udało się odczytać zdjęcia."));
    reader.onerror = () => reject(Error("Nie udało się odczytać zdjęcia."));
    reader.readAsDataURL(file);
  });
  const part: FileUIPart = { type: "file", mediaType: file.type, filename: file.name.slice(0, 200) || "zdjecie", url };
  imageByteLength(part);
  return part;
}

export function useImageAttachments() {
  const [files, setFiles] = useState<FileUIPart[]>([]);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const loading = useRef(false);
  async function addFiles(incoming: File[]) {
    if (loading.current || !incoming.length) return;
    loading.current = true; setReading(true); setError("");
    try {
      if (files.length + incoming.length > MAX_IMAGES_PER_MESSAGE) throw Error("Dodaj maksymalnie 3 zdjęcia do wiadomości.");
      const added: FileUIPart[] = [];
      for (const original of incoming) added.push(await prepareImagePart(original));
      if ([...files, ...added].reduce((total, file) => total + imageByteLength(file), 0) > MAX_IMAGE_TOTAL_BYTES) throw Error("Zdjęcia mogą mieć łącznie maksymalnie 2,5 MB.");
      setFiles((previous) => [...previous, ...added]);
    } catch (error) { setError(error instanceof Error ? error.message : "Nie udało się dodać zdjęcia."); }
    finally { loading.current = false; setReading(false); }
  }
  return {
    files, error, reading, addFiles,
    paste(event: ClipboardEvent<HTMLElement>) {
      const pasted = Array.from(event.clipboardData.files);
      if (!pasted.length) return false;
      event.preventDefault(); void addFiles(pasted); return true;
    },
    clear() { setFiles([]); setError(""); },
    remove(index: number) { setFiles((previous) => previous.filter((_, i) => i !== index)); setError(""); },
  };
}

export default function ImageAttachments({ attachments, disabled }: { attachments: ReturnType<typeof useImageAttachments>; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="image-attachments">
    <input ref={input} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={disabled || attachments.reading} aria-label="Wybierz zdjęcia z dysku" onChange={(event) => { void attachments.addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    <button type="button" className="copy-button" title="Dodaj JPG, PNG lub WebP do 4 MB albo wklej Ctrl+V; duże zdjęcia są optymalizowane" disabled={disabled || attachments.reading} onClick={() => input.current?.click()}>{attachments.reading ? "Wczytuję zdjęcie…" : "Dodaj zdjęcie"}</button>
    {attachments.files.map((file, index) => <div className="image-preview" key={`${index}-${file.filename}`}><img src={file.url} alt={`Podgląd: ${file.filename}`} /><button type="button" className="copy-button" aria-label={`Usuń ${file.filename}`} disabled={disabled} onClick={() => attachments.remove(index)}>×</button></div>)}
    {attachments.error && <span role="alert">{attachments.error}</span>}
  </div>;
}
