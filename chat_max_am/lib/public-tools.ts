import { jsonSchema, tool } from "ai";

export type WeatherLocation = { latitude: number; longitude: number };
type Dependencies = { fetcher?: typeof fetch; now?: () => Date; signal?: AbortSignal; location?: WeatherLocation };
export function parseWeatherLocation(value: unknown): WeatherLocation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "latitude" && key !== "longitude")) return;
  const { latitude, longitude } = record;
  if (typeof latitude !== "number" || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || typeof longitude !== "number" || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return;
  return { latitude: Math.round(latitude * 1000) / 1000, longitude: Math.round(longitude * 1000) / 1000 };
}
type CurrencyInput = { currency: string; date: string };
type WeatherInput = { city: string; startOffsetDays: number; days: number };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const instant = (deps: Dependencies) => (deps.now?.() ?? new Date());
const failed = (message: string, deps: Dependencies) => ({ ok: false as const, message, fetchedAt: instant(deps).toISOString() });
function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

async function requestJson(url: string, deps: Dependencies) {
  const timeout = AbortSignal.timeout(6000);
  const response = await (deps.fetcher ?? fetch)(url, {
    headers: { Accept: "application/json" }, cache: "no-store", redirect: "error",
    signal: deps.signal ? AbortSignal.any([deps.signal, timeout]) : timeout,
  });
  return { status: response.status, ok: response.ok, data: response.ok ? await response.json() as unknown : undefined };
}

export async function kursWalutyNBP(input: CurrencyInput, deps: Dependencies = {}) {
  const currency = input.currency.trim().toUpperCase();
  const date = input.date.trim();
  if (!/^[A-Z]{3}$/.test(currency)) return failed("Podaj trzyliterowy kod waluty, np. EUR, USD lub CHF. Jeśli nie podano waluty, zapytaj klienta, o jaką chodzi.", deps);
  if (date && !validDate(date)) return failed("Data kursu musi mieć format RRRR-MM-DD. Pusty tekst oznacza ostatni opublikowany kurs.", deps);
  try {
    for (const table of ["a", "b"]) {
      const sourceUrl = `https://api.nbp.pl/api/exchangerates/rates/${table}/${currency.toLowerCase()}/${date ? `${date}/` : ""}?format=json`;
      const response = await requestJson(sourceUrl, deps);
      if (response.status === 404) continue;
      if (!response.ok) return failed(`NBP jest niedostępny (HTTP ${response.status}). Nie podawaj kursu z pamięci. Spróbuj później.`, deps);
      const data = object(response.data);
      const rate = object(Array.isArray(data.rates) ? data.rates[0] : undefined);
      if (data.code !== currency || !finite(rate.mid) || rate.mid <= 0 || typeof rate.effectiveDate !== "string" || !validDate(rate.effectiveDate) || typeof rate.no !== "string" || (date && rate.effectiveDate !== date)) {
        return failed("NBP zwrócił nieprawidłowe dane. Kurs nie został potwierdzony.", deps);
      }
      return { ok: true as const, currency, quoteCurrency: "PLN", rateType: "średni kurs NBP za 1 jednostkę waluty", rate: rate.mid, effectiveDate: rate.effectiveDate, tableNumber: rate.no, sourceUrl, fetchedAt: instant(deps).toISOString() };
    }
    return failed(`NBP nie opublikował kursu ${currency}${date ? ` na ${date}` : " w tabelach A/B"}. Nie zastępuj go inną datą lub wymyśloną wartością.`, deps);
  } catch { return failed("Nie udało się pobrać kursu z NBP (brak połączenia lub przekroczony czas). Spróbuj później; nie podawaj kursu z pamięci.", deps); }
}

