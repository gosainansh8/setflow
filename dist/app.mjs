import {
  transition,
  optimize,
  targetEnergy,
  parseCSV,
  csvCell,
  validateTrack,
  keyIsUncertain,
  normalizeKey,
  parseRekordboxXML,
} from "./core.mjs";
import {
  audioStoreAvailable,
  saveAudio,
  loadAllAudio,
  deleteAudio,
  clearAudio,
} from "./audio-store.mjs";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)],
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    ),
  uid = () =>
    crypto.randomUUID
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
// Demo library: real songs I play, ordered roughly warm-up to peak.
// BPM, Camelot key, energy and duration are my estimates for planning,
// not measured from audio, and no audio ships with the app.
const demoVersion = 2;
const seed = [
  ["Gal Mitthi Mitthi", "Tochi Raina", 98, "4A", 5, 236, "Bollywood"],
  ["Lamberghini", "The Doorbeen, Ragini", 96, "6A", 5, 217, "Punjabi"],
  [
    "Brown Munde",
    "AP Dhillon, Gurinder Gill, Shinda Kahlon",
    97,
    "7A",
    5,
    267,
    "Punjabi",
  ],
  ["Proper Patola", "Diljit Dosanjh, Badshah", 104, "9A", 6, 200, "Punjabi"],
  [
    "Kala Chashma",
    "Amar Arshi, Badshah, Neha Kakkar",
    106,
    "8A",
    6,
    187,
    "Bollywood",
  ],
  ["Lungi Dance", "Yo Yo Honey Singh", 105, "9A", 7, 211, "Bollywood"],
  [
    "Aaj Ki Raat",
    "Madhubanti Bagchi, Divya Kumar",
    110,
    "8A",
    5,
    228,
    "Bollywood",
  ],
  [
    "Kar Gayi Chull",
    "Badshah, Fazilpuria, Sukriti Kakar, Neha Kakkar",
    115,
    "10A",
    7,
    188,
    "Bollywood",
  ],
  ["Ghungroo", "Arijit Singh, Shilpa Rao", 118, "7A", 6, 302, "Bollywood"],
  [
    "Badtameez Dil",
    "Benny Dayal, Shefali Alvares",
    120,
    "9A",
    8,
    253,
    "Bollywood",
  ],
  [
    "Balam Pichkari",
    "Vishal Dadlani, Shalmali Kholgade",
    120,
    "8A",
    8,
    289,
    "Bollywood",
  ],
  [
    "Jhoome Jo Pathaan",
    "Arijit Singh, Sukriti Kakar",
    120,
    "11A",
    8,
    208,
    "Bollywood",
  ],
  ["Tauba Tauba", "Karan Aujla", 122, "9A", 7, 207, "Bollywood"],
  [
    "London Thumakda",
    "Labh Janjua, Sonu Kakkar, Neha Kakkar",
    124,
    "10A",
    8,
    230,
    "Bollywood",
  ],
  ["Nashe Si Chadh Gayi", "Arijit Singh", 124, "8B", 7, 237, "Bollywood"],
  [
    "Desi Girl",
    "Shankar Mahadevan, Sunidhi Chauhan, Vishal Dadlani",
    126,
    "9B",
    8,
    306,
    "Bollywood",
  ],
  [
    "Sheila Ki Jawani",
    "Vishal Dadlani, Sunidhi Chauhan",
    128,
    "11A",
    9,
    284,
    "Bollywood",
  ],
  [
    "Dilliwaali Girlfriend",
    "Arijit Singh, Sunidhi Chauhan",
    128,
    "10B",
    9,
    260,
    "Bollywood",
  ],
  [
    "Disco Deewane",
    "Benny Dayal, Sunidhi Chauhan",
    128,
    "10A",
    9,
    342,
    "Bollywood",
  ],
].map((t, i) => ({
  id: `demo${demoVersion}-${i}`,
  title: t[0],
  artist: t[1],
  bpm: t[2],
  key: t[3],
  energy: t[4],
  duration: t[5],
  genre: t[6],
  source: "demo",
}));
const storageKey = "setflow-v1";
let stored;
try {
  stored = JSON.parse(localStorage.getItem(storageKey));
} catch {}
let tracks = seed,
  saved = [],
  setIds = [],
  shape = "build",
  setName = "Friday night";
