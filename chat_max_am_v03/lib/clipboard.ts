export type ClipboardContent = { text: string; html?: string; imageUrl?: string; imageOnly?: boolean };

export async function clipboardPng(imageUrl: string): Promise<Blob> {
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(imageUrl)) throw Error("Nieprawidłowy obraz do skopiowania.");
  const blob = await (await fetch(imageUrl)).blob();
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw Error("Nie udało się przygotować obrazu do schowka.");
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw Error("Nie udało się przygotować obrazu do schowka.");
    return png;
  } finally { bitmap.close(); }
}

export async function copyClipboardContent({ text, html, imageUrl, imageOnly }: ClipboardContent) {
  if (!navigator.clipboard) throw Error("Schowek wymaga HTTPS lub localhost i zgody przeglądarki.");
  const hasImages = Boolean(imageUrl || html?.includes("<img "));
  if (!html && !imageUrl) { await navigator.clipboard.writeText(text); return; }
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    if (!hasImages) { await navigator.clipboard.writeText(text); return; }
    throw Error("Ta przeglądarka nie obsługuje kopiowania grafiki. Użyj Chrome, Edge lub innej przeglądarki z obsługą schowka obrazów.");
  }
  const content: Record<string, Blob | Promise<Blob>> = {};
  if (!imageOnly) {
    content["text/plain"] = new Blob([text], { type: "text/plain" });
    if (html) content["text/html"] = new Blob([html], { type: "text/html" });
  }
  if (imageUrl) content["image/png"] = clipboardPng(imageUrl);
  // Promise przekazujemy od razu, aby zachować aktywację użytkownika także w Safari.
  await navigator.clipboard.write([new ClipboardItem(content)]);
}
