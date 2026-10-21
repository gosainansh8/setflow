# SetFlow

A personal DJ set-planning workspace built for Ansh's interest in Bollywood mixing. Import local audio or CSV metadata, build an energy-aware sequence, inspect transitions, and save or export the result.

## Run locally

Requires Python 3 for a local server and Node.js 18+ for tests. There are no npm runtime dependencies or build steps.

```bash
python3 -m http.server 8000 --directory dist
# Open http://localhost:8000
node --test tests/*.test.mjs
```

Serve over localhost or HTTPS for browser audio capabilities. Do not open index.html directly as a file; ES modules require a server.

## Included

- Searchable and sortable track library, genre filters, editable metadata.
- Browser-only audio decoding; DSP in an isolated Web Worker.
- Estimated BPM, Camelot key, energy, and a full-track waveform preview with seeking.
- CSV import with quoted fields and validation; atomic per-file metadata import.
- Beam-search set planner, three energy profiles, and transparent transition scores.
- Drag-and-drop and keyboard-accessible move buttons.
- Saved sets, CSV export in play order, JSON workspace backup and validated restore.
- Device-local persistence. Audio blobs remain in memory for the current session.
- Responsive dark studio interface with no image assets or UI framework.

## Architecture

`dist/app.mjs` owns UI events and browser-local application state. `dist/core.mjs` contains pure, tested planning and CSV functions. `dist/analyzer.js` runs signal processing in a worker; large sample arrays use transferable buffers. `dist/style.css` and `dist/index.html` implement the responsive UI. Google Fonts are optional; local sans-serif fallback remains usable without them.

The deployable application is entirely static. There is no backend, cloud database, streaming integration, or audio upload service. Metadata is not synchronized between devices; use backup/restore to transfer it.

## Sequencing algorithm

For adjacent tracks a and b:

- Tempo proximity: max(0, 1 - abs(a.bpm - b.bpm) / 24).
- Harmonic compatibility: same Camelot key 1.0; relative major/minor .9; adjacent wheel number in the same mode .85; two wheel steps .5; otherwise .15.
- Energy proximity: max(0, 1 - abs(a.energy - b.energy) / 6).
- Transition score: round(100 * (.4 * tempo + .4 * harmonic + .2 * energy)).

The planner expands each partial sequence with every unused candidate and retains the best 36 partial sequences at each position. Each step combines 62% transition score and 38% energy-profile fit. The first position uses energy fit. The result is a heuristic, not a guaranteed global optimum. Candidate pool is capped at the first 100 matching tracks; the UI generates up to 20 tracks. The generator replaces the current unsaved sequence. Save any sequence you want to keep first.

Build profile rises from 4 to 9. Rise & release follows 5 + 4*sin(pi*p). Steady targets 7. Track energies are editable subjective ratings. Measured track durations are summed without estimating overlap time.

## Audio analysis

1. Decode a supported audio file with Web Audio.
2. Convert up to 90 seconds to a mono sample stream at 11,025 Hz.
3. Use positive changes in short-window RMS as an onset envelope; find the strongest autocorrelation lag over 70–180 BPM.
4. Compute Hann-windowed radix-2 FFTs and pool magnitude into pitch-class chroma.
5. Correlate against major/minor key profiles and convert the winning root/mode to Camelot notation.
6. Estimate energy from loudness and tempo; produce full-track waveform peaks.

This is a lightweight baseline, not validated commercial DJ analysis. Half/double-time errors, key ambiguity, unusual intros and mastering differences affect estimates. Verify by ear or import trusted DJ-software metadata. Silence and clips shorter than three seconds are rejected. Audio files are limited to 100 MB; decoding still requires browser memory. Supported formats depend on the browser. The app does not auto-mix, beatmatch playback, time-stretch, detect phrases, or generate transitions.

## Demo content

All demo BPMs, keys, energies and durations are illustrative, not claims about the actual songs or remixes. The demo includes metadata only, no music. The House/Hip-hop titles attributed to SetFlow Demo are fictional. Import audio you have the right to use for playback.

## CSV schema

```csv
title,artist,bpm,key,energy,duration,genre
My Track,Artist,124,8A,7,240,House
```

Duration is seconds; BPM 40–240; Camelot keys 1A–12A or 1B–12B; energy 1–10. CSV import is limited to 1,000 rows per file. Supported curated genre filters: Bollywood, House, Hip-hop, Other. Other genre names remain searchable under All tracks. Backups omit audio binaries.

## Validation

Automated tests cover harmonic-wheel wraparound, score bounds, sequencing uniqueness and target direction, quoted CSV round-trips, invalid metadata, synthetic 120 BPM onset detection, and silence/short-input rejection. Browser QA covers library display, set generation, reordering, save and reopen, persistence, and synthetic WAV import through the browser. These tests do not establish real-world key/BPM accuracy.

## Portfolio discussion points

- Why bounded beam search is preferable to exhaustive permutations here, and how beam width affects quality/latency.
- Why expensive DSP runs in a worker while browser decoding remains on the main thread.
- Why audio binaries are session-only and metadata is persisted, and the tradeoffs against IndexedDB/cloud storage.
- How input validation and HTML escaping protect imported metadata.
- How to evaluate this baseline: compare tempo/key to a manually labeled collection; measure sequence quality against randomized and nearest-neighbor baselines; report actual timing and accuracy rather than invented metrics.

Future work: persistent audio in IndexedDB, a calibrated onset detector, key confidence UI, deduplication by audio hash, cue/phrase detection, and an optional backend with durable job processing.
