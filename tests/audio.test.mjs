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
test("DSP identifies a synthetic 120 BPM pulse train", () => {
  const rate = 11025,
    samples = new Float32Array(rate * 20);
  for (let i = 0; i < samples.length; i++) {
    const phase = (i / rate) % 0.5;
    if (phase < 0.025)
      samples[i] =
        Math.sin((i / rate) * 2 * Math.PI * 220) * Math.exp(-phase * 120);
  }
  const r = analyze(samples);
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
