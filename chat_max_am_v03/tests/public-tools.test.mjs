import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { loadPublicToolsModule } from './public-tools-helper.mjs';
const module = await loadPublicToolsModule(vm.createContext({ URL, URLSearchParams, AbortSignal }));
await module.evaluate();
const { aktualnyCzas, kursWalutyNBP, pogodaOpenMeteo, requestedPublicTools, createPublicTools, parseWeatherLocation } = module.namespace;
const now = () => new Date('2026-11-15T12:34:56.789Z');
const plain = (value) => JSON.parse(JSON.stringify(value));
const reply = (data, status = 200) => ({ ok: status === 200, status, json: async () => data });

test('aktualnyCzas: Warszawa, milisekundy i zmiana dnia latem', () => {
  const result = aktualnyCzas({ now });
  assert.equal(result.date, '2026-11-15');
  assert.equal(result.weekday, 'niedziela');
  assert.equal(result.time, '13:34:56.789');
  assert.equal(result.timezone, 'Europe/Warsaw');
  const summer = aktualnyCzas({ now: () => new Date('2026-07-01T22:01:02.003Z') });
  assert.equal(summer.date, '2026-07-02');
  assert.equal(summer.time, '00:01:02.003');
});

test('dobór narzędzi: NBP, pogoda, dokładny czas; zwykła godzina bez zmian', () => {
  for (const question of ['Jaki jest dziś kurs euro?', 'Kurs usd', 'Ile kosztuje wymiana CHF?']) assert.deepEqual(plain(requestedPublicTools(question)), ['kursWalutyNBP']);
  for (const question of ['Jaka jest dziś pogoda?', 'Jaka będzie pogoda za tydzień?', 'Daj pogodę na trzy najbliższe dni']) assert.deepEqual(plain(requestedPublicTools(question)), ['pogodaOpenMeteo']);
  assert.deepEqual(plain(requestedPublicTools('Która jest DOKŁADNIE godzina? Podaj ms.')), ['aktualnyCzas']);
  assert.deepEqual(plain(requestedPublicTools('Która jest godzina?')), []);
  assert.deepEqual(plain(requestedPublicTools('Spotkania dokładnie co trzeci dzień o godzinie 16:00 czasu lokalnego.')), []);
  assert.deepEqual(plain(requestedPublicTools('Kurs programowania')), []);
  assert.deepEqual(plain(requestedPublicTools('Konsultacja 20 listopada o 16:00 w Warszawie. Jaka to godzina w Nowym Jorku?')), []);
  assert.deepEqual(plain(requestedPublicTools('Czy 11 listopada jest dniem wolnym?')), []);
  assert.deepEqual(plain(requestedPublicTools('Czy jutro będą opady deszczu?')), ['pogodaOpenMeteo']);
});

test('NBP: tylko potrzebne pola, data tabeli osobno od pobrania', async () => {
  const calls = [];
  const result = await kursWalutyNBP({ currency: 'eur', date: '' }, { now, fetcher: async (url) => {
    calls.push(url);
    return reply({ code: 'EUR', unused: 'nie kopiuj', rates: [{ mid: 4.25, no: 'test/A', effectiveDate: '2026-11-13' }] });
  } });
  assert.equal(result.ok, true);
  assert.equal(result.effectiveDate, '2026-11-13');
  assert.equal(result.fetchedAt, now().toISOString());
  assert.equal(result.rate, 4.25);
  assert.equal(result.unused, undefined);
  assert.equal(calls[0], 'https://api.nbp.pl/api/exchangerates/rates/a/eur/?format=json');
});

test('NBP: tabela B po 404, brak danych po ograniczonym szukaniu wstecz', async () => {
  const calls = [];
  const result = await kursWalutyNBP({ currency: 'ZAR', date: '' }, { now, fetcher: async (url) => {
    calls.push(url);
    return calls.length === 1 ? reply({}, 404) : reply({ code: 'ZAR', rates: [{ mid: 0.2, no: 'test/B', effectiveDate: '2026-11-12' }] });
  } });
  assert.equal(result.ok, true);
  assert.match(calls[1], /rates\/b\/zar/);
  const dated = [];
  const missing = await kursWalutyNBP({ currency: 'EUR', date: '2026-11-15' }, { now, fetcher: async (url) => { dated.push(url); return reply({}, 404); } });
  assert.equal(missing.ok, false);
  assert.ok(dated.every((url) => url.includes('/2026-11-15/')));
});

