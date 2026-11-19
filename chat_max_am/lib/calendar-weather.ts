export type CalendarWeatherDay = { date: string; minC: number; maxC: number; precipitationMm: number; code: number; kind: "history" | "forecast" };
export type CalendarWeather = { city: string; days: CalendarWeatherDay[]; notes: string[]; sources: { url: string; title: string; fetchedAt: string }[] };
const iso = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const shift = (date: string, days: number) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);
export async function calendarWeather(year: number, month: number, city: string, deps: { fetcher?: typeof fetch; now?: () => Date; signal?: AbortSignal } = {}): Promise<CalendarWeather> {
  const result: CalendarWeather = { city, days: [], sources: [], notes: [] };
  if (!month) { result.notes.push("Pogoda dostępna dla kalendarza miesięcznego; wybierz miesiąc."); return result; }
  const from = `${year}-${String(month).padStart(2, "0")}-01`, to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const today = iso(deps.now?.() ?? new Date());
  const ranges = [
    { from, to: to < shift(today, -6) ? to : shift(today, -6), base: "https://archive-api.open-meteo.com/v1/archive", kind: "history" as const },
    { from: from > shift(today, -5) ? from : shift(today, -5), to: to < shift(today, 15) ? to : shift(today, 15), base: "https://api.open-meteo.com/v1/forecast", kind: "forecast" as const },
  ].filter((range) => range.from <= range.to);
  if (!ranges.length) { result.notes.push("Brak danych pogodowych dla wybranego miesiąca: poza horyzontem prognozy."); return result; }
  const get = async (url: string) => {
    const response = await (deps.fetcher ?? fetch)(url, { cache: "no-store", redirect: "error", headers: { Accept: "application/json" }, signal: deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000) });
    if (!response.ok) throw Error("WEATHER_UNAVAILABLE");
    return response.json();
  };
  let location;
  try {
    const geo = await get(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: city, count: "1", language: "pl", format: "json" })}`);
    location = geo?.results?.[0];
    if (!location || !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180) throw Error("BAD_LOCATION");
  } catch { result.notes.push("Nie udało się ustalić miejscowości lub pobrać pogody. Kalendarz zachowano bez zmyślonych danych."); return result; }
  await Promise.all(ranges.map(async (range) => {
    const url = new URL(range.base);
    url.search = new URLSearchParams({ latitude: String(location.latitude), longitude: String(location.longitude), start_date: range.from, end_date: range.to, daily: "weather_code,temperature_2m_min,temperature_2m_max,precipitation_sum", timezone: "Europe/Warsaw", temperature_unit: "celsius", precipitation_unit: "mm", ...(range.kind === "forecast" ? { past_days: "5", forecast_days: "16" } : {}) }).toString();
    try {
      const data = await get(url.href), d = data?.daily;
      if (!d || !["time", "weather_code", "temperature_2m_min", "temperature_2m_max", "precipitation_sum"].every((key) => Array.isArray(d[key]) && d[key].length === d.time.length)) throw Error("BAD_WEATHER");
      for (let i = 0; i < d.time.length; i++) {
        const date = d.time[i];
        if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < range.from || date > range.to) continue;
        const values = [d.temperature_2m_min[i], d.temperature_2m_max[i], d.precipitation_sum[i], d.weather_code[i]];
        if (!values.every((v) => typeof v === "number" && Number.isFinite(v)) || values[0] > values[1] || values[2] < 0 || !Number.isInteger(values[3])) continue;
        result.days.push({ date, minC: values[0], maxC: values[1], precipitationMm: values[2], code: values[3], kind: range.kind });
      }
      result.sources.push({ url: url.href, title: range.kind === "history" ? "Open-Meteo — pogoda historyczna (model/reanaliza)" : "Open-Meteo — prognoza i archiwalne prognozy", fetchedAt: (deps.now?.() ?? new Date()).toISOString() });
    } catch { result.notes.push(`Brak potwierdzonej pogody: ${range.from}–${range.to}.`); }
  }));
  result.days.sort((a, b) => a.date.localeCompare(b.date));
  if (result.days.length < new Date(Date.UTC(year, month, 0)).getUTCDate()) result.notes.push("Dni bez danych mają oznaczenie BRAK DANYCH; niczego nie uzupełniono z pamięci modelu.");
  return result;
}
