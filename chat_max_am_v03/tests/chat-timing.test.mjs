import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { loadTimingModule } from './timing-helper.mjs';
const module = await loadTimingModule(vm.createContext({}));
await module.evaluate();
const { createChatTiming } = module.namespace;

test('pomiary: oddzielone etapy modelu, narzędzie i narzut serwera', () => {
  let clock = 0;
  const timer = createChatTiming(() => clock);
  clock = 10; timer.startStep(1, 0);
  clock = 100; timer.startTool(1, 0, 'call', 'pogodaOpenMeteo');
  clock = 120; timer.endTool(1, 'call', true);
  clock = 130; timer.endStep(1, 0);
  clock = 140; timer.startStep(1, 1);
  clock = 200; timer.endStep(1, 1);
  clock = 210;
  const result = timer.snapshot();
  assert.equal(result.totalMs, 210);
  assert.equal(result.modelBeforeToolMs, 100);
  assert.equal(result.toolMs, 20);
  assert.equal(result.modelAfterToolMs, 60);
  assert.equal(result.overheadMs, 30);
  assert.equal(result.tools[0].durationMs, 20);
  assert.equal(result.steps.length, 2);
});

test('równoległe narzędzia nie są podwójnie liczone w czasie całego etapu', () => {
  let clock = 0;
  const timer = createChatTiming(() => clock);
  timer.startStep(1, 0);
  clock = 20; timer.startTool(1, 0, 'a', 'one');
  clock = 30; timer.startTool(1, 0, 'b', 'two');
  clock = 50; timer.endTool(1, 'a', true);
  clock = 60; timer.endTool(1, 'b', true);
  clock = 80; timer.endStep(1, 0);
  const result = timer.snapshot();
  assert.equal(result.toolMs, 40);
  assert.equal(result.modelBeforeToolMs, 40);
  assert.equal(result.tools.reduce((sum, tool) => sum + tool.durationMs, 0), 60);
});

test('błąd i ponowienie zachowują osobne próby, bez sekretów i treści żądania', () => {
  let clock = 0;
  const timer = createChatTiming(() => clock);
  timer.startStep(1, 0);
  clock = 50; timer.endAttempt(1);
  clock = 60; timer.startStep(2, 0);
  clock = 100; timer.endStep(2, 0);
  const result = timer.snapshot();
  assert.equal(result.steps[0].attempt, 1);
  assert.equal(result.steps[0].totalMs, 50);
  assert.equal(result.steps[1].attempt, 2);
  assert.equal(result.modelBeforeToolMs, 90);
  assert.equal(result.toolMs, 0);
  assert.equal(result.modelAfterToolMs, 0);
  assert.equal(result.overheadMs, 10);
});
