import test from "node:test";
import assert from "node:assert/strict";
import {
  harmonic,
  transition,
  optimize,
  parseCSV,
  csvCell,
  validateTrack,
  keyIsUncertain,
  LOW_KEY_CONFIDENCE,
  normalizeKey,
  parseRekordboxXML,
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
test("key confidence is validated and low values are flagged", () => {
  const good = track("t", 120, "8A", 5);
  assert.equal(validateTrack(good).keyConfidence, undefined);
  assert.equal(
    validateTrack({ ...good, keyConfidence: 0.83 }).keyConfidence,
    0.83,
  );
  for (const bad of [-0.1, 1.5, "abc", NaN])
    assert.equal(
      validateTrack({ ...good, keyConfidence: bad }).keyConfidence,
      undefined,
    );
  assert.equal(
    keyIsUncertain(good),
    false,
    "no estimate means nothing to flag",
  );
  assert.equal(
    keyIsUncertain({ keyConfidence: LOW_KEY_CONFIDENCE - 0.01 }),
    true,
  );
  assert.equal(keyIsUncertain({ keyConfidence: LOW_KEY_CONFIDENCE }), false);
});
test("musical keys convert to Camelot, including enharmonics", () => {
  const cases = {
    C: "8B",
    Am: "8A",
    G: "9B",
    Em: "9A",
    "F#": "2B",
    Gb: "2B",
    "F#m": "11A",
    Db: "3B",
    "C#": "3B",
    Ebm: "2A",
    "D#m": "2A",
    Bbm: "3A",
    Fm: "4A",
    Cmaj: "8B",
    "A minor": "8A",
    "A Minor": "8A",
    AM: "11B",
    "08a": "8A",
    "12b": "12B",
    "B♭m": "3A",
  };
  for (const [input, want] of Object.entries(cases))
    assert.equal(normalizeKey(input), want, input);
  // All 24 major and minor keys land on 24 distinct Camelot codes.
  const names = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  const all = names.flatMap((n) => [normalizeKey(n), normalizeKey(n + "m")]);
  assert.equal(new Set(all).size, 24);
  assert.ok(all.every((k) => /^(?:[1-9]|1[0-2])[AB]$/.test(k)));
});
const rekordbox = (
  tracks,
  playlists = "",
) => `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0">
  <PRODUCT Name="rekordbox" Version="6.8.5" Company="AlphaTheta"/>
  <COLLECTION Entries="9">
${tracks}
  </COLLECTION>
  <PLAYLISTS><NODE Type="0" Name="ROOT" Count="1">${playlists}</NODE></PLAYLISTS>
</DJ_PLAYLISTS>`;
test("Rekordbox XML maps title, artist, BPM, key and duration", () => {
  const { tracks, skipped } = parseRekordboxXML(
    rekordbox(
      `
    <TRACK TrackID="1" Name="Badtameez Dil" Artist="Benny Dayal &amp; Shefali Alvares" Genre="Bollywood" TotalTime="253" AverageBpm="120.00" Tonality="9A" Location="file://localhost/Music/a.mp3"/>
    <TRACK TrackID="2" Name="Caf&#233; &quot;Edit&quot;" Artist="" Genre="" TotalTime="241" AverageBpm="123.47" Tonality="F#m">
      <TEMPO Inizio="0.025" Bpm="123.47" Metro="4/4" Battito="1"/>
      <POSITION_MARK Name="" Type="0" Start="0.025" Num="-1"/>
    </TRACK>`,
      `<NODE Name="Friday" Type="1" Entries="1"><TRACK Key="1"/></NODE>`,
    ),
  );
  assert.deepEqual(skipped, []);
  assert.equal(tracks.length, 2, "playlist TRACK references are not tracks");
  assert.deepEqual(
    tracks.map(({ title, artist, genre, bpm, key, duration, energy }) => ({
      title,
      artist,
      genre,
      bpm,
      key,
      duration,
      energy,
    })),
    [
      {
        title: "Badtameez Dil",
        artist: "Benny Dayal & Shefali Alvares",
        genre: "Bollywood",
        bpm: 120,
        key: "9A",
        duration: 253,
        energy: 5,
      },
      {
        title: 'Café "Edit"',
        artist: "Unknown artist",
        genre: "Other",
        bpm: 123.5,
        key: "11A",
        duration: 241,
        energy: 5,
      },
    ],
  );
});
test("Rekordbox XML skips unanalyzed or invalid tracks with reasons", () => {
  const { tracks, skipped } = parseRekordboxXML(
    rekordbox(`
    <TRACK TrackID="1" Name="Good" Artist="A" TotalTime="200" AverageBpm="100" Tonality="8A"/>
    <TRACK TrackID="2" Name="No BPM" Artist="A" TotalTime="200" AverageBpm="0.00" Tonality="8A"/>
    <TRACK TrackID="3" Name="No key" Artist="A" TotalTime="200" AverageBpm="100" Tonality=""/>
    <TRACK TrackID="4" Name="" Artist="A" TotalTime="200" AverageBpm="100" Tonality="8A"/>
    <TRACK TrackID="5" Name="Weird key" Artist="A" TotalTime="200" AverageBpm="100" Tonality="Hm"/>
    <TRACK TrackID="6" Name="Too fast" Artist="A" TotalTime="200" AverageBpm="300" Tonality="8A"/>`),
  );
  assert.deepEqual(
    tracks.map((t) => t.title),
    ["Good"],
  );
  assert.deepEqual(
    skipped.map((s) => s.title + ": " + s.reason.split(" (")[0]),
    [
      "No BPM: no BPM",
      "No key: no key",
      "Track 4: no title",
      "Weird key: Use a Camelot key, such as 8A or 11B.",
      "Too fast: BPM must be between 40 and 240.",
    ],
  );
});
test("non-Rekordbox or empty XML is rejected", () => {
  assert.throws(
    () => parseRekordboxXML("<plist><dict/></plist>"),
    /Not a Rekordbox/,
  );
  assert.throws(
    () => parseRekordboxXML("<DJ_PLAYLISTS></DJ_PLAYLISTS>"),
    /no COLLECTION/,
  );
  assert.throws(() => parseRekordboxXML(rekordbox("")), /no tracks/);
});
