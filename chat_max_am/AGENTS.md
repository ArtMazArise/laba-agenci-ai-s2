# Zasady tego projektu

- Pisz po polsku i krótko. Realizuj bieżący krok użytkownika.
- Widoczna wersja ma format `v02.xx`; obecna to `v02.05`.
- W oznaczeniu wersji pokazuj tylko numer. Nie dodawaj opisów jego znaczenia ani tematu.
- Przy kolejnej ukończonej zmianie aplikacji zwiększaj tylko `xx`, raz na spójny zestaw zmian.
- Prefiks `02` zmieniaj na `03` wyłącznie na wyraźny sygnał użytkownika.
- W `package.json` zachowuj poprawny SemVer: `0.2.5` odpowiada widocznemu `v02.05`. Synchronizuj wersję główną i pakietu głównego w `package-lock.json`. Stopka formatuje ją automatycznie.
- Nie odczytuj ani nie wypisuj istniejących sekretów. Nie wykonuj samodzielnie płatnych wywołań modeli.