test('NBP: walidacja i awarie zwracają komunikat, bez wymyślonego kursu', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return reply({}, 503); };
  for (const input of [{ currency: '../x', date: '' }, { currency: 'EUR', date: '2026-02-30' }]) assert.equal((await kursWalutyNBP(input, { now, fetcher })).ok, false);
  assert.equal(calls, 0);
  for (const badFetch of [fetcher, async () => { throw Error('private details'); }, async () => reply({ code: 'EUR', rates: [{ mid: '4.25' }] })]) {
    const result = await kursWalutyNBP({ currency: 'EUR', date: '' }, { now, fetcher: badFetch });
    assert.equal(result.ok, false);
    assert.ok(result.message);
    assert.ok(!JSON.stringify(result).includes('private details'));
    assert.equal(result.rate, undefined);
  }
});

const forecast = () => ({ timezone: 'Europe/Warsaw', current: { time: '2026-11-15T13:30', temperature_2m: 8, weather_code: 3 }, daily: {
  time: Array.from({ length: 8 }, (_, i) => `2026-11-${15 + i}`), temperature_2m_min: Array(8).fill(2), temperature_2m_max: Array(8).fill(10), precipitation_sum: Array(8).fill(0.5), weather_code: Array(8).fill(3),
} });
const geo = { results: [{ name: 'Warszawa', country: 'Polska', latitude: 52.23, longitude: 21.01 }] };

test('OpenMeteo: brak miejscowości i zbyt odległa data bez połączenia z API', async () => {
  const missing = await pogodaOpenMeteo({ city: '', startOffsetDays: 0, days: 1 }, { now });
  assert.match(missing.message, /Moja lokalizacja/);
  assert.match(missing.message, /wpisz miejscowość/);
  let calls = 0;
  const fetcher = async () => { calls++; throw Error('unexpected'); };
  for (const input of [{ city: '', startOffsetDays: 0, days: 1 }, { city: 'Warszawa', startOffsetDays: 16, days: 1 }]) assert.equal((await pogodaOpenMeteo(input, { now, fetcher })).ok, false);
  assert.equal(calls, 0);
});

test('OpenMeteo: prognoza 3 dni oraz za tydzień, tylko wymagane pola', async () => {
  for (const [offset, days] of [[0, 3], [7, 1]]) {
    const calls = [];
    const result = await pogodaOpenMeteo({ city: 'Warszawa', startOffsetDays: offset, days }, { now, fetcher: async (url) => { calls.push(url); return reply(calls.length === 1 ? geo : forecast()); } });
    assert.equal(result.ok, true);
    assert.equal(result.forecast.length, days);
    assert.equal(result.forecast[0].date, `2026-11-${15 + offset}`);
    assert.equal(result.fetchedAt, now().toISOString());
    assert.equal(new URL(calls[1]).searchParams.get('forecast_days'), String(offset + days));
    assert.equal(Boolean(result.current), offset === 0);
    assert.equal(result.daily, undefined);
  }
});

test('OpenMeteo: brak miasta w API, wadliwe dane i HTTP 503 nie wywracają aplikacji', async () => {
  for (const responses of [[reply({})], [reply({ results: [{ ...geo.results[0], latitude: 120 }] })], [reply(geo), reply({}, 503)], [reply(geo), reply({ timezone: 'Europe/Warsaw', daily: {} })]]) {
    const result = await pogodaOpenMeteo({ city: 'Warszawa', startOffsetDays: 0, days: 1 }, { now, fetcher: async () => responses.shift() });
    assert.equal(result.ok, false);
    assert.ok(result.message);
    assert.equal(result.forecast, undefined);
  }
});

