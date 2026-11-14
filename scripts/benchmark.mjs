#!/usr/bin/env node
// Measures SetFlow's BPM and key detection against tracks you labeled by hand.
//
//   node scripts/benchmark.mjs labels.csv [--out results.csv]
//
// labels.csv needs a header row with these columns (any order):
//   path  audio file, absolute or relative to the CSV file
//   bpm   true BPM
//   key   true key, Camelot (8A) or musical (Am, F#m, Db)
//
// Audio goes through the same steps as the browser: mono, 11,025 Hz, first
// 90 seconds, then dist/analyzer.js. WAV files are decoded here; other
// formats (MP3, M4A, FLAC...) need ffmpeg on your PATH.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCSV, normalizeKey, harmonic } from "../dist/core.mjs";

const RATE = 11025,
  MAX_SECONDS = 90,
  BPM_TOLERANCE = 2;

const analyzerSource = fs.readFileSync(
  fileURLToPath(new URL("../dist/analyzer.js", import.meta.url)),
  "utf8",
);
// Run the browser worker unchanged: give it a fake `self`, post one message,
// and capture what it posts back.
export function analyze(samples, sampleRate = RATE) {
  let result;
  const scope = {
    self: { postMessage: (r) => (result = r) },
    Float64Array,
    Math,
    Array,
  };
  vm.runInNewContext(analyzerSource, scope);
  scope.self.onmessage({ data: { samples, sampleRate } });
  return result;
}

// Same downmix and nearest-sample resampling as importAudio() in app.mjs.
function toAnalysisRate(channels, sourceRate) {
  const frames = channels[0].length,
    len = Math.min(
      Math.floor((frames / sourceRate) * RATE),
      RATE * MAX_SECONDS,
    ),
    out = new Float32Array(len);
  for (const data of channels)
    for (let i = 0; i < len; i++)
      out[i] +=
        data[Math.min(frames - 1, Math.floor((i * sourceRate) / RATE))] /
        channels.length;
  return out;
}

// Minimal WAV reader: PCM 8/16/24/32-bit integer and 32/64-bit float.
export function decodeWav(buffer) {
  const v = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    tag = (o) => String.fromCharCode(...buffer.subarray(o, o + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw Error("not a WAV file");
  let fmt, data;
  for (let o = 12; o + 8 <= buffer.length; ) {
    const id = tag(o),
      size = v.getUint32(o + 4, true);
    if (id === "fmt ") fmt = o + 8;
    if (id === "data") data = { start: o + 8, size };
    o += 8 + size + (size % 2);
  }
  if (fmt == null || !data) throw Error("WAV is missing fmt or data chunk");
  let format = v.getUint16(fmt, true);
  const channels = v.getUint16(fmt + 2, true),
    sampleRate = v.getUint32(fmt + 4, true),
    bits = v.getUint16(fmt + 14, true);
  if (format === 0xfffe) format = v.getUint16(fmt + 24, true); // extensible
  const bytes = bits / 8,
    frames = Math.floor(
      Math.min(data.size, buffer.length - data.start) / (bytes * channels),
    ),
    out = Array.from({ length: channels }, () => new Float32Array(frames));
  const read = (o) => {
    if (format === 3)
      return bits === 64 ? v.getFloat64(o, true) : v.getFloat32(o, true);
    if (format !== 1) throw Error(`unsupported WAV format ${format}`);
    if (bits === 8) return (v.getUint8(o) - 128) / 128;
    if (bits === 16) return v.getInt16(o, true) / 32768;
    if (bits === 24) {
      const x =
        v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getInt8(o + 2) << 16);
      return x / 8388608;
    }
    if (bits === 32) return v.getInt32(o, true) / 2147483648;
    throw Error(`unsupported WAV bit depth ${bits}`);
  };
  for (let f = 0; f < frames; f++)
    for (let c = 0; c < channels; c++)
      out[c][f] = read(data.start + (f * channels + c) * bytes);
  return { channels: out, sampleRate };
}

function loadSamples(file) {
  if (/\.wave?$/i.test(file)) {
    const { channels, sampleRate } = decodeWav(fs.readFileSync(file));
    return toAnalysisRate(channels, sampleRate);
  }
  let raw;
  try {
    raw = execFileSync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        file,
        "-t",
        String(MAX_SECONDS),
        "-ac",
        "1",
        "-ar",
        String(RATE),
        "-f",
        "f32le",
        "-",
      ],
      { maxBuffer: RATE * MAX_SECONDS * 4 + 1024 },
    );
  } catch (e) {
    throw Error(
      e.code === "ENOENT"
        ? "needs ffmpeg for non-WAV files (brew install ffmpeg)"
        : `ffmpeg could not decode it: ${String(e.stderr || e.message).trim()}`,
    );
  }
  return new Float32Array(
    raw.buffer,
    raw.byteOffset,
    raw.byteLength / 4,
  ).slice();
}

// Scoring for one labeled track. Compatible means a mix-safe neighbor on the
// Camelot wheel: same key, relative major/minor, or one step either way.
export function scoreTrack(truth, estimate) {
  const bpmError = estimate.bpm - truth.bpm,
    octaveError = Math.min(
      ...[1, 2, 0.5].map((m) => Math.abs(estimate.bpm - truth.bpm * m)),
    );
  return {
    bpmOk: Math.abs(bpmError) <= BPM_TOLERANCE,
    bpmOctaveOk: octaveError <= BPM_TOLERANCE,
    keyExact: estimate.key === truth.key,
    keyCompatible: harmonic(estimate.key, truth.key) >= 0.85,
    bpmError,
  };
}
export function summarize(rows) {
  const n = rows.length,
    pct = (k) => (n ? (100 * rows.filter((r) => r[k]).length) / n : 0);
  return {
    n,
    bpm: pct("bpmOk"),
    bpmOctave: pct("bpmOctaveOk"),
    keyExact: pct("keyExact"),
    keyCompatible: pct("keyCompatible"),
  };
}

