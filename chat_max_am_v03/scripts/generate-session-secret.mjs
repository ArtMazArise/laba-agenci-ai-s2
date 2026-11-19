import { randomBytes } from "node:crypto";
import { appendFile, chmod } from "node:fs/promises";
import path from "node:path";

// Zapis tylko przez dopisanie. Nie odczytuje istniejącego pliku ani sekretów.
const filename = path.resolve(".env.local");
await appendFile(filename, `\nSESSION_SECRET=${randomBytes(48).toString("base64url")}\n`, { mode: 0o600 });
await chmod(filename, 0o600);
console.log("Wygenerowano i zapisano nowy SESSION_SECRET w .env.local. Wartość nie została wypisana.");
