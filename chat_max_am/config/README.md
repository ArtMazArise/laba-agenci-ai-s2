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

## Lista użytych narzędzi

`CHAT_SHOW_USED_TOOLS` w głównym `config.json` włącza (`true`) lub wyłącza (`false`) dopisek „użyto: web_search, google_search” dla nowych odpowiedzi i ich kopii. Gdy pola nie ma, obowiązuje env, a domyślnie lista jest włączona. Brak użytych narzędzi oznacza brak dopisku. Nie zmienia to czteropolowego schematu JSON.

Lista pochodzi z wyników narzędzi SDK, źródeł i metadanych natywnego wyszukiwania (webSearchQueries), nie z tekstu wygenerowanego przez model ani samego faktu skonfigurowania narzędzia. Nieudana próba Gemini nie dopisuje narzędzia do późniejszej odpowiedzi bez wyszukiwania. Kopiowanie umieszcza „użyto” pod needs_review, jeśli odpowiedź ma ten status, lub na końcu tekstu odpowiedzi w pojedynku.

Bieżący czas jest nadal przekazywany w instrukcji serwerowej każdego requestu przez zmienną `currentDateTime` w `app/api/chat/route.ts`. Proste pytanie o godzinę nadal korzysta z tej wartości, bez wywołania narzędzia. Osobne `aktualnyCzas` obsługuje wyraźne żądanie dokładnej godziny lub milisekund. Funkcje pomocnicze takie jak `getAppInfo`, `getDuelBatchSize`, `getMaxAttempts` i `loadTestQuestions` nie są udostępnione modelowi jako narzędzia. Gotowe narzędzia wyszukiwania to `web_search` i `google_search`; nazwy zachowano. Własne narzędzia opisano poniżej.


## Publiczne dane i dokładny zegar