export function currencyComparisonRequest(text: string, now = new Date()): { date?: string } | undefined {
  const plain = normalized(text);
  if (!/porown|zmian|zmienil/.test(plain)) return;
  const explicitDate = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  if (explicitDate) return { date: validDate(explicitDate) ? explicitDate : undefined };
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const date = new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
  const days = plain.match(/(?:sprzed\s+)?(\d+)\s*dni(?:a)?\b/)?.[1];
  if (days) {
    if (Number(days) > 3650) return {};
    date.setUTCDate(date.getUTCDate() - Number(days));
  } else if (/tydzien temu|sprzed tygodnia/.test(plain)) date.setUTCDate(date.getUTCDate() - 7);
  else if (/rok temu|sprzed roku/.test(plain)) {
    const year = date.getUTCFullYear() - 1;
    const month = date.getUTCMonth();
    const day = Math.min(date.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
    date.setUTCFullYear(year, month, day);
  } else return {};
  return { date: date.toISOString().slice(0, 10) };
}

export async function porownajKursWalutyNBP(input: CurrencyInput, deps: Dependencies = {}) {
  if (!input.date.trim()) return failed("Do porównania kursu z bieżącym potrzebna jest data historyczna. Zapytaj o datę lub okres; nie wymyślaj drugiego kursu.", deps);
  const [historical, current] = await Promise.all([kursWalutyNBP(input, deps), kursWalutyNBP({ currency: input.currency, date: "" }, deps)]);
  if (!historical.ok || !current.ok) return failed(`Nie można obliczyć zmiany kursu. ${!historical.ok ? historical.message : ""} ${!current.ok ? current.message : ""}`.trim(), deps);
  return {
    ok: true as const, currency: historical.currency, quoteCurrency: "PLN",
    historical, current,
    changePLN: Number((current.rate - historical.rate).toFixed(4)),
    changePercent: Number(((current.rate - historical.rate) / historical.rate * 100).toFixed(6)),
    calculation: "Zmiana = bieżący minus historyczny; procent = zmiana / historyczny × 100. Daty dotyczą publikacji tabel, nie pobrania.",
    fetchedAt: instant(deps).toISOString(),
    sources: [historical, current].map((rate) => ({ url: rate.sourceUrl, title: `NBP — ${rate.currency}, tabela ${rate.tableNumber}, ${rate.effectiveDate}`, fetchedAt: rate.fetchedAt })),
  };
}

export async function pogodaOpenMeteo(input: WeatherInput, deps: Dependencies = {}) {
  const city = input.city.trim();
  const browserLocation = parseWeatherLocation(deps.location);
  if (!city && !browserLocation) return failed("Aby sprawdzić pogodę, kliknij „Moja lokalizacja” nad czatem i zezwól przeglądarce na jej udostępnienie albo wpisz miejscowość w wiadomości. Nie zakładaj miasta użytkownika.", deps);
  if (city.length > 100 || !Number.isInteger(input.startOffsetDays) || !Number.isInteger(input.days) || input.startOffsetDays < 0 || input.days < 1 || input.startOffsetDays + input.days > 16) {
    return failed("Open-Meteo obsługuje tutaj prognozę od dziś do 15 dni naprzód, łącznie maksymalnie 16 dni. Doprecyzuj lokalizację i zakres.", deps);
  }
  try {
    let location: Record<string, unknown> = { name: "Twoja lokalizacja", ...browserLocation };
    if (city) {
      const geocoding = new URL("https://geocoding-api.open-meteo.com/v1/search");
      geocoding.search = new URLSearchParams({ name: city, count: "1", language: "pl", format: "json" }).toString();
      const geo = await requestJson(geocoding.href, deps);
      if (!geo.ok) return failed("Open-Meteo nie może teraz wyszukać miejscowości. Spróbuj później.", deps);
      const data = object(geo.data);
      location = object(Array.isArray(data.results) ? data.results[0] : undefined);
      if (!Object.keys(location).length) return failed("Nie znaleziono miejscowości. Podaj jej nazwę z krajem lub regionem.", deps);
    }
    if (typeof location.name !== "string" || !finite(location.latitude) || !finite(location.longitude) || Math.abs(location.latitude) > 90 || Math.abs(location.longitude) > 180) return failed("Open-Meteo zwróciło nieprawidłową lokalizację.", deps);
    const forecast = new URL("https://api.open-meteo.com/v1/forecast");
    forecast.search = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), timezone: "auto", forecast_days: String(input.startOffsetDays + input.days), daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum", ...(input.startOffsetDays === 0 ? { current: "temperature_2m,weather_code" } : {}) }).toString();
    const response = await requestJson(forecast.href, deps);
    if (!response.ok) return failed(`Prognoza Open-Meteo jest niedostępna (HTTP ${response.status}). Spróbuj później.`, deps);
    const forecastData = object(response.data);
    const daily = object(forecastData.daily);
    const fields = ["time", "temperature_2m_min", "temperature_2m_max", "precipitation_sum", "weather_code"];
    const count = input.startOffsetDays + input.days;
    if (typeof forecastData.timezone !== "string" || fields.some((key) => !Array.isArray(daily[key]) || daily[key].length < count)) return failed("Open-Meteo zwróciło niekompletną prognozę.", deps);
    const days = Array.from({ length: input.days }, (_, index) => {
      const position = input.startOffsetDays + index;
      const get = (field: string) => (daily[field] as unknown[])[position];
      return { date: get("time"), temperatureMinC: get("temperature_2m_min"), temperatureMaxC: get("temperature_2m_max"), precipitationMm: get("precipitation_sum"), weatherCode: get("weather_code") };
    });
    if (days.some((day) => typeof day.date !== "string" || !validDate(day.date) || !finite(day.temperatureMinC) || !finite(day.temperatureMaxC) || !finite(day.precipitationMm) || !finite(day.weatherCode))) return failed("Open-Meteo zwróciło nieprawidłowe wartości prognozy.", deps);
    const current = object(forecastData.current);
    const currentWeather = input.startOffsetDays === 0 && typeof current.time === "string" && finite(current.temperature_2m) && finite(current.weather_code) ? { time: current.time, temperatureC: current.temperature_2m, weatherCode: current.weather_code } : undefined;
    return { ok: true as const, location: location.name, country: typeof location.country === "string" ? location.country : "", timezone: forecastData.timezone, ...(currentWeather ? { current: currentWeather } : {}), forecast: days, sourceUrl: forecast.href, fetchedAt: instant(deps).toISOString() };
  } catch { return failed("Nie udało się pobrać pogody z Open-Meteo (brak połączenia lub przekroczony czas). Spróbuj później; nie zgaduj prognozy.", deps); }
}

