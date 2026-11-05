type Responder = (text: string) => Promise<string | null>;

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
export async function runDuel({ initialPrompt, responders, signal, onTurn, pause = waitBetweenTurns, waitForResume = async () => {} }: {
  initialPrompt: string;
  responders: [Responder, Responder];
  signal: AbortSignal;
  onTurn: (turn: number) => void;
  pause?: (signal: AbortSignal) => Promise<void>;
  waitForResume?: (signal: AbortSignal) => Promise<void>;
}) {
  let prompt = `Rozpocznij żartobliwy, mroczny pojedynek na temat: ${initialPrompt}`;
  let turn = 0;
  while (!signal.aborted) {
    await waitForResume(signal);
    if (signal.aborted) return;
    const index = turn % 2;
    const reply = await responders[index](prompt);
    if (signal.aborted) return;
    if (!reply?.trim()) throw new Error("Pojedynek zatrzymany: model nie zwrócił pełnej odpowiedzi. Sprawdź komunikat w jego oknie.");
    turn += 1;
    onTurn(turn);
    prompt = `Twój rozmówca MAX ${index === 0 ? "OpenRouter" : "Gemini"} powiedział:\n\n${reply}\n\nTwoja riposta?`;
    await pause(signal);
  }
}
