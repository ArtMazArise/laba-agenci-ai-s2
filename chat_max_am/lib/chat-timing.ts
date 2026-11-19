export type ChatTiming = {
  totalMs: number;
  modelBeforeToolMs: number;
  toolMs: number;
  modelAfterToolMs: number;
  overheadMs: number;
  steps: { attempt: number; step: number; modelMs: number; toolMs: number; totalMs: number }[];
  tools: { name: string; attempt: number; step: number; durationMs: number; success: boolean }[];
};

type Span = { attempt: number; step: number; start: number; end?: number };
type ToolSpan = Span & { id: string; name: string; success: boolean };
const rounded = (value: number) => Math.round(Math.max(0, value) * 100) / 100;
function union(spans: { start: number; end: number }[]) {
  let total = 0, previousEnd = -Infinity;
  for (const span of spans.sort((a, b) => a.start - b.start)) {
    total += Math.max(0, span.end - Math.max(span.start, previousEnd));
    previousEnd = Math.max(previousEnd, span.end);
  }
  return total;
}

export function createChatTiming(now: () => number = () => performance.now()) {
  const started = now();
  const steps: Span[] = [];
  const tools: ToolSpan[] = [];
  return {
    startStep(attempt: number, step: number) { steps.push({ attempt, step, start: now() }); },
    endStep(attempt: number, step: number) {
      const span = steps.find((item) => item.attempt === attempt && item.step === step);
      if (span && span.end === undefined) span.end = now();
    },
    startTool(attempt: number, step: number, id: string, name: string) { tools.push({ attempt, step, id, name, start: now(), success: false }); },
    endTool(attempt: number, id: string, success: boolean) {
      const span = tools.find((item) => item.attempt === attempt && item.id === id);
      if (span && span.end === undefined) { span.end = now(); span.success = success; }
    },
    endAttempt(attempt: number) {
      const ended = now();
      for (const span of [...steps, ...tools]) if (span.attempt === attempt && span.end === undefined) span.end = ended;
    },
    snapshot(): ChatTiming {
      const ended = now();
      let before = 0, after = 0;
      let hadTool = false;
      const completed = steps.map((span) => {
        const end = span.end ?? ended;
        const totalMs = Math.max(0, end - span.start);
        const executions = tools.filter((tool) => tool.attempt === span.attempt && tool.step === span.step);
        const toolMs = union(executions.map((tool) => ({ start: Math.max(span.start, tool.start), end: Math.min(end, tool.end ?? ended) })));
        const modelMs = Math.max(0, totalMs - toolMs);
        if (hadTool) after += modelMs; else before += modelMs;
        if (executions.length) hadTool = true;
        return { attempt: span.attempt, step: span.step, modelMs: rounded(modelMs), toolMs: rounded(toolMs), totalMs: rounded(totalMs) };
      });
      const toolMs = union(tools.map((tool) => ({ start: tool.start, end: tool.end ?? ended })));
      return {
        totalMs: rounded(ended - started), modelBeforeToolMs: rounded(before), toolMs: rounded(toolMs), modelAfterToolMs: rounded(after),
        overheadMs: rounded(ended - started - before - after - toolMs),
        steps: completed,
        tools: tools.map((tool) => ({ name: tool.name, attempt: tool.attempt, step: tool.step, durationMs: rounded((tool.end ?? ended) - tool.start), success: tool.success })),
      };
    },
  };
}


export type ChatRequestDiagnostics = {
  endpoint: "/api/chat" | "/api/agent";
  provider: "openrouter" | "google";
  model: string;
  mode: "chat" | "analysis" | "duel";
  message: string;
  historyMessageCount: number;
  requestPolicy?: { profile: "simple_chat" | "agent" | "analysis"; timeoutMs: number; structuredOutput: boolean; toolNames: string[] };
  failure?: { providerHint?: "thought_signature" | "tool_schema" | "tool_choice" | "routing"; code: string; statusCode: number | null; finishReason: string | null; stage: "before_tool" | "after_tool"; requiredTools: string[]; message: string };
  images?: { filename: string; mediaType: string; sizeBytes: number }[];
  location: { latitude: number; longitude: number } | null;
  toolCalls: { attempt: number; step: number; name: string; input: Record<string, string | number | boolean | null>; effectiveInput: Record<string, string | number | boolean | null> }[];
};
