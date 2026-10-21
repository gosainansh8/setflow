import {
  transition,
  optimize,
  targetEnergy,
  parseCSV,
  csvCell,
  validateTrack,
} from "./core.mjs";
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
const seed = [
  [
    "Kala Chashma",
    "Amar Arshi, Badshah, Neha Kakkar",
    106,
    "8A",
    6,
    187,
    "Bollywood",
    "#a86d42",
  ],
  [
    "Badtameez Dil",
    "Benny Dayal, Shefali Alvares",
    120,
    "9A",
    8,
    253,
    "Bollywood",
    "#9a4252",
  ],
  [
    "Desi Girl",
    "Shankar Mahadevan, Sunidhi Chauhan",
    126,
    "9B",
    8,
    306,
    "Bollywood",
    "#af8249",
  ],
  [
    "Dilliwaali Girlfriend",
    "Arijit Singh, Sunidhi Chauhan",
    128,
    "10B",
    9,
    260,
    "Bollywood",
    "#6c759f",
  ],
  [
    "Balam Pichkari",
    "Vishal Dadlani, Shalmali Kholgade",
    120,
    "8A",
    8,
    289,
    "Bollywood",
    "#8b5680",
  ],
  [
    "Ghungroo",
    "Arijit Singh, Shilpa Rao",
    118,
    "7A",
    6,
    302,
    "Bollywood",
    "#557b92",
  ],
  [
    "Aaj Ki Raat",
    "Madhubanti Bagchi, Divya Kumar",
    110,
    "8A",
    5,
    228,
    "Bollywood",
    "#537b54",
  ],
  ["Tauba Tauba", "Karan Aujla", 122, "9A", 7, 207, "Bollywood", "#a17a4c"],
  [
    "Disco Deewane",
    "Benny Dayal, Sunidhi Chauhan",
    128,
    "10A",
    9,
    342,
    "Bollywood",
    "#8d666d",
  ],
  [
    "Nashe Si Chadh Gayi",
    "Arijit Singh",
    124,
    "8B",
    7,
    237,
    "Bollywood",
    "#4e7d79",
  ],
  ["Midnight Motion", "SetFlow Demo", 124, "8A", 6, 270, "House", "#4f6d8b"],
  ["Afterhours", "SetFlow Demo", 126, "9A", 7, 290, "House", "#795a9c"],
  ["Neon District", "SetFlow Demo", 128, "10A", 8, 310, "House", "#a28b52"],
  ["One More Sunrise", "SetFlow Demo", 130, "10B", 9, 240, "House", "#b46856"],
  ["Low End Theory", "SetFlow Demo", 92, "7A", 4, 195, "Hip-hop", "#66816f"],
  ["Night Shift", "SetFlow Demo", 100, "8A", 5, 210, "Hip-hop", "#86654f"],
].map((t, i) => ({
  id: "demo-" + i,
  title: t[0],
  artist: t[1],
  bpm: t[2],
  key: t[3],
  energy: t[4],
  duration: t[5],
  genre: t[6],
  color: t[7],
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
  setName = "Friday night · Vol. 01";
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
  view = "library",
  playing = null;
const media = new Map();
let toastTimer;
const colors = ["#a86d42", "#6c759f", "#537b54", "#795a9c", "#4e7d79"];
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
      JSON.stringify({ tracks, saved, setIds, shape, setName }),
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
function cover(t) {
  const color = /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : "#537b54";
  return `<div class="cover" style="--c:${color}">${esc(t.title[0])}</div>`;
}
function bars(e) {
  return `<div class="energy" aria-label="Energy ${e} of 10">${Array.from({ length: 10 }, (_, i) => `<i class="${i < e ? "on" : ""}"></i>`).join("")}<span>${e}</span></div>`;
}
function keyBadge(t) {
  return `<span class="keybadge ${t.key.endsWith("B") ? "b" : ""}">${esc(t.key)}</span>`;
}
function currentSet() {
  return setIds.map((id) => tracks.find((t) => t.id === id)).filter(Boolean);
}
function renderLibrary() {
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
    .map(
      (t, i) =>
        `<tr><td>${String(i + 1).padStart(2, "0")}</td><td><div class="trackcell">${cover(t)}<div><span class="tracktitle">${esc(t.title)}</span><span class="trackartist">${esc(t.artist)}</span></div></div></td><td>${t.bpm}</td><td>${keyBadge(t)}</td><td>${bars(t.energy)}</td><td>${duration(t.duration)}</td><td><div class="rowactions">${media.has(t.id) ? `<button class="iconbtn" data-action="play" data-id="${esc(t.id)}" aria-label="Play ${esc(t.title)}">▷</button>` : ""}<button class="iconbtn" data-action="edit" data-id="${esc(t.id)}" aria-label="Edit ${esc(t.title)}">⋯</button><button class="iconbtn" data-action="add" data-id="${esc(t.id)}" aria-label="Add ${esc(t.title)} to set">${setIds.includes(t.id) ? "✓" : "＋"}</button></div></td></tr>`,
    )
    .join("");
  $("#emptyLibrary").hidden = !!ts.length;
  $("#showing").textContent = `Showing ${ts.length} of ${tracks.length} tracks`;
  $("#statTracks").textContent = String(tracks.length).padStart(2, "0");
  $("#crateCount").textContent = tracks.length;
  $("#navCount").textContent = tracks.length;
  $("#savedCount").textContent = saved.length;
  $("#statTime").textContent = totalTime(
    tracks.reduce((s, t) => s + t.duration, 0),
  );
  $("#statBpm").textContent = tracks.length
    ? `${Math.min(...tracks.map((t) => t.bpm))}–${Math.max(...tracks.map((t) => t.bpm))}`
    : "—";
  $("#statGenres").textContent =
    `${new Set(tracks.map((t) => t.genre)).size} genres · Endless possibilities`;
  $("#statCollection").textContent = filter === "All" ? "Open format" : filter;
  $("#statSource").textContent = tracks.some((t) => t.source === "demo")
    ? "Includes demo metadata"
    : "Your personal collection";
}
function renderSet() {
  const list = currentSet();
  $("#setList").innerHTML = list
    .map((t, i) => {
      const prev = list[i - 1],
        score = prev ? transition(prev, t) : null;
      return `${prev ? `<div class="transition ${score < 65 ? "warn" : ""}"><span>${score >= 80 ? "↗ Smooth blend" : score >= 65 ? "→ Room to mix" : "↳ Creative transition"} · ${score}/100 &nbsp; / &nbsp; ${t.bpm - prev.bpm >= 0 ? "+" : ""}${t.bpm - prev.bpm} BPM · ${esc(prev.key)} → ${esc(t.key)}</span></div>` : ""}<div class="setrow" draggable="true" data-index="${i}"><span class="setnum">${String(i + 1).padStart(2, "0")}</span>${cover(t)}<div class="trackinfo"><span class="tracktitle">${esc(t.title)}</span><span class="trackartist">${esc(t.artist)} · ${t.bpm} BPM · E${t.energy}</span></div>${keyBadge(t)}<div class="rowactions"><button class="iconbtn" data-move="${i}" data-step="-1" aria-label="Move ${esc(t.title)} up">↑</button><button class="iconbtn" data-move="${i}" data-step="1" aria-label="Move ${esc(t.title)} down">↓</button><button class="iconbtn" data-remove="${i}" aria-label="Remove ${esc(t.title)} from set">×</button></div></div>`;
    })
    .join("");
  $("#setEmpty").hidden = !!list.length;
  $("#setTrackCount").textContent = `${list.length} TRACKS`;
  $("#setDuration").textContent = list.length
    ? totalTime(list.reduce((s, t) => s + t.duration, 0))
    : "—";
  $("#setScore").textContent =
    list.length > 1
      ? Math.round(
          list.slice(1).reduce((s, t, i) => s + transition(list[i], t), 0) /
            (list.length - 1),
        ) + " / 100"
      : "—";
  $("#setName").value = setName;
  $("#shape").value = shape;
  drawCurve();
}
function drawCurve() {
  const list = currentSet(),
    x = (i) => 20 + (i * 760) / Math.max(1, list.length - 1),
    y = (e) => 150 - e * 13;
  const path = list
    .map((t, i) => `${i ? "L" : "M"}${x(i)},${y(t.energy)}`)
    .join(" ");
  const target = Array.from(
    { length: 41 },
    (_, i) =>
      `${i ? "L" : "M"}${20 + i * 19},${y(targetEnergy(i / 40, shape))}`,
  ).join(" ");
  $("#curve").innerHTML =
    `${[2, 4, 6, 8, 10].map((e) => `<line x1="15" y1="${y(e)}" x2="790" y2="${y(e)}" stroke="#34412e" stroke-width=".7"/><text x="0" y="${y(e) + 3}" fill="#718669" font-size="9">${e}</text>`).join("")}<path d="${target}" fill="none" stroke="#607a50" stroke-dasharray="5 7" stroke-width="2"/>${list.length ? `<defs><linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cdf994" stop-opacity=".22"/><stop offset="1" stop-color="#cdf994" stop-opacity="0"/></linearGradient></defs><path d="${path} L${x(list.length - 1)},150 L20,150 Z" fill="url(#curveFill)"/><path d="${path}" fill="none" stroke="#cdf994" stroke-width="2.5"/>${list.map((t, i) => `<circle cx="${x(i)}" cy="${y(t.energy)}" r="4" fill="#cdf994"><title>${esc(t.title)} · Energy ${t.energy}</title></circle>`).join("")}` : ""}`;
}
function renderSaved() {
  $("#savedGrid").innerHTML = saved.length
    ? saved
        .map((s) => {
          const ts = s.trackIds
            .map((id) => tracks.find((t) => t.id === id))
            .filter(Boolean);
          return `<article class="savedcard"><div class="savedart">${ts.map((t) => `<i style="height:${t.energy * 9}px"></i>`).join("")}</div><div class="eyebrow">${ts.length} TRACKS · ${totalTime(ts.reduce((a, t) => a + t.duration, 0))}</div><h3>${esc(s.name)}</h3><p>${new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} · ${esc({ build: "Gradual build", peak: "Rise & release", steady: "Keep it rolling" }[s.shape] || "Custom flow")}</p><button class="btn" data-open="${esc(s.id)}">Open set ↗</button><button class="textbtn" data-delete-set="${esc(s.id)}">Delete</button></article>`;
        })
        .join("")
    : '<div class="empty">Your saved sets will live here.<br>Build a sequence, then hit Save set.</div>';
}
function render() {
  renderLibrary();
  renderSet();
  renderSaved();
}
function navigate(v) {
  view = v;
  ["library", "builder", "saved"].forEach(
    (k) => ($("#" + k + "View").hidden = k !== v),
  );
  $$(".nav").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  $("#crumb").textContent = {
    library: "Track library",
    builder: "Set builder",
    saved: "Saved sets",
  }[v];
  $("#pageTitle").innerHTML = {
    library: "Find your flow<span>.</span>",
    builder: "Build the moment<span>.</span>",
    saved: "Keep the good ones<span>.</span>",
  }[v];
  $("#pageSubtitle").textContent = {
    library: "Your tracks, in harmony. Build a set that moves the room.",
    builder: "Every transition tells a story. Make yours worth following.",
    saved: "Your favorite sequences, ready for the next room.",
  }[v];
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
    id ? "Track details" : "Add to your crate",
    `<form id="trackForm"><label>Track title<input name="title" value="${esc(t.title)}" required maxlength="160"></label><label>Artist<input name="artist" value="${esc(t.artist)}" maxlength="160"></label><div class="formgrid"><label>BPM<input name="bpm" type="number" min="40" max="240" step=".1" value="${t.bpm}" required></label><label>Camelot key<select name="key">${Array.from({ length: 12 }, (_, i) => ["A", "B"].map((m) => `<option ${t.key === `${i + 1}${m}` ? "selected" : ""}>${i + 1}${m}</option>`).join("")).join("")}</select></label><label>Energy (1–10)<input name="energy" type="number" min="1" max="10" value="${t.energy}" required></label><label>Duration (seconds)<input name="duration" type="number" min="1" max="7200" value="${t.duration}" required></label></div><label>Genre<select name="genre">${["Bollywood", "House", "Hip-hop", "Other"].map((g) => `<option ${g === t.genre ? "selected" : ""}>${g}</option>`).join("")}</select></label><div class="formerror" id="formError"></div><button class="btn primary full" type="submit">${id ? "Save changes" : "Add track"}</button>${id ? '<button class="textbtn full" type="button" id="deleteTrack">Remove from library</button>' : ""}<p>${t.source === "demo" ? "Demo metadata is illustrative. Adjust it to your version of the track." : t.source === "audio" ? "Audio analysis gives estimates. Verify BPM, key and energy by ear." : "Use your DJ software’s metadata or enter your own."}</p></form>`,
  );
  $("#trackForm").onsubmit = (e) => {
    e.preventDefault();
    try {
      const input = Object.fromEntries(new FormData(e.currentTarget));
      const next = validateTrack({
        ...t,
        ...input,
        id: id || uid(),
        color: t.color || colors[tracks.length % colors.length],
        source: t.source || "manual",
      });
      if (id) tracks = tracks.map((x) => (x.id === id ? next : x));
      else tracks.push(next);
      persist();
      render();
      closeModal();
      toast("Track saved to your crate.");
    } catch (err) {
      $("#formError").textContent = err.message;
    }
  };
  if (id)
    $("#deleteTrack").onclick = () => {
      modal(
        "Remove this track?",
        `<p>“${esc(t.title)}” will also be removed from your current and saved sets.</p><button id="confirmRemove" class="btn primary full">Remove track</button>`,
      );
      $("#confirmRemove").onclick = () => {
        tracks = tracks.filter((x) => x.id !== id);
        setIds = setIds.filter((x) => x !== id);
        saved = saved.map((s) => ({
          ...s,
          trackIds: s.trackIds.filter((x) => x !== id),
        }));
        if (playing === id) stopAudio();
        if (media.has(id)) {
          URL.revokeObjectURL(media.get(id).url);
          media.delete(id);
        }
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
        key: t.key.toUpperCase(),
        id: uid(),
        source: "csv",
        color: colors[i % colors.length],
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
      energy: result.energy,
      duration: Math.max(1, Math.round(buffer.duration)),
      source: "audio",
      color: colors[tracks.length % colors.length],
      wave: result.wave,
    });
  tracks.push(t);
  media.set(id, { url: URL.createObjectURL(file), wave: result.wave });
  persist();
  render();
  return 1;
}
let importing = false;
async function importFiles(files) {
  if (importing) return toast("An import is already running.");
  const list = [...files];
  if (!list.length) return;
  importing = true;
  $("#importBtn").disabled = true;
  let added = 0,
    errors = [];
  for (let i = 0; i < list.length; i++) {
    toast(`Importing ${i + 1}/${list.length}: ${list[i].name}`);
    try {
      added += list[i].name.toLowerCase().endsWith(".csv")
        ? await importCSV(list[i])
        : await importAudio(list[i]);
    } catch (e) {
      errors.push(`${list[i].name}: ${e.message}`);
    }
  }
  importing = false;
  $("#importBtn").disabled = false;
  $("#fileInput").value = "";
  toast(
    `${added} track${added === 1 ? "" : "s"} imported${errors.length ? ` · ${errors.length} could not be imported` : ". Ready to find your flow."}`,
  );
  if (errors.length)
    modal(
      "Import report",
      `<p>${added} tracks imported.</p><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>`,
    );
}
function showImport() {
  modal(
    "Bring your sound.",
    `<button class="dropzone" id="pickFiles">↥ &nbsp; Choose audio or CSV files<small>MP3, WAV, M4A, OGG · CSV metadata</small></button><p>Audio stays in your browser. SetFlow estimates BPM, Camelot key, and energy from the first 90 seconds, and generates a waveform.</p><p>Estimates can be wrong, especially half/double tempo. Verify and edit the results before performing. Audio playback is available for files imported in this session; metadata is saved on this device.</p><p>Already analyzed your library? Import CSV columns <b>title, artist, bpm, key, energy, duration, genre</b>. Duration is in seconds.</p>`,
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
    "Designed for your next set.",
    `<p><b>1. Fill your crate.</b> Explore illustrative demo tracks, enter metadata, or import your own audio and CSV files.</p><p><b>2. Shape the journey.</b> Choose a track count and energy profile. A beam-search planner explores sequences, balancing transitions and energy fit. It considers the first 100 tracks in your selected crate.</p><p><b>3. Make it yours.</b> Reorder tracks by dragging or using the arrows. Review each transition, save a set, and export a CSV.</p><p><b>Scoring:</b> 40% tempo proximity, 40% Camelot compatibility, and 20% energy proximity. Scores are planning heuristics, not guarantees of a good mix.</p><p>Your metadata and saved sets live in this browser. Download a backup from the sidebar to move devices. SetFlow does not auto-mix audio or connect to streaming services.</p>`,
  );
}
$$("[data-view]").forEach((b) => (b.onclick = () => navigate(b.dataset.view)));
$(".brand").onclick = (e) => {
  e.preventDefault();
  navigate("library");
};
$("#heroBuild").onclick = () => navigate("builder");
$("#howBtn").onclick = how;
$("#aboutBtn").onclick = how;
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
$$("[data-filter]").forEach(
  (b) =>
    (b.onclick = () => {
      filter = b.dataset.filter;
      $$("[data-filter]").forEach((x) => x.classList.toggle("active", x === b));
      renderLibrary();
    }),
);
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
    navigate("library");
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
      toast("That track is already in your set.");
      return;
    }
    setIds.push(id);
    persist();
    render();
    toast("Added to your set. Open Set builder to arrange it.");
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
  if (!pool.length) return toast("Add some tracks to this crate first.");
  const count = +$("#trackCount").value;
  setIds = optimize(pool, { count, shape }).map((t) => t.id);
  persist();
  renderSet();
  toast(
    `Built your ${setIds.length}-track journey${count > pool.length ? " using every track in this crate" : ""}.`,
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
  } else if (r) setIds.splice(+r.dataset.remove, 1);
  else return;
  persist();
  renderSet();
  renderLibrary();
};
let dragged = null;
$("#setList").ondragstart = (e) => {
  const row = e.target.closest("[data-index]");
  if (row) {
    dragged = +row.dataset.index;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(dragged));
  }
};
$("#setList").ondragover = (e) => e.preventDefault();
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
$("#setList").ondragend = () => (dragged = null);
$("#saveSetBtn").onclick = () => {
  if (!setIds.length) return toast("Add tracks before saving your set.");
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
  toast("Set saved. Find it in Saved sets.");
};
$("#exportBtn").onclick = () => {
  if (!setIds.length) return toast("Add tracks before exporting.");
  download(
    (setName.trim() || "setflow").replace(/[^a-z0-9-]/gi, "-") + ".csv",
    csv(currentSet()),
  );
  toast("Set exported in play order.");
};
$("#savedGrid").onclick = (e) => {
  const open = e.target.closest("[data-open]"),
    del = e.target.closest("[data-delete-set]");
  if (open) {
    const s = saved.find((x) => x.id === open.dataset.open);
    setIds = s.trackIds.filter((id) => tracks.some((t) => t.id === id));
    setName = s.name;
    shape = s.shape;
    persist();
    navigate("builder");
  }
  if (del) {
    modal(
      "Delete this saved set?",
      '<p>Your tracks will stay in the library.</p><button class="btn primary full" id="confirmDeleteSet">Delete set</button>',
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
        genre: "House",
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
  toast("Workspace backup downloaded. Audio files are not included.");
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
      "Restore workspace?",
      `<p>This replaces your current library and sets with ${d.tracks.length} tracks and ${d.saved.length} saved sets. Download a backup first if you want to keep your current workspace.</p><button class="btn primary full" id="confirmRestore">Restore backup</button>`,
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
      toast("Workspace restored.");
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
render();
