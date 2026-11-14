import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
const code = fs.readFileSync(
  new URL("../dist/analyzer.js", import.meta.url),
  "utf8",
);
function analyze(samples, sampleRate = 11025) {
  let result;
  const scope = {
    self: { postMessage: (r) => (result = r) },
    Float64Array,
    Math,
    Array,
  };
  vm.runInNewContext(code, scope);
  scope.self.onmessage({ data: { samples, sampleRate } });
  return result;
}
// Short decaying 220 Hz bursts on every beat. accents[k % accents.length]
// scales beat k, so [1, 0.5] gives a strong-weak pattern.
function pulses(bpm, { seconds = 20, accents = [1], rate = 11025 } = {}) {
  const samples = new Float32Array(rate * seconds),
    period = 60 / bpm;
  for (let i = 0; i < samples.length; i++) {
    const time = i / rate,
      beat = Math.floor(time / period),
      phase = time - beat * period;
    if (phase < 0.025)
      samples[i] =
        accents[beat % accents.length] *
        Math.sin(time * 2 * Math.PI * 220) *
        Math.exp(-phase * 120);
  }
  return samples;
}
test("DSP identifies a synthetic 120 BPM pulse train", () => {
  const r = analyze(pulses(120));
  assert.equal(r.error, undefined);
  assert.ok(Math.abs(r.bpm - 120) <= 2, JSON.stringify(r));
  assert.match(r.key, /^(?:[1-9]|1[0-2])[AB]$/);
  assert.ok(r.energy >= 1 && r.energy <= 10);
  assert.equal(r.wave.length, 180);
});
test("silence and very short clips are rejected", () => {
  assert.match(analyze(new Float32Array(11025 * 5)).error, /quiet/);
  assert.match(analyze(new Float32Array(100)).error, /3 seconds/);
});
test("slow tempo is not doubled: 70 BPM reads as 70", () => {
  const r = analyze(pulses(70));
  assert.equal(r.error, undefined);
  assert.ok(Math.abs(r.bpm - 70) <= 1, `got ${r.bpm}`);
});
test("fast tempo is not halved: 140 BPM reads as 140", () => {
  const r = analyze(pulses(140));
  assert.equal(r.error, undefined);
  assert.ok(Math.abs(r.bpm - 140) <= 1, `got ${r.bpm}`);
});
test("accented 140 BPM (strong, weak) still reads as 140, not 70", () => {
  const r = analyze(pulses(140, { accents: [1, 0.5] }));
  assert.ok(Math.abs(r.bpm - 140) <= 1, `got ${r.bpm}`);
});
test("tempos across the range avoid octave errors", () => {
  for (const bpm of [64, 85, 96, 110, 128, 150, 174]) {
    const r = analyze(pulses(bpm));
    assert.ok(Math.abs(r.bpm - bpm) <= 1, `${bpm} BPM read as ${r.bpm}`);
  }
});
