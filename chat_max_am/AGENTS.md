# Zasady tego projektu

- Pisz po polsku i krótko. Realizuj bieżący krok użytkownika.
- Widoczna wersja ma format `v03.xx`; obecna to `v03.20`.
- W oznaczeniu wersji pokazuj tylko numer. Nie dodawaj opisów jego znaczenia ani tematu.
- Przy kolejnej ukończonej zmianie aplikacji zwiększaj tylko `xx`, raz na spójny zestaw zmian.
- Prefiks `03` zmieniaj wyłącznie na wyraźny sygnał użytkownika.
- W `package.json` zachowuj poprawny SemVer: `0.3.20` odpowiada widocznemu `v03.20`. Synchronizuj wersję główną i pakietu głównego w `package-lock.json`. Stopka formatuje ją automatycznie.
- Nie odczytuj ani nie wypisuj istniejących sekretów. Nie wykonuj samodzielnie płatnych wywołań modeli.