test('narzędzia mają aktualnyCzas i ścisłe schematy wejściowe', async () => {
  const tools = createPublicTools(new AbortController().signal);
  assert.deepEqual(Object.keys(tools), ['przeliczStrefyCzasowe', 'dniWolnePL', 'kursWalutyNBP', 'pogodaOpenMeteo', 'aktualnyCzas']);
  for (const tool of Object.values(tools)) assert.equal(tool.inputSchema.jsonSchema.additionalProperties, false);
  assert.equal((await tools.aktualnyCzas.inputSchema.validate({ extra: true })).success, false);
  assert.equal((await tools.dniWolnePL.inputSchema.validate({ from: '2026-12-25', to: '', send_now: true })).success, false);
  assert.equal((await tools.kursWalutyNBP.inputSchema.validate({ currency: 'EUR', date: '', send_now: true })).success, false);
});


test('lokalizacja z requestu: walidacja i zaokrąglenie, bez dodatkowych pól', () => {
  assert.deepEqual(plain(parseWeatherLocation({ latitude: 52.234567, longitude: 21.012345 })), { latitude: 52.235, longitude: 21.012 });
  for (const value of [null, [], { latitude: 100, longitude: 0 }, { latitude: NaN, longitude: 0 }, { latitude: 0, longitude: Infinity }, { latitude: '52', longitude: 21 }, { latitude: 52, longitude: 21, role: 'admin' }]) assert.equal(parseWeatherLocation(value), undefined);
});

test('OpenMeteo używa zgody na współrzędne bez wyszukiwania miasta', async () => {
  const calls = [];
  const result = await pogodaOpenMeteo({ city: '', startOffsetDays: 0, days: 1 }, { now, location: { latitude: 52.234567, longitude: 21.012345 }, fetcher: async (url) => { calls.push(url); return reply(forecast()); } });
  assert.equal(result.ok, true);
  assert.equal(result.location, 'Twoja lokalizacja');
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]).hostname, 'api.open-meteo.com');
  assert.equal(new URL(calls[0]).searchParams.get('latitude'), '52.235');
  assert.equal(new URL(calls[0]).searchParams.get('longitude'), '21.012');
});

test('miasto w pytaniu ma pierwszeństwo nad współrzędnymi przeglądarki', async () => {
  const calls = [];
  const result = await pogodaOpenMeteo({ city: 'Warszawa', startOffsetDays: 0, days: 1 }, { now, location: { latitude: 50, longitude: 20 }, fetcher: async (url) => { calls.push(url); return reply(calls.length === 1 ? geo : forecast()); } });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[0]).hostname, 'geocoding-api.open-meteo.com');
  assert.equal(new URL(calls[1]).searchParams.get('latitude'), '52.23');
});

test('porównanie EUR: daty według Warszawy, 3/7/30 dni i rok, także rok przestępny', () => {
  const compare = module.namespace.currencyComparisonRequest;
  for (const [period, expected] of [['3 dni temu', '2026-11-12'], ['tydzień temu', '2026-11-08'], ['30 dni temu', '2026-10-16'], ['rok temu', '2025-11-15']]) {
    assert.equal(compare(`Jaki był kurs EUR ${period}? Porównaj z bieżącym.`, now()).date, expected);
  }
  assert.equal(compare('Kurs EUR rok temu, porównaj', new Date('2024-02-29T12:00:00Z')).date, '2023-02-28');
  assert.equal(compare('Jaki jest kurs EUR?', now()), undefined);
  assert.equal(compare('Porównaj kurs EUR z 2026-10-16', now()).date, '2026-10-16');
});

test('NBP: jedno wykonanie porównania pobiera oba kursy i oblicza zmianę', async () => {
  const calls = [];
  const result = await module.namespace.porownajKursWalutyNBP({ currency: 'EUR', date: '2026-10-16' }, { now, fetcher: async (url) => {
    calls.push(url);
    const historical = url.includes('/2026-10-16/');
    return reply({ code: 'EUR', rates: [{ mid: historical ? 4 : 4.5, no: historical ? 'test-old/A' : 'test-new/A', effectiveDate: historical ? '2026-10-16' : '2026-11-13' }] });
  } });
  assert.equal(calls.length, 2);
  assert.equal(result.ok, true);
  assert.equal(result.historical.rate, 4);
  assert.equal(result.current.rate, 4.5);
  assert.equal(result.changePLN, 0.5);
  assert.equal(result.changePercent, 12.5);
  assert.equal(result.sources.length, 2);
});

