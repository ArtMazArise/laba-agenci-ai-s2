type Responder = (text: string) => Promise<string | null>;

export function getDuelBatchSize(value?: string | number) {
  const rounds = Number(value);
  return Number.isInteger(rounds) && rounds >= 1 && rounds <= 100 ? rounds : 5;
}

export function createDuelPause() {
  let paused = false;
  const listeners = new Set<() => void>();
  return {
    setPaused(value: boolean) {
      paused = value;
      if (!paused) for (const resume of [...listeners]) resume();
    },
    wait(signal: AbortSignal) {
      return new Promise<void>((resolve) => {
        if (!paused || signal.aborted) return resolve();
        const finish = () => {
          listeners.delete(finish);
          signal.removeEventListener("abort", finish);
          resolve();
        };
        listeners.add(finish);
        signal.addEventListener("abort", finish, { once: true });
      });
    },
  };
}

function waitBetweenTurns(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, 1500);
    signal.addEventListener("abort", finish, { once: true });
  });
}

// Jedna odpowiedź naraz. Następna tura dopiero po ukończeniu poprzedniej.
export async function runDuel({ initialPrompt, responders, signal, onTurn, startIndex = 0, roundsPerBatch = 5, onBatchComplete, pause = waitBetweenTurns, waitForResume = async () => {} }: {
  initialPrompt: string;
  responders: [Responder, Responder];
  signal: AbortSignal;
  onTurn: (turn: number) => void;
  startIndex?: 0 | 1;
  roundsPerBatch?: number;
  onBatchComplete?: (completedRounds: number) => Promise<boolean>;
  pause?: (signal: AbortSignal) => Promise<void>;
  waitForResume?: (signal: AbortSignal) => Promise<void>;
}) {
  let prompt = `Rozpocznij żartobliwy, mroczny pojedynek na temat: ${initialPrompt}`;
  let turn = 0;
  const turnsPerBatch = getDuelBatchSize(roundsPerBatch) * 2;
  while (!signal.aborted) {
    await waitForResume(signal);
    if (signal.aborted) return;
    const index = (turn + startIndex) % 2;
    const reply = await responders[index](prompt);
    if (signal.aborted) return;
    if (!reply?.trim()) throw new Error("Pojedynek zatrzymany: model nie zwrócił pełnej odpowiedzi. Sprawdź komunikat w jego oknie.");
    turn += 1;
    onTurn(turn);
    prompt = `Twój rozmówca MAX ${index === 0 ? "OpenRouter" : "Gemini"} powiedział:\n\n${reply}\n\nTwoja riposta?`;
    if (signal.aborted) return;
    if (turn % turnsPerBatch === 0) {
      // Bez jawnej zgody na następną partię nie wykonujemy kolejnego wywołania.
      if (!onBatchComplete || !await onBatchComplete(turn / 2) || signal.aborted) return;
    }
    await pause(signal);
  }
}
