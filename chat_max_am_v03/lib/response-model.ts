// Odczytujemy wyłącznie identyfikator podany w odpowiedzi API, nigdy nazwę z konfiguracji.
export function captureModelFetch(fetcher: typeof fetch, report: (model: string) => void): typeof fetch {
  return async (input, init) => {
    const response = await fetcher(input, init);
    if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) return response;
    const decoder = new TextDecoder();
    let buffer = "", data: string[] = [];
    const line = (value: string) => {
      if (value.startsWith("data:")) data.push(value.slice(5).trimStart());
      if (!value) {
        try {
          const parsed = JSON.parse(data.join("\n"));
          const model = parsed.model ?? parsed.modelVersion;
          if (typeof model === "string" && /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/.test(model)) report(model);
        } catch { /* Pozostałe zdarzenia i błędy obsługuje provider SDK. */ }
        data = [];
      }
    };
    return new Response(response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        buffer += decoder.decode(chunk, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) { line(buffer.slice(0, end).replace(/\r$/, "")); buffer = buffer.slice(end + 1); }
      },
      flush() { buffer += decoder.decode(); if (buffer) line(buffer.replace(/\r$/, "")); line(""); },
    })), { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}
