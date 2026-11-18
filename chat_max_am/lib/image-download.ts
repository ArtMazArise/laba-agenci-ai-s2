type SaveHandle = { createWritable(): Promise<{ write(blob: Blob): Promise<void>; close(): Promise<void>; abort?(): Promise<void> }> };
type SavePicker = (options: { suggestedName: string; startIn: "downloads"; excludeAcceptAllOption: boolean; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveHandle>;

export function imageDownloadInfo(imageUrl: string, description: string, now = new Date()) {
  const mediaType = imageUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,[A-Za-z0-9+/]+=*$/)?.[1];
  if (!mediaType) throw Error("Nieprawidłowy obraz do zapisania.");
  const extension = mediaType === "image/jpeg" ? ".jpg" : mediaType === "image/webp" ? ".webp" : ".png";
  const title = description.replace(/^(?:Opis|Polecenie):\s*/i, "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70).replace(/-$/, "") || "grafika";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const stamp = `${value("year")}${value("month")}${value("day")}-${value("hour")}${value("minute")}${value("second")}`;
  return { mediaType, extension, filename: `max-${title}-${stamp}${extension}` };
}

export async function saveImageToDevice(imageUrl: string, description: string, now = new Date()): Promise<"saved" | "downloaded" | "cancelled"> {
  const info = imageDownloadInfo(imageUrl, description, now);
  const picker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    try {
      // Otwórz okno od razu po kliknięciu, przed asynchronicznym odczytaniem danych.
      const handle = await picker.call(window, { suggestedName: info.filename, startIn: "downloads", excludeAcceptAllOption: true, types: [{ description: `Obraz ${info.extension.slice(1).toUpperCase()}`, accept: { [info.mediaType]: [info.extension] } }] });
      const blob = await (await fetch(imageUrl)).blob();
      const writable = await handle.createWritable();
      try { await writable.write(blob); await writable.close(); }
      catch (error) { await writable.abort?.().catch(() => {}); throw error; }
      return "saved";
    } catch (error) { if (error && typeof error === "object" && "name" in error && error.name === "AbortError") return "cancelled"; throw error; }
  }
  const blob = await (await fetch(imageUrl)).blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = info.filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "downloaded";
}
