// Local DSP worker: onset autocorrelation + chroma/profile correlation.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len *= 2) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      let wr = 1,
        wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const p = i + j,
          q = p + len / 2,
          tr = wr * re[q] - wi * im[q],
          ti = wr * im[q] + wi * re[q];
        re[q] = re[p] - tr;
        im[q] = im[p] - ti;
        re[p] += tr;
        im[p] += ti;
        const w = wr;
        wr = w * Math.cos(ang) - wi * Math.sin(ang);
        wi = w * Math.sin(ang) + wi * Math.cos(ang);
      }
    }
  }
}
function corr(a, b) {
  const am = a.reduce((s, x) => s + x, 0) / a.length,
    bm = b.reduce((s, x) => s + x, 0) / b.length;
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - am,
      y = b[i] - bm;
    dot += x * y;
    aa += x * x;
    bb += y * y;
  }
  return dot / Math.sqrt(aa * bb || 1);
}
const MIN_BPM = 60,
  MAX_BPM = 180;
// Average product of the onset envelope with itself shifted by one beat.
// Dividing by the number of terms keeps long lags (slow tempos) from being
// penalized just because fewer frames overlap.
function tempoScore(onset, frameRate, bpm) {
  const lag = (frameRate * 60) / bpm;
  let sum = 0,
    n = 0;
  for (let i = Math.ceil(lag); i < onset.length; i++) {
    const at = i - lag,
      j = Math.floor(at),
      f = at - j;
    sum += onset[i] * (onset[j] * (1 - f) + (onset[j + 1] ?? 0) * f);
    n++;
  }
  return n ? sum / n : 0;
}
// Comb score: compare hits 1, 2, 3 and 4 beats apart. A small error in the
// beat period adds up over several beats, so the peak is much sharper than
// with a single lag. Lags longer than half the clip are skipped.
function combScore(onset, frameRate, bpm) {
  const lag = (frameRate * 60) / bpm;
  let sum = 0,
    terms = 0;
  for (let k = 1; k <= 4 && k * lag < onset.length / 2; k++) {
    sum += tempoScore(onset, frameRate, bpm / k);
    terms++;
  }
  return terms ? sum / terms : 0;
}
function bestInRange(onset, frameRate, lo, hi) {
  let best = lo,
    bestScore = -1;
  for (let b = Math.max(MIN_BPM, lo); b <= Math.min(MAX_BPM, hi); b++) {
    const s = combScore(onset, frameRate, b);
    if (s > bestScore) {
      bestScore = s;
      best = b;
    }
  }
  return best;
}
// Octave errors: a beat at B BPM also lines up at twice its period, so B/2
// scores about as well as B, and the raw maximum often lands on half time.
// The reverse is not true: a beat at B/2 has nothing halfway between its
// hits, so B scores near zero at a one-beat lag. So if doubling the tempo
// keeps at least OCTAVE_RATIO of the one-beat score, the faster tempo is the
// real beat. This check uses the single-lag score on purpose: the comb would
// give the double of a slow beat partial credit from its even-numbered lags.
const OCTAVE_RATIO = 0.5;
function estimateTempo(onset, frameRate) {
  let bpm = bestInRange(onset, frameRate, MIN_BPM, MAX_BPM);
  while (bpm * 2 <= MAX_BPM + 2) {
    const double = bestInRange(onset, frameRate, bpm * 2 - 2, bpm * 2 + 2);
    if (
      tempoScore(onset, frameRate, double) <
      OCTAVE_RATIO * tempoScore(onset, frameRate, bpm)
    )
      break;
    bpm = double;
  }
  return bpm;
}
self.onmessage = ({ data: { samples, sampleRate } }) => {
  try {
    // 128-sample hop at 11,025 Hz is about 11.6 ms per frame, fine enough
    // to tell 140 BPM (a beat every 36.9 frames) from 142 (36.4 frames).
    const hop = 128,
      env = [];
    let square = 0;
    for (let i = 0; i < samples.length; i++) square += samples[i] * samples[i];
    if (samples.length < sampleRate * 3)
      throw Error("Use at least 3 seconds of audio.");
    if (Math.sqrt(square / samples.length) < 0.0001)
      throw Error("Audio is too quiet to analyze.");
    for (let i = 0; i < samples.length - hop; i += hop) {
      let e = 0;
      for (let j = 0; j < hop; j++) e += samples[i + j] * samples[i + j];
      env.push(Math.sqrt(e / hop));
    }
    // Positive change in loudness from the previous frame. Use i > 0 rather
    // than `env[i - 1] || v`: that treats a silent previous frame (0) as
    // missing and erases every hit that follows silence.
    const rise = env.map((v, i) => (i > 0 ? Math.max(0, v - env[i - 1]) : 0));
    // Spread each hit over neighboring frames (1-2-1 kernel) so a beat that
    // falls between two frames still lines up with the lag being tested.
    const onset = rise.map(
      (v, i) => ((rise[i - 1] ?? 0) + 2 * v + (rise[i + 1] ?? 0)) / 4,
    );
    const bpm = estimateTempo(onset, sampleRate / hop);
    const chroma = Array(12).fill(0),
      n = 2048,
      frames = Math.min(300, Math.floor(samples.length / n));
    for (let f = 0; f < frames; f++) {
      const start = Math.floor(
          (f * (samples.length - n)) / Math.max(1, frames - 1),
        ),
        re = new Float64Array(n),
        im = new Float64Array(n);
      for (let i = 0; i < n; i++)
        re[i] =
          samples[start + i] *
          (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
      fft(re, im);
      for (let k = 1; k < n / 2; k++) {
        const hz = (k * sampleRate) / n;
        if (hz < 65 || hz > 2100) continue;
        const midi = 69 + 12 * Math.log2(hz / 440),
          nearest = Math.round(midi);
        if (Math.abs(midi - nearest) > 0.3) continue;
        chroma[((nearest % 12) + 12) % 12] += Math.sqrt(
          re[k] * re[k] + im[k] * im[k],
        );
      }
    }
    const major = [
        6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
      ],
      minor = [
        6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
      ];
    const majKeys = [
        "8B",
        "3B",
        "10B",
        "5B",
        "12B",
        "7B",
        "2B",
        "9B",
        "4B",
        "11B",
        "6B",
        "1B",
      ],
      minKeys = [
        "5A",
        "12A",
        "7A",
        "2A",
        "9A",
        "4A",
        "11A",
        "6A",
        "1A",
        "8A",
        "3A",
        "10A",
      ];
    let key = "8A",
      confidence = -1;
    for (let root = 0; root < 12; root++)
      for (let mode = 0; mode < 2; mode++) {
        const profile = mode ? minor : major,
          shift = Array.from(
            { length: 12 },
            (_, i) => profile[(i - root + 12) % 12],
          ),
          score = corr(chroma, shift);
        if (score > confidence) {
          confidence = score;
          key = (mode ? minKeys : majKeys)[root];
        }
      }
    const rms = Math.sqrt(square / Math.max(1, samples.length));
    const energy = Math.round(
      Math.max(
        1,
        Math.min(
          10,
          4 + (20 * Math.log10(rms + 1e-6) + 20) * 0.2 + (bpm - 100) / 35,
        ),
      ),
    );
    const wave = Array.from({ length: 180 }, (_, i) => {
      const s = Math.floor((i * samples.length) / 180),
        end = Math.floor(((i + 1) * samples.length) / 180);
      let max = 0;
      for (let j = s; j < end; j += 8)
        max = Math.max(max, Math.abs(samples[j]));
      return max;
    });
    self.postMessage({
      bpm,
      key,
      energy,
      wave,
      // Pearson correlation between the track's chroma and the best key
      // profile. Clear major or minor material scores about 0.8 or more;
      // noise and atonal clusters score about 0.33.
      keyConfidence: Math.round(Math.max(0, confidence) * 100) / 100,
    });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