try {
  if (stored) {
    if (
      !Array.isArray(stored.tracks) ||
      !Array.isArray(stored.saved) ||
      !Array.isArray(stored.setIds)
    )
      throw Error();
    const ids = new Set();
    tracks = stored.tracks.map((t) => {
      const v = validateTrack(t);
      if (!v.id || ids.has(v.id)) throw Error();
      ids.add(v.id);
      return v;
    });
    saved = stored.saved.filter(
      (s) => s && typeof s.name === "string" && Array.isArray(s.trackIds),
    );
    setIds = stored.setIds.filter((id) => ids.has(id));
    shape = ["build", "peak", "steady"].includes(stored.shape)
      ? stored.shape
      : "build";
    setName = String(stored.setName || setName);
    if (stored.demoVersion !== demoVersion) {
      const oldDemo = new Set(
        tracks.filter((t) => t.source === "demo").map((t) => t.id),
      );
      if (oldDemo.size) {
        tracks = [...seed, ...tracks.filter((t) => !oldDemo.has(t.id))];
        setIds = setIds.filter((id) => !oldDemo.has(id));
        saved = saved.map((s) => ({
          ...s,
          trackIds: s.trackIds.filter((id) => !oldDemo.has(id)),
        }));
      }
      // Record the new version so edits to demo tracks survive reloads.
      // Deferred until the module has finished loading, because persist()
      // can show a toast, which uses state declared further down.
      queueMicrotask(persist);
    }
  }
} catch {
  tracks = seed;
  saved = [];
  setIds = [];
}
let filter = "All",
  query = "",
  sort = "",
  dir = 1,
  view = "plan",
  playing = null;
