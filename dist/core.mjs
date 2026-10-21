export function harmonic(a, b) {
  if (!a || !b) return 0.45;
  const x = /^(\d{1,2})([AB])$/.exec(a),
    y = /^(\d{1,2})([AB])$/.exec(b);
  if (!x || !y) return 0.45;
  const d = Math.min(Math.abs(+x[1] - y[1]), 12 - Math.abs(+x[1] - y[1]));
  return d === 0
    ? x[2] === y[2]
      ? 1
      : 0.9
    : d === 1 && x[2] === y[2]
      ? 0.85
      : d === 2 && x[2] === y[2]
        ? 0.5
        : 0.15;
}
export function transition(a, b) {
  if (!a || !b) return 100;
  const tempo = Math.max(0, 1 - Math.abs(a.bpm - b.bpm) / 24),
    key = harmonic(a.key, b.key),
    energy = Math.max(0, 1 - Math.abs(a.energy - b.energy) / 6);
  return Math.round(100 * (0.4 * tempo + 0.4 * key + 0.2 * energy));
}
export function targetEnergy(p, shape) {
  if (shape === "peak") return 5 + 4 * Math.sin(Math.PI * p);
  if (shape === "steady") return 7;
  return 4 + 5 * p;
}
export function optimize(tracks, { count = 8, shape = "build" } = {}) {
  const pool = tracks.slice(0, 100);
  const n = Math.min(Math.max(1, count), pool.length);
  if (!n) return [];
  let beam = [{ ids: [], score: 0 }];
  for (let i = 0; i < n; i++) {
    const next = [];
    for (const s of beam)
      for (let j = 0; j < pool.length; j++) {
        if (s.ids.includes(j)) continue;
        const t = pool[j],
          fit =
            100 -
            Math.abs(
              t.energy - targetEnergy(n === 1 ? 0.5 : i / (n - 1), shape),
            ) *
              16;
        const tr = s.ids.length ? transition(pool[s.ids.at(-1)], t) : fit;
        next.push({
          ids: [...s.ids, j],
          score: s.score + 0.62 * tr + 0.38 * fit,
        });
      }
    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, 36);
  }
  return beam[0]?.ids.map((i) => pool[i]) || [];
}
export function parseCSV(text) {
  const rows = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw Error("Unclosed quote in CSV");
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
export const csvCell = (v) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
export function validateTrack(t) {
  if (!String(t.title || "").trim()) throw Error("Every track needs a title.");
  if (!Number.isFinite(+t.bpm) || +t.bpm < 40 || +t.bpm > 240)
    throw Error("BPM must be between 40 and 240.");
  if (!/^(?:[1-9]|1[0-2])[AB]$/.test(t.key))
    throw Error("Use a Camelot key, such as 8A or 11B.");
  if (!Number.isFinite(+t.energy) || +t.energy < 1 || +t.energy > 10)
    throw Error("Energy must be between 1 and 10.");
  if (!Number.isFinite(+t.duration) || +t.duration < 1 || +t.duration > 7200)
    throw Error("Duration must be 1–7200 seconds.");
  return {
    ...t,
    title: String(t.title).trim(),
    artist: String(t.artist || "Unknown artist"),
    genre: String(t.genre || "Other"),
    bpm: +t.bpm,
    energy: +t.energy,
    duration: +t.duration,
  };
}
