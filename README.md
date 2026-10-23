# SetFlow

I DJ Bollywood sets, and planning the order of tracks by hand meant juggling tempo, key, and energy across dozens of songs. SetFlow is a browser app I built to do that: import local audio or CSV metadata, generate an energy-aware sequence, inspect each transition, and save or export the set.

## Run locally

Requires Python 3 for a local server and Node.js 18+ for tests. There are no npm runtime dependencies or build steps.

```bash
python3 -m http.server 8000 --directory dist
# Open http://localhost:8000
node --test tests/*.test.mjs
```

Serve over localhost or HTTPS for browser audio features. Opening index.html directly as a file won't work, since ES modules require a server.

## Features

- Searchable, sortable track library with genre filters and editable metadata
- In-browser audio decoding, with signal processing in a Web Worker
- Estimated BPM, Camelot key, and energy, plus a full-track waveform preview with seeking
- CSV import with quoted fields and validation
- Beam-search set planner with three energy profiles and visible transition scores
- Drag-and-drop and keyboard-accessible reordering
- Saved sets, CSV export in play order, and JSON workspace backup and restore
- Local persistence for metadata; audio stays in memory for the current session

## Architecture

- `dist/app.mjs`: UI events and local application state
- `dist/core.mjs`: pure, tested planning and CSV functions
- `dist/analyzer.js`: signal processing in a Web Worker, using transferable buffers for large sample arrays
- `dist/index.html`, `dist/style.css`: responsive UI with no framework or image assets

The app is fully static: no backend, database, or upload service.

## Sequencing algorithm

For adjacent tracks a and b:

- Tempo: max(0, 1 - |a.bpm - b.bpm| / 24)
- Harmonic fit: same Camelot key 1.0; relative major/minor 0.9; adjacent wheel number, same mode 0.85; two steps 0.5; otherwise 0.15
- Energy: max(0, 1 - |a.energy - b.energy| / 6)
- Transition score: round(100 * (0.4 * tempo + 0.4 * harmonic + 0.2 * energy))

The planner extends each partial sequence with every unused track and keeps the best 36 at each position (beam width 36). Each step weighs 62% transition score and 38% fit to the chosen energy profile. Exhaustive search over orderings is factorial, so beam search trades a guaranteed optimum for fast, good-enough results. The candidate pool is capped at 100 tracks and sets at 20.

Energy profiles: Build rises from 4 to 9, Rise & release follows 5 + 4 sin(pi * p), and Steady targets 7.

## Audio analysis

1. Decode the file with the Web Audio API.
2. Downmix up to 90 seconds to mono at 11,025 Hz.
3. Build an onset envelope from positive changes in short-window RMS, then pick the strongest autocorrelation lag between 70 and 180 BPM.
4. Compute Hann-windowed radix-2 FFTs and pool magnitudes into pitch-class chroma.
5. Correlate chroma against major and minor key profiles and convert the best match to Camelot notation.
6. Estimate energy from loudness and tempo.

This is a lightweight baseline, not commercial-grade analysis. Half- and double-time errors and key ambiguity happen, so I verify by ear or import metadata from DJ software. Clips under three seconds and silence are rejected; files are limited to 100 MB.

## CSV format

```csv
title,artist,bpm,key,energy,duration,genre
My Track,Artist,124,8A,7,240,House
```

Duration in seconds; BPM 40 to 240; keys 1A to 12B; energy 1 to 10; up to 1,000 rows per file.

## Testing

Tests cover Camelot wheel wraparound, score bounds, sequence uniqueness, CSV round-trips, invalid metadata, onset detection on a synthetic 120 BPM signal, and rejection of silent or short input. They don't measure real-world BPM or key accuracy.

## Demo content

Demo track metadata is illustrative and includes no audio.

## Next steps

- Persist audio in IndexedDB
- Show key-detection confidence
- Benchmark BPM and key accuracy against a hand-labeled collection
- Detect cue points and phrases
