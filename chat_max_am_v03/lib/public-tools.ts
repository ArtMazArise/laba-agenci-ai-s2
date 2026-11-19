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
    const start = date ? new Date(`${date}T00:00:00Z`) : undefined;
    start?.setUTCDate(start.getUTCDate() - 14);
    const earliest = start?.toISOString().slice(0, 10);
    // Najpierw dokładna data w A/B. Po 404 szukamy ostatniej wcześniejszej publikacji.
    for (const fallback of date ? [false, true] : [false]) {
      for (const table of ["a", "b"]) {
        const period = fallback ? `${earliest}/${date}/` : date ? `${date}/` : "";
        const sourceUrl = `https://api.nbp.pl/api/exchangerates/rates/${table}/${currency.toLowerCase()}/${period}?format=json`;
        const response = await requestJson(sourceUrl, deps);
        if (response.status === 404) continue;
        if (!response.ok) return failed(`NBP jest niedostępny (HTTP ${response.status}). Nie podawaj kursu z pamięci. Spróbuj później.`, deps);
        const data = object(response.data);
        const rates = Array.isArray(data.rates) ? data.rates.map(object) : [];
        if (data.code !== currency || !rates.length || rates.some((rate) => !finite(rate.mid) || rate.mid <= 0 || typeof rate.effectiveDate !== "string" || !validDate(rate.effectiveDate) || typeof rate.no !== "string" || (date && (fallback ? rate.effectiveDate > date || rate.effectiveDate < earliest! : rate.effectiveDate !== date)))) {
          return failed("NBP zwrócił nieprawidłowe dane. Kurs nie został potwierdzony.", deps);
        }
        const rate = rates.sort((left, right) => String(right.effectiveDate).localeCompare(String(left.effectiveDate)))[0];
        return { ok: true as const, currency, quoteCurrency: "PLN", rateType: "średni kurs NBP za 1 jednostkę waluty", rate: rate.mid as number, effectiveDate: rate.effectiveDate as string, tableNumber: rate.no as string, requestedDate: date || null, usedEarlierDate: Boolean(date && rate.effectiveDate !== date), sourceUrl, fetchedAt: instant(deps).toISOString() };
      }
    }
    return failed(`NBP nie opublikował kursu ${currency}${date ? ` na ${date} ani w ciągu 14 wcześniejszych dni` : " w tabelach A/B"}. Nie wymyślaj wartości.`, deps);
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
  else if (/poprzedni piatek|ostatni piatek/.test(plain)) {
    const daysBack = (date.getUTCDay() + 2) % 7 || 7;
    date.setUTCDate(date.getUTCDate() - daysBack);
  }
  else if (/rok temu|sprzed roku/.test(plain)) {
    const year = date.getUTCFullYear() - 1;
    const month = date.getUTCMonth();
    const day = Math.min(date.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
    date.setUTCFullYear(year, month, day);
  } else return {};
  return { date: date.toISOString().slice(0, 10) };
}

export function formatCurrencyComparison(value: { currency: string; historical: { rate: number; effectiveDate: string; tableNumber: string; requestedDate: string | null }; current: { rate: number; effectiveDate: string; tableNumber: string } }) {
  const { currency, historical, current } = value;
  const change = Number((current.rate - historical.rate).toFixed(4));
  const percent = change / historical.rate * 100;
  const format = (number: number, digits: number) => number.toFixed(digits).replace(".", ",");
  const signed = (number: number, digits: number) => `${number > 0 ? "+" : ""}${format(number, digits)}`;
  const lines = [
    `Wskazany kurs ${currency}: ${format(historical.rate, 4)} zł — ${historical.effectiveDate}.`,
    `Bieżący kurs ${currency}: ${format(current.rate, 4)} zł — ${current.effectiveDate} (ostatni opublikowany kurs).`,
    `Zmiana: ${signed(change, 4)} zł (${signed(change * 100, 2)} gr), czyli ${signed(percent, 2)}%.`,
  ];
  if (historical.requestedDate && historical.requestedDate !== historical.effectiveDate) lines.push(`Dla żądanej daty ${historical.requestedDate} nie było tabeli — użyto ostatniej wcześniejszej publikacji z ${historical.effectiveDate}.`);
  if (historical.effectiveDate === current.effectiveDate) lines.push("Oba kursy dotyczą tej samej daty publikacji, dlatego zmiana wynosi zero.");
  return lines.join("\n");
}