- `kursWalutyNBP`: średni kurs za jedną jednostkę waluty w PLN z tabel A/B, data publikacji, numer tabeli, źródło i czas pobrania. Ostatni kurs może pochodzić z wcześniejszego dnia roboczego. Dla wskazanej daty, po braku tabeli (HTTP 404), narzędzie wybiera ostatnią opublikowaną tabelę z 14 wcześniejszych dni. Wynik ujawnia datę żądaną i faktyczną oraz usedEarlierDate. [Dokumentacja NBP](https://api.nbp.pl/).
- `pogodaOpenMeteo`: miejscowość wyszukana przez geocoding, kraj, strefa czasowa, temperatura i kod pogody WMO, prognoza temperatur oraz opadów. Bez miejscowości narzędzie prosi o lokalizację. Maksymalnie 16 dni prognozy; „za tydzień” to offset 7, „trzy najbliższe dni” to 3 dni od dziś. [Prognoza](https://open-meteo.com/en/docs), [geocoding](https://open-meteo.com/en/docs/geocoding-api).
- `aktualnyCzas`: data, dzień tygodnia i czas serwera w Europe/Warsaw z milisekundami. Precyzja zapisu nie jest gwarancją idealnej synchronizacji zegara ani czasu odebrania odpowiedzi przez użytkownika. Zwykłe pytanie „Która jest godzina?” nadal używa czasu requestu.

Pytanie o kurs i walutę, pogodę lub dokładny czas wymusza odpowiednie function calling po stronie serwera. Przy doprecyzowaniu miejscowości lub waluty uwzględniane jest poprzednie pytanie. Pozostałe aktualne tematy nadal używają wyszukiwarki. Narzędzia nie przyjmują dowolnych adresów URL, nie wymagają kluczy i nie mają dostępu do sekretów. API ma limit czasu 6 sekund na żądanie; awarie zwracają czytelny wynik narzędzia, bez wymyślonych danych. Model musi obsługiwać function calling razem z używanym structured output. Wybranych modeli nie zmieniono.

Udane wyniki NBP i Open-Meteo przekazują do czatu źródło z datą pobrania, także gdy limit wyszukiwarki Gemini spowodował ponowienie. Lista „użyto” i kopie zawierają faktyczne nazwy wykonanych narzędzi; steruje nią dotychczasowe `CHAT_SHOW_USED_TOOLS`. Schemat czterech pól pozostaje bez zmian.

Test w przeglądarce: zapytaj o kurs EUR, następnie o pogodę w Warszawie na trzy dni i za tydzień. Porównaj zwykłe pytanie o godzinę z żądaniem dokładności do ms: tylko to drugie powinno dopisać `aktualnyCzas`. Nowe pytania są na liście. Testy automatyczne sprawdzają lokalne odpowiedzi API, walidację, awarie, strefę czasową i faktyczny wieloetapowy przepływ SDK obu providerów. Nie wywołują modeli ani prawdziwych API.


## Moja lokalizacja

Przycisk „Moja lokalizacja” wywołuje jednorazowe `navigator.geolocation.getCurrentPosition` dopiero po kliknięciu. Przeglądarka pyta o zgodę; HTTPS lub localhost są wymagane. Brak zgody, brak obsługi i przekroczenie 10 sekund pokazują komunikat z możliwością podania miasta w wiadomości. Nie ma geolokalizacji po IP ani śledzenia `watchPosition`. [Specyfikacja Geolocation W3C](https://www.w3.org/TR/geolocation/).

Współrzędne zaokrąglone do trzech miejsc po przecinku są przechowywane w pamięci karty i dołączane do żądań obu czatów oraz analizy. Serwer sprawdza typ, zakres i brak dodatkowych pól, po sprawdzeniu sesji. Przy ponowieniu zachowany jest kontekst lokalizacji pierwotnego żądania. Nie są zapisywane w pliku, bazie ani localStorage; odświeżenie lub „Usuń lokalizację” usuwa je z bieżącego kontekstu. Źródło już wykonanej prognozy w historii zawiera użyte współrzędne w adresie URL.

`pogodaOpenMeteo` przy pustym `city` używa udostępnionych współrzędnych bez geocodingu. Miasto wpisane w pytaniu ma pierwszeństwo. Bez obu informacji dotychczasowe pytanie o miejscowość pozostaje. Jest to kontekst żądania, a nie osobne narzędzie AI: dopisek „użyto” zawiera faktycznie wykonane `pogodaOpenMeteo`.

Test ręczny: kliknij „Moja lokalizacja”, zaakceptuj zgodę i wybierz „Jaka jest dziś pogoda?”. Sprawdź źródło i dopisek narzędzia. Następnie usuń lokalizację i powtórz — bot powinien zapytać o miasto. Odmowę zgody można sprawdzić po zmianie uprawnień lokalizacji w przeglądarce. Testy automatyczne korzystają z lokalnych atrap API, bez geolokalizacji urządzenia i bez wywołań modeli.


## Porównanie kursu z bieżącym

Dla pytań o porównanie lub zmianę kursu `kursWalutyNBP` zwraca w jednym wykonaniu dwa potwierdzone wyniki: `historical` i `current`. Kod oblicza `changePLN` (bieżący minus historyczny) i `changePercent` (zmiana / historyczny × 100), zamiast pozostawiać te obliczenia modelowi. Każda tabela ma własną datę publikacji, datę pobrania i źródło. Obydwa źródła trafiają do czatu. Schemat końcowej odpowiedzi nadal ma cztery pola.

Dla pytań „3 dni temu”, „tydzień temu”, „30 dni temu”, „rok temu” i „w poprzedni piątek” serwer wyznacza datę na podstawie dnia w Europe/Warsaw; rok wstecz z 29 lutego oznacza 28 lutego. Jawna data RRRR-MM-DD ma pierwszeństwo. Inne okresy model przekazuje jako datę historyczną. Brak daty wymaga doprecyzowania. Jeśli NBP nie opublikował tabeli w żądanym dniu, narzędzie szuka najbliższej wcześniejszej publikacji, maksymalnie 14 dni wstecz. W wyniku requestedDate oznacza datę żądaną, effectiveDate datę publikacji, a usedEarlierDate informuje o cofnięciu. Odpowiedź musi ujawnić obie daty. Awaria sieci lub HTTP inne niż 404 nie uruchamia cofania. Brak danych w całym zakresie kończy się czytelnym komunikatem. Poprzedni piątek jest ściśle wcześniejszy niż dzień bieżący: w piątek oznacza piątek sprzed siedmiu dni. Instrukcja nakazuje wykorzystać udane dane narzędzia, a w razie braku wskazać rzeczywisty problem.

Test ręczny obu AI: „Jaki był kurs EUR według NBP 30 dni temu? Porównaj z bieżącym kursem: podaj zmianę w zł i procentach oraz daty tabel.” Sprawdź obie daty, dwa źródła oraz „użyto: kursWalutyNBP”. Testy automatyczne sprawdzają dane przekazane do kolejnego kroku obu modeli i obliczenia na lokalnych fikcyjnych kursach; nie generują rzeczywistej odpowiedzi modeli.


Po odmowie lokalizacji przeglądarka może pamiętać blokadę i nie pytać ponownie. Aplikacja nie może sama jej cofnąć. Komunikat wskazuje ikonę po lewej stronie adresu, uprawnienie lokalizacji oraz ustawienia lokalizacji systemu. Można też podać miasto w wiadomości. [Ustawienia lokalizacji Chrome](https://support.google.com/chrome/answer/142065).


Porównanie kursów ma teraz stały opis wyliczony przez kod z udanego wyniku NBP: wskazany kurs i jego tabela, bieżący kurs i jego tabela, zmiana w zł (4 miejsca), groszach (2 miejsca) oraz procentach (2 miejsca). Przy cofnięciu do wcześniejszej publikacji opis pokazuje datę żądaną i rzeczywistą. Jeśli daty są takie same, wyjaśnia zerową zmianę. Model nadal kończy odpowiedź i podlega walidacji schematu; dopiero po jej powodzeniu serwer ustawia draft na potwierdzony opis. Błąd dostawcy, odmowa, ucięcie lub brak danych nie są zastępowane poprawnym wynikiem. Ten sam draft trafia do widoku, kopii oraz JSON. Podgląd porównania korzysta z tego samego opisu, zamiast pokazywać niesprawdzone daty lub zaokrąglenia wygenerowane przez model.


## Czasy (JSON)

Każda nowa odpowiedź strumieniowa może zawierać osobne `data-timing`, niezależne od czteropolowego wyniku modelu. W zwykłym czacie rozwijane „Czasy (JSON)” pokazuje `{ "timing": ... }` i ma własny przycisk kopii. „Kopiuj z JSON”, kopie czatu i całości z JSON dopisują diagnostykę osobno; zwykłe kopie i przycisk kopiujący sam wynik JSON zachowują dotychczasową zawartość. Analiza nie wyświetla surowego JSON.

Pomiary pochodzą z monotonicznego zegara serwera i callbacków zainstalowanego SDK: `experimental_onStepStart`, `onStepFinish`, `experimental_onToolCallStart`, `experimental_onToolCallFinish`. Nie zawierają promptów, argumentów, wyników narzędzi, kluczy ani surowych błędów dostawcy. Są ignorowane przy przekazywaniu historii do modelu.

- `totalMs`: czas po stronie serwera od wejścia do endpointu do zapisu diagnostyki. Nie obejmuje transportu odpowiedzi do przeglądarki, dlatego różni się od czasu obok nazwy AI.
- `modelBeforeToolMs`: etapy SDK do pierwszego wykonanego narzędzia, po odjęciu czasu wykonywania funkcji. Bez narzędzi cały czas modelu jest tutaj.
- `toolMs`: czas zajęty przez nasze funkcje `execute`. Przedziały równoległych narzędzi są scalane, więc nie liczą się podwójnie.
- `modelAfterToolMs`: kolejne etapy po pierwszym narzędziu, bez czasu wykonania funkcji.
- `overheadMs`: pozostały czas autoryzacji, przygotowania, walidacji i obsługi strumienia.
- `steps`: poszczególne etapy, z numerem próby (`attempt`, od 1), kroku (`step`, od 0), czasem modelu, funkcji oraz całego etapu.
- `tools`: nazwa, próba, krok, indywidualny czas funkcji oraz `success` (czy funkcja zakończyła się bez wyjątku; wynik biznesowy API nadal może zawierać ok=false).

Czas etapów modelu obejmuje przygotowanie SDK, sieć, kolejkę dostawcy i generowanie. To nie pomiar samego „myślenia”. Natywne wyszukiwanie wykonane po stronie providera jest wliczone w ten czas — jego wewnętrznego czasu SDK nie udostępnia oddzielnie. Ponowienie Gemini zachowuje obie próby w diagnostyce. Przy błędzie po rozpoczęciu strumienia metadane są wysyłane przed komunikatem błędu; nie tworzą poprawnej odpowiedzi w miejsce błędu.

Test ręczny: wyślij to samo pytanie o pogodę do obu czatów, rozwiń „Czasy (JSON)” i porównaj `steps[].modelMs` oraz `tools[].durationMs`. Bez miasta lokalne narzędzie powinno zakończyć się szybko; oczekiwanie na odpowiedź modelu jest mierzone osobno. Dotychczasowe wiadomości nie mają metadanych i nie otrzymują zmyślonych pomiarów. Testy używają atrap modeli i kontrolowanego zegara, bez płatnych wywołań.


## Natychmiastowy wybór miasta przed wywołaniem AI

W zwykłym czacie pytanie o pogodę bez lokalizacji jest przechwytywane przez aplikację przed transportem AI. Dotyczy wspólnego pola i pól pojedynczych czatów. Nie ma wtedy wywołania modelu, narzędzia, sztucznej odpowiedzi AI ani zmyślonej diagnostyki. Nad czatami od razu pojawia się oczekujące pytanie, przyciski Radom/Warszawa/Zakopane/Gdańsk, pole własnej miejscowości i możliwość anulowania.

Po wyborze miasta aplikacja wysyła pełne pierwotne pytanie z dodatkową linią `Miejscowość: ...`, zachowując „za tydzień” albo „na trzy dni”. Wspólne pytanie trafia do zaznaczonych odbiorców, a pytanie z jednego panelu zachowuje tego odbiorcę. Uzyskanie lokalizacji przeglądarki również uruchamia oczekujące pytanie, po udzieleniu zgody. Wpisana miejscowość lub już udostępnione współrzędne pozwalają pominąć wybór. Rozpoznawanie lokalizacji w swobodnym tekście jest proste; jednoznaczna linia „Miejscowość: ...” zapewnia wysłanie bez dodatkowego pytania.

Test ręczny: bez udostępnionej lokalizacji wybierz „Jaka będzie pogoda za tydzień?” i Wyślij. Wybór miasta powinien pokazać się natychmiast, bez wpisu AI i bez nowego /api/chat w panelu sieci. Kliknij Warszawa: dopiero wtedy oba zaznaczone czaty otrzymają pytanie i wykonają rzeczywistą prognozę na wskazany termin. Rzeczywistą prognozę testuje użytkownik; testy automatyczne sprawdzają brak wywołania transportu i treść wysyłaną do odbiorców na atrapach.


## Zamknięcie wyboru miejscowości i żądanie w diagnostyce

Panel miejscowości jest widoczny wyłącznie dla oczekującego pytania. Wysłanie, anulowanie lub wyczyszczenie usuwa oczekujące pytanie; sama historia pogody nie otwiera panelu ponownie. Wybór nigdy nie odtwarza pytania z historii. Składanie wiadomości usuwa poprzednie linie „Miejscowość:” / „Miasto:” i dodaje tylko aktualne miasto. Serwer odczytuje ostatnią jawną linię z bieżącej wiadomości i nadaje jej pierwszeństwo w wykonaniu `pogodaOpenMeteo`, nawet jeśli model poda stare miasto.

„Żądanie i czasy (JSON)” oraz kopie z JSON zawierają teraz osobne `request` obok `timing`. To wybrane dane żądania aplikacji: endpoint, dostawca, ustawiony model, tryb, dokładna bieżąca wiadomość, liczba wiadomości historii, udostępnione współrzędne (lub null) i faktyczne wywołania narzędzi. `input` oznacza argumenty przekazane przez model, `effectiveInput` uwzględnia zastosowane przez serwer miasto lub datę porównania. Rejestrowane są wyłącznie dozwolone pola argumentów własnych narzędzi. Nie jest to zrzut nagłówków HTTP, kluczy, instrukcji systemowej ani całej historii. Dane diagnostyczne nie są ponownie przekazywane do modelu. Schemat biznesowego wyniku pozostaje czteropolowy.

Test ręczny: zapytaj o pogodę, wybierz Radom — panel ma zniknąć od razu. Zadaj nowe pytanie o pogodę i wybierz Zakopane. Wiadomość oraz `request.message` mają zawierać jedną linię miejscowości, a `request.toolCalls[].effectiveInput.city` ma wskazywać Zakopane. Testy lokalne wymuszają błędne miasto modelu i sprawdzają, że wykonanie API obu providerów mimo tego korzysta z miasta w bieżącej wiadomości.
