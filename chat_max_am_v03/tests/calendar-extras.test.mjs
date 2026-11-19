import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { loadPublicToolsModule } from './public-tools-helper.mjs';
const context = vm.createContext({ Buffer, URL, URLSearchParams, AbortSignal });
const publicTools = await loadPublicToolsModule(context);
const zlib = new vm.SyntheticModule(['deflateSync'], function () { this.setExport('deflateSync', deflateSync); }, { context });
const modules = { 'node:zlib': zlib, '@/lib/public-tools': publicTools };
for (const [name, file] of [['./calendar-image', '../lib/calendar-image.ts'], ['events', '../lib/calendar-events.ts'], ['weather', '../lib/calendar-weather.ts']]) {
  const module = new vm.SourceTextModule(ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, { context });
  await module.link((name) => { assert.ok(modules[name], name); return modules[name]; }); modules[name] = module; await module.evaluate();
}
const { planCalendarEvents, validateCalendarInput } = modules.events.namespace;
const { calendarWeather } = modules.weather.namespace;
const recurring = { year: 2032, month: 5, events: [{ date: '2032-05-08', label: 'Osoba A', kind: 'birthday' }], recurrence: { startDate: '2032-05-01', everyDays: 3, time: '16:00', locations: [{ label: 'Miasto A', timeZone: 'Asia/Seoul' }], repeatLocations: false } };
test('urodziny i cykl co 3 dni zachowują daty, nie zgadują pozostałych lokalizacji', () => {
  const result = planCalendarEvents(recurring);
  assert.equal(result.calendar.dayCount, 31);
  assert.equal(result.annotations.length, 12);
  assert.equal(result.annotations.filter((event) => event.kind === 'birthday').length, 1);
  const meetings = result.annotations.filter((event) => event.kind === 'meeting');
  assert.equal(meetings[0].warsawTime, '09:00');
  assert.equal(meetings[0].sourceDate, '2032-05-01');
  assert.deepEqual(JSON.parse(JSON.stringify(meetings.map((event) => Number(event.sourceDate.slice(-2))))), [1,4,7,10,13,16,19,22,25,28,31]);
  assert.equal(result.missingLocations.length, 10);
  assert.ok(meetings.slice(1).every((event) => event.missingZone && !event.warsawTime));
});
test('podana sekwencja może się powtarzać, a identyczne wydarzenia nie są dublowane', () => {
  const input = { ...recurring, events: [recurring.events[0], recurring.events[0]], recurrence: { ...recurring.recurrence, everyDays: 10, repeatLocations: true, locations: [{ label: 'Strefa A', timeZone: 'Asia/Seoul' }, { label: 'Strefa B', timeZone: 'Europe/London' }] } };
  const result = planCalendarEvents(input);
  assert.equal(result.annotations.filter((event) => event.kind === 'birthday').length, 1);
  assert.equal(result.missingLocations.length, 0);
  assert.equal(result.annotations.filter((event) => event.kind === 'meeting')[2].timeZone, 'Asia/Seoul');
});
test('kalendarz z dodatkami jest PNG i zachowuje każdy dzień', () => {
  const plan = planCalendarEvents(recurring);
  const plain = modules['./calendar-image'].namespace.renderCalendar(2032, 5);
  const decorated = modules['./calendar-image'].namespace.renderCalendar(2032, 5, { annotations: plan.annotations, warnings: plan.warnings });
  assert.equal(decorated.dayCount, 31);
  assert.equal(decorated.annotationCount, 12);
  assert.ok(decorated.height > plain.height);
  assert.notEqual(decorated.imageUrl, plain.imageUrl);
});
test('nieprawidłowe wydarzenia, nieprawidłowy cykl i dodatkowe pola są odrzucane', () => {
  for (const value of [{ ...recurring, events: [{ ...recurring.events[0], date: '2032-05-32' }] }, { ...recurring, recurrence: { ...recurring.recurrence, everyDays: 0 } }, { ...recurring, events: [{ ...recurring.events[0], admin: true }] }, { ...recurring, events: [{ ...recurring.events[0], date: '2032-06-08' }] }]) assert.equal(validateCalendarInput(value), false);
});
const now = () => new Date('2032-05-20T12:00:00Z');
const reply = (data) => ({ ok: true, status: 200, json: async () => data });
function weatherFetch(calls, missing = false) {
  return async (value) => {
    const url = new URL(value); calls.push(url);
    if (url.hostname.startsWith('geocoding')) return reply({ results: [{ latitude: 50, longitude: 20 }] });
    const from = url.searchParams.get('start_date'), to = url.searchParams.get('end_date');
    const dates = [];
    for (let d = Date.parse(from); d <= Date.parse(to); d += 86400000) dates.push(new Date(d).toISOString().slice(0, 10));
    return reply({ daily: { time: dates, temperature_2m_min: dates.map((date) => missing && date === '2032-05-18' ? null : 5), temperature_2m_max: dates.map(() => 12), precipitation_sum: dates.map(() => 1.2), weather_code: dates.map(() => 61) } });
  };
}
test('pogoda kalendarza dopasowuje historię i prognozę do dat miesiąca', async () => {
  const calls = [];
  const weather = await calendarWeather(2032, 5, 'Miasto testowe', { now, fetcher: weatherFetch(calls) });
  assert.equal(weather.days.length, 31);
  assert.equal(weather.days[0].date, '2032-05-01');
  assert.equal(weather.days[0].kind, 'history');
  assert.equal(weather.days.at(-1).kind, 'forecast');
  assert.equal(weather.sources.length, 2);
  assert.equal(calls.length, 3);
  assert.ok(calls.some((url) => url.hostname === 'archive-api.open-meteo.com'));
});
test('brakujące dane, awaria i zbyt daleka przyszłość nie tworzą fikcyjnej pogody', async () => {
  const partial = await calendarWeather(2032, 5, 'Miasto testowe', { now, fetcher: weatherFetch([], true) });
  assert.equal(partial.days.length, 30);
  assert.ok(!partial.days.some((day) => day.date === '2032-05-18'));
  const failure = await calendarWeather(2032, 5, 'Miasto testowe', { now, fetcher: async () => { throw Error('PRIVATE'); } });
  assert.equal(failure.days.length, 0);
  assert.ok(!JSON.stringify(failure).includes('PRIVATE'));
  let calls = 0;
  const future = await calendarWeather(2035, 5, 'Miasto testowe', { now, fetcher: async () => { calls++; throw Error('Unexpected'); } });
  assert.equal(calls, 0);
  assert.equal(future.days.length, 0);
});
