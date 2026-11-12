import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseTestQuestions } from "./chat-tools";

export async function loadTestQuestions() {
  if (process.env.CHAT_TEST_QUESTIONS_ENABLED?.trim().toLowerCase() !== "true") {
    return { questions: [], invalid: false };
  }
  try {
    const raw = await readFile(path.join(process.cwd(), "config/test-questions.json"), "utf8");
    return parseTestQuestions(raw);
  } catch { return { questions: [], invalid: true }; }
}