export function aktualnyCzas(deps: Dependencies = {}) {
  const now = instant(deps);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, hourCycle: "h23" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { ok: true as const, date: `${value("year")}-${value("month")}-${value("day")}`, weekday: new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", weekday: "long" }).format(now), time: `${value("hour")}:${value("minute")}:${value("second")}.${value("fractionalSecond")}`, timezone: "Europe/Warsaw", fetchedAt: now.toISOString(), clockSource: "Zegar serwera w momencie wykonania narzędzia; milisekundy oznaczają precyzję zapisu, nie gwarantowaną dokładność synchronizacji." };
}

export type PublicToolName = "kursWalutyNBP" | "pogodaOpenMeteo" | "aktualnyCzas";
function normalized(text: string) { return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l"); }
export function requestedPublicTools(text: string): PublicToolName[] {
  const plain = normalized(text);
  const names: PublicToolName[] = [];
  if (/kurs|notowan|przelicz|wymian/.test(plain) && (/walut|euro|dolar|frank|funt|jen|koron|hryw|forint|lira|lir[ey]|juan|yuan|zlot/.test(plain) || /\b(?:eur|usd|gbp|chf|jpy|czk|sek|nok|dkk|huf|uah|cny|aud|cad|nzd|try|ron|bgn|brl|inr|kwd|sar|aed|xdr)\b/.test(plain) || /\b[A-Z]{3}\b/.test(text))) names.push("kursWalutyNBP");
  if (/pogod|prognoz|temperatur|bedzie padac|czy pada|opad|deszcz|snieg/.test(plain)) names.push("pogodaOpenMeteo");
  if (/godzin|\bczas\b/.test(plain) && /doklad|milisek|\bms\b/.test(plain)) names.push("aktualnyCzas");
  return names;
}

export function createPublicTools(signal: AbortSignal, location?: WeatherLocation, comparison?: { date?: string }) {
  const currencySchema = jsonSchema<CurrencyInput>({ type: "object", properties: { currency: { type: "string", description: "Kod waluty ISO, np. EUR. Pusty tekst, jeśli klient nie podał waluty." }, date: { type: "string", description: "RRRR-MM-DD dla konkretnej daty lub pusty tekst dla ostatniego opublikowanego kursu. Nie wymyślaj daty publikacji dzisiejszej tabeli." } }, required: ["currency", "date"], additionalProperties: false }, { validate: (v) => {
    const input = object(v); return Object.keys(input).length === 2 && typeof input.currency === "string" && typeof input.date === "string" ? { success: true, value: input as CurrencyInput } : { success: false, error: new Error("Nieprawidłowe parametry NBP.") };
  } });
  const weatherSchema = jsonSchema<WeatherInput>({ type: "object", properties: { city: { type: "string", maxLength: 100, description: "Miejscowość z wiadomości lub odpowiedzi na pytanie o lokalizację; pusty tekst, jeśli jej nie podano." }, startOffsetDays: { type: "integer", description: "Dziś: 0, jutro: 1, za tydzień: 7. Poza zakresem 0–15 narzędzie zwróci komunikat." }, days: { type: "integer", minimum: 1, maximum: 16, description: "Liczba dni prognozy. Trzy najbliższe dni: 3, od dziś (offset 0)." } }, required: ["city", "startOffsetDays", "days"], additionalProperties: false }, { validate: (v) => {
    const input = object(v); return Object.keys(input).length === 3 && typeof input.city === "string" && input.city.length <= 100 && Number.isInteger(input.startOffsetDays) && Number.isInteger(input.days) && Number(input.days) >= 1 && Number(input.days) <= 16 ? { success: true, value: input as WeatherInput } : { success: false, error: new Error("Nieprawidłowe parametry Open-Meteo.") };
  } });
  const emptySchema = jsonSchema<Record<string, never>>({ type: "object", properties: {}, additionalProperties: false }, { validate: (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0 ? { success: true, value: {} } : { success: false, error: new Error("Narzędzie czasu nie przyjmuje parametrów.") } });
  return {
    kursWalutyNBP: tool({ description: "Pobierz prawdziwy średni kurs waluty względem PLN z publicznego API NBP. Używaj zawsze przy pytaniach o kurs i walutę, także dziś lub dla daty historycznej. Zwraca datę publikacji i pobrania; ostatnia tabela może pochodzić z dnia roboczego. Nie jest kursem kantoru ani prognozą. Przy porównaniu z bieżącym przekaż datę historyczną: jedno wykonanie zwróci oba kursy oraz obliczoną zmianę, więc nie potrzebujesz drugiego wywołania.", inputSchema: currencySchema, execute: async (input) => comparison ? await porownajKursWalutyNBP({ ...input, date: comparison.date ?? input.date }, { signal }) : await kursWalutyNBP(input, { signal }) }),
    pogodaOpenMeteo: tool({ description: "Pobierz bieżące warunki i prognozę z Open-Meteo. Używaj zawsze przy pytaniach o pogodę, dziś, jutro, za tydzień i na kilka dni. Bez miasta wywołaj z city='': narzędzie użyje lokalizacji przeglądarki, jeśli została udostępniona, albo poprosi o miejscowość. Nie zakładaj lokalizacji. Kod pogody to WMO, temperatura °C, opady mm.", inputSchema: weatherSchema, execute: (input) => pogodaOpenMeteo(input, { signal, location }) }),
    aktualnyCzas: tool({ description: "Pobierz świeżą datę, dzień tygodnia i godzinę zegara serwera w Europe/Warsaw z milisekundami. Używaj do DOKŁADNEJ godziny lub żądania precyzji ms. Proste pytania o godzinę, dziś, jutro i za ile dni nadal korzystają z czasu podanego w instrukcji requestu.", inputSchema: emptySchema, execute: () => aktualnyCzas() }),
  };
}
