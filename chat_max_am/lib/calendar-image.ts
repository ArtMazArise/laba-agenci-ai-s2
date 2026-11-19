import type { CalendarAnnotation } from "./calendar-events";
import type { CalendarWeather } from "./calendar-weather";
import { deflateSync } from "node:zlib";

const MONTHS = ["STYCZEŃ", "LUTY", "MARZEC", "KWIECIEŃ", "MAJ", "CZERWIEC", "LIPIEC", "SIERPIEŃ", "WRZESIEŃ", "PAŹDZIERNIK", "LISTOPAD", "GRUDZIEŃ"];
export function buildCalendar(year: number, month: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 0 || month > 12) throw Error("Podaj rok 2000–2100 i miesiąc 1–12; 0 oznacza cały rok.");
  const months = (month ? [month] : Array.from({ length: 12 }, (_, i) => i + 1)).map((number) => {
    const firstColumn = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
    return { number, title: MONTHS[number - 1], days: Array.from({ length: count }, (_, index) => ({ day: index + 1, column: (firstColumn + index) % 7, row: Math.floor((firstColumn + index) / 7) })) };
  });
  return { year, month, months, dayCount: months.reduce((sum, item) => sum + item.days.length, 0) };
}

// Litery i liczby rysujemy pikselowo: PNG nie zależy od fontów zainstalowanych na hostingu.
const FONT: Record<string, string> = {
  "0":"01110/10001/10011/10101/11001/10001/01110", "1":"00100/01100/00100/00100/00100/00100/01110", "2":"01110/10001/00001/00010/00100/01000/11111", "3":"11110/00001/00001/01110/00001/00001/11110", "4":"00010/00110/01010/10010/11111/00010/00010", "5":"11111/10000/10000/11110/00001/00001/11110", "6":"01110/10000/10000/11110/10001/10001/01110", "7":"11111/00001/00010/00100/01000/01000/01000", "8":"01110/10001/10001/01110/10001/10001/01110", "9":"01110/10001/10001/01111/00001/00001/01110",
  A:"01110/10001/10001/11111/10001/10001/10001", B:"11110/10001/10001/11110/10001/10001/11110", C:"01111/10000/10000/10000/10000/10000/01111", D:"11110/10001/10001/10001/10001/10001/11110", E:"11111/10000/10000/11110/10000/10000/11111", F:"11111/10000/10000/11110/10000/10000/10000", G:"01111/10000/10000/10111/10001/10001/01111", H:"10001/10001/10001/11111/10001/10001/10001", I:"01110/00100/00100/00100/00100/00100/01110", J:"00111/00010/00010/00010/10010/10010/01100", K:"10001/10010/10100/11000/10100/10010/10001", L:"10000/10000/10000/10000/10000/10000/11111", M:"10001/11011/10101/10101/10001/10001/10001", N:"10001/11001/10101/10011/10001/10001/10001", O:"01110/10001/10001/10001/10001/10001/01110", P:"11110/10001/10001/11110/10000/10000/10000", R:"11110/10001/10001/11110/10100/10010/10001", S:"01111/10000/10000/01110/00001/00001/11110", T:"11111/00100/00100/00100/00100/00100/00100", U:"10001/10001/10001/10001/10001/10001/01110", W:"10001/10001/10001/10101/10101/10101/01010", X:"10001/10001/01010/00100/01010/10001/10001", Y:"10001/10001/01010/00100/00100/00100/00100", Z:"11111/00001/00010/00100/01000/10000/11111", "-":"00000/00000/00000/11111/00000/00000/00000", " ":"00000/00000/00000/00000/00000/00000/00000",
};
Object.assign(FONT, {
  Q: "01110/10001/10001/10001/10101/10010/01101", V: "10001/10001/10001/10001/10001/01010/00100", "Ł": "10000/10010/10100/11000/10000/10000/11111",
  ":": "00000/00100/00100/00000/00100/00100/00000", ".": "00000/00000/00000/00000/00000/00100/00100", "/": "00001/00010/00010/00100/01000/01000/10000", "+": "00000/00100/00100/11111/00100/00100/00000", "?": "01110/10001/00001/00010/00100/00000/00100", "*": "00000/10101/01110/11111/01110/10101/00000", ">": "10000/01000/00100/00010/00100/01000/10000", ",": "00000/00000/00000/00000/00110/00100/01000", "(": "00010/00100/01000/01000/01000/00100/00010", ")": "01000/00100/00010/00010/00010/00100/01000"
});
const crcTable = Array.from({ length: 256 }, (_, value) => { let c = value; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function chunk(type: string, data: Buffer) {
  const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, name, data, checksum]);
}
export function renderCalendar(year: number, month: number, extras: { annotations?: CalendarAnnotation[]; weather?: CalendarWeather; warnings?: string[]; cellHeight?: number } = {}) {
  const calendar = buildCalendar(year, month);
  const annotations = extras.annotations ?? [];
  const extended = annotations.length > 0 || !!extras.weather || extras.cellHeight !== undefined;
  const cellHeight = extras.cellHeight ?? 105;
  if (!Number.isInteger(cellHeight) || cellHeight < 105 || cellHeight > 300) throw Error("Wysokość komórki: 105–300 px.");
  const extraHeight = extended ? (cellHeight - 105) * 6 : 0;
  const annual = month === 0, width = annual ? 2100 : extended ? 1400 : 1000;
  const baseHeight = annual ? 2220 : extended ? 1040 + extraHeight : 850;
  const legend: string[] = annotations.flatMap((event) => {
    const time = event.time ? ` ${event.time} ${event.timeZone || "BRAK STREFY"}` : "";
    const target = event.warsawTime ? ` -> WARSZAWA ${event.warsawDate} ${event.warsawTime}` : "";
    const forecast = extras.weather?.days.find((day) => day.date === (event.warsawDate || event.date));
    const weather = forecast ? ` / ${extras.weather?.city}: ${forecast.minC.toFixed(1)}..${forecast.maxC.toFixed(1)} C, ${forecast.precipitationMm.toFixed(1)} MM` : extras.weather ? " / POGODA: BRAK DANYCH" : "";
    return [`${event.sourceDate} - ${event.kind === "birthday" ? "URODZINY: " : ""}${event.label}${time}${target}${weather}`, ...(event.conversionWarning ? [event.conversionWarning] : [])];
  });
  legend.push(...(extras.warnings ?? []), ...(extras.weather?.notes ?? []));
  if (extras.weather) legend.push(`POGODA OPEN-METEO ${extras.weather.city}: H = HISTORIA MODELOWA, P = PROGNOZA / ARCHIWALNA PROGNOZA. DLA BRAKOW: BRAK DANYCH.`);
  const wrap = (line: string, maximum: number) => {
    const words = line.replace(/\s+/g, " ").split(" "), lines: string[] = []; let current = "";
    for (const word of words) { if (current.length + word.length + 1 > maximum) { if (current) lines.push(current); current = word; } else current += `${current ? " " : ""}${word}`; }
    if (current) lines.push(current); return lines;
  };
  const legendLines = legend.flatMap((line) => wrap(line, Math.floor((width - 80) / 12)));
  const height = baseHeight + (legendLines.length ? 75 + legendLines.length * 28 : 0);
  if (height > 12000) throw Error("Za dużo podpisów w jednym obrazie. Wybierz krótszy zakres wydarzeń.");
  const rgb = Buffer.alloc(width * height * 3);
  const dark = [8, 11, 8], panel = [17, 23, 15], lime = [189, 255, 89], white = [230, 242, 218], muted = [129, 151, 113];
  const rect = (x: number, y: number, w: number, h: number, color: number[]) => {
    for (let row = Math.max(0, Math.floor(y)); row < Math.min(height, y + h); row++) for (let col = Math.max(0, Math.floor(x)); col < Math.min(width, x + w); col++) {
      const offset = (row * width + col) * 3;
      rgb[offset] = color[0]; rgb[offset + 1] = color[1]; rgb[offset + 2] = color[2];
    }
  };
  const text = (value: string, x: number, y: number, scale: number, color: number[], centered = false) => {
    const characters = [...value.toUpperCase().replace(/[–—]/g, "-")];
    let cursor = x - (centered ? (characters.length * 6 - 1) * scale / 2 : 0);
    for (const character of characters) {
      const [base, accent] = [...character.normalize("NFD")];
      if (accent) { rect(cursor + 3 * scale, y, scale, scale, color); rect(cursor + 2 * scale, y + scale, scale, scale, color); }
      (FONT[base] ?? FONT[" "]).split("/").forEach((row, r) => [...row].forEach((bit, c) => { if (bit === "1") rect(cursor + c * scale, y + (r + 2) * scale, scale, scale, color); }));
      cursor += 6 * scale;
    }
  };
  rect(0, 0, width, height, dark);
  text(`MAX - ${year}`, width / 2, 20, annual ? 8 : 6, lime, true);
  calendar.months.forEach((item, index) => {
    const x = annual ? 30 + (index % 3) * 690 : 30, y = annual ? 130 + Math.floor(index / 3) * 510 : 125;
    const w = annual ? 660 : extended ? 1340 : 940, h = annual ? 480 : extended ? 810 + extraHeight : 625, scale = annual ? 3 : 4;
    rect(x, y, w, h, panel); rect(x, y, w, 3, lime);
    text(item.title, x + w / 2, y + 15, scale, lime, true);
    const cellWidth = (w - 30) / 7, gridY = y + (annual ? 100 : 125), rowHeight = annual ? 57 : extended ? cellHeight : 75;
    ["PN", "WT", "ŚR", "CZ", "PT", "SO", "ND"].forEach((day, column) => text(day, x + 15 + (column + 0.5) * cellWidth, y + (annual ? 60 : 75), scale, column >= 5 ? lime : muted, true));
    for (let row = 0; row <= 6; row++) rect(x + 15, gridY + row * rowHeight, w - 30, 1, muted);
    for (const day of item.days) {
      const date = `${year}-${String(item.number).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
      const cx = x + 15 + (day.column + 0.5) * cellWidth, cy = gridY + day.row * rowHeight;
      const dayEvents = annotations.filter((event) => event.date === date);
      text(String(day.day), cx, cy + 10, extended && !annual ? scale : scale + 1, day.column >= 5 ? lime : white, true);
      if (dayEvents.some((event) => event.kind === "birthday")) {
        // Mały tort ze świeczkami, niezależny od fontów i emoji modelu.
        const ix = x + 19 + day.column * cellWidth, iy = cy + 8, size = annual ? 2 : 3;
        ["001010100", "001010100", "000000000", "111111111", "101010101", "111111111", "111111111"].forEach((row, r) => [...row].forEach((bit, c) => { if (bit === "1") rect(ix + c * size, iy + r * size, size, size, lime); }));
      }
      if (!annual) {
        dayEvents.slice(0, 1).forEach((event) => {
          const maximum = Math.floor((cellWidth - 8) / 12);
          const place = event.label.split(" — ").at(-1) || event.label;
          const local = event.time ? `${place.slice(0, maximum - 6)} ${event.time}` : event.label;
          text(local.slice(0, maximum), cx, cy + 40, 2, lime, true);
          if (event.time) text(event.warsawTime ? `WAW ${event.warsawTime}` : "BRAK STREFY", cx, cy + 59, 2, muted, true);
        });
        if (dayEvents.length > 1) text(`+${dayEvents.length - 1} W LEGENDZIE`, cx, cy + 78, 1, muted, true);
        if (extras.weather) {
          const forecast = extras.weather.days.find((entry) => entry.date === date);
          const label = forecast ? `${forecast.kind === "history" ? "H" : "P"} ${Math.round(forecast.minC)}..${Math.round(forecast.maxC)} C ${forecast.precipitationMm.toFixed(1)}MM` : "POGODA: BRAK DANYCH";
          text(label.slice(0, Math.floor((cellWidth - 8) / 6)), cx, cy + 88, 1, muted, true);
        }
      } else if (dayEvents.length) text("*", cx + 25, cy + 12, 2, lime);
    }
  });
  text("PN - ND", width / 2, baseHeight - 65, annual ? 4 : 3, muted, true);
  if (legendLines.length) {
    text("WYDARZENIA I UWAGI", 40, baseHeight + 5, 3, lime);
    legendLines.forEach((line, index) => text(line, 40, baseHeight + 50 + index * 28, 2, white));
  }
  const scanlines = Buffer.alloc((width * 3 + 1) * height);
  for (let row = 0; row < height; row++) rgb.copy(scanlines, row * (width * 3 + 1) + 1, row * width * 3, (row + 1) * width * 3);
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(scanlines)), chunk("IEND", Buffer.alloc(0))]);
  return { annotationCount: annotations.length, imageUrl: `data:image/png;base64,${png.toString("base64")}`, width, height, ...calendar };
}
