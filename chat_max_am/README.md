# MAX od AM

Prosty chatbot Next.js App Router z TypeScript, strumieniowaniem i historią bieżącej rozmowy. Historia jest w pamięci przeglądarki i znika po odświeżeniu strony.

## Uruchomienie

1. W folderze projektu wykonaj `npm install`. Zachowaj `package-lock.json`; npm uzupełni go o nowe zależności. Kolejne instalacje z gotowym lockfile można wykonywać przez `npm ci`.
2. Utwórz samodzielnie plik `.env.local`, kopiując zawartość `.env.example`. Jeśli `.env.local` już istnieje, uzupełnij go bez nadpisywania innych ustawień.
3. Po `OPENROUTER_API_KEY=` wpisz swój klucz z konta OpenRouter. Po `OPENROUTER_MODEL=` wpisz identyfikator wybranego modelu z katalogu OpenRouter (format `dostawca/model`). Oba pola w przykładzie celowo pozostają puste. Nie wklejaj klucza do rozmowy i nie dodawaj prefiksu `NEXT_PUBLIC_`.
4. Uruchom `npm run dev` i otwórz http://localhost:3000 (lub adres wypisany w terminalu). Po zmianie konfiguracji zatrzymaj serwer przez Ctrl+C i uruchom go ponownie.

Pliki `.env` i `.env.local` są ignorowane przez `.gitignore`. Klucz jest używany wyłącznie w serwerowym `/api/chat`. Bez konfiguracji aplikacja pokazuje błąd, bez zastępczej odpowiedzi. Pierwszy test modelu wykonaj samodzielnie w przeglądarce; wysłanie wiadomości może zużywać środki OpenRouter.

## Wersje i protokół

- `ai` 6.x + `@ai-sdk/react` 3.x, zgodnie z [oficjalną instrukcją AI SDK 6](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0).
- `@openrouter/ai-sdk-provider` 2.9.1, zgodnie z [instrukcją OpenRouter dla AI SDK 6](https://github.com/OpenRouterTeam/ai-sdk-provider#legacy-setup-for-ai-sdk-v6).
- Klient: `useChat`, `DefaultChatTransport`, `sendMessage` i tekstowe `message.parts`. Serwer: `validateUIMessages`, asynchroniczne `convertToModelMessages`, `streamText` i `toUIMessageStreamResponse`. Transport przesyła pełną historię bieżącej rozmowy przy każdej wiadomości.

Bez bazy danych. Dark i animacje pozostają w aplikacji.

## Sprawdzenie bez płatnych wywołań

`npm test` sprawdza obsługę brakującej konfiguracji, pustych wiadomości, historii i błędów. Testy podstawiają atrapę SDK oraz własne zmienne środowiskowe: nie czytają `.env.local` i nie łączą się z OpenRouter. Pełne sprawdzenie typów po instalacji: `npx tsc --noEmit`.