test('NBP: brak jednego kursu nie tworzy pozornego porównania', async () => {
  const result = await module.namespace.porownajKursWalutyNBP({ currency: 'EUR', date: '2026-11-15' }, { now, fetcher: async (url) => url.includes('2026-11-15/') ? reply({}, 404) : reply({ code: 'EUR', rates: [{ mid: 4.5, no: 'test/A', effectiveDate: '2026-11-13' }] }) });
  assert.equal(result.ok, false);
  assert.equal(result.changePLN, undefined);
  assert.match(result.message, /Nie można obliczyć zmiany/);
});


test('NBP: po braku tabeli bierze najbliższą wcześniejszą i ujawnia obie daty', async () => {
  const calls = [];
  const result = await kursWalutyNBP({ currency: 'EUR', date: '2026-11-08' }, { now, fetcher: async (url) => {
    calls.push(url);
    if (!url.includes('/2026-10-25/2026-11-08/')) return reply({}, 404);
    return reply({ code: 'EUR', rates: [{ mid: 4, no: 'older/A', effectiveDate: '2026-11-05' }, { mid: 4.1, no: 'nearest/A', effectiveDate: '2026-11-06' }] });
  } });
  assert.equal(result.ok, true);
  assert.equal(result.requestedDate, '2026-11-08');
  assert.equal(result.effectiveDate, '2026-11-06');
  assert.equal(result.usedEarlierDate, true);
  assert.equal(result.rate, 4.1);
  assert.equal(calls.length, 3);
});

test('poprzedni piątek to dzień przed dziś, także gdy dziś jest piątek', () => {
  const compare = module.namespace.currencyComparisonRequest;
  assert.equal(compare('Kurs EUR w poprzedni piątek, porównaj', now()).date, '2026-11-13');
  assert.equal(compare('Kurs EUR w poprzedni piątek, porównaj', new Date('2026-11-13T12:00:00Z')).date, '2026-11-06');
});

test('NBP nie cofa daty po awarii HTTP 503 ani nie przyjmuje tabeli z przyszłości', async () => {
  let calls = 0;
  const unavailable = await kursWalutyNBP({ currency: 'EUR', date: '2026-11-08' }, { now, fetcher: async () => { calls++; return reply({}, 503); } });
  assert.equal(unavailable.ok, false);
  assert.equal(calls, 1);
  const invalid = await kursWalutyNBP({ currency: 'EUR', date: '2026-11-08' }, { now, fetcher: async (url) => url.includes('/2026-10-25/') ? reply({ code: 'EUR', rates: [{ mid: 4, no: 'future/A', effectiveDate: '2026-11-09' }] }) : reply({}, 404) });
  assert.equal(invalid.ok, false);
});


test('opis porównania pokazuje oba kursy, dokładne grosze i rzeczywiste daty', () => {
  const format = module.namespace.formatCurrencyComparison;
  const result = format({ currency: 'EUR', historical: { rate: 4.3925, effectiveDate: '2026-11-06', tableNumber: '217/A', requestedDate: '2026-11-08' }, current: { rate: 4.407, effectiveDate: '2026-11-13', tableNumber: '221/A' } });
  for (const expected of ['4,3925 zł', '4,4070 zł', '+0,0145 zł', '+1,45 gr', '+0,33%', '2026-11-06', '2026-11-13', '2026-11-08']) assert.ok(result.includes(expected), expected);
  const same = format({ currency: 'EUR', historical: { rate: 4.407, effectiveDate: '2026-11-13', tableNumber: '221/A', requestedDate: '2026-11-13' }, current: { rate: 4.407, effectiveDate: '2026-11-13', tableNumber: '221/A' } });
  assert.match(same, /0,0000 zł/);
  assert.match(same, /tej samej daty publikacji/);
  const fall = format({ currency: 'EUR', historical: { rate: 4.5, effectiveDate: '2026-11-06', tableNumber: '217/A', requestedDate: '2026-11-06' }, current: { rate: 4.4, effectiveDate: '2026-11-13', tableNumber: '221/A' } });
  assert.match(fall, /-0,1000 zł/);
});

