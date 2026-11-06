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
- `CHAT_DUEL_ROUNDS=5` w `.env.local` ustawia rozmiar partii (1–100, domyślnie 5). Runda to po jednej odpowiedzi obu modeli. Po każdej partii pojawia się automatyczna pauza i pytanie o kolejną partię tej samej długości. „Tak” zachowuje historię i kolejność, „Nie” kończy pojedynek.
- „Pauza” pozwala dokończyć bieżącą wypowiedź, po czym blokuje następną turę. „Kontynuuj” wznawia od kolejnego rozmówcy, z tą samą historią. „Stop” działa również podczas pauzy.
- Okna mają zawsze tę samą wysokość, również podczas oczekiwania i błędów. Uchwyt pod czatami zmienia wysokość obu naraz (360–1400 px) przez przeciąganie myszą lub palcem. Można też wybrać uchwyt klawiszem Tab i użyć strzałek, Home lub End. Wąski ekran układa czaty jeden pod drugim, zachowując wspólną wysokość.

Pierwszy test wykonaj samodzielnie w przeglądarce. Każda odpowiedź zużywa limit API, a płatne modele mogą pobierać środki. Pojedynek działa partiami po `CHAT_DUEL_ROUNDS` pełnych rund (domyślnie 5); po partii pyta o kontynuację; z każdą turą rośnie przesyłana historia. Zatrzymanie nie cofa kosztu już rozpoczętej generacji.

## Wersje i protokół

