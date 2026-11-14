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
// Below this chroma correlation the detected key is flagged for checking.
// Picked from synthetic signals: clear triads and progressions score
// 0.80 to 0.98, a lone note 0.68, noise and clusters about 0.33.
export const LOW_KEY_CONFIDENCE = 0.7;
export function keyIsUncertain(t) {
  return (
    Number.isFinite(t?.keyConfidence) && t.keyConfidence < LOW_KEY_CONFIDENCE
  );
}
export function validateTrack(t) {
  if (!String(t.title || "").trim()) throw Error("Every track needs a title.");
  if (!Number.isFinite(+t.bpm) || +t.bpm < 40 || +t.bpm > 240)
    throw Error("BPM must be between 40 and 240.");
  if (!/^(?:[1-9]|1[0-2])[AB]$/.test(t.key))
    throw Error("Use a Camelot key, such as 8A or 11B.");
  if (!Number.isFinite(+t.energy) || +t.energy < 1 || +t.energy > 10)
    throw Error("Energy must be between 1 and 10.");
  if (!Number.isFinite(+t.duration) || +t.duration < 1 || +t.duration > 7200)
    throw Error("Duration must be between 1 and 7200 seconds.");
  return {
    ...t,
    title: String(t.title).trim(),
    artist: String(t.artist || "Unknown artist"),
    genre: String(t.genre || "Other"),
    bpm: +t.bpm,
    energy: +t.energy,
    duration: +t.duration,
    keyConfidence:
      t.keyConfidence != null &&
      Number.isFinite(+t.keyConfidence) &&
      +t.keyConfidence >= 0 &&
      +t.keyConfidence <= 1
        ? +t.keyConfidence
        : undefined,
  };
}

// Musical key to Camelot. Rekordbox exports either notation depending on
// its "Key display format" setting, e.g. Tonality="8A" or Tonality="Am".
const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 },
  CAMELOT_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1],
  CAMELOT_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
export function normalizeKey(value) {
  const s = String(value ?? "").trim();
  const camelot = /^0?([1-9]|1[0-2])\s*([AB])$/i.exec(s);
  if (camelot) return camelot[1] + camelot[2].toUpperCase();
  const musical = /^([A-G])\s*([#♯b♭]?)\s*(m|min|minor|maj|major)?$/i.exec(s);
  if (!musical) return s.toUpperCase();
  const letter = musical[1].toUpperCase(),
    accidental = musical[2],
    quality = musical[3] || "",
    // Lowercase "m" alone means minor (capital "M" is major shorthand);
    // spelled-out "min" or "minor" is minor in any case.
    minor = quality === "m" || /^(min|minor)$/i.test(quality),
    shift = /[#♯]/.test(accidental) ? 1 : /[b♭]/.test(accidental) ? -1 : 0,
    pitch = (PITCH[letter] + shift + 12) % 12;
  return minor ? `${CAMELOT_MINOR[pitch]}A` : `${CAMELOT_MAJOR[pitch]}B`;
}

function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    const k = e.toLowerCase();
    if (k[0] === "#")
      return String.fromCodePoint(
        k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10),
      );
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[k];
  });
}
function xmlAttributes(source) {
  const attrs = {};
  for (const m of source.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    attrs[m[1]] = decodeXml(m[2] ?? m[3]);
  return attrs;
}
export const REKORDBOX_LIMIT = 5000;
// Parses a Rekordbox library export (File > Export Collection in xml
// format). Only <TRACK> elements inside <COLLECTION> are tracks; the ones
// under <PLAYLISTS> are references by id and are ignored. Tracks that
// Rekordbox never analyzed (no BPM or key) are skipped with a reason
// instead of failing the whole file. Rekordbox has no energy field, so
// energy defaults to 5.
export function parseRekordboxXML(text) {
  const xml = String(text);
  if (!/<DJ_PLAYLISTS[\s>]/.test(xml))
    throw Error("Not a Rekordbox XML export (no DJ_PLAYLISTS element).");
  const collection = /<COLLECTION\b[^>]*>([\s\S]*?)<\/COLLECTION>/.exec(xml);
  if (!collection) throw Error("Rekordbox XML has no COLLECTION of tracks.");
  const elements = [...collection[1].matchAll(/<TRACK\b([^>]*?)\/?>/g)];
  if (!elements.length) throw Error("Rekordbox XML has no tracks.");
  if (elements.length > REKORDBOX_LIMIT)
    throw Error(
      `Import up to ${REKORDBOX_LIMIT.toLocaleString("en-US")} tracks at a time.`,
    );
  const tracks = [],
    skipped = [];
  elements.forEach((m, i) => {
    const a = xmlAttributes(m[1]),
      title = (a.Name || "").trim(),
      label = title || `Track ${a.TrackID || i + 1}`,
      bpm = parseFloat(a.AverageBpm),
      duration = parseInt(a.TotalTime, 10);
    let reason = "";
    if (!title) reason = "no title";
    else if (!(bpm > 0)) reason = "no BPM (not analyzed in Rekordbox)";
    else if (!a.Tonality?.trim()) reason = "no key (not analyzed in Rekordbox)";
    else if (!(duration > 0)) reason = "no duration";
    if (reason) return skipped.push({ title: label, reason });
    try {
      tracks.push(
        validateTrack({
          title,
          artist: (a.Artist || "").trim() || "Unknown artist",
          genre: (a.Genre || "").trim() || "Other",
          bpm: Math.round(bpm * 10) / 10,
          key: normalizeKey(a.Tonality),
          energy: 5,
          duration,
        }),
      );
    } catch (e) {
      skipped.push({ title: label, reason: e.message });
    }
  });
  return { tracks, skipped };
}
