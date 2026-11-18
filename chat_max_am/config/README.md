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


## Zdjęcia w wiadomościach

W zwykłym czacie (wspólne pole lub pojedynczy panel) i analizie można wkleić zdjęcie Ctrl+V albo użyć „＋ Zdjęcie” do wyboru pliku. Przed wysłaniem jest podgląd i przycisk usunięcia. Zdjęcie nie jest wysyłane podczas wyboru lub wklejenia — dopiero przy „Wyślij”/„Ślij”/„Analizuj”. Wiadomość bez tekstu otrzymuje prosty opis polecenia po stronie interfejsu. Wspólne zdjęcia trafiają do obu zaznaczonych czatów. Pojedynek nie wysyła zdjęć i jest wyłączony przy załącznikach.

Używany jest interfejs zainstalowanego SDK: `sendMessage({ text, files: FileUIPart[] })`, pliki `type: file` z mediaType, filename i adresem data URL. `validateUIMessages` oraz `convertToModelMessages` przekazują obrazy do OpenRouter/Gemini. Model musi obsługiwać obrazy oraz używany format odpowiedzi; nie zmieniamy wybranego modelu ani dostawcy. HTTP 400 informuje także o potrzebie obsługi obrazów. Klucze i sprawdzenie sesji pozostają na serwerze.

Dozwolone są PNG, JPG/JPEG i WebP. Maksymalnie 3 zdjęcia na wiadomość, do 1,5 MB każde i 2,5 MB łącznie w historii rozmowy. Klient i serwer sprawdzają format, wielkość i sygnaturę pliku. Przy przekroczeniu limitu historii należy wyczyścić czat i użyć mniejszych zdjęć. Zewnętrzne URL plików, SVG, inne typy plików i załączniki w wiadomościach podszywających się pod asystenta są odrzucane przed modelem. Nie ma nowej bazy, bucketu ani osobnego endpointu uploadu; zdjęcia są przesyłane jako część historii rozmowy.

Diagnostyka request.images zawiera nazwy, typy i wielkości zdjęć, bez kopiowania base64 do JSON diagnostycznego. Treść obrazów to dane klienta, a nie instrukcje zmieniające zasady firmy. Po odświeżeniu lub wyczyszczeniu rozmowy zdjęcia nie są utrwalane przez aplikację. Dostawca modelu otrzymuje zdjęcia dopiero przy wysłaniu wiadomości.

Test ręczny: wklej niewielki obraz w pole wiadomości; sprawdź podgląd i usunięcie. Następnie dodaj plik przez „＋ Zdjęcie”, dopisz pytanie i wyślij do zaznaczonych modeli. Sprawdź zdjęcie w historii i metadane images w diagnostyce. Rzeczywisty test rozpoznawania wykonuje użytkownik. Testy automatyczne sprawdzają walidację oraz przekazanie obrazu przez prawdziwy SDK obu providerów wyłącznie z atrapami odpowiedzi, bez wywołań modeli.


## Vision i generowanie obrazu

„Dodaj zdjęcie” przyjmuje JPG/PNG/WebP do 4 MB z dysku lub schowka. Duże pliki są optymalizowane w przeglądarce (JPEG, białe tło przezroczystości) przed wysłaniem, aby kodowanie base64 nie przekroczyło limitu żądania Vercel. Limit danych obrazu wysyłanych do modelu pozostaje 1,5 MB na plik i 2,5 MB na historię. Wysłana miniatura pokazuje przygotowany plik. Analiza bieżącego załącznika nie włącza wyszukiwarki i nie wykonuje ponowienia Gemini „bez wyszukiwania”. Instrukcja traktuje opis obrazu jako dozwolone zadanie, bez odsyłania do oferty firmy; pozostałe granice i schemat wyniku pozostają.

Pod odpowiedzią i wygenerowanym obrazem widać „Model: ...”. Identyfikator analizy pochodzi z pola `model` odpowiedzi SSE OpenRouter albo `modelVersion` Google. Zainstalowany provider Google nie przekazuje tego ostatniego pola jako faktycznego modelId, dlatego lekka nakładka fetch odczytuje wyłącznie identyfikator z oryginalnych zdarzeń, bez zmieniania strumienia. Brak identyfikatora oznacza jawny komunikat „dostawca nie potwierdził identyfikatora”, a nie nazwę z konfiguracji. Nagłówek panelu nadal pokazuje model skonfigurowany. Wygenerowany obraz ma modelId z `generateImage().responses`, czyli pola model odpowiedzi OpenRouter.

