# MAX od AM

Chatbot Next.js App Router z TypeScript: dwa okna (OpenRouter i Gemini), strumieniowanie i oddzielna historia każdej rozmowy. Historia jest w pamięci przeglądarki i znika po odświeżeniu strony.

## Uruchomienie

1. W folderze projektu wykonaj `npm install`. Zachowaj `package-lock.json`; npm uzupełni go o nowe zależności. Kolejne instalacje z gotowym lockfile można wykonywać przez `npm ci`.
2. Utwórz samodzielnie plik `.env.local`, kopiując zawartość `.env.example`. Jeśli `.env.local` już istnieje, uzupełnij go bez nadpisywania innych ustawień.
3. Uzupełnij samodzielnie wartości w `.env.local`:
   - `OPENROUTER_ENABLED`: `true` włącza OpenRouter, `false` go wyłącza.
   - `OPENROUTER_API_KEY`: klucz OpenRouter.
   - `OPENROUTER_MODEL`: identyfikator modelu OpenRouter, np. `openrouter/free`.
   - `GEMINI_ENABLED`: `true` włącza Gemini, `false` go wyłącza.
   - `GOOGLE_GENERATIVE_AI_API_KEY`: klucz wygenerowany w Google AI Studio, osobny od klucza OpenRouter.
   - `GEMINI_MODEL`: identyfikator modelu Google, np. `gemini-3.5-flash-lite` ([cennik i darmowy poziom](https://aistudio.google.com/docs/pricing#gemini-3.5-flash-lite)).

   Pola kluczy i modeli w `.env.example` celowo pozostają puste, a flagi mają wartość `true`. Brak flagi w istniejącym `.env.local` oznacza `true`, więc dotychczasowa konfiguracja nadal działa. Nie wklejaj kluczy do rozmowy i nie dodawaj prefiksu `NEXT_PUBLIC_`.
4. Uruchom `npm run dev` i otwórz http://localhost:3000 (lub adres wypisany w terminalu). Po zmianie konfiguracji zatrzymaj serwer przez Ctrl+C i uruchom go ponownie.

Pliki `.env` i `.env.local` są ignorowane przez `.gitignore`. Oba klucze są używane wyłącznie w serwerowym `/api/chat`. Pole `provider` wybiera `openrouter` lub `google`; bez tego pola route zachowuje dotychczasowy OpenRouter. Brak konfiguracji jednego dostawcy nie blokuje drugiego. Bez konfiguracji aplikacja pokazuje błąd, bez zastępczej odpowiedzi.

## Dwa czaty i pojedynek

- Cała konfiguracja jest w `.env.local`; wzór to `.env.example`. `OPENROUTER_ENABLED=false` lub `GEMINI_ENABLED=false` wyłącza dostawcę w interfejsie i API. `true` go włącza. Po zmianie uruchom serwer ponownie. Do przeglądarki przekazywane są tylko booleany dostępności, bez kluczy.
- Checkboxy „Aktywne czaty” na stronie pozwalają przełączyć się na jeden lub dwa dostępne modele bez edycji plików. Ukrycie okna nie usuwa historii; wybór obowiązuje do odświeżenia strony. Podczas odpowiedzi i pojedynku checkboxy są zablokowane. Dostawcy wyłączeni w konfiguracji nie mogą zostać włączeni checkboxem.
- Własne pole pod każdym oknem wysyła wiadomość tylko do tego dostawcy.
- Obok „Ślij” przy każdym czacie jest „Pojedynek!”. Wpisz temat w polu tego MAX-a, który ma zacząć, i kliknij jego „Pojedynek!”. Oba czaty muszą być aktywne i gotowe. Jego pełna odpowiedź trafi do drugiego MAX-a, dalej odpowiadają na zmianę. Każdy model zachowuje własną historię. Między wypowiedziami jest 1,5 sekundy przerwy.
- Przyciski „Pauza / Kontynuuj” i „Stop” są pośrodku pod oknami czatów. „Stop” przerywa bieżący strumień i blokuje kolejne tury. Błąd, przerwany strumień lub brak odpowiedzi także kończą pojedynek. Tryb nie uruchamia się sam po otwarciu strony.
- „Pauza” pozwala dokończyć bieżącą wypowiedź, po czym blokuje następną turę. „Kontynuuj” wznawia od kolejnego rozmówcy, z tą samą historią. „Stop” działa również podczas pauzy.
- Okna mają zawsze tę samą wysokość, również podczas oczekiwania i błędów. Uchwyt pod czatami zmienia wysokość obu naraz (360–1400 px) przez przeciąganie myszą lub palcem. Można też wybrać uchwyt klawiszem Tab i użyć strzałek, Home lub End. Wąski ekran układa czaty jeden pod drugim, zachowując wspólną wysokość.

Pierwszy test wykonaj samodzielnie w przeglądarce. Każda odpowiedź zużywa limit API, a płatne modele mogą pobierać środki. Pojedynek działa do przerwania lub błędu, bez limitu tur; z każdą turą rośnie przesyłana historia. Zatrzymanie nie cofa kosztu już rozpoczętej generacji.

## Wersje i protokół

- `ai` 6.x + `@ai-sdk/react` 3.x, zgodnie z [oficjalną instrukcją AI SDK 6](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0).
- `@openrouter/ai-sdk-provider` 2.9.1, zgodnie z [instrukcją OpenRouter dla AI SDK 6](https://github.com/OpenRouterTeam/ai-sdk-provider#legacy-setup-for-ai-sdk-v6).
- `@ai-sdk/google` 3.x, zgodnie z tabelą wersji AI SDK 6. Bezpośrednie połączenie z Google przez `createGoogleGenerativeAI`, z nazwą API z wersji 6 ([zmiany nazw w wersji 7](https://github.com/vercel/ai/blob/main/skills/migrate-ai-sdk-v6-to-v7/SKILL.md)).
- Klient: `useChat`, `DefaultChatTransport`, `sendMessage` i tekstowe `message.parts`. Serwer: `validateUIMessages`, asynchroniczne `convertToModelMessages`, `streamText` i `toUIMessageStreamResponse`. Transport przesyła pełną historię bieżącej rozmowy przy każdej wiadomości.

Bez bazy danych. Dark i animacje pozostają w aplikacji.

## Sprawdzenie bez płatnych wywołań

`npm test` sprawdza konfigurację obu dostawców, historię, błędy oraz naprzemienne tury, przerwanie i zatrzymywanie po błędzie. Testy podstawiają atrapę SDK oraz własne zmienne środowiskowe: nie czytają `.env.local` i nie łączą się z modelami. Pełne sprawdzenie typów po instalacji: `npx tsc --noEmit`.
