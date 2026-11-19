export type ChatRequestMode = "chat" | "analysis" | "duel";

export type ChatResult = {
  category: "sales" | "support" | "billing" | "unknown";
  priority: "normal" | "high";
  draft: string;
  needs_review: boolean;
};

export const chatResultJsonSchema = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    category: { type: "string" as const, enum: ["sales", "support", "billing", "unknown"] },
    priority: { type: "string" as const, enum: ["normal", "high"] },
    draft: { type: "string" as const },
    needs_review: { type: "boolean" as const },
  },
  required: ["category", "priority", "draft", "needs_review"],
};

export function isChatResult(value: unknown): value is ChatResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 4 &&
    ["sales", "support", "billing", "unknown"].includes(v.category as string) &&
    ["normal", "high"].includes(v.priority as string) &&
    typeof v.draft === "string" &&
    typeof v.needs_review === "boolean";
}
