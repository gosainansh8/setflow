import test from "node:test";
import assert from "node:assert/strict";
import {
  harmonic,
  transition,
  optimize,
  parseCSV,
  csvCell,
  validateTrack,
} from "../dist/core.mjs";
const track = (id, bpm, key, energy) => ({
  id,
  title: id,
  artist: "Test",
  bpm,
  key,
  energy,
  duration: 180,
  genre: "House",
});
test("Camelot wheel wraps and recognizes relative modes", () => {
  assert.equal(harmonic("12A", "1A"), 0.85);
  assert.equal(harmonic("8A", "8B"), 0.9);
  assert.equal(harmonic("8A", "8A"), 1);
  assert.ok(harmonic("8A", "3B") < 0.2);
});
test("transition favors compatible tracks and is bounded", () => {
  const a = track("a", 120, "8A", 5);
  assert.equal(transition(a, a), 100);
  assert.ok(
    transition(a, track("b", 122, "9A", 6)) >
      transition(a, track("c", 150, "3B", 10)),
  );
  for (let bpm = 40; bpm < 241; bpm += 10) {
    const s = transition(a, track("t", bpm, "3B", 10));
    assert.ok(s >= 0 && s <= 100);
  }
});
test("beam search respects count and uniqueness; empty pool safe", () => {
  const ts = Array.from({ length: 10 }, (_, i) =>
    track("t" + i, 110 + i * 2, (i % 12) + 1 + "A", i + 1),
  );
  const result = optimize(ts, { count: 8 });
  assert.equal(result.length, 8);
  assert.equal(new Set(result.map((t) => t.id)).size, 8);
  assert.deepEqual(optimize([]), []);
  assert.equal(optimize(ts, { count: 20 }).length, 10);
});
test("energy targets influence order when tempo and key match", () => {
  const ts = [9, 4, 7, 5, 8, 6].map((e) => track("e" + e, 120, "8A", e));
  const result = optimize(ts, { count: 6, shape: "build" });
  assert.ok(result[0].energy < result.at(-1).energy);
});
test("CSV handles quotes, commas, embedded newlines, CRLF and rejects malformed input", () => {
  const cells = ["a,b", 'a"b', "a\nb"];
  assert.deepEqual(parseCSV(cells.map(csvCell).join(",") + "\r\n")[0], cells);
  assert.throws(() => parseCSV('"unfinished'));
});
test("metadata rejects NaN, bad keys, invalid duration", () => {
  const good = track("t", 120, "8A", 5);
  assert.equal(validateTrack(good).bpm, 120);
  for (const patch of [
    { bpm: NaN },
    { key: "13A" },
    { energy: 11 },
    { duration: 0 },
    { title: "" },
  ])
    assert.throws(() => validateTrack({ ...good, ...patch }));
});