export async function porownajKursWalutyNBP(input: CurrencyInput, deps: Dependencies = {}) {
  if (!input.date.trim()) return failed("Do porównania kursu z bieżącym potrzebna jest data historyczna. Zapytaj o datę lub okres; nie wymyślaj drugiego kursu.", deps);
  const [historical, current] = await Promise.all([kursWalutyNBP(input, deps), kursWalutyNBP({ currency: input.currency, date: "" }, deps)]);
  if (!historical.ok || !current.ok) return failed(`Nie można obliczyć zmiany kursu. ${!historical.ok ? historical.message : ""} ${!current.ok ? current.message : ""}`.trim(), deps);
  return {
    ok: true as const, currency: historical.currency, quoteCurrency: "PLN",
    historical, current,
    comparisonDraft: formatCurrencyComparison({ currency: historical.currency, historical, current }),
    changePLN: Number((current.rate - historical.rate).toFixed(4)),
    changePercent: Number(((current.rate - historical.rate) / historical.rate * 100).toFixed(6)),
    calculation: "Zmiana = bieżący minus historyczny; procent = zmiana / historyczny × 100. Daty dotyczą publikacji tabel, nie pobrania.",
    fetchedAt: instant(deps).toISOString(),
    sources: [historical, current].map((rate) => ({ url: rate.sourceUrl, title: `NBP — ${rate.currency}, ${rate.effectiveDate}`, fetchedAt: rate.fetchedAt })),
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


// Kalendarz informacyjny PL: weekendy + ogólnopolskie święta z publicznego API v4.
export async function dniWolnePL(input: { from: string; to: string }, deps: Dependencies = {}) {
  if (!input || typeof input.from !== "string" || typeof input.to !== "string") return failed("Podaj daty od/do w formacie RRRR-MM-DD.", deps);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(instant(deps));
  const from = input.from || today, to = input.to || from;
  if (!validDate(from) || !validDate(to)) return failed("Nieprawidłowa data. Użyj RRRR-MM-DD, np. 2026-12-25.", deps);
  const count = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (count < 1 || count > 62 || Number(from.slice(0, 4)) < 2000 || Number(to.slice(0, 4)) > 2100) return failed("Sprawdź kolejność dat. Jedno zapytanie może obejmować od 1 do 62 dni w latach 2000–2100.", deps);
  try {
    const holidays: { date: string; name: string }[] = [];
    const sources = [];
    for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
      const url = `https://nagerholidays.com/api/v4/Holidays/PL/${year}`;
      const response = await requestJson(url, deps);
      if (!response.ok) return failed(`Nie udało się sprawdzić świąt w Nager.Holidays (HTTP ${response.status}). Spróbuj później; nie potwierdzono dni wolnych.`, deps);
      if (!Array.isArray(response.data) || !response.data.length || response.data.length > 366) return failed("Nager.Holidays zwróciło nieprawidłowy kalendarz. Nie potwierdzono dni wolnych.", deps);
      for (const item of response.data) {
        const holiday = object(item);
        if (typeof holiday.date !== "string" || !validDate(holiday.date) || !holiday.date.startsWith(`${year}-`) || holiday.countryCode !== "PL" || typeof holiday.name !== "string" || !holiday.name.trim() || holiday.name.length > 200 || typeof holiday.nationalHoliday !== "boolean" || !Array.isArray(holiday.holidayTypes) || !holiday.holidayTypes.every((type) => typeof type === "string")) return failed("Nager.Holidays zwróciło niekompletne dane. Nie potwierdzono dni wolnych.", deps);
        if (holiday.nationalHoliday && holiday.holidayTypes.includes("Public")) holidays.push({ date: holiday.date, name: holiday.name });
      }
      sources.push({ url, title: `Nager.Holidays — święta w Polsce, ${year}`, fetchedAt: instant(deps).toISOString() });
    }
    const days = Array.from({ length: count }, (_, index) => {
      const date = new Date(Date.parse(from) + index * 86400000);
      const iso = date.toISOString().slice(0, 10);
      const weekend = [0, 6].includes(date.getUTCDay());
      const names = [...new Set(holidays.filter((holiday) => holiday.date === iso).map((holiday) => holiday.name))];
      return { date: iso, weekday: new Intl.DateTimeFormat("pl-PL", { weekday: "long", timeZone: "UTC" }).format(date), weekend, publicHoliday: names.length > 0, holidayNames: names, dayOffCalendar: weekend || names.length > 0 };
    });
    return { ok: true as const, country: "PL", from, to, days, freeDaysCount: days.filter((day) => day.dayOffCalendar).length, workingDaysCount: days.filter((day) => !day.dayOffCalendar).length, sources, fetchedAt: instant(deps).toISOString(), note: "Kalendarz weekendów i świąt ogólnopolskich. Nie potwierdza dostępności konsultacji ani indywidualnego grafiku pracy. Nie wyznacza zastępczego dnia wolnego za święto w sobotę." };
  } catch {
    return failed("Kalendarz świąt jest chwilowo niedostępny lub zapytanie przerwano. Nie potwierdzono dni wolnych; spróbuj później.", deps);
  }
}


type ZoneInput = { date: string; time: string; fromZone: string; toZone: string };
// Odwrotne mapowanie czasu lokalnego: sprawdzamy możliwe offsety i każdą datę weryfikujemy w Intl.
export function przeliczStrefyCzasowe(input: ZoneInput, deps: Dependencies = {}) {
  if (!input || [input.date, input.time, input.fromZone, input.toZone].some((value) => typeof value !== "string")) return failed("Podaj datę, godzinę i obie strefy czasowe.", deps);
  const date = input.date.trim(), time = input.time.trim();
  if (!validDate(date) || Number(date.slice(0, 4)) < 2000 || Number(date.slice(0, 4)) > 2100 || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return failed("Podaj poprawną datę RRRR-MM-DD (2000–2100) i godzinę GG:MM, np. 2026-11-20 16:00.", deps);
  const fromZone = input.fromZone.trim() || "Europe/Warsaw", toZone = input.toZone.trim();
  const namedZone = /^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+){1,3})$/;
  if (!namedZone.test(fromZone) || !namedZone.test(toZone) || fromZone.length > 100 || toZone.length > 100) return failed("Podaj jednoznaczne strefy IANA, np. Europe/Warsaw, America/New_York lub UTC. Skróty typu CST nie wskazują jednoznacznie miejsca.", deps);
  try {
    const formatter = (zone: string) => new Intl.DateTimeFormat("en-GB", { timeZone: zone, calendar: "iso8601", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const sourceFormatter = formatter(fromZone), targetFormatter = formatter(toZone);
    const parts = (format: Intl.DateTimeFormat, instant: number) => Object.fromEntries(format.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const localAsUTC = (format: Intl.DateTimeFormat, instant: number) => {
      const p = parts(format, instant);
      return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    };
    const wall = Date.parse(`${date}T${time}:00Z`);
    const offsets = new Set<number>();
    // Bierzemy offsety po obu stronach potencjalnej zmiany czasu, również dla zmian o 30 min.
    for (let hours = -48; hours <= 48; hours += 6) {
      const sample = wall + hours * 3600000;
      offsets.add(localAsUTC(sourceFormatter, sample) - sample);
    }
    const candidates = [...offsets].map((offset) => wall - offset).filter((instant) => localAsUTC(sourceFormatter, instant) === wall).sort((a, b) => a - b);
    const offsetLabel = (milliseconds: number) => {
      const minutes = Math.round(Math.abs(milliseconds) / 60000);
      return `UTC${milliseconds < 0 ? "-" : "+"}${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    };
    if (!candidates.length) return { ...failed("Ta godzina nie istnieje w podanej strefie z powodu zmiany czasu. Podaj inną godzinę.", deps), code: "NONEXISTENT_LOCAL_TIME" };
    if (candidates.length > 1) return { ...failed("Ta godzina występuje dwukrotnie podczas zmiany czasu. Doprecyzuj, o które wystąpienie chodzi, lub podaj jednoznaczny termin w UTC.", deps), code: "AMBIGUOUS_LOCAL_TIME", options: candidates.map((instant) => ({ utc: new Date(instant).toISOString(), utcOffset: offsetLabel(localAsUTC(sourceFormatter, instant) - instant) })) };
    const instant = candidates[0];
    const describe = (format: Intl.DateTimeFormat) => {
      const p = parts(format, instant), timezone = format.resolvedOptions().timeZone;
      return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, timezone, weekday: new Intl.DateTimeFormat("pl-PL", { timeZone: timezone, weekday: "long" }).format(new Date(instant)), utcOffset: offsetLabel(localAsUTC(format, instant) - instant) };
    };
    const source = describe(sourceFormatter), target = describe(targetFormatter);
    return { ok: true as const, source, target, utc: new Date(instant).toISOString(), dayDifference: Math.round((Date.parse(target.date) - Date.parse(source.date)) / 86400000), dataSource: "Lokalna baza stref IANA środowiska serwera (Intl.DateTimeFormat)", calculatedAt: (deps.now?.() ?? new Date()).toISOString(), note: "Przeliczenie godziny, bez rezerwacji i bez potwierdzenia dostępności konsultacji. Uwzględnia reguły stref zapisane w środowisku serwera." };
  } catch {
    return failed("Nie rozpoznaję tej strefy czasowej. Podaj nazwę IANA, np. Europe/Warsaw lub America/New_York.", deps);
  }
}

export type PublicToolName = "kursWalutyNBP" | "pogodaOpenMeteo" | "aktualnyCzas";
function normalized(text: string) { return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l"); }
export function requestedPublicTools(text: string): PublicToolName[] {
  const plain = normalized(text);
  const names: PublicToolName[] = [];
  if (/kurs|notowan|przelicz|wymian/.test(plain) && (/walut|euro|dolar|frank|funt|jen|koron|hryw|forint|lira|lir[ey]|juan|yuan|zlot/.test(plain) || /\b(?:eur|usd|gbp|chf|jpy|czk|sek|nok|dkk|huf|uah|cny|aud|cad|nzd|try|ron|bgn|brl|inr|kwd|sar|aed|xdr)\b/.test(plain) || /\b[A-Z]{3}\b/.test(text) && /kurs|notowan|walut|wymian/.test(plain))) names.push("kursWalutyNBP");
  if (/pogod|prognoz|temperatur|bedzie padac|czy pada|\bopad|deszcz|snieg/.test(plain)) names.push("pogodaOpenMeteo");
  if (/dokladn\w*\s+(?:aktualn\w*\s+)?(?:godzin|czas)|(?:godzin|\bczas)\w*[^.!?\n]{0,30}(?:dokladnosc|milisek|\bms\b)|milisek|\bms\b/.test(plain)) names.push("aktualnyCzas");
  return names;
}

export function explicitWeatherCity(text: string): string | undefined {
  const city = [...text.matchAll(/^\s*(?:Miejscowość|Miasto)\s*:\s*([^\r\n]+)$/gim)].at(-1)?.[1].trim();
  return city && city.length <= 100 ? city : undefined;
}

export function createPublicTools(signal: AbortSignal, location?: WeatherLocation, comparison?: { date?: string }, weatherCity?: string) {
  const currencySchema = jsonSchema<CurrencyInput>({ type: "object", properties: { currency: { type: "string", description: "Kod waluty ISO, np. EUR. Pusty tekst, jeśli klient nie podał waluty." }, date: { type: "string", description: "RRRR-MM-DD dla konkretnej daty lub pusty tekst dla ostatniego opublikowanego kursu. Przy braku tabeli we wskazanym dniu narzędzie pobierze najbliższą wcześniejszą, maksymalnie 14 dni wstecz. Podaj rzeczywistą datę publikacji." } }, required: ["currency", "date"], additionalProperties: false }, { validate: (v) => {
    const input = object(v); return Object.keys(input).length === 2 && typeof input.currency === "string" && typeof input.date === "string" ? { success: true, value: input as CurrencyInput } : { success: false, error: new Error("Nieprawidłowe parametry NBP.") };
  } });
  const weatherSchema = jsonSchema<WeatherInput>({ type: "object", properties: { city: { type: "string", maxLength: 100, description: "Miejscowość z wiadomości lub odpowiedzi na pytanie o lokalizację; pusty tekst, jeśli jej nie podano." }, startOffsetDays: { type: "integer", description: "Dziś: 0, jutro: 1, za tydzień: 7. Poza zakresem 0–15 narzędzie zwróci komunikat." }, days: { type: "integer", minimum: 1, maximum: 16, description: "Liczba dni prognozy. Trzy najbliższe dni: 3, od dziś (offset 0)." } }, required: ["city", "startOffsetDays", "days"], additionalProperties: false }, { validate: (v) => {
    const input = object(v); return Object.keys(input).length === 3 && typeof input.city === "string" && input.city.length <= 100 && Number.isInteger(input.startOffsetDays) && Number.isInteger(input.days) && Number(input.days) >= 1 && Number(input.days) <= 16 ? { success: true, value: input as WeatherInput } : { success: false, error: new Error("Nieprawidłowe parametry Open-Meteo.") };
  } });
  const emptySchema = jsonSchema<Record<string, never>>({ type: "object", properties: {}, additionalProperties: false }, { validate: (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0 ? { success: true, value: {} } : { success: false, error: new Error("Narzędzie czasu nie przyjmuje parametrów.") } });
  const calendarSchema = jsonSchema<{ from: string; to: string }>({ type: "object", properties: { from: { type: "string", description: "Początek RRRR-MM-DD; pusty tekst oznacza dziś w Polsce." }, to: { type: "string", description: "Koniec RRRR-MM-DD włącznie; pusty tekst oznacza tylko datę from. Zakres do 62 dni." } }, required: ["from", "to"], additionalProperties: false }, { validate: (value) => {
    const v = object(value); return Object.keys(v).length === 2 && typeof v.from === "string" && typeof v.to === "string" ? { success: true, value: v as { from: string; to: string } } : { success: false, error: new Error("Nieprawidłowe daty kalendarza.") };
  } });
  const zonesSchema = jsonSchema<ZoneInput>({ type: "object", properties: { date: { type: "string", description: "Data lokalna w strefie początkowej, RRRR-MM-DD." }, time: { type: "string", description: "Godzina lokalna GG:MM, bez zgadywania brakującej godziny." }, fromZone: { type: "string", description: "Strefa IANA źródła, np. Europe/Warsaw. Pusty tekst oznacza Europe/Warsaw." }, toZone: { type: "string", description: "Docelowa strefa IANA, np. America/New_York lub UTC; nie zgaduj miejsca klienta." } }, required: ["date", "time", "fromZone", "toZone"], additionalProperties: false }, { validate: (value) => {
    const v = object(value), keys = ["date", "time", "fromZone", "toZone"];
    return Object.keys(v).length === 4 && keys.every((key) => typeof v[key] === "string") ? { success: true, value: v as ZoneInput } : { success: false, error: new Error("Nieprawidłowe parametry stref czasowych.") };
  } });
  return {
    przeliczStrefyCzasowe: tool({ description: "Przelicz termin konsultacji lub inną datę i godzinę pomiędzy strefami czasowymi, np. Warszawa–Nowy Jork. Korzysta z lokalnej bazy IANA, uwzględnia zmianę daty i czasu letniego. Nie wykonuje rezerwacji, nie sprawdza dostępności i nie służy do walut ani zwykłego pytania o aktualną godzinę w Polsce. Gdy brak daty, godziny lub miejsca klienta, poproś o doprecyzowanie. Nie wybieraj sam wystąpienia godziny powtórzonej podczas zmiany czasu.", inputSchema: zonesSchema, execute: (input) => przeliczStrefyCzasowe(input) }),
    dniWolnePL: tool({ description: "Sprawdź, czy wskazana data albo zakres do 62 dni to weekend lub ogólnopolskie święto w Polsce. Użyj przy pytaniach o dni wolne, święta, dni robocze lub dni tygodnia w konkretnym terminie. Pobiera kalendarz Nager.Holidays bez klucza; nie sprawdza kalendarza rezerwacji, urlopu, grafiku firmy ani świąt innych krajów. Nie używaj przy zwykłym pytaniu o cenę lub czas konsultacji, pogodę, kurs waluty ani na powitanie.", inputSchema: calendarSchema, execute: (input) => dniWolnePL(input, { signal }) }),
    kursWalutyNBP: tool({ description: "Pobierz prawdziwy średni kurs waluty względem PLN z publicznego API NBP. Używaj zawsze przy pytaniach o kurs i walutę, także dziś lub dla daty historycznej. Zwraca datę publikacji i pobrania; ostatnia tabela może pochodzić z dnia roboczego. Nie jest kursem kantoru ani prognozą. Przy porównaniu z bieżącym przekaż datę historyczną: jedno wykonanie zwróci oba kursy oraz obliczoną zmianę, więc nie potrzebujesz drugiego wywołania.", inputSchema: currencySchema, execute: async (input) => comparison ? await porownajKursWalutyNBP({ ...input, date: comparison.date ?? input.date }, { signal }) : await kursWalutyNBP(input, { signal }) }),
    pogodaOpenMeteo: tool({ description: "Pobierz bieżące warunki i prognozę z Open-Meteo. Używaj zawsze przy pytaniach o pogodę, dziś, jutro, za tydzień i na kilka dni. Bez miasta wywołaj z city='': narzędzie użyje lokalizacji przeglądarki, jeśli została udostępniona, albo poprosi o miejscowość. Nie zakładaj lokalizacji. Kod pogody to WMO, temperatura °C, opady mm.", inputSchema: weatherSchema, execute: (input) => pogodaOpenMeteo({ ...input, city: weatherCity ?? input.city }, { signal, location }) }),
    aktualnyCzas: tool({ description: "Pobierz świeżą datę, dzień tygodnia i godzinę zegara serwera w Europe/Warsaw z milisekundami. Używaj do DOKŁADNEJ godziny lub żądania precyzji ms. Proste pytania o godzinę, dziś, jutro i za ile dni nadal korzystają z czasu podanego w instrukcji requestu.", inputSchema: emptySchema, execute: () => aktualnyCzas() }),
  };
}