`POST /api/image` najpierw sprawdza sesję, a dopiero potem parsuje opis i wywołuje model. Przyjmuje wyłącznie `{ "prompt": "..." }`, od 1 do 500 znaków. Używa `generateImage` i `openrouter.imageModel`, n=1, maxRetries=0, klucza OPENROUTER_API_KEY oraz publicznego OPENROUTER_IMAGE_MODEL z config.json (env, gdy nie ma wpisu). Domyślny model z instrukcji to `google/gemini-3.1-flash-image-preview`. Błąd dostępności, limit lub brak obrazu nie powodują automatycznej zmiany modelu ani pozornego wyniku. Generowanie uruchamia przycisk „Wygeneruj obraz” albo jawne polecenie zaczynające się od „Wygeneruj obraz:” wysłane przez „Wyślij”/„Ślij”. Takie polecenie omija zwykłe modele rozmowy i kieruje dokładnie jedno żądanie do /api/image. Zwykłe wiadomości nadal trafiają do /api/chat. Generowanie działa teraz w osobnym trybie Generator. Jedno kliknięcie Generuj robi jedno wywołanie i zapisuje wynik w galerii Generatora. Nie powiela go w dwóch czatach. Jawny prefiks Wygeneruj obraz: wysłany w czacie przełącza na Generator i uruchamia to samo pojedyncze wywołanie. Obraz trafia do historii jako osobny wynik; nie jest automatycznie ponownie wysyłany jako załącznik przy kolejnych pytaniach. Brak nowej bazy i trwałego zapisu wygenerowanych plików.