const holiday = (date, name = 'Public holiday', nationalHoliday = true, holidayTypes = ['Public']) => ({ date, name, countryCode: 'PL', nationalHoliday, holidayTypes, subdivisionCodes: null });
const calendar = module.namespace.dniWolnePL;
test('dni wolne: święta i weekendy nie sumują tego samego dnia dwa razy', async () => {
  const result = await calendar({ from: '2026-12-24', to: '2026-12-27' }, { now, fetcher: async (url) => {
    assert.equal(url, 'https://nagerholidays.com/api/v4/Holidays/PL/2026');
    return reply([holiday('2026-12-24', 'Christmas Eve'), holiday('2026-12-25', 'Christmas Day'), holiday('2026-12-26', 'Second Day of Christmas')]);
  } });
  assert.equal(result.ok, true);
  assert.equal(result.freeDaysCount, 4);
  assert.equal(result.workingDaysCount, 0);
  assert.equal(result.days[2].weekend, true);
  assert.equal(result.days[2].publicHoliday, true);
  assert.equal(result.days[3].weekday, 'niedziela');
  assert.equal(result.days[3].publicHoliday, false);
  assert.equal(result.sources[0].fetchedAt, now().toISOString());
  assert.match(result.note, /Nie potwierdza dostępności/);
});
test('zwykły dzień, święto lokalne i obchody nie są ogólnopolskim świętem', async () => {
  const result = await calendar({ from: '2026-11-18', to: '' }, { now, fetcher: async () => reply([holiday('2026-01-01'), holiday('2026-11-18', 'Regional', false), holiday('2026-11-18', 'Observance', true, ['Observance'])]) });
  assert.equal(result.ok, true);
  assert.equal(result.days[0].dayOffCalendar, false);
  assert.equal(result.workingDaysCount, 1);
});
test('kalendarz: przełom roku pobiera dwa kalendarze, dziś liczy w Warszawie', async () => {
  const calls = [];
  const fetcher = async (url) => { calls.push(url); return reply([holiday(`${url.slice(-4)}-01-01`, 'New Year')]); };
  const result = await calendar({ from: '2026-12-31', to: '2027-01-02' }, { now, fetcher });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(result.days[1].publicHoliday, true);
  const midnight = await calendar({ from: '', to: '' }, { now: () => new Date('2026-12-31T23:30:00Z'), fetcher });
  assert.equal(midnight.from, '2027-01-01');
});
test('nieprawidłowe daty i nadmierny zakres nie wywołują API', async () => {
  let calls = 0;
  for (const input of [{ from: '2026-02-30', to: '' }, { from: '2026-12-31', to: '2026-01-01' }, { from: '2026-01-01', to: '2026-12-31' }, { from: '1999-01-01', to: '' }]) {
    assert.equal((await calendar(input, { fetcher: async () => { calls++; throw Error('Unexpected'); } })).ok, false);
  }
  assert.equal(calls, 0);
});
test('awaria, nieprawidłowy JSON i obcy kraj nie są pozornie poprawnym kalendarzem', async () => {
  for (const fetcher of [async () => reply({}, 503), async () => { throw Error('timeout'); }, async () => reply([]), async () => reply([{ ...holiday('2026-01-01'), countryCode: 'DE' }]), async () => reply([{ date: '2026-01-01' }])]) {
    const result = await calendar({ from: '2026-01-01', to: '' }, { now, fetcher });
    assert.equal(result.ok, false);
    assert.equal(result.days, undefined);
    assert.ok(result.message.length > 20);
  }
});

