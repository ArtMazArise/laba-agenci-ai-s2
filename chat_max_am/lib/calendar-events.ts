import { buildCalendar } from "./calendar-image";
import { przeliczStrefyCzasowe } from "@/lib/public-tools";

export type CalendarEvent = { date: string; label: string; kind: "birthday" | "meeting" | "note"; time?: string; timeZone?: string };
export type CalendarRecurrence = { startDate: string; everyDays: number; time: string; locations: { label: string; timeZone: string }[]; repeatLocations?: boolean; label?: string };
export type CalendarInput = { year: number; month: number; events?: CalendarEvent[]; recurrence?: CalendarRecurrence | null; weatherCity?: string; cellHeight?: number; artPrompt?: string };
export type CalendarAnnotation = CalendarEvent & { sourceDate: string; warsawDate?: string; warsawTime?: string; missingZone?: boolean; conversionWarning?: string };
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const dateValid = (date: unknown): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
const timeValid = (value: unknown) => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const textValid = (value: unknown, limit: number, empty = false) => typeof value === "string" && value.length <= limit && (empty || value.trim().length > 0);
export function validateCalendarInput(value: unknown): value is CalendarInput {
  if (!record(value) || Object.keys(value).some((key) => !["year", "month", "events", "recurrence", "weatherCity", "cellHeight", "artPrompt"].includes(key))) return false;
  try { buildCalendar(value.year as number, value.month as number); } catch { return false; }
  if (value.artPrompt !== undefined && !textValid(value.artPrompt, 500, true)) return false;
  if (value.cellHeight !== undefined && (!Number.isInteger(value.cellHeight) || Number(value.cellHeight) < 105 || Number(value.cellHeight) > 300 || value.month === 0)) return false;
  const inCalendar = (date: string) => date.startsWith(`${value.year}-`) && (!value.month || Number(date.slice(5, 7)) === value.month);
  if (value.weatherCity !== undefined && !textValid(value.weatherCity, 100, true)) return false;
  if (value.events !== undefined && (!Array.isArray(value.events) || value.events.length > 100 || value.events.some((event) => !record(event) || Object.keys(event).some((key) => !["date", "label", "kind", "time", "timeZone"].includes(key)) || !dateValid(event.date) || !inCalendar(event.date) || !textValid(event.label, 80) || !["birthday", "meeting", "note"].includes(String(event.kind)) || (event.time !== undefined && event.time !== "" && !timeValid(event.time)) || (event.timeZone !== undefined && !textValid(event.timeZone, 100, true))))) return false;
  const repeat = value.recurrence;
  if (repeat !== undefined && repeat !== null) {
    if (!record(repeat) || Object.keys(repeat).some((key) => !["startDate", "everyDays", "time", "locations", "repeatLocations", "label"].includes(key)) || !dateValid(repeat.startDate) || !inCalendar(repeat.startDate) || !Number.isInteger(repeat.everyDays) || Number(repeat.everyDays) < 1 || Number(repeat.everyDays) > 366 || !timeValid(repeat.time) || !Array.isArray(repeat.locations) || repeat.locations.length > 100 || repeat.locations.some((location) => !record(location) || Object.keys(location).some((key) => !["label", "timeZone"].includes(key)) || !textValid(location.label, 60, true) || !textValid(location.timeZone, 100, true)) || (repeat.repeatLocations !== undefined && typeof repeat.repeatLocations !== "boolean") || (repeat.label !== undefined && !textValid(repeat.label, 60))) return false;
  }
  return true;
}
export function planCalendarEvents(input: CalendarInput) {
  if (!validateCalendarInput(input)) throw Error("Nieprawidłowe parametry wydarzeń kalendarza.");
  const events: CalendarEvent[] = [...(input.events ?? [])];
  const calendar = buildCalendar(input.year, input.month);
  if (input.recurrence) {
    const r = input.recurrence;
    const end = Date.UTC(input.year, input.month || 12, 0);
    for (let instant = Date.parse(r.startDate), index = 0; instant <= end; instant += r.everyDays * 86400000, index++) {
      if (events.length >= 200) throw Error("Kalendarz może mieć maksymalnie 200 wydarzeń. Wybierz krótszy zakres.");
      const location = r.locations[r.repeatLocations && r.locations.length ? index % r.locations.length : index];
      events.push({ date: new Date(instant).toISOString().slice(0, 10), label: [r.label || "Spotkanie", location?.label].filter(Boolean).join(" — "), kind: "meeting", time: r.time, timeZone: location?.timeZone || "" });
    }
  }
  const warnings: string[] = [];
  const unique = [...new Map(events.map((event) => [JSON.stringify([event.date, event.kind, event.label, event.time || "", event.timeZone || ""]), event])).values()];
  const annotations: CalendarAnnotation[] = unique.map((event) => {
    const item: CalendarAnnotation = { ...event, sourceDate: event.date };
    if (!event.time) return item;
    if (!event.timeZone) {
      item.missingZone = true;
      return item;
    }
    const converted = przeliczStrefyCzasowe({ date: event.date, time: event.time, fromZone: event.timeZone, toZone: "Europe/Warsaw" });
    if (!converted.ok) {
      item.conversionWarning = converted.message;
      warnings.push(`${event.date}: ${converted.message}`);
      return item;
    }
    item.date = converted.target.date;
    item.warsawDate = converted.target.date;
    item.warsawTime = converted.target.time;
    if (!item.date.startsWith(`${input.year}-`) || input.month && Number(item.date.slice(5, 7)) !== input.month) warnings.push(`${event.date}: po przeliczeniu na Warszawę wydarzenie wypada poza wybranym kalendarzem (${item.date}); pozostaje w legendzie.`);
    return item;
  });
  annotations.sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));
  const missingLocations = annotations.filter((event) => event.missingZone).map((event) => event.sourceDate);
  if (missingLocations.length) warnings.push(`Brakuje lokalizacji/stref dla ${missingLocations.length} spotkań. Poproś użytkownika w czacie o pozostałe miasta; nie zgaduj. Daty: ${missingLocations.join(", ")}.`);
  return { calendar, annotations, warnings, missingLocations };
}
