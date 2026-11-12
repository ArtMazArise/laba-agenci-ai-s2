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