const convertZone = module.namespace.przeliczStrefyCzasowe;
const zoneInput = (date, time, toZone = 'America/New_York', fromZone = 'Europe/Warsaw') => ({ date, time, fromZone, toZone });
test('strefy: Warszawa–Nowy Jork zimą, latem i między różnymi zmianami czasu', () => {
  for (const [date, expected] of [['2026-11-20', '10:00'], ['2026-07-15', '10:00'], ['2026-03-20', '11:00']]) {
    const result = convertZone(zoneInput(date, '16:00'), { now });
    assert.equal(result.ok, true);
    assert.equal(result.source.time, '16:00');
    assert.equal(result.target.date, date);
    assert.equal(result.target.time, expected);
    assert.equal(result.dayDifference, 0);
    assert.equal(result.calculatedAt, now().toISOString());
  }
});
test('strefy: zmiana daty i offset kwadransowy', () => {
  const next = convertZone(zoneInput('2026-11-20', '23:30', 'Asia/Kathmandu'));
  assert.equal(next.ok, true);
  assert.equal(next.target.date, '2026-11-21');
  assert.equal(next.target.time, '04:15');
  assert.equal(next.target.utcOffset, 'UTC+05:45');
  assert.equal(next.dayDifference, 1);
  const previous = convertZone(zoneInput('2026-11-20', '08:00', 'Pacific/Honolulu'));
  assert.equal(previous.target.date, '2026-11-19');
  assert.equal(previous.target.time, '21:00');
  assert.equal(previous.dayDifference, -1);
});
test('nieistniejąca i dwukrotna godzina w Polsce nie są zgadywane', () => {
  const gap = convertZone(zoneInput('2026-03-29', '02:30'));
  assert.equal(gap.ok, false);
  assert.equal(gap.code, 'NONEXISTENT_LOCAL_TIME');
  assert.equal(gap.target, undefined);
  const fold = convertZone(zoneInput('2026-10-25', '02:30'));
  assert.equal(fold.ok, false);
  assert.equal(fold.code, 'AMBIGUOUS_LOCAL_TIME');
  assert.equal(fold.options.length, 2);
  assert.deepEqual(plain(fold.options.map((option) => option.utc)), ['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']);
  assert.equal(fold.target, undefined);
});
test('strefy: uwzględnia półgodzinną zmianę czasu Lord Howe', () => {
  assert.equal(convertZone(zoneInput('2026-10-04', '02:15', 'UTC', 'Australia/Lord_Howe')).code, 'NONEXISTENT_LOCAL_TIME');
  assert.equal(convertZone(zoneInput('2026-04-05', '01:45', 'UTC', 'Australia/Lord_Howe')).options.length, 2);
});
test('strefy: błędna data, godzina, strefa i skrót są odrzucane; UTC jest obsługiwane', async () => {
  for (const input of [zoneInput('2026-02-30', '16:00'), zoneInput('2026-11-20', '24:00'), zoneInput('2026-11-20', '16:00', 'Mars/Unknown'), zoneInput('2026-11-20', '16:00', 'CST'), zoneInput('2026-11-20', '16:00', '')]) assert.equal(convertZone(input).ok, false);
  const result = convertZone(zoneInput('2026-11-20', '16:00', 'UTC', ''));
  assert.equal(result.target.time, '15:00');
  assert.equal(result.utc, '2026-11-20T15:00:00.000Z');
  const tools = createPublicTools(new AbortController().signal);
  assert.equal((await tools.przeliczStrefyCzasowe.inputSchema.validate({ ...zoneInput('2026-11-20', '16:00'), send_now: true })).success, false);
});
test('przeliczenie UTC i GMT nie wymusza narzędzia walutowego', () => {
  assert.deepEqual(plain(requestedPublicTools('Przelicz 16:00 z UTC na godzinę w Warszawie.')), []);
  assert.deepEqual(plain(requestedPublicTools('MAX, przelicz czas GMT na czas Polski.')), []);
  assert.deepEqual(plain(requestedPublicTools('Przelicz 150 PLN na EUR.')), ['kursWalutyNBP']);
});