export function readLabels(csvPath) {
  const rows = parseCSV(fs.readFileSync(csvPath, "utf8").replace(/^﻿/, ""));
  if (rows.length < 2)
    throw Error("labels CSV needs a header and at least one row");
  const head = rows.shift().map((h) => h.trim().toLowerCase()),
    col = (name) => {
      const i = head.indexOf(name);
      if (i < 0) throw Error(`labels CSV is missing a "${name}" column`);
      return i;
    },
    [p, b, k] = ["path", "bpm", "key"].map(col),
    base = path.dirname(path.resolve(csvPath));
  return rows.map((r, i) => {
    const line = i + 2,
      bpm = Number(r[b]),
      key = normalizeKey(r[k]);
    if (!r[p]?.trim()) throw Error(`line ${line}: empty path`);
    if (!(bpm >= 40 && bpm <= 240))
      throw Error(`line ${line}: bpm "${r[b]}" is not 40 to 240`);
    if (!/^(?:[1-9]|1[0-2])[AB]$/.test(key))
      throw Error(
        `line ${line}: key "${r[k]}" is not a Camelot or musical key`,
      );
    return { line, file: path.resolve(base, r[p].trim()), bpm, key };
  });
}

export function run(csvPath, { out, log = console.log } = {}) {
  const labels = readLabels(csvPath),
    results = [],
    failures = [];
  for (const t of labels) {
    try {
      const est = analyze(loadSamples(t.file));
      if (est.error) throw Error(est.error);
      const s = scoreTrack(t, est);
      results.push({ ...t, est, ...s });
      log(
        `${s.bpmOk ? "ok " : "BPM"} ${s.keyExact ? "ok " : s.keyCompatible ? "~  " : "KEY"}  ` +
          `bpm ${String(est.bpm).padStart(3)} (true ${t.bpm})  ` +
          `key ${est.key.padEnd(3)} (true ${t.key.padEnd(3)}) conf ${est.keyConfidence.toFixed(2)}  ` +
          path.basename(t.file),
      );
    } catch (e) {
      failures.push({ ...t, error: e.message });
      log(`ERR  ${path.basename(t.file)}: ${e.message}`);
    }
  }
  const all = summarize(results);
  log("");
  log(
    `Analyzed ${all.n} of ${labels.length} tracks${failures.length ? ` (${failures.length} failed, listed above)` : ""}.`,
  );
  if (all.n) {
    // How useful is the low-confidence flag? Compare the two groups.
    const low = summarize(results.filter((r) => r.est.keyConfidence < 0.7)),
      high = summarize(results.filter((r) => r.est.keyConfidence >= 0.7)),
      share = (g) => (g.n ? `${g.keyExact.toFixed(1)}% of ${g.n}` : "n/a");
    for (const [label, value] of [
      [`BPM within +/-${BPM_TOLERANCE}`, `${all.bpm.toFixed(1)}%`],
      [
        `BPM within +/-${BPM_TOLERANCE}, allowing x2 or /2`,
        `${all.bpmOctave.toFixed(1)}%`,
      ],
      ["Key exact", `${all.keyExact.toFixed(1)}%`],
      [
        "Key compatible (same, relative, +/-1)",
        `${all.keyCompatible.toFixed(1)}%`,
      ],
      ["Key exact, confidence >= 0.70", share(high)],
      ["Key exact, confidence < 0.70", share(low)],
    ])
      log(`${(label + ":").padEnd(40)} ${value}`);
  }
  if (out) {
    const cell = (v) => `"${String(v).replaceAll('"', '""')}"`;
    fs.writeFileSync(
      out,
      [
        "path,true_bpm,est_bpm,bpm_ok,true_key,est_key,key_exact,key_compatible,key_confidence,error",
        ...results.map((r) =>
          [
            r.file,
            r.bpm,
            r.est.bpm,
            r.bpmOk,
            r.key,
            r.est.key,
            r.keyExact,
            r.keyCompatible,
            r.est.keyConfidence,
            "",
          ]
            .map(cell)
            .join(","),
        ),
        ...failures.map((f) =>
          [f.file, f.bpm, "", "", f.key, "", "", "", "", f.error]
            .map(cell)
            .join(","),
        ),
      ].join("\n") + "\n",
    );
    log(`Per-track results written to ${out}`);
  }
  return { summary: all, results, failures };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2),
    outIndex = args.indexOf("--out"),
    out = outIndex >= 0 ? args[outIndex + 1] : undefined,
    csv = args.find(
      (a, i) => !a.startsWith("--") && (outIndex < 0 || i !== outIndex + 1),
    );
  if (!csv || (outIndex >= 0 && !out)) {
    console.error(
      "Usage: node scripts/benchmark.mjs labels.csv [--out results.csv]",
    );
    console.error(
      "labels.csv columns: path,bpm,key  e.g.  music/track.mp3,128,8A",
    );
    process.exit(2);
  }
  try {
    run(csv, { out });
  } catch (e) {
    console.error(`benchmark: ${e.message}`);
    process.exit(1);
  }
}
