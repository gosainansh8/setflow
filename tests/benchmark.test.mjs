import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  scoreTrack,
  summarize,
  readLabels,
  decodeWav,
  run,
} from "../scripts/benchmark.mjs";

// 16-bit PCM WAV with a 220 Hz burst on every beat.
function wav(bpm, { seconds = 12, rate = 22050, channels = 2 } = {}) {
  const frames = rate * seconds,
    buf = Buffer.alloc(44 + frames * channels * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + frames * channels * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(frames * channels * 2, 40);
  const period = 60 / bpm;
  for (let f = 0; f < frames; f++) {
    const t = f / rate,
      phase = t % period,
      x =
        phase < 0.025
          ? Math.sin(2 * Math.PI * 220 * t) * Math.exp(-phase * 120)
          : 0;
    for (let c = 0; c < channels; c++)
      buf.writeInt16LE(Math.round(x * 20000), 44 + (f * channels + c) * 2);
  }
  return buf;
}

test("scoring: BPM tolerance, octave errors and key compatibility", () => {
  const truth = { bpm: 128, key: "8A" };
  assert.equal(scoreTrack(truth, { bpm: 130, key: "8A" }).bpmOk, true);
  assert.equal(scoreTrack(truth, { bpm: 131, key: "8A" }).bpmOk, false);
  const half = scoreTrack(truth, { bpm: 64, key: "9A" });
  assert.equal(half.bpmOk, false);
  assert.equal(half.bpmOctaveOk, true);
  assert.equal(half.keyExact, false);
  assert.equal(half.keyCompatible, true, "one step on the wheel is compatible");
  assert.equal(scoreTrack(truth, { bpm: 128, key: "8B" }).keyCompatible, true);
  assert.equal(scoreTrack(truth, { bpm: 128, key: "3B" }).keyCompatible, false);
  assert.deepEqual(
    summarize([
      { bpmOk: true, bpmOctaveOk: true, keyExact: true, keyCompatible: true },
      {
        bpmOk: false,
        bpmOctaveOk: true,
        keyExact: false,
        keyCompatible: false,
      },
    ]),
    { n: 2, bpm: 50, bpmOctave: 100, keyExact: 50, keyCompatible: 50 },
  );
});

test("labels CSV: relative paths, musical keys and validation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setflow-bench-"));
  const csv = path.join(dir, "labels.csv");
  fs.writeFileSync(
    csv,
    "key,path,bpm\nAm,songs/a.wav,124\n8B,/abs/b.mp3,99.5\n",
  );
  assert.deepEqual(readLabels(csv), [
    { line: 2, file: path.join(dir, "songs/a.wav"), bpm: 124, key: "8A" },
    { line: 3, file: "/abs/b.mp3", bpm: 99.5, key: "8B" },
  ]);
  fs.writeFileSync(csv, "path,bpm\na.wav,120\n");
  assert.throws(() => readLabels(csv), /missing a "key" column/);
  fs.writeFileSync(csv, "path,bpm,key\na.wav,fast,8A\n");
  assert.throws(() => readLabels(csv), /line 2: bpm/);
  fs.writeFileSync(csv, "path,bpm,key\na.wav,120,H\n");
  assert.throws(() => readLabels(csv), /line 2: key/);
});

test("WAV decoding and an end-to-end run on synthetic files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setflow-bench-"));
  fs.writeFileSync(path.join(dir, "a.wav"), wav(120));
  fs.writeFileSync(
    path.join(dir, "b.wav"),
    wav(140, { channels: 1, rate: 44100 }),
  );
  const decoded = decodeWav(fs.readFileSync(path.join(dir, "a.wav")));
  assert.equal(decoded.channels.length, 2);
  assert.equal(decoded.sampleRate, 22050);
  // Labels use the true tempo; keys are arbitrary since clicks have no key.
  fs.writeFileSync(
    path.join(dir, "labels.csv"),
    "path,bpm,key\na.wav,120,8A\nb.wav,140,8A\nmissing.wav,100,8A\n",
  );
  const out = path.join(dir, "results.csv"),
    lines = [];
  const { summary, failures } = run(path.join(dir, "labels.csv"), {
    out,
    log: (l) => lines.push(l),
  });
  assert.equal(summary.n, 2);
  assert.equal(summary.bpm, 100);
  assert.equal(failures.length, 1, "a missing file is reported, not fatal");
  assert.ok(lines.some((l) => /^BPM within \+\/-2: +100\.0%$/.test(l)));
  assert.equal(fs.readFileSync(out, "utf8").trim().split("\n").length, 4);
});

test("command line works with and without --out", async () => {
  const { execFileSync } = await import("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "setflow-bench-"));
  fs.writeFileSync(path.join(dir, "a.wav"), wav(120));
  fs.writeFileSync(
    path.join(dir, "labels.csv"),
    "path,bpm,key\na.wav,120,8A\n",
  );
  const script = new URL("../scripts/benchmark.mjs", import.meta.url).pathname;
  const plain = execFileSync("node", [script, path.join(dir, "labels.csv")], {
    encoding: "utf8",
  });
  assert.match(plain, /Analyzed 1 of 1 tracks/);
  const out = path.join(dir, "r.csv");
  execFileSync("node", [script, "--out", out, path.join(dir, "labels.csv")]);
  assert.ok(fs.existsSync(out));
});
