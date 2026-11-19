import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
const context = vm.createContext({ Buffer });
const zlib = new vm.SyntheticModule(['deflateSync'], function () { this.setExport('deflateSync', deflateSync); }, { context });
const source = await readFile(new URL('../lib/calendar-image.ts', import.meta.url), 'utf8');
const module = new vm.SourceTextModule(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, { context });
await module.link((name) => { assert.equal(name, 'node:zlib'); return zlib; });
await module.evaluate();
const { buildCalendar, renderCalendar } = module.namespace;

test('kalendarz: każdy dzień raz, poprawne długości miesięcy 2000–2100', () => {
  for (let year = 2000; year <= 2100; year++) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const expected = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const calendar = buildCalendar(year, 0);
    assert.equal(calendar.months.length, 12);
    assert.equal(calendar.dayCount, leap ? 366 : 365);
    calendar.months.forEach((month, index) => {
      assert.equal(month.days.length, expected[index]);
      assert.equal(new Set(month.days.map((day) => day.day)).size, expected[index]);
      assert.equal(new Set(month.days.map((day) => `${day.row}-${day.column}`)).size, expected[index]);
      for (let day = 1; day <= expected[index]; day++) assert.ok(month.days.some((item) => item.day === day));
      assert.ok(month.days.every((day) => day.row >= 0 && day.row <= 5 && day.column >= 0 && day.column <= 6));
    });
  }
});
test('styczeń 2027: piątek 1 stycznia i niedziela 31 stycznia; rok przestępny', () => {
  const january = buildCalendar(2027, 1).months[0];
  assert.equal(january.days[0].column, 4);
  assert.equal(january.days[30].column, 6);
  assert.equal(january.days[30].row, 4);
  const february = buildCalendar(2028, 2).months[0];
  assert.equal(february.days.at(-1).day, 29);
  assert.equal(february.days.at(-1).column, 1);
});
test('renderer tworzy prawdziwy PNG, o pełnych wymiarach i poprawnych blokach CRC', () => {
  for (const month of [0, 2]) {
    const result = renderCalendar(2028, month);
    const png = Buffer.from(result.imageUrl.split(',')[1], 'base64');
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), result.width);
    assert.equal(png.readUInt32BE(20), result.height);
    const payloads = [];
    for (let position = 8; position < png.length;) {
      const length = png.readUInt32BE(position), type = png.subarray(position + 4, position + 8).toString();
      let crc = 0xffffffff;
      for (const byte of png.subarray(position + 4, position + 8 + length)) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
      }
      assert.equal((crc ^ 0xffffffff) >>> 0, png.readUInt32BE(position + 8 + length));
      if (type === 'IDAT') payloads.push(png.subarray(position + 8, position + 8 + length));
      position += length + 12;
    }
    const pixels = inflateSync(Buffer.concat(payloads));
    assert.equal(pixels.length, (result.width * 3 + 1) * result.height);
    assert.ok(pixels.includes(189));
    assert.ok(png.length < 4_000_000);
  }
});
test('nieprawidłowy rok lub miesiąc nie tworzy pozornego obrazu', () => {
  for (const [year, month] of [[1999, 1], [2101, 0], [2027, 13], [2027, -1], [2027.5, 1], [2027, 1.2]]) assert.throws(() => renderCalendar(year, month));
});