- `ai` 6.x + `@ai-sdk/react` 3.x, zgodnie z [oficjalną instrukcją AI SDK 6](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0).
- `@openrouter/ai-sdk-provider` 2.9.1, zgodnie z [instrukcją OpenRouter dla AI SDK 6](https://github.com/OpenRouterTeam/ai-sdk-provider#legacy-setup-for-ai-sdk-v6).
- `@ai-sdk/google` 3.x, zgodnie z tabelą wersji AI SDK 6. Bezpośrednie połączenie z Google przez `createGoogleGenerativeAI`, z nazwą API z wersji 6 ([zmiany nazw w wersji 7](https://github.com/vercel/ai/blob/main/skills/migrate-ai-sdk-v6-to-v7/SKILL.md)).
- Klient: `useChat`, `DefaultChatTransport`, `sendMessage` i tekstowe `message.parts`. Serwer: `validateUIMessages`, asynchroniczne `convertToModelMessages`, `streamText` i `toUIMessageStreamResponse`. Transport przesyła pełną historię bieżącej rozmowy przy każdej wiadomości.

Bez bazy danych. Dark i animacje pozostają w aplikacji.

## Hasło warsztatowe i sesja

Cała konfiguracja pozostaje w `.env.local` (wzór: `.env.example`). Nie nadpisuj istniejącego pliku ani kluczy dostawców.

1. Dodaj `CHAT_PASSWORD=` i po znaku `=` wpisz własne hasło warsztatowe (1–512 znaków, nie same spacje). Nie udostępniaj go w rozmowie.
2. `SESSION_SECRET` został wygenerowany lokalnie kryptograficznie i dopisany do istniejącego `.env.local`, bez odczytu jego wcześniejszej zawartości. Nie kopiuj na niego pustego pola z przykładu. Przy nowej instalacji wygenerujesz sekret poleceniem `node scripts/generate-session-secret.mjs`; kolejne uruchomienie dopisuje nową wartość i unieważnia wcześniejsze sesje. Skrypt nigdy nie wypisuje sekretu.
3. Lokalnie `AUTH_STATE_DIR` zostaw puste — serwer użyje ignorowanego przez Git katalogu `.auth-state/`. Zrestartuj `npm run dev` po zmianie `.env.local`.

Hasło porównywane jest wyłącznie na serwerze. Sesja trwa 8 godzin i ma podpis HMAC oparty na `SESSION_SECRET`. Cookie zawiera tylko losowy identyfikator sesji, datę wygaśnięcia oraz podpis: bez hasła i kluczy API. Ustawienia: `HttpOnly`, `SameSite=Strict`, `Path=/`, a w produkcji także `Secure`. Strona i `/api/chat` sprawdzają sesję przed dostępem do czatu, obu dostawców i modeli. Brak sesji daje 401, brak konfiguracji lub magazynu daje 503; ochrona nigdy nie wyłącza się sama. Żądania logowania, wyjścia i zalogowanego czatu muszą mieć prawidłowy `Origin`.

„Wyjdź” zatrzymuje odpowiedzi i pojedynek, unieważnia sesję po stronie serwera, usuwa cookie i wraca do ekranu hasła. Skopiowane wcześniej cookie też przestaje działać. Zmiana hasła lub sekretu unieważnia stare sesje.

W lokalnym `npm run dev` domyślnie działa `AUTH_LEARNING_MODE=true`: po wyczerpaniu limitu błędnych prób wystarczy odświeżyć ekran hasła klawiszem F5, aby dostać nowy limit prób. Nie trzeba czekać 15 minut. Ustawienie `AUTH_LEARNING_MODE=false` przywraca pełny limit również lokalnie. W produkcji tryb nauki jest zawsze wyłączony: po wyczerpaniu limitu błędów obowiązuje 15-minutowe okno liczone od pierwszego błędu. Limit dotyczy całego wspólnego hasła warsztatowego, więc błędy jednej osoby mogą chwilowo zablokować logowanie pozostałym. Już zalogowane sesje pozostają aktywne. Limit i identyfikatory sesji zapisują się w pliku stanu; licznik nie zależy od cookie, adresu IP ani pamięci procesu. Atomowa blokada plikowa chroni również przed równoczesnymi próbami. Sukces nie kasuje wcześniejszych błędów w oknie. Po każdej z dozwolonych błędnych prób serwer prosi tylko jeden aktywny model o żart. Pierwszy MAX jest losowany na serwerze; przy kolejnych próbach w tym samym ekranie Gemini i OpenRouter odpowiadają naprzemiennie. Przy jednym aktywnym modelu odpowiada on sam. F5 zaczyna nowe losowanie. To jawny wyjątek na ekranie logowania; zużywa limit API i ewentualne środki dostawców. Modele dostają wyłącznie stały prompt, bez wpisanego hasła ani danych z formularza. Wykonywane jest jedno wywołanie na próbę, bez ponowień. OpenRouter ma 30 sekund i 1024 tokeny, Gemini 30 sekund i 180 tokenów. Komunikaty odróżniają przekroczenie czasu, brak tekstu, wyczerpanie tokenów i błędy HTTP dostawcy. Brak konfiguracji, pusty tekst lub błąd daje jawny komunikat „Żart niedostępny”, bez lokalnej imitacji. Kolejne żądania po wyczerpaniu prób nie uruchamiają modeli. `/api/chat` nadal wymaga sesji i nigdy nie wywołuje modelu bez niej.

Limit błędnych prób ustawia `CHAT_MAX_ATTEMPTS` w `.env.local` (domyślnie 5; zakres 1–100). Ekran pokazuje licznik błędów i „ZABLOKOWANO” po wyczerpaniu limitu, bez instrukcji odświeżania.

### Hosting

Instrukcje publikacji na własnym GitHub, konfiguracji Vercel i obowiązkowych testów hasła po wdrożeniu: [DEPLOY.md](DEPLOY.md).

Na Vercel sesje i limit prób korzystają z prywatnego Vercel Blob Store przez `BLOB_READ_WRITE_TOKEN`. Bez niego logowanie jest zablokowane. Wspólne odczyty bez cache i warunkowe zapisy ETag zapewniają spójny stan przy wielu instancjach. Magazyn nie zawiera haseł ani kluczy API; nie zapisuje też historii czatu. Nie dodano bazy danych.

Lokalnie nadal używany jest ignorowany katalog `.auth-state/`. Przy własnym serwerze można wskazać `AUTH_STATE_DIR` jako trwały katalog współdzielony przez wszystkie instancje. Dysk lokalny funkcji serverless lub `/tmp` nie zapewnia globalnego limitu. Niedostępny lub uszkodzony magazyn blokuje dostęp zamiast zerować licznik.

### Sprawdzenia ręczne w przeglądarce

Po ustawieniu hasła i restarcie serwera (błędne hasło uruchomi teraz generowanie żartów przez aktywne modele):

1. W prywatnym oknie przeglądarki zobacz ekran „Wpisz hasło”. Wpisz jeden raz błędne hasło: komunikat o 2 pozostałych próbach i żarty aktywnych MAX-ów.
2. Wpisz prawidłowe hasło: zobaczysz czaty. Nie wysyłaj wiadomości do modeli w ramach tego testu.
3. Kliknij „Wyjdź”: ekran hasła wraca; odświeżenie nadal nie pokazuje czatu.
4. Lokalnie sprawdź limit błędnych prób: po ostatniej pojawi się „ZABLOKOWANO”. Odśwież stronę i sprawdź poprawne hasło — bez czekania. W produkcji lub przy wyłączonym trybie nauki F5 nie resetuje blokady 15-minutowej.
5. Opcjonalnie w konsoli przeglądarki wykonaj `fetch('/api/chat', {method: 'POST', credentials: 'omit'}).then(r => console.log(r.status))`. Oczekiwane 401; brak cookie zatrzymuje żądanie przed modelem.

Automatyczne testy używają oddzielnego katalogu tymczasowego, sztucznych haseł i sekretów. Nie odczytują rzeczywistego `.env.local`, nie zmieniają limitu warsztatu i nie wykonują płatnych wywołań. Obejmują dobre i złe hasło, trzecią próbę, blokadę równoległych prób i nowych instancji, wyjście i odrzucanie starej sesji, wygaśnięcie/podmianę cookie, zmianę hasła, brak konfiguracji, niedostępny magazyn, cookie produkcyjne oraz 401 obu modeli bez sesji, reset prób w lokalnym trybie nauki, zgodność Origin/Host i generowanie żartów bez przekazywania hasła.

## Sprawdzenie bez płatnych wywołań

`npm test` sprawdza konfigurację obu dostawców, historię, błędy oraz naprzemienne tury, przerwanie i zatrzymywanie po błędzie. Testy podstawiają atrapę SDK oraz własne zmienne środowiskowe: nie czytają `.env.local` i nie łączą się z modelami. Pełne sprawdzenie typów po instalacji: `npx tsc --noEmit`.

## Oznaczenie wersji

Drobna stopka na ekranie hasła i pod czatem pokazuje wersję z `package.json`, datę w strefie `Europe/Warsaw` oraz „Lokalnie” / „Vercel · produkcja” / „Vercel · podgląd”. Lokalnie data pochodzi z najnowszej modyfikacji plików źródłowych; na Vercel z ostatniego commita aplikacji. Gdy historia Git jest niedostępna podczas budowania, stopka jawnie pokazuje datę „build”. Zmiana lokalnych plików nie aktualizuje wdrożenia Vercel — wymaga commita, push i nowego wdrożenia.

## Wspólne pytania i kopiowanie

`CHAT_TEST_QUESTIONS` to tablica JSON z tekstami pytań. Przykład z sześcioma pytaniami znajduje się w `.env.example`. Lokalnie otocz cały JSON pojedynczymi apostrofami, tak jak w przykładzie; w panelu Vercel wklej samą tablicę JSON jako Config. Po zmianie konfiguracji lokalnie uruchom serwer ponownie; na Vercel wykonaj nowe wdrożenie.

Pole obok checkboxów pozwala wybrać podpowiedź, zmienić jej treść lub wpisać własną wiadomość. Pusta zmienna lub `[]` usuwa podpowiedzi, ale pozostawia możliwość pisania. Mały „×” czyści pole. „Wyślij” kieruje tę samą wiadomość równocześnie do zaznaczonych czatów; niezaznaczone modele nie otrzymują zapytań. Podczas pojedynku lub trwającej odpowiedzi wysyłanie jest zablokowane.

„Kopiuj” przy wypowiedzi zapisuje w schowku tekst `Autor: wiadomość`. „Kopiuj czat” w nagłówku kopiuje wszystkie tekstowe wypowiedzi w kolejności rozmowy, oddzielone linią myślników. Nadmiar pustych linii jest usuwany z widoku i kopiowanego tekstu. Kolejne wypowiedzi w widoku rozdziela przerywana linia. Kopiowanie pomija części rozumowania i puste wiadomości. Przeglądarka musi udostępniać schowek (localhost lub HTTPS); odmowa jest sygnalizowana na przycisku.

„Kopiuj całość” przy wspólnych pytaniach łączy obie historie: wspólna wiadomość pojawia się raz, potem odpowiedź OpenRouter i Gemini. Brak odpowiedzi któregoś modelu pomija jego wpis. Kolejne pytania zachowują kolejność; powtórzone pytanie wysłane ponownie jest osobną pozycją. Przycisk kopiuje aktualny tekst rozmów, również gdy dany czat jest obecnie ukryty checkboxem.

Pod „Kopiuj czat” znajduje się „Wyczyść” usuwające historię i błąd tego modelu. Pod „Kopiuj całość” jest „Wyczyść całość”, które usuwa historie obu modeli (również ukryte), błędy i licznik pojedynku. Czyszczenie jest zablokowane podczas odpowiedzi lub aktywnego pojedynku; najpierw użyj „Stop”. Niewysłane szkice i zawartość schowka pozostają bez zmian.