const media = new Map();
let toastTimer;
function toast(msg) {
  $("#toast").textContent = msg;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4200);
}
function persist() {
  try {
    localStorage.setItem(
      storageKey,
      JSON.stringify({ tracks, saved, setIds, shape, setName, demoVersion }),
    );
    return true;
  } catch {
    toast("Device storage is full. Download a backup to keep your changes.");
    return false;
  }
}
function duration(sec) {
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}
function totalTime(sec) {
  return sec >= 3600
    ? `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
    : `${Math.floor(sec / 60)}m`;
}
function bars(e) {
  return `<div class="energy" aria-label="Energy ${e} of 10">${Array.from({ length: 10 }, (_, i) => `<i class="${i < e ? "on" : ""}"></i>`).join("")}<span>${e}</span></div>`;
}
// Key cell: the Camelot key, plus the detection confidence for analyzed
// tracks. Low-confidence keys are marked so they get checked by ear.
function keyCell(t) {
  if (!Number.isFinite(t.keyConfidence)) return esc(t.key);
  const low = keyIsUncertain(t),
    value = t.keyConfidence.toFixed(2);
  return `${esc(t.key)}<span class="conf${low ? " low" : ""}" title="${low ? "Low key confidence, check by ear. " : ""}Chroma correlation with the key profile: ${value}">${value}${low ? " ?" : ""}</span>`;
}
function currentSet() {
  return setIds.map((id) => tracks.find((t) => t.id === id)).filter(Boolean);
}
const genreChoices = ["Bollywood", "Punjabi", "House", "Hip-hop", "Other"];
function genres() {
  return [...new Set(tracks.map((t) => t.genre))].sort();
}
function renderGenreControls() {
  const list = genres();
  if (filter !== "All" && !list.includes(filter)) filter = "All";
  $("#genreFilters").innerHTML = ["All", ...list]
    .map(
      (g) =>
        `<button class="chip" data-filter="${esc(g)}" aria-pressed="${g === filter}">${esc(g)}</button>`,
    )
    .join("");
  const select = $("#buildGenre"),
    current = select.value || "All";
  select.innerHTML = ["All", ...list]
    .map((g) => `<option value="${esc(g)}">${esc(g)}</option>`)
    .join("");
  select.value = list.includes(current) ? current : "All";
}
function renderLibrary() {
  renderGenreControls();
  const ts = tracks.filter(
    (t) =>
      (filter === "All" || t.genre === filter) &&
      `${t.title} ${t.artist}`.toLowerCase().includes(query.toLowerCase()),
  );
  if (sort)
    ts.sort(
      (a, b) =>
        dir * (sort === "bpm" ? a.bpm - b.bpm : a.title.localeCompare(b.title)),
    );
  $("#trackRows").innerHTML = ts
    .map((t, i) => {
      const inSet = setIds.includes(t.id);
      return `<tr><td class="num">${i + 1}</td><td class="title" title="${esc(t.title)}">${esc(t.title)}${t.source === "demo" ? '<span class="tag" title="Demo metadata, no audio">demo</span>' : ""}</td><td class="artist" title="${esc(t.artist)}">${esc(t.artist)}</td><td class="num">${t.bpm}</td><td class="mono">${keyCell(t)}</td><td>${bars(t.energy)}</td><td class="num">${duration(t.duration)}</td><td><div class="rowactions">${media.has(t.id) ? `<button class="iconbtn" data-action="play" data-id="${esc(t.id)}" aria-label="Play ${esc(t.title)}" title="Play">▶</button>` : ""}<button class="iconbtn" data-action="edit" data-id="${esc(t.id)}" aria-label="Edit ${esc(t.title)}" title="Edit">✎</button><button class="iconbtn" data-action="add" data-id="${esc(t.id)}" aria-label="${inSet ? `${esc(t.title)} is in the set` : `Add ${esc(t.title)} to set`}" title="${inSet ? "In set" : "Add to set"}"${inSet ? ' aria-disabled="true"' : ""}>${inSet ? "✓" : "+"}</button></div></td></tr>`;
    })
    .join("");
  $("#emptyLibrary").hidden = !!ts.length;
  $("#showing").textContent = `Showing ${ts.length} of ${tracks.length} tracks`;
  $("#demoNote").hidden = !tracks.some((t) => t.source === "demo");
  $("#libraryCount").textContent = tracks.length;
  $("#savedCount").textContent = saved.length;
  $("#sortTitle").setAttribute(
    "aria-sort",
    sort === "title" ? (dir > 0 ? "ascending" : "descending") : "none",
  );
  $("#sortBpm").setAttribute(
    "aria-sort",
    sort === "bpm" ? (dir > 0 ? "ascending" : "descending") : "none",
  );
}
function renderSet() {
  const list = currentSet();
  $("#setList").innerHTML = list
    .map((t, i) => {
      const prev = list[i - 1],
        score = prev ? transition(prev, t) : null,
        grade = score >= 80 ? "good" : score >= 65 ? "ok" : "poor",
        delta = prev ? t.bpm - prev.bpm : 0;
      return `<li class="setrow" draggable="true" data-index="${i}">${prev ? `<div class="transition ${grade}" title="Transition score out of 100"><span class="score">${score}</span><span>${delta >= 0 ? "+" : ""}${delta} BPM</span><span>${esc(prev.key)} → ${esc(t.key)}</span></div>` : ""}<div class="setrow-main"><span class="pos mono">${i + 1}</span><span class="who"><strong>${esc(t.title)}</strong><span>${esc(t.artist)}</span></span><span class="mono">${t.bpm}</span><span class="mono">${esc(t.key)}${keyIsUncertain(t) ? '<span class="conf low" title="Low key confidence, check by ear">?</span>' : ""}</span><div class="rowactions"><button class="iconbtn" data-move="${i}" data-step="-1" aria-label="Move ${esc(t.title)} up">↑</button><button class="iconbtn" data-move="${i}" data-step="1" aria-label="Move ${esc(t.title)} down">↓</button><button class="iconbtn" data-remove="${i}" aria-label="Remove ${esc(t.title)} from set">×</button></div></div></li>`;
    })
    .join("");
  $("#setEmpty").hidden = !!list.length;
  $("#setTrackCount").textContent = list.length;
  $("#setDuration").textContent = totalTime(
    list.reduce((s, t) => s + t.duration, 0),
  );
  $("#setScore").textContent =
    list.length > 1
      ? Math.round(
          list.slice(1).reduce((s, t, i) => s + transition(list[i], t), 0) /
            (list.length - 1),
        )
      : "-";
  $("#setName").value = setName;
  $("#shape").value = shape;
  drawCurve();
}
function drawCurve() {
  const list = currentSet(),
    x = (i) => 24 + (i * 368) / Math.max(1, list.length - 1),
    y = (e) => 112 - e * 10;
  const path = list
    .map((t, i) => `${i ? "L" : "M"}${x(i)},${y(t.energy)}`)
    .join(" ");
  const target = Array.from(
    { length: 41 },
    (_, i) =>
      `${i ? "L" : "M"}${24 + i * 9.2},${y(targetEnergy(i / 40, shape))}`,
  ).join(" ");
  $("#curve").innerHTML =
    `${[2, 4, 6, 8, 10].map((e) => `<line class="grid" x1="24" y1="${y(e)}" x2="392" y2="${y(e)}"/><text class="axis" x="0" y="${y(e) + 4}">${e}</text>`).join("")}<path class="target" d="${target}"/>${list.length ? `<path class="actual" d="${path}"/>${list.map((t, i) => `<circle cx="${x(i)}" cy="${y(t.energy)}" r="3.5"><title>${i + 1}. ${esc(t.title)}, energy ${t.energy}</title></circle>`).join("")}` : ""}`;
}
const profileNames = {
  build: "Build",
  peak: "Rise & release",
  steady: "Steady",
};
function renderSaved() {
  $("#savedRows").innerHTML = saved
    .map((s) => {
      const ts = s.trackIds
        .map((id) => tracks.find((t) => t.id === id))
        .filter(Boolean);
      return `<tr><td class="title">${esc(s.name)}</td><td class="num">${ts.length}</td><td class="num">${totalTime(ts.reduce((a, t) => a + t.duration, 0))}</td><td>${esc(profileNames[s.shape] || "Custom")}</td><td class="mono">${esc(new Date(s.date).toISOString().slice(0, 10))}</td><td><div class="rowactions"><button class="btn" data-open="${esc(s.id)}">Open</button><button class="btn btn-quiet" data-delete-set="${esc(s.id)}">Delete</button></div></td></tr>`;
    })
    .join("");
  $("#savedEmpty").hidden = !!saved.length;
}
function render() {
  renderAudioStatus();
  renderLibrary();
  renderSet();
  renderSaved();
}
function navigate(v) {
  view = v;
  $("#planView").hidden = v !== "plan";
  $("#savedView").hidden = v !== "saved";
  $$(".tab").forEach((b) =>
    b.dataset.view === v
      ? b.setAttribute("aria-current", "page")
      : b.removeAttribute("aria-current"),
  );
  render();
}
function modal(title, html) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = html;
  $("#modal").showModal();
}
function closeModal() {
  $("#modal").close();
}
function editTrack(id) {
  const t = tracks.find((t) => t.id === id) || {
    title: "",
    artist: "",
    genre: "Bollywood",
    bpm: 120,
    key: "8A",
    energy: 6,
    duration: 240,
  };
  modal(
    id ? "Edit track" : "Add track",
    `<form id="trackForm"><label>Track title<input name="title" value="${esc(t.title)}" required maxlength="160"></label><label>Artist<input name="artist" value="${esc(t.artist)}" maxlength="160"></label><div class="formgrid"><label>BPM<input name="bpm" type="number" min="40" max="240" step=".1" value="${t.bpm}" required></label><label>Camelot key<select name="key">${Array.from({ length: 12 }, (_, i) => ["A", "B"].map((m) => `<option ${t.key === `${i + 1}${m}` ? "selected" : ""}>${i + 1}${m}</option>`).join("")).join("")}</select></label><label>Energy (1 to 10)<input name="energy" type="number" min="1" max="10" value="${t.energy}" required></label><label>Duration (seconds)<input name="duration" type="number" min="1" max="7200" value="${t.duration}" required></label></div><label>Genre<select name="genre">${[...new Set([...genreChoices, t.genre])].map((g) => `<option ${g === t.genre ? "selected" : ""}>${g}</option>`).join("")}</select></label>${Number.isFinite(t.keyConfidence) ? `<p class="${keyIsUncertain(t) ? "warn" : ""}">Detected key confidence: <b class="mono">${t.keyConfidence.toFixed(2)}</b>${keyIsUncertain(t) ? ", low. Check the key by ear." : "."} Changing the key marks it as checked.</p>` : ""}<div class="formerror" id="formError"></div><button class="btn btn-primary full" type="submit">${id ? "Save changes" : "Add track"}</button>${id && media.has(id) ? '<button class="btn btn-quiet full" type="button" id="deleteTrackAudio">Delete stored audio for this track</button>' : ""}${id ? '<button class="btn btn-quiet full" type="button" id="deleteTrack">Remove from library</button>' : ""}<p>${t.source === "demo" ? "Demo metadata only, no audio. Adjust it to match your version of the track." : t.source === "audio" ? "Analyzed from audio. Check BPM, key and energy by ear before you play out." : "Copy the values from your DJ software or enter your own."}</p></form>`,
  );
  $("#trackForm").onsubmit = (e) => {
    e.preventDefault();
    try {
      const input = Object.fromEntries(new FormData(e.currentTarget));
      const next = validateTrack({
        ...t,
        ...input,
        // A key the user changed by hand is their call, not an estimate.
        keyConfidence: input.key === t.key ? t.keyConfidence : undefined,
        id: id || uid(),
        source: t.source || "manual",
      });
      if (id) tracks = tracks.map((x) => (x.id === id ? next : x));
      else tracks.push(next);
      persist();
      render();
      closeModal();
      toast("Track saved.");
    } catch (err) {
      $("#formError").textContent = err.message;
    }
  };
  if (id && media.has(id))
    $("#deleteTrackAudio").onclick = () => {
      forgetAudio(id);
      render();
      closeModal();
      toast("Stored audio deleted. The track's metadata is kept.");
    };
  if (id)
    $("#deleteTrack").onclick = () => {
      modal(
        "Remove this track?",
        `<p>“${esc(t.title)}” will also be removed from your current and saved sets.</p><button id="confirmRemove" class="btn btn-primary full">Remove track</button>`,
      );
      $("#confirmRemove").onclick = () => {
        tracks = tracks.filter((x) => x.id !== id);
        setIds = setIds.filter((x) => x !== id);
        saved = saved.map((s) => ({
          ...s,
          trackIds: s.trackIds.filter((x) => x !== id),
        }));
        forgetAudio(id);
        persist();
        render();
        closeModal();
        toast("Track removed.");
      };
    };
}
function download(name, text, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csv(ts) {
  return [
    "title,artist,bpm,key,energy,duration,genre",
    ...ts.map((t) =>
      [t.title, t.artist, t.bpm, t.key, t.energy, t.duration, t.genre]
        .map(csvCell)
        .join(","),
    ),
  ].join("\r\n");
}
async function importCSV(file) {
  const rows = parseCSV(await file.text());
  if (rows.length < 2)
    throw Error("CSV needs a header and at least one track.");
  const headers = rows.shift().map((x) =>
    x
      .trim()
      .toLowerCase()
      .replace(/^\uFEFF/, ""),
  );
  if (
    !["title", "bpm", "key", "energy", "duration"].every((k) =>
      headers.includes(k),
    )
  )
    throw Error("Use columns: title,artist,bpm,key,energy,duration,genre.");
  if (rows.length > 1000) throw Error("Import up to 1,000 tracks at a time.");
  const batch = rows.map((r, i) => {
    const t = Object.fromEntries(
      headers.map((h, j) => [h, r[j]?.trim() || ""]),
    );
    try {
      return validateTrack({
        ...t,
        key: normalizeKey(t.key),
        id: uid(),
        source: "csv",
      });
    } catch (e) {
      throw Error(`Row ${i + 2}: ${e.message}`);
    }
  });
  tracks.push(...batch);
  persist();
  render();
  return batch.length;
}
async function importRekordbox(file, notes) {
  if (file.size > 50 * 1024 * 1024)
    throw Error("Rekordbox XML must be under 50 MB.");
  const { tracks: found, skipped } = parseRekordboxXML(await file.text());
  // Re-importing the same export should not duplicate the library.
  const have = new Set(
    tracks.map((t) => `${t.title}\u0000${t.artist}`.toLowerCase()),
  );
  const batch = [];
  for (const t of found) {
    const k = `${t.title}\u0000${t.artist}`.toLowerCase();
    if (have.has(k)) {
      skipped.push({ title: t.title, reason: "already in the library" });
      continue;
    }
    have.add(k);
    batch.push({ ...t, id: uid(), source: "rekordbox" });
  }
  tracks.push(...batch);
  persist();
  render();
  for (const s of skipped)
    notes.push(`${file.name}: skipped "${s.title}", ${s.reason}`);
  if (batch.length)
    notes.push(
      `${file.name}: energy is not in Rekordbox exports, so imported tracks start at 5. Adjust them in the library.`,
    );
  return batch.length;
}
async function importAudio(file) {
  if (file.size > 100 * 1024 * 1024)
    throw Error("Audio files must be under 100 MB.");
  const context = new AudioContext();
  let buffer;
  try {
    buffer = await context.decodeAudioData(await file.arrayBuffer());
  } finally {
    await context.close();
  }
  const sampleRate = 11025,
    len = Math.min(Math.floor(buffer.duration * sampleRate), sampleRate * 90),
    samples = new Float32Array(len);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++)
      samples[i] +=
        data[
          Math.min(
            data.length - 1,
            Math.floor((i * buffer.sampleRate) / sampleRate),
          )
        ] / buffer.numberOfChannels;
  }
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker("analyzer.js"),
      timer = setTimeout(() => {
        worker.terminate();
        reject(Error("Audio analysis timed out. Try a shorter file."));
      }, 60000);
    worker.onmessage = ({ data }) => {
      clearTimeout(timer);
      worker.terminate();
      data.error ? reject(Error(data.error)) : resolve(data);
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      reject(Error("Could not analyze this audio."));
    };
    worker.postMessage({ samples, sampleRate }, [samples.buffer]);
  });
  const fullWave = Array.from({ length: 180 }, (_, i) => {
    const data = buffer.getChannelData(0),
      start = Math.floor((i * data.length) / 180),
      end = Math.floor(((i + 1) * data.length) / 180);
    let peak = 0;
    for (let j = start; j < end; j += 8)
      peak = Math.max(peak, Math.abs(data[j]));
    return peak;
  });
  result.wave = fullWave;
  const base = file.name.replace(/\.[^.]+$/, ""),
    parts = base.split(" - "),
    id = uid(),
    t = validateTrack({
      id,
      title: parts.length > 1 ? parts.slice(1).join(" - ") : base,
      artist: parts.length > 1 ? parts[0] : "Unknown artist",
      genre: "Other",
      bpm: result.bpm,
      key: result.key,
      keyConfidence: result.keyConfidence,
      energy: result.energy,
      duration: Math.max(1, Math.round(buffer.duration)),
      source: "audio",
      wave: result.wave,
    });
  tracks.push(t);
  media.set(id, {
    url: URL.createObjectURL(file),
    wave: result.wave,
    size: file.size,
  });
  persist();
  render();
  await storeAudio(id, file, result.wave);
  return 1;
}
// Audio persistence. The media map holds an object URL per track for the
// <audio> element; IndexedDB holds the file itself so the map can be
// rebuilt after a reload.
let storeWarned = false;
async function storeAudio(id, file, wave) {
  if (!audioStoreAvailable) return;
  try {
    await saveAudio(id, file, wave);
    // Ask the browser not to evict our storage under pressure. Browsers may
    // grant this silently, ask, or say no; the app works either way.
    navigator.storage?.persist?.().catch(() => {});
  } catch {
    media.get(id) && (media.get(id).stored = false);
    if (!storeWarned)
      toast("Browser storage is full. This audio will play until you reload.");
    storeWarned = true;
  }
  renderAudioStatus();
}
async function restoreStoredAudio() {
  if (!audioStoreAvailable) return;
  let records;
  try {
    records = await loadAllAudio();
  } catch {
    return;
  }
  const ids = new Set(tracks.map((t) => t.id));
  for (const r of records) {
    if (!ids.has(r.id)) {
      // Track was removed in another tab or by a restore: drop the file.
      deleteAudio(r.id).catch(() => {});
      continue;
    }
    if (!media.has(r.id))
      media.set(r.id, {
        url: URL.createObjectURL(r.blob),
        wave: r.wave || [],
        size: r.size || r.blob.size,
      });
  }
  render();
}
function forgetAudio(id) {
  if (playing === id) stopAudio();
  const m = media.get(id);
  if (m) URL.revokeObjectURL(m.url);
  media.delete(id);
  if (audioStoreAvailable) deleteAudio(id).catch(() => {});
}
function renderAudioStatus() {
  const n = media.size,
    mb = [...media.values()].reduce((a, m) => a + (m.size || 0), 0) / 1e6;
  $("#audioStatus").hidden = !n;
  $("#audioStatusText").textContent =
    `${n} audio file${n === 1 ? "" : "s"} stored (${mb.toFixed(1)} MB).`;
}
let importing = false;
async function importFiles(files) {
  if (importing) return toast("An import is already running.");
  const list = [...files];
  if (!list.length) return;
  importing = true;
  $("#importBtn").disabled = true;
  let added = 0,
    errors = [],
    notes = [];
  for (let i = 0; i < list.length; i++) {
    toast(`Importing ${i + 1}/${list.length}: ${list[i].name}`);
    try {
      const name = list[i].name.toLowerCase();
      added += name.endsWith(".csv")
        ? await importCSV(list[i])
        : name.endsWith(".xml")
          ? await importRekordbox(list[i], notes)
          : await importAudio(list[i]);
    } catch (e) {
      errors.push(`${list[i].name}: ${e.message}`);
    }
  }
  importing = false;
  $("#importBtn").disabled = false;
  $("#fileInput").value = "";
  toast(
    `${added} track${added === 1 ? "" : "s"} imported${errors.length ? `, ${errors.length} failed` : "."}`,
  );
  if (errors.length || notes.length) {
    const shown = [...errors, ...notes],
      more = shown.length - 50;
    modal(
      "Import report",
      `<p>${added} tracks imported.</p><ul>${shown
        .slice(0, 50)
        .map((e) => `<li>${esc(e)}</li>`)
        .join("")}${more > 0 ? `<li>and ${more} more</li>` : ""}</ul>`,
    );
  }
}
function showImport() {
  modal(
    "Import tracks",
    `<button class="dropzone" id="pickFiles">Choose audio, CSV or Rekordbox XML files<small>MP3, WAV, M4A or OGG audio, a CSV of track metadata, or a Rekordbox collection export</small></button><p>Audio is decoded in your browser and never uploaded. BPM, Camelot key and energy are estimated from the first 90 seconds.</p><p>Estimates can be wrong, so check them before you play out. Imported audio is kept in this browser so it still plays after a reload. Delete it any time from the bottom of the page.</p><p>CSV columns: <b>title, artist, bpm, key, energy, duration, genre</b>. Duration is in seconds. Keys can be Camelot (8A) or musical (Am).</p><p>Rekordbox: File, Export Collection in xml format. Title, artist, genre, BPM, key and duration are imported; tracks Rekordbox has not analyzed are skipped.</p>`,
  );
  $("#pickFiles").onclick = () => {
    closeModal();
    $("#fileInput").click();
  };
}
function stopAudio() {
  $("#audio").pause();
  $("#audio").removeAttribute("src");
  $("#player").hidden = true;
  playing = null;
}
function play(id) {
  const t = tracks.find((x) => x.id === id),
    m = media.get(id);
  if (!m) return toast("Reimport the local audio file to play it.");
  playing = id;
  $("#audio").src = m.url;
  $("#playingTitle").textContent = t.title;
  $("#playingArtist").textContent = t.artist;
  $("#player").hidden = false;
  $("#audio")
    .play()
    .then(() => ($("#playToggle").textContent = "Ⅱ"))
    .catch(() => toast("Press play to start audio."));
  drawWave();
}
function drawWave() {
  if (!playing) return;
  const canvas = $("#waveform"),
    ctx = canvas.getContext("2d"),
    wave = media.get(playing)?.wave || [],
    a = $("#audio"),
    progress = a.currentTime / (a.duration || 1);
  ctx.clearRect(0, 0, 600, 40);
  wave.forEach((v, i) => {
    ctx.fillStyle = i / wave.length < progress ? "#cdf994" : "#627951";
    const h = Math.max(2, v * 36);
    ctx.fillRect((i * 600) / wave.length, 20 - h / 2, 2, h);
  });
}
function how() {
  modal(
    "How SetFlow works",
    `<p><b>1. Load tracks.</b> Use the demo metadata, add tracks by hand, or import audio files and CSVs.</p><p><b>2. Generate.</b> Pick a track count, energy profile and genre. A beam search orders tracks by transition score and fit to the profile, using the first 100 tracks that match the genre.</p><p><b>3. Adjust.</b> Reorder by dragging or with the arrow buttons, check each transition score, then save the set or export it as CSV.</p><p><b>Scoring:</b> 40% tempo proximity, 40% Camelot compatibility, and 20% energy proximity. Scores are planning heuristics, not guarantees of a good mix.</p><p>Your metadata and saved sets live in this browser. Use Download backup at the bottom of the page to move them to another device. SetFlow does not auto-mix audio or connect to streaming services.</p>`,
  );
}
$$("[data-view]").forEach((b) => (b.onclick = () => navigate(b.dataset.view)));
$(".brand").onclick = (e) => {
  e.preventDefault();
  navigate("plan");
};
$("#helpBtn").onclick = how;
$("#closeModal").onclick = closeModal;
$("#modal").onclick = (e) => {
  if (e.target === $("#modal")) {
    const r = e.target.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      closeModal();
  }
};
$("#addBtn").onclick = () => editTrack();
$("#importBtn").onclick = showImport;
$("#fileInput").onchange = (e) => importFiles(e.target.files);
$("#genreFilters").onclick = (e) => {
  const b = e.target.closest("[data-filter]");
  if (!b) return;
  filter = b.dataset.filter;
  renderLibrary();
};
$("#searchInput").oninput = (e) => {
  query = e.target.value;
  renderLibrary();
};
["Title", "Bpm"].forEach(
  (k) =>
    ($("#sort" + k).onclick = () => {
      const key = k.toLowerCase();
      dir = sort === key ? -dir : 1;
      sort = key;
      renderLibrary();
    }),
);
document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) &&
    !$("#modal").open
  ) {
    e.preventDefault();
    navigate("plan");
    $("#searchInput").focus();
  }
});
$("#trackRows").onclick = (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const { action, id } = b.dataset;
  if (action === "edit") editTrack(id);
  if (action === "play") play(id);
  if (action === "add") {
    if (setIds.includes(id)) {
      toast("That track is already in the set.");
      return;
    }
    setIds.push(id);
    persist();
    render();
    toast(`Added "${tracks.find((t) => t.id === id).title}" to the set.`);
  }
};
$("#trackCount").oninput = (e) =>
  ($("#countOutput").textContent = e.target.value);
$("#setName").oninput = (e) => {
  setName = e.target.value;
  persist();
};
$("#shape").onchange = (e) => {
  shape = e.target.value;
  persist();
  drawCurve();
};
$("#generateBtn").onclick = () => {
  const pool = tracks.filter(
    (t) =>
      $("#buildGenre").value === "All" || t.genre === $("#buildGenre").value,
  );
  if (!pool.length) return toast("No tracks match that genre.");
  const count = +$("#trackCount").value;
  setIds = optimize(pool, { count, shape }).map((t) => t.id);
  persist();
  renderSet();
  toast(
    `Generated ${setIds.length} tracks${count > pool.length ? `; only ${pool.length} match the genre` : ""}.`,
  );
};
$("#setList").onclick = (e) => {
  const m = e.target.closest("[data-move]"),
    r = e.target.closest("[data-remove]");
  if (m) {
    const i = +m.dataset.move,
      j = i + +m.dataset.step;
    if (j < 0 || j >= setIds.length) return;
    [setIds[i], setIds[j]] = [setIds[j], setIds[i]];
    persist();
    renderSet();
    // Re-rendering replaces the buttons, so put focus back on the same
    // control in the moved row. Keyboard users can keep pressing Enter.
    $(`[data-move="${j}"][data-step="${m.dataset.step}"]`)?.focus();
  } else if (r) {
    const i = +r.dataset.remove;
    setIds.splice(i, 1);
    persist();
    renderSet();
    renderLibrary();
    const next = $(`[data-remove="${Math.min(i, setIds.length - 1)}"]`);
    (next || $("#generateBtn")).focus();
  }
};
let dragged = null;
$("#setList").ondragstart = (e) => {
  const row = e.target.closest("[data-index]");
  if (row) {
    dragged = +row.dataset.index;
    row.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(dragged));
  }
};
$("#setList").ondragover = (e) => {
  e.preventDefault();
  const row = e.target.closest("[data-index]");
  $$(".drop-target").forEach(
    (x) => x !== row && x.classList.remove("drop-target"),
  );
  if (row && +row.dataset.index !== dragged) row.classList.add("drop-target");
};
$("#setList").ondrop = (e) => {
  e.preventDefault();
  const row = e.target.closest("[data-index]");
  if (row && dragged !== null) {
    const [id] = setIds.splice(dragged, 1);
    setIds.splice(+row.dataset.index, 0, id);
    persist();
    renderSet();
  }
  dragged = null;
};
$("#setList").ondragend = () => {
  dragged = null;
  $$(".dragging, .drop-target").forEach((x) =>
    x.classList.remove("dragging", "drop-target"),
  );
};
$("#saveSetBtn").onclick = () => {
  if (!setIds.length) return toast("The set is empty.");
  const name = setName.trim() || "Untitled set";
  saved.unshift({
    id: uid(),
    name,
    trackIds: [...setIds],
    shape,
    date: new Date().toISOString(),
  });
  persist();
  render();
  toast(`Saved "${name}".`);
};
$("#exportBtn").onclick = () => {
  if (!setIds.length) return toast("The set is empty.");
  download(
    (setName.trim() || "setflow").replace(/[^a-z0-9-]/gi, "-") + ".csv",
    csv(currentSet()),
  );
  toast("Set exported in play order.");
};
$("#savedRows").onclick = (e) => {
  const open = e.target.closest("[data-open]"),
    del = e.target.closest("[data-delete-set]");
  if (open) {
    const s = saved.find((x) => x.id === open.dataset.open);
    setIds = s.trackIds.filter((id) => tracks.some((t) => t.id === id));
    setName = s.name;
    shape = s.shape;
    persist();
    navigate("plan");
  }
  if (del) {
    modal(
      "Delete this saved set?",
      '<p>Your tracks will stay in the library.</p><button class="btn btn-primary full" id="confirmDeleteSet">Delete set</button>',
    );
    $("#confirmDeleteSet").onclick = () => {
      saved = saved.filter((s) => s.id !== del.dataset.deleteSet);
      persist();
      render();
      closeModal();
      toast("Saved set deleted.");
    };
  }
};
$("#templateBtn").onclick = () =>
  download(
    "setflow-template.csv",
    csv([
      {
        title: "Your track",
        artist: "Artist",
        bpm: 124,
        key: "8A",
        energy: 7,
        duration: 240,
        genre: "Bollywood",
      },
    ]),
  );
$("#backupBtn").onclick = () => {
  download(
    "setflow-backup.json",
    JSON.stringify(
      { version: 1, tracks, saved, setIds, shape, setName },
      null,
      2,
    ),
    "application/json",
  );
  toast("Backup downloaded. Audio files are not included.");
};
$("#restoreBtn").onclick = () => $("#restoreInput").click();
$("#restoreInput").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    if (f.size > 10 * 1024 * 1024) throw Error("Backup is too large.");
    const d = JSON.parse(await f.text());
    if (
      d.version !== 1 ||
      !Array.isArray(d.tracks) ||
      !Array.isArray(d.saved) ||
      !Array.isArray(d.setIds)
    )
      throw Error("Not a SetFlow backup.");
    d.tracks = d.tracks.map(validateTrack);
    const ids = new Set(d.tracks.map((t) => t.id));
    if (
      ids.size !== d.tracks.length ||
      d.tracks.some((t) => typeof t.id !== "string")
    )
      throw Error("Invalid track IDs.");
    d.saved = d.saved.map((s) => {
      if (
        typeof s.id !== "string" ||
        typeof s.name !== "string" ||
        !Array.isArray(s.trackIds) ||
        !["build", "peak", "steady"].includes(s.shape)
      )
        throw Error("Invalid saved set.");
      return { ...s, trackIds: s.trackIds.filter((id) => ids.has(id)) };
    });
    modal(
      "Restore backup?",
      `<p>This replaces your current library and sets with ${d.tracks.length} tracks and ${d.saved.length} saved sets. Download a backup first if you want to keep the current data.</p><button class="btn btn-primary full" id="confirmRestore">Restore backup</button>`,
    );
    $("#confirmRestore").onclick = () => {
      tracks = d.tracks;
      saved = d.saved;
      setIds = d.setIds.filter((id) => ids.has(id));
      shape = ["build", "peak", "steady"].includes(d.shape) ? d.shape : "build";
      setName = String(d.setName || "Restored set");
      stopAudio();
      media.forEach((m) => URL.revokeObjectURL(m.url));
      media.clear();
      persist();
      render();
      closeModal();
      toast("Backup restored.");
      restoreStoredAudio();
    };
  } catch (err) {
    toast(err.message);
  }
  e.target.value = "";
};
$("#playToggle").onclick = () => {
  const a = $("#audio");
  if (a.paused)
    a.play()
      .then(() => ($("#playToggle").textContent = "Ⅱ"))
      .catch(() => toast("Unable to play this file."));
  else {
    a.pause();
    $("#playToggle").textContent = "▷";
  }
};
$("#closePlayer").onclick = stopAudio;
$("#audio").ontimeupdate = () => {
  $("#playTime").textContent = duration($("#audio").currentTime);
  drawWave();
};
$("#audio").onended = () => ($("#playToggle").textContent = "▷");
$("#waveform").onclick = (e) => {
  const a = $("#audio");
  if (Number.isFinite(a.duration)) {
    const r = e.target.getBoundingClientRect();
    a.currentTime = ((e.clientX - r.left) / r.width) * a.duration;
  }
};
$("#clearAudioBtn").onclick = () => {
  modal(
    "Delete stored audio?",
    `<p>This deletes all ${media.size} audio files saved in this browser. Track metadata and sets are kept, but playback and waveforms need the files imported again.</p><button class="btn btn-primary full" id="confirmClearAudio">Delete stored audio</button>`,
  );
  $("#confirmClearAudio").onclick = async () => {
    stopAudio();
    media.forEach((m) => URL.revokeObjectURL(m.url));
    media.clear();
    try {
      if (audioStoreAvailable) await clearAudio();
      toast("Stored audio deleted.");
    } catch {
      toast("Could not delete stored audio. Try clearing site data.");
    }
    closeModal();
    render();
  };
};
render();
restoreStoredAudio();
