import { ImageResponse } from "next/og";
import { createElement as h, type ReactNode } from "react";
import { buildCalendar } from "./calendar-image";
import type { CalendarAnnotation } from "./calendar-events";
import type { CalendarWeather } from "./calendar-weather";

type PosterInput = { year: number; month: number; annotations: CalendarAnnotation[]; weather?: CalendarWeather; artUrl: string; referenceImageUrl: string; cellHeight?: number };
const box = (style: Record<string, unknown>, ...children: ReactNode[]) => h("div", { style: { display: "flex", ...style } }, ...children);
const cake = () => h("svg", { width: 28, height: 28, viewBox: "0 0 28 28" }, h("path", { d: "M5 13h18v11H5zM7 8h14v5H7zM10 3v5m8-5v5", fill: "#bdff59", stroke: "#bdff59", strokeWidth: 2 }), h("path", { d: "M5 18h18", stroke: "#17311d", strokeWidth: 2 }));

// AI tworzy ilustrację. Teksty i układ dni składa kod, bez rysowania cyfr przez model.
export async function renderCalendarPoster(input: PosterInput) {
  const calendar = buildCalendar(input.year, input.month);
  const counts = new Map<string, number>();
  for (const event of input.annotations) counts.set(event.date, (counts.get(event.date) ?? 0) + 1);
  const width = 1800, cellHeight = Math.max([...counts.values()].some((count) => count >= 2) ? 340 : 230, input.cellHeight ?? 230);
  const month = calendar.months[0];
  const rowCount = month.days.at(-1)!.row + 1;
  const height = input.month ? 620 + rowCount * cellHeight : 2440;
  const weatherAvailable = input.weather?.days.length ?? 0;
  const header = box({ height: 440, width, backgroundColor: "#101b12", alignItems: "center" },
    h("img", { src: input.artUrl, width: 440, height: 440, style: { objectFit: "cover" } }),
    box({ flexDirection: "column", padding: "45px 55px", gap: 20 },
      h("div", { style: { color: "#bdff59", fontSize: 24, letterSpacing: 7 } }, "MAX"),
      h("div", { style: { fontSize: 66, fontWeight: 700, color: "#f1f5e9" } }, input.month ? `${month.title} ${input.year}` : `${input.year}`),
      h("div", { style: { fontSize: 23, color: "#afc3a6" } }, "Twoje wydarzenia · godziny lokalne i warszawskie")));
  const rows: ReactNode[] = [];
  if (input.month) {
    rows.push(box({ padding: "18px 50px 8px", height: 70 }, ...["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota", "Niedziela"].map((name, index) => box({ width: 242, justifyContent: "center", fontSize: 21, color: index >= 5 ? "#bdff59" : "#a6baa0" }, name))));
    for (let row = 0; row < rowCount; row++) {
      const cells = Array.from({ length: 7 }, (_, column) => {
        const day = month.days.find((value) => value.row === row && value.column === column);
        if (!day) return box({ width: 242, height: cellHeight, padding: 4 });
        const date = `${input.year}-${String(input.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
        const events = input.annotations.filter((event) => event.date === date);
        const forecast = input.weather?.days.find((entry) => entry.date === date);
        const eventNodes = events.slice(0, 2).map((event) => box({ flexDirection: "column", gap: 3, marginTop: 10 },
          box({ color: "#e8f5df", fontSize: 19, gap: 7, alignItems: "center" }, event.kind === "birthday" ? cake() : null, event.label.split(" — ").at(-1)!),
          ...(event.time ? [h("div", { style: { fontSize: 18, color: "#bdff59" } }, `Lokalnie ${event.time}`), h("div", { style: { fontSize: 17, color: "#bdcbb8" } }, event.warsawTime ? `Warszawa ${event.warsawTime}` : "Brak strefy czasowej")] : [])));
        const weatherText = !input.weather ? "" : forecast ? `${forecast.kind === "history" ? "Historia" : "Prognoza"}: ${forecast.minC.toFixed(0)}–${forecast.maxC.toFixed(0)}°C · ${forecast.precipitationMm.toFixed(1)} mm` : "Pogoda: brak danych";
        return box({ width: 242, height: cellHeight, padding: 4 }, box({ width: 234, height: cellHeight - 8, borderRadius: 14, border: `1px solid ${events.length ? "#66883d" : "#2a3b2a"}`, backgroundColor: events.length ? "#192b19" : "#101b13", padding: "14px 16px", flexDirection: "column" },
          h("div", { style: { fontSize: 32, fontWeight: 700, color: column >= 5 ? "#bdff59" : "#f0f5ea" } }, String(day.day)),
          ...eventNodes,
          ...(events.length > 2 ? [h("div", { style: { fontSize: 15, color: "#c5d4bc", marginTop: 4 } }, `+${events.length - 2} wydarzeń — szczegóły pod obrazem`)] : []),
          h("div", { style: { marginTop: "auto", paddingTop: 8, fontSize: 15, color: "#9db194" } }, weatherText)));
      });
      rows.push(box({ padding: "0 50px" }, ...cells));
    }
  } else rows.push(h("img", { src: input.referenceImageUrl, width: 1800, height: 1900, style: { objectFit: "contain" } }));
  const footer = box({ padding: "20px 60px", fontSize: 17, color: "#9db194", flexDirection: "column", gap: 6 },
    h("div", {}, "Ilustracja: AI · Daty, godziny i podpisy: kod aplikacji · Pełne wydarzenia i uwagi pod obrazem"),
    input.weather ? h("div", {}, `Pogoda: Open-Meteo, dane dla ${weatherAvailable} dni. Historia modelowa i prognoza są rozróżnione; braków nie uzupełniono.`) : null);
  const response = new ImageResponse(box({ width, height, backgroundColor: "#080e0a", flexDirection: "column", fontFamily: "sans-serif" }, h("img", { src: input.artUrl, width, height, style: { position: "absolute", top: 0, left: 0, objectFit: "cover", opacity: 0.10 } }), header, ...rows, footer), { width, height });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 6_000_000) throw Error("MAX: Kalendarz jest zbyt duży. Wybierz krótszy zakres lub mniej wydarzeń.");
  return { imageUrl: `data:image/png;base64,${buffer.toString("base64")}`, width, height, cellHeight };
}
