import type { FileUIPart, UIMessage } from "ai";

export const DEFAULT_VISION_QUESTION = "Przeanalizuj załączony obraz w trzech konkretnych punktach: 1. Co przedstawia i jakie elementy są najważniejsze. 2. Jakie napisy i szczegóły są widoczne. 3. Jakie są kolory, kompozycja i charakter grafiki. Nie zgaduj nieczytelnych elementów.";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 1_500_000;
export const MAX_IMAGE_TOTAL_BYTES = 2_500_000;
export const MAX_IMAGES_PER_MESSAGE = 3;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function imageByteLength(file: Pick<FileUIPart, "url" | "mediaType">) {
  if (!IMAGE_TYPES.includes(file.mediaType) || typeof file.url !== "string") throw new Error("Dozwolone zdjęcia: PNG, JPG i WebP.");
  const prefix = `data:${file.mediaType};base64,`;
  if (!file.url.startsWith(prefix)) throw new Error("Zdjęcie musi być załączone z urządzenia. Zewnętrzne adresy plików nie są obsługiwane.");
  const encoded = file.url.slice(prefix.length);
  if (!encoded.length || encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("Zdjęcie jest nieprawidłowe lub przekracza 1,5 MB.");
  const bytes = encoded.length / 4 * 3 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (bytes > MAX_IMAGE_BYTES) throw new Error("Maksymalny rozmiar zdjęcia to 1,5 MB.");
  const header = atob(encoded.slice(0, 32));
  const valid = file.mediaType === "image/png" ? header.startsWith("\x89PNG\r\n\x1a\n") : file.mediaType === "image/jpeg" ? header.startsWith("\xff\xd8\xff") : header.startsWith("RIFF") && header.slice(8, 12) === "WEBP";
  if (!valid) throw new Error("Zawartość zdjęcia nie pasuje do formatu PNG, JPG lub WebP.");
  return bytes;
}

export function validateChatImages(messages: UIMessage[]) {
  let total = 0;
  for (const message of messages) {
    const files = message.parts.filter((part) => part.type === "file");
    if (files.length > MAX_IMAGES_PER_MESSAGE || files.length && message.role !== "user") throw new Error("Możesz dodać maksymalnie 3 zdjęcia do wiadomości użytkownika.");
    for (const file of files) total += imageByteLength(file);
  }
  if (total > MAX_IMAGE_TOTAL_BYTES) throw new Error("Zdjęcia w rozmowie przekraczają łącznie 2,5 MB. Wyczyść czat i dodaj mniejsze zdjęcie.");
}
