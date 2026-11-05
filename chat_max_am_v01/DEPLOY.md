# Publikacja MAX na własnym GitHub i Vercel

Publikujemy tylko chatbot. Repozytorium nadrzędne zawiera materiały LABA — nie dodawaj tam nowego commita ani nie używaj jego remote do publikacji aplikacji.

## Przygotowanie źródeł

1. `npm install` uzupełnia istniejący `package-lock.json`, w tym SDK prywatnego magazynu Vercel Blob. Zachowaj lockfile.
2. Wykonaj `npm test`, `npx tsc --noEmit` oraz `npm run build`. Build powinien sprawdzać typy, nie pomijać błędów.
3. Wykonaj `npm run publish:prepare`. Skrypt sprawdza indeks Git pod kątem nazw plików sekretów i rozpoznanych wzorców kluczy, sprawdza zgodność lockfile i kopiuje wyłącznie kod aplikacji do `.publish/max-chatbot/`. Sekrety nie są odczytywane z `.env.local` ani kopiowane. W razie śledzonego sekretu lub wykrytego klucza skrypt zatrzymuje publikację i nie wypisuje jego wartości.
4. W utworzonej kopii jest osobne repo Git z gałęzią `main` i przygotowanymi plikami do commita, bez historii kursu, remote, `.env.local`, `.auth-state`, `.vercel` i `node_modules`. Skrypt nie robi commita ani push. Nie nadpisuje istniejącej kopii.
5. Na swoim koncie GitHub utwórz nowe, puste repozytorium, np. `max-chatbot`. Nie inicjalizuj go dodatkowym README. Następnie w katalogu `.publish/max-chatbot` zapisz commit i ustaw remote na to konkretne repozytorium. Przed push sprawdź `git remote -v`. Nie może to być repo `laba-agenci-ai-s2`, fork kursu ani repo prowadzącego.

Nigdy nie używaj `git add -f` do plików `.env`. `.env.example` może być w repo — pola sekretów muszą być puste. Skan wzorców jest kontrolą pomocniczą, nie gwarancją wykrycia każdego możliwego sekretu. Jeśli sekret był już w historii opublikowanego repo, zatrzymaj publikację i wymień ten sekret; samo dodanie gitignore nie usuwa go z historii.

## Import do Vercel

1. Zaloguj się do Vercel przez własne konto. Wybierz Add New → Project i zaimportuj wyłącznie nowe repo chatbota. Framework: Next.js, Root Directory: katalog główny repo, Build Command: `npm run build`, Install Command: `npm ci`. Wybierz obsługiwaną wersję Node.js 24 LTS.
2. W ustawieniach Environment Variables wpisz wymagane zmienne samodzielnie w panelu. Nie podawaj haseł ani tokenów w rozmowie. Nie używaj prefiksu `NEXT_PUBLIC_` dla sekretów.
3. W Storage utwórz **prywatny Vercel Blob Store** i połącz go z projektem dla środowiska Production. Integracja doda `BLOB_READ_WRITE_TOKEN`. Magazyn przechowuje tylko techniczny stan sesji i prób logowania, nie historię czatu ani klucze. To magazyn plików, bez dodawania bazy danych. Obowiązują limity i rozliczenia planu Vercel Blob.
4. Jeżeli pierwszy deployment powstał przed podłączeniem Blob, logowanie pozostanie celowo zablokowane. Po podłączeniu magazynu i ustawieniu zmiennych wykonaj Redeploy. Nie traktuj pierwszego adresu jako gotowego przed testem hasła.
5. Nie ustawiaj `AUTH_STATE_DIR` na Vercel — dysk funkcji nie jest globalny ani trwały. Aplikacja wykrywa Vercel i wymaga prywatnego Blob. Odczyty pomijają cache, a zapisy warunkowe ETag chronią licznik i wylogowanie przy wielu instancjach. Brak tokenu, błąd magazynu lub konflikt blokują dostęp.

Preview i Production nie powinny współdzielić stanu warsztatu: użyj osobnego prywatnego magazynu i sekretów dla testowych deploymentów lub pozostaw je bez konfiguracji logowania.

## Nazwy zmiennych na Vercel

Wymagane do ochrony dostępu:

- `CHAT_PASSWORD`
- `CHAT_MAX_ATTEMPTS`
- `CHAT_DUEL_ROUNDS`
- `SESSION_SECRET`
- `BLOB_READ_WRITE_TOKEN` — dodawany przy połączeniu prywatnego Blob Store

Dla OpenRouter:

- `OPENROUTER_ENABLED`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`

Dla Gemini:

- `GEMINI_ENABLED`
- `GOOGLE_GENERATIVE_AI_API_KEY`
- `GEMINI_MODEL`

Klucz i model są potrzebne tylko dla włączonego dostawcy. `AUTH_LEARNING_MODE` dotyczy lokalnego developmentu; na Vercel tryb nauki jest zawsze wyłączony. `NODE_ENV` i `VERCEL` ustawia platforma.

## Obowiązkowe sprawdzenie opublikowanego adresu

Nie uznawaj publikacji za skończoną na podstawie samego zielonego builda.

1. Otwórz finalny adres w nowym prywatnym oknie: ma być ekran hasła, bez widocznego czatu.
2. Bez sesji wykonaj `fetch('/api/chat', {method: 'POST', credentials: 'omit'}).then(async r => console.log(r.status, await r.text()))`. Oczekuj 401 i komunikatu MAX o braku sesji, a nie tylko blokady samego Vercel. To nie wywołuje modelu.
3. Samodzielnie sprawdź jedno błędne hasło. Powinno odmówić wejścia. Ta próba generuje prawdziwe żarty aktywnych modeli, więc może zużyć ich limit lub środki. Automatyczne testy robią to na atrapach; agent nie wykonuje płatnego testu.
4. Samodzielnie wpisz poprawne hasło: czat ma się otworzyć. Nie udostępniaj hasła agentowi.
5. Kliknij „Wyjdź”, odśwież stronę i ponownie sprawdź 401 `/api/chat`. Ekran hasła ma wrócić, a sesja ma zostać unieważniona również na serwerze.
6. Jeśli chcesz, samodzielnie wyślij pierwszą wiadomość do wybranego modelu i potwierdź strumieniowanie. Dopiero po udanych testach zapisz działający link jako finalny adres aplikacji.

Dokumentacja: [GitHub → Vercel](https://vercel.com/docs/git/vercel-for-github), [zmienne środowiskowe](https://vercel.com/docs/environment-variables), [prywatny Blob i zapisy warunkowe](https://vercel.com/docs/vercel-blob/using-blob-sdk).
