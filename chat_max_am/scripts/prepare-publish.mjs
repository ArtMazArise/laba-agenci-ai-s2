import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const source = process.cwd();
const target = path.join(source, ".publish", "max-chatbot");
const rootFiles = [".env.example", ".gitignore", "AGENTS.md", "README.md", "DEPLOY.md", "next.config.ts", "package.json", "package-lock.json", "tsconfig.json"];
const directories = ["app", "lib", "scripts", "tests"];
const credentialPatterns = [
  /sk-or-v1-[A-Za-z0-9]{30,}/,
  /AIza[A-Za-z0-9_-]{30,}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
const forbidden = (name) => {
  const parts = name.split("/");
  const base = parts.at(-1);
  return parts.some((part) => [".auth-state", ".vercel", ".aws", "node_modules", ".next"].includes(part))
    || (base.startsWith(".env") && base !== ".env.example") || ["id_rsa", "id_ed25519"].includes(base);
};
function checkContent(name, content) {
  if (credentialPatterns.some((pattern) => pattern.test(content))) throw Error(`STOP: wykryto wzorzec sekretu w ${name}. Wartości nie wypisano.`);
  if (name.endsWith(".env.example") && /^(?:CHAT_PASSWORD|SESSION_SECRET|OPENROUTER_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|BLOB_READ_WRITE_TOKEN)=.+$/m.test(content)) throw Error("STOP: pola sekretów w .env.example muszą być puste.");
}

// Sprawdzamy również indeks repo nadrzędnego, ale nic w nim nie zmieniamy.
const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const tracked = execFileSync("git", ["-C", gitRoot, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
for (const name of tracked) {
  if (forbidden(name)) throw Error(`STOP: sekret lub stan jest śledzony przez Git: ${name}. Publikacja zatrzymana.`);
  checkContent(name, execFileSync("git", ["-C", gitRoot, "show", `:${name}`], { encoding: "utf8" }));
}
const manifest = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
for (const section of ["dependencies", "devDependencies"]) {
  if (JSON.stringify(Object.entries(manifest[section] || {}).sort()) !== JSON.stringify(Object.entries(lock.packages[""][section] || {}).sort())) throw Error("Lockfile wymaga aktualizacji: najpierw wykonaj npm install.");
}
const files = [...rootFiles];
async function collect(directory) {
  for (const entry of await readdir(path.join(source, directory), { withFileTypes: true })) {
    const name = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw Error(`Nie kopiuję dowiązania: ${name}`);
    if (forbidden(name)) throw Error(`Nie kopiuję pliku prywatnego: ${name}`);
    if (entry.isDirectory()) await collect(name);
    else if (entry.isFile()) files.push(name);
  }
}
for (const directory of directories) await collect(directory);
for (const name of files) checkContent(name, await readFile(path.join(source, name), "utf8"));
try { await stat(target); throw Error(`Folder ${target} już istnieje. Nie nadpisuję go.`); }
catch (error) { if (error.code !== "ENOENT") throw error; }
await mkdir(target, { recursive: true });
for (const name of files) {
  await mkdir(path.dirname(path.join(target, name)), { recursive: true });
  await copyFile(path.join(source, name), path.join(target, name));
}
execFileSync("git", ["init", "--initial-branch=main"], { cwd: target, stdio: "pipe" });
execFileSync("git", ["add", "--", ...files], { cwd: target, stdio: "pipe" });
console.log(`Czyste, osobne repozytorium: ${target}`);
console.log("Pliki przygotowane do commita (bez sekretów, plików kursu i historii nadrzędnego repo):");
console.log(execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: target, encoding: "utf8" }));
console.log("Nie utworzono commita ani remote i nie wysłano kodu.");