Oficjalne materiały: [Nano Banana 2](https://openrouter.ai/google/gemini-3.1-flash-image-preview), [generowanie obrazów OpenRouter](https://openrouter.ai/docs/guides/overview/multimodal/image-generation), [Google GenerateContentResponse — modelVersion](https://ai.google.dev/api/generate-content). Implementacja korzysta z API zainstalowanych ai 6 i providera OpenRouter 2.9.1, potwierdzonego w lokalnych docs i typach; nie aktualizowano zależności.

Test ręczny A: dodaj zdjęcie, wybierz „Co widzisz na tym zdjęciu? Opisz w trzech punktach.” i wyślij. Sprawdź miniaturę, konkretną odpowiedź i identyfikator modelu pod nią. Test ręczny B: wybierz nowy opis logo z listy i kliknij „Wygeneruj obraz”. Sprawdź wynik i identyfikator pod obrazem. Nie testowano płatnego generowania ani Vision na prawdziwym modelu; testy lokalne używają prawdziwego SDK i providerów z atrapami HTTP oraz sprawdzają odmienny rzeczywisty model niż ustawiony w żądaniu, brak sesji i błędy.


## Generator i kopiowanie grafiki

Tryb „Generator” znajduje się obok „Zwykły czat” i „Analiza wiadomości”. Ma osobne pole opisu (500 znaków), mniejszy przycisk „Generuj”, „Wstaw przykład”, historię grafik i usuwanie wyników. Zwykłe czaty i analiza zachowują swoje historie; wcześniejsze grafiki w czatach nadal są wyświetlane. Wyniki nowego Generatora nie są automatycznie wysyłane do modeli rozmowy. Dostępny model nadal pochodzi z OPENROUTER_IMAGE_MODEL; nie dodawano automatycznego porównywania ani zamiany na droższe modele.

„Kopiuj obraz” przy wygenerowanej grafice i wysłanym zdjęciu zapisuje sam obraz jako image/png. JPEG/WebP są lokalnie konwertowane do PNG na potrzeby schowka. „Kopiuj” i „Kopiuj z JSON” wiadomości przygotowują text/plain, bezpieczny text/html z obrazami i, dla jednej grafiki, image/png. Kopie całego czatu i całości przygotowują HTML z wszystkimi obrazami oraz dotychczasowy tekst. Wspólne pytanie ze zdjęciem pozostaje w kopii całości tylko raz. Surowy JSON wyniku lub diagnostyki nadal kopiuje się jako sam tekst.

Program docelowy wybiera reprezentację: edytor obsługujący HTML może wkleić opis z obrazami, program graficzny może wkleić PNG, a edytor tekstowy sam tekst. Nie wszystkie programy zachowują obrazy z HTML; do samej grafiki służy niezależny „Kopiuj obraz”. Brak obsługi lub odmowa schowka pokazują „Nie skopiowano”; nie udajemy skopiowania obrazu przez ciche zastąpienie go tekstem. Korzystamy z ClipboardItem i navigator.clipboard.write, wyłącznie w reakcji na kliknięcie; nie odczytujemy schowka. Obsługiwane źródła to tylko lokalne data URL PNG/JPEG/WebP, bez pobierania zewnętrznych adresów. Tekst w HTML jest escapowany. [Specyfikacja Clipboard API](https://www.w3.org/TR/clipboard-apis/).

Test ręczny: w Generatorze kliknij „Kopiuj obraz” przy istniejącej grafice i wklej do programu obsługującego obrazy. Następnie sprawdź „Kopiuj” w edytorze HTML/dokumentów. Testy lokalne sprawdzają formaty schowka i treść HTML na atrapach, bez dostępu do systemowego schowka i bez generowania nowych obrazów.


## Zapis obrazu i opis Vision w Generatorze

„Zapisz obraz” pod grafiką proponuje nazwę `max-<opis>-<data i godzina Warszawy>.<png|jpg|webp>`. Rozszerzenie odpowiada typowi obrazu. Nazwa ma ograniczoną długość, usuwa znaki ścieżek i normalizuje polskie znaki. Jeśli przeglądarka udostępnia `showSaveFilePicker`, okno otrzymuje suggestedName, typ pliku i startIn=downloads. Użytkownik może zmienić nazwę i miejsce; aplikacja nie wymusza absolutnej ścieżki do katalogu domowego. Bez tego API używany jest zwykły download według ustawień przeglądarki. Anulowanie okna nie uruchamia dodatkowego pobierania. Obraz jest zapisywany bez ponownego generowania i bez zmiany jego bajtów. [Specyfikacja File System Access](https://wicg.github.io/file-system-access/).

Pod obrazem są również przyciski „Opisz — OpenRouter” i „Opisz — Gemini”. Kliknięcie wysyła wybraną grafikę jako file do istniejącego /api/chat z pytaniem o opis w trzech punktach. Większy obraz jest przygotowywany tym samym mechanizmem optymalizacji co załączniki. Wynik Vision i faktyczny identyfikator modelu pojawiają się pod obrazem; błędy są jawne. Samo generowanie obrazu nie uruchamia automatycznie dodatkowej analizy. Opis jest przechowywany w pamięci galerii i trafia do kopii wyniku oraz kopii całości. „Polecenie” przy grafice to prompt generatora, a „Opis zdjęcia” to odpowiedź Vision — są pokazane osobno.

Test ręczny: kliknij „Zapisz obraz” przy istniejącej grafice i sprawdź proponowaną nazwę, rozszerzenie oraz katalog. Następnie kliknij wybrany przycisk „Opisz” i sprawdź trzy punkty oraz model pod opisem. Testy lokalne sprawdzają nazwę i zapis na atrapach systemowego okna, bez rzeczywistego zapisu w Pobranych i bez wywoływania modeli.


## Vision w Analizie i standard obrazów

Gdy w Analizie dodano obraz, sekcja zmienia się na „Analiza obrazu — Vision”, a wynik jest opisany jako „Opis zdjęcia”. Zamiast sekcji kategorii/priorytetu i etykiety szkicu wyświetlany jest opis oraz model z API. Schemat czterech pól nadal jest walidowany wewnętrznie. Analiza tekstowej wiadomości klienta zachowuje poprzedni interfejs i reguły firmy.

Vision ma oddzielną instrukcję serwerową: domyślnie trzy konkretne punkty obejmujące obiekt, napisy/szczegóły i kolory/kompozycję. Nie wymaga, aby obraz zawierał wiadomość klienta i nie odsyła do oferty firmy tylko dlatego, że jest grafiką. Tekst na obrazie jest niezaufanym materiałem, nie zmianą zasad. Nieczytelne elementy nie są zgadywane. Rzeczywistą jakość odpowiedzi sprawdza użytkownik na modelu; testy lokalne sprawdzają instrukcję, format i metadane na atrapach.

Standard: trzy klikalne opisy z config/image-prompts.json pojawiają się pod polem wspólnym i w Generatorze. Kliknięcie tylko ustawia treść. „Generuj” pokazuje „Generuję obraz…” i blokuje kolejne generowanie przez stan interfejsu oraz natychmiastową blokadę ref. API nadal generuje n=1, bez retry. „Pobierz” korzysta z mechanizmu zapisu z nazwą, rozszerzeniem i sugestią katalogu Pobrane. PDF, nieobsługiwany format i plik ponad 4 MB są odrzucane w przeglądarce przed FileReader, dekodowaniem lub żądaniem serwerowym.

Test ręczny: w Analizie dodaj grafikę bez tekstowego pytania i kliknij „Analizuj zdjęcie” — oczekiwane trzy konkretne punkty i model pod opisem. Sprawdź trzy podpowiedzi w Generatorze. Próba wybrania PDF lub pliku ponad 4 MB powinna dać komunikat, bez /api/chat w panelu sieci. Wybrany wariant zaawansowany to Styl marki MAX, opisany poniżej.


## Styl marki MAX — wariant zaawansowany

Publiczne IMAGE_BRAND_STYLE w głównym config.json określa wspólny styl wszystkich nowych grafik: minimalistyczny mrok, czarne tło #080b08, limonkowy akcent #bdff59, wyraziste kontury, motyw czaszki/wampira i prosty układ. Tekst jest edytowalny w pliku. Gdy pola nie ma, obowiązuje env; pusty/brakujący styl uruchamia serwerowy styl domyślny MAX. Maksymalnie 2000 znaków; błędna konfiguracja blokuje wywołanie modelu.

Po sprawdzeniu sesji /api/image oddziela JSON-em temat użytkownika od stałych zasad wizualnych i dopisuje styl po stronie serwera. Przeglądarka nadal może wysłać wyłącznie prompt do 500 znaków — próby nadpisania stylu lub modelu dodatkowymi polami są odrzucane. Stały format 1:1 jest również przekazywany jako aspectRatio w generateImage. Nie zmieniono modelu ani liczby generowanych obrazów. Dołączenie instrukcji stylu nie jest gwarancją, że model wizualny zawsze zrealizuje każdy detal; wynik ocenia użytkownik.

Odpowiedź API zawiera prompt użytkownika, brandStyle i effectivePrompt faktycznie wysłany do generatora. Pod nową grafiką rozwijane „Polecenie wysłane do generatora — styl MAX” pokazuje ten tekst i umożliwia kopię. To dane publiczne, bez kluczy i nagłówków. Identyfikator modelu nadal pochodzi z odpowiedzi API.

Test ręczny: wygeneruj dwa różne tematy i porównaj wspólną paletę, klimat oraz kwadratowy format. Rozwiń wysłane polecenie, aby potwierdzić dołączenie stylu. Testy lokalne sprawdzają rzeczywisty payload providera na atrapach, w tym sprzeczne żądanie koloru, własny styl z config.json i próbę nadpisania z przeglądarki. Nie generowano płatnych obrazów.

## Agent — wspólny endpoint

Od v03.44 czat oraz analiza korzystają z `POST /api/agent`. Sprawdzenie sesji poprzedza parsowanie danych i każde wywołanie modelu. Klucze nadal pozostają wyłącznie na serwerze. Modele pozostają zgodne z dotychczasowym configiem/env.

- `mode: "chat"`: `streamText`, do pięciu kroków, serwerowe narzędzia `kursWalutyNBP`, `pogodaOpenMeteo`, `aktualnyCzas`, `web_search` i `generujObraz`. Złożone zadanie najpierw zbiera informacje, potem tworzy grafikę. Znane intencje czasu/kursów/pogody nadal wymuszają właściwe API, dalsze kroki wybiera model. Pojedynek zachowuje wewnętrzny tryb zgodności `duel`.
- `mode: "analyze"`: `generateText` + `Output.object`, ścisły schemat czterech pól i dodatkowa walidacja po stronie serwera. Wynik wraca w tym samym protokole UI jako zatwierdzone dane, bez podglądu niezwalidowanego szkicu. Wewnętrzny alias `analysis` pozostaje dla ponawiania starszych żądań.
- Gemini używa funkcji `web_search`, która wywołuje natywny Google Search w osobnym zapytaniu **na tym samym skonfigurowanym modelu**. Dzięki temu funkcje aplikacji i wyszukiwanie nie są mieszane w jednym wywołaniu Gemini. OpenRouter używa gotowego `openrouter.tools.webSearch({ maxResults: 3, engine: "native" })`.
- `generujObraz` korzysta z istniejącego, chronionego mechanizmu generowania i stylu MAX. Do przeglądarki zwraca plik i faktyczny model obrazu. `toModelOutput` przekazuje modelowi tylko krótki tekst wyniku, bez base64 i bez ponownego analizowania obrazu. Maksymalnie jedna udana generacja na pojedyncze żądanie agenta. Przy zaznaczonych obu czatach każdy agent wykonuje swoje zadanie niezależnie.
- W czacie grafika jest widoczna w odpowiedzi i dopisywana do Generatora. Widok nie przełącza się automatycznie. Usunięta grafika nie wraca do galerii przy kolejnej wiadomości. Etykiety narzędzi pojawiają się w kolejności wywołań; przy wyczerpaniu pięciu kroków bez odpowiedzi pojawia się „Przerwałem po 5 krokach”.
- Błędy generowania, odmowa, ucięcie, dodatkowe pola lub niezgodny JSON nie są zastępowane poprawnym wynikiem. `send_now`, uprawnienia i instrukcja systemowa z przeglądarki są odrzucane.

Zachowane przejściowo `/api/chat` i `/api/image` umożliwiają powrót i ręczny Generator. Nie usuwamy ich przed sprawdzeniem nowej ścieżki na rzeczywistym modelu. `/api/image` jest też współdzielonym wykonawcą narzędzia (wywołanie funkcji na serwerze, bez żądania sieciowego do własnej aplikacji).

SDK 6: API zweryfikowane w `node_modules/ai/docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx`, `10-generating-structured-data.mdx`, typach `@ai-sdk/provider-utils` i dokumentacji providera Google. W tej wersji obowiązują `system`, `stepCountIs(5)`, `tool({ inputSchema, execute, toModelOutput })`.

Sprawdzenia lokalne: `tests/agent-route.test.mjs` uruchamia prawdziwy SDK i providerów z lokalnymi atrapami HTTP. Obejmuje sesję, dwa narzędzia i obraz, brak base64 w kontynuacji modelu, limit kroków, wynik analizy dla obu providerów, cztery błędne schematy, odmowę, ucięcie i błędy dostawcy. Nie wykonuje zapytań do modeli ani do publicznego internetu.

Test ręczny w zwykłym czacie: „Sprawdź, jaka będzie jutro pogoda w Krakowie, potem wygeneruj plakat zapraszający na poranny bieg po Plantach.” Sprawdź kolejność narzędzi, opis/źródła, obraz i faktyczny model, pozostanie w czacie oraz obecność obrazu po ręcznym przełączeniu do Generatora. Osobno sprawdź analizę wiadomości klienta i próbę `/api/agent` bez sesji (401). Rzeczywiste wywołania wykonuje użytkownik; nie zmieniamy automatycznie modeli na droższe.

### Poprawka pochodzenia i obowiązkowego obrazu

Wewnętrzne wywołanie `/api/image` z agenta zachowuje `Origin`, `Host`, `Sec-Fetch-Site` i cookie wejściowego żądania. Nie tworzy sztucznego Origin ani nie omija `requireSession`/CSRF. Test z prawdziwym modułem autoryzacji obejmuje localhost, proxy Vercel oraz odrzucenie obcej domeny, braku Origin, braku sesji i cross-site.

Wyraźne zadanie wygenerowania grafiki dopisuje `generujObraz` do kolejki wymaganych narzędzi po API pogody/kursu/czasu. `prepareStep` wymusza generator dopiero po zebraniu tych informacji, a końcowa kontrola odrzuca wynik pomijający to narzędzie. Nie polegamy wyłącznie na obietnicy z promptu. Test odtwarza zadanie pogoda w Krakowie + plakat dla obu dostawców bez prawdziwych wywołań API.
