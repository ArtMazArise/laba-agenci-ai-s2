# Konfiguracja aplikacji

Główny plik `config.json` jest w katalogu projektu. Zawiera wyłącznie ustawienia niesekretne. Wpisano w nim nazwy modeli widoczne na ostatnich zrzutach aplikacji.

Kolejność: pole obecne w `config.json` → brakujące pole z env → dotychczasowa wartość domyślna aplikacji. `false` i pusty tekst są jawnymi wartościami, nie uruchamiają fallbacku. Aby wrócić do env dla modelu, usuń jego pole z pliku.

Obsługiwane pola:

| Nazwa | Typ JSON |
| --- | --- |
| `OPENROUTER_MODEL`, `GEMINI_MODEL` | tekst |
| `OPENROUTER_ENABLED`, `GEMINI_ENABLED` | boolean `true`/`false` |
| `CHAT_MAX_ATTEMPTS`, `CHAT_DUEL_ROUNDS` | liczba całkowita 1–100 |
| `CHAT_TEST_QUESTIONS_ENABLED`, `AUTH_LEARNING_MODE` | boolean `true`/`false` |
| `AUTH_STATE_DIR` | tekst; dla własnego serwera trwały katalog absolutny |

Na przykład można dopisać `"CHAT_DUEL_ROUNDS": 2` lub `"GEMINI_ENABLED": false`. Pozostałe ustawienia nadal pochodzą z env. Pytania testowe pozostają w osobnym `config/test-questions.json`.

Klucze API, `CHAT_PASSWORD`, `SESSION_SECRET` i `BLOB_READ_WRITE_TOKEN` są dozwolone tylko w env. Plik konfiguracji odrzuca te pola, inne nieznane parametry oraz niewłaściwe typy. Zmienne platformy (`NODE_ENV`, `VERCEL` i metadane wdrożenia) pozostają w env. Tryb nauki nie wyłącza ochrony w produkcji.

Ta sama konfiguracja jest używana w zwykłym czacie, analizie, nazwach modeli w nagłówkach, żartach po błędnym haśle i limitach aplikacji. Mechanizm konfiguracji nie zwraca sekretów do przeglądarki. Nie trzeba przenosić żadnych istniejących sekretów.

Lokalnie po edycji odśwież stronę; w razie potrzeby uruchom ponownie `npm run dev`. W produkcji wykonaj nowy build/wdrożenie. Na Vercel wartości z pliku mają pierwszeństwo przed zmiennymi środowiskowymi, dopóki pola pozostają w pliku.

## Wyszukiwanie i źródła

W zainstalowanym AI SDK 6 używamy `stepCountIs(5)` (nie ma eksportu `isStepCount`). Zachowujemy opcję `system`, właściwą dla tej wersji, i istniejący structured output. Implementację sprawdzono w `node_modules/ai/docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx`, `09-troubleshooting/14-tool-calling-with-structured-outputs.mdx`, `04-ai-sdk-ui/02-chatbot.mdx` oraz typach providera.

OpenRouter otrzymuje `openrouter.tools.webSearch({ maxResults: 3, engine: "native" })`. Bezpośrednie Gemini, używające osobnego klucza Google, otrzymuje `google.tools.googleSearch({})` pod nazwą `google_search`. Nie zmieniono modeli ani kluczy. Wyszukiwanie odbywa się tylko wtedy, gdy wywoła je model; treść stron nie może zmieniać instrukcji firmy. Dotychczasowy zakaz pytań o jedzenie nadal obowiązuje.

Źródła są przekazywane przez `toUIMessageStream({ sendSources: true })`. W structured output przesyłane są źródła i podgląd szkicu, a gotowy JSON dopiero po walidacji. Pod odpowiedzią widać tytuły, linki i „pobrano” z czasem odebrania źródła na serwerze, wyświetlanym w strefie Europe/Warsaw. To nie data publikacji artykułu. Linki są ograniczone do HTTP/HTTPS, duplikaty pomijane. Źródła nie są dopisywane do czteropolowego JSON i nie są wymyślane przy braku wyników.

Zgodnie z dokumentacją OpenRouter natywna wyszukiwarka może ignorować limit maxResults; aplikacja przekazuje wartość 3, ale pokazuje wszystkie faktycznie otrzymane źródła. `stepCountIs(5)` ogranicza kroki AI SDK, a nie wewnętrzne operacje serwerowego narzędzia. [Dokumentacja narzędzia OpenRouter](https://openrouter.ai/docs/guides/features/server-tools/web-search).

Test w przeglądarce: zapytaj „Jakie są najnowsze wiadomości o misjach NASA? Użyj wyszukiwania i podaj źródła.” Sprawdź klikalne tytuły i datę odbioru. Jeśli skonfigurowany model nie obsługuje natywnego wyszukiwania lub jego połączenia z JSON Schema, aplikacja pokazuje błąd; nie zmienia modelu ani nie przechodzi samodzielnie na inny silnik. Pierwszy rzeczywisty test uruchamia użytkownik. Testy automatyczne używają tylko lokalnych odpowiedzi HTTP/SDK.

## Błędy wyszukiwania na localhost

HTTP 429 od modelu oznacza limit u dostawcy (modelu, zapytań lub wyszukiwania); ponowne uruchomienie Next.js nie resetuje tego limitu. Starsze wdrożenie bez narzędzi może działać inaczej. Kod błędu OpenRouter może być przesłany wewnątrz odpowiedzi SSE HTTP 200 jako zwykły obiekt zamiast APICallError. Aplikacja rozpoznaje taki kod oraz błędy opakowane w cause/lastError, bez przesyłania surowych komunikatów, metadanych lub kluczy do przeglądarki. Błąd nie staje się pozornie poprawną odpowiedzią i nie zmienia modelu. Jedyny automatyczny fallback opisano poniżej: Gemini 429 → jedna próba bez wyszukiwania. Przy ogólnym błędzie nie należy zakładać błędnego klucza bez rozpoznania odpowiedzi dostawcy.

## Gemini: odpowiedź bez wyszukiwania po limicie

Gdy Gemini zwróci HTTP 429, aplikacja wykonuje dokładnie jedną dodatkową próbę z tym samym modelem, kluczem, wiadomością i historią, ale bez narzędzia wyszukiwania. Dotyczy czatu, analizy i pojedynku. OpenRouter nie korzysta z tego mechanizmu. Inne błędy, anulowane żądania i błąd drugiej próby nie uruchamiają kolejnych wywołań.

Udana odpowiedź ma widoczny dopisek „Bez wyszukiwania — limit API”, także w kopii. Nie dostaje źródeł z nieudanej próby. Częściowy podgląd pierwszej próby jest usuwany przed nowym generowaniem. JSON nadal podlega temu samemu schematowi. Instrukcja bez wyszukiwania zabrania podawania z pamięci aktualnego kursu, ceny i niezweryfikowanego źródła; znane fakty firmy pozostają dostępne. Dla aktualnych danych bot ma wskazać brak możliwości weryfikacji.

Jeśli również próba bez wyszukiwania zwróci 429, aplikacja wyświetla informację o limicie generowania odpowiedzi. Ten mechanizm nie obchodzi limitu całego modelu. Test w przeglądarce: ponów pytanie o kurs euro przy Gemini. Gdy wyszukiwanie ma limit, lecz generowanie nadal jest dostępne, oczekiwany jest szkic bez źródeł i jawna informacja o braku wyszukiwania. Testy automatyczne używają tylko atrap SDK i HTTP, nie wywołują modeli.
