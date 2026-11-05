type Responder = (text: string) => Promise<string | null>;

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
export async function runDuel({ initialPrompt, responders, signal, onTurn, pause = waitBetweenTurns }: {
  initialPrompt: string;
  responders: [Responder, Responder];
  signal: AbortSignal;
  onTurn: (turn: number) => void;
  pause?: (signal: AbortSignal) => Promise<void>;
}) {
  let prompt = `Rozpocznij żartobliwy, mroczny pojedynek na temat: ${initialPrompt}`;
  let turn = 0;
  while (!signal.aborted) {
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
