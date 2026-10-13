import {
  BasicPitch,
  noteFramesToTime,
  outputToNotesPoly,
} from "https://esm.sh/@spotify/basic-pitch@1.0.1";

/* ---------- Config ---------- */

// If you copy the model files into a ./model folder next to this page, they are used.
// Otherwise the model loads from jsDelivr (same files, from the npm package).
const LOCAL_MODEL = "./model/model.json";
const CDN_MODEL = "https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/model/model.json";

const SAMPLE_RATE = 22050; // Basic Pitch needs mono audio at 22050 Hz
const PPQ = 480;
const PX_PER_SEC = 90;
const ROW_H = 10;

const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const DEGREES = ["1", "♭2", "2", "♭3", "3", "4", "♭5", "5", "♭6", "6", "♭7", "7"];

const SCALES = {
  auto: { name: "Auto (major or minor)" },
  major: { name: "Major", iv: [0, 2, 4, 5, 7, 9, 11] },
  minor: { name: "Natural minor", iv: [0, 2, 3, 5, 7, 8, 10] },
  harmonic: { name: "Harmonic minor", iv: [0, 2, 3, 5, 7, 8, 11] },
  dorian: { name: "Dorian", iv: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { name: "Phrygian", iv: [0, 1, 3, 5, 7, 8, 10] },
  mixolydian: { name: "Mixolydian", iv: [0, 2, 4, 5, 7, 9, 10] },
  majpent: { name: "Major pentatonic", iv: [0, 2, 4, 7, 9] },
  minpent: { name: "Minor pentatonic", iv: [0, 3, 5, 7, 10] },
  custom: { name: "Custom (pick notes)" },
};

// Krumhansl-Kessler key profiles
const PROFILE_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const PROFILE_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/* ---------- State ---------- */

const $ = (id) => document.getElementById(id);

const state = {
  frames: null,
  onsets: null,
  contours: null,
  raw: [], // notes from the model, in seconds
  notes: [], // processed notes, in beats
  inSet: null,
  bpm: 120,
  fileName: "audio",
  model: null,
};

/* ---------- Helpers ---------- */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const noteName = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

function setStatus(text, progress, isError = false) {
  $("progressWrap").hidden = false;
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("error", isError);
  if (typeof progress === "number") $("bar").value = progress;
}

/* ---------- Audio and model ---------- */

async function decodeMono(file) {
  const data = await file.arrayBuffer();
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const decoded = await ctx.decodeAudioData(data);
    const mono = ctx.createBuffer(1, decoded.length, SAMPLE_RATE);
    const out = mono.getChannelData(0);
    const channels = decoded.numberOfChannels;
    for (let c = 0; c < channels; c++) {
      const ch = decoded.getChannelData(c);
      for (let i = 0; i < ch.length; i++) out[i] += ch[i] / channels;
    }
    return mono;
  } finally {
    ctx.close();
  }
}

async function getModel() {
  if (state.model) return state.model;
  let url = CDN_MODEL;
  try {
    const head = await fetch(LOCAL_MODEL, { method: "HEAD" });
    if (head.ok) url = new URL(LOCAL_MODEL, location.href).href;
  } catch (_) {
    /* no local model, use CDN */
  }
  state.model = new BasicPitch(url);
  return state.model;
}

async function analyze(mono) {
  const bp = await getModel();
  const attempt = async (input) => {
    const frames = [], onsets = [], contours = [];
    await bp.evaluateModel(
      input,
      (f, o, c) => {
        frames.push(...f);
        onsets.push(...o);
        contours.push(...c);
      },
      (p) => setStatus("Detecting notes…", 0.15 + 0.85 * p)
    );
    return { frames, onsets, contours };
  };
  let result;
  try {
    result = await attempt(mono);
  } catch (err) {
    // Some versions expect a raw Float32Array instead of an AudioBuffer.
    result = await attempt(mono.getChannelData(0));
  }
  state.frames = result.frames;
  state.onsets = result.onsets;
  state.contours = result.contours;
}

function extractRaw() {
  const onset = +$("onset").value;
  const frame = +$("frame").value;
  const minLen = +$("minlen").value;
  const events = outputToNotesPoly(state.frames, state.onsets, onset, frame, minLen);
  state.raw = noteFramesToTime(events);
}

/* ---------- Key detection and correction ---------- */

function pcWeights(notes) {
  const h = new Array(12).fill(0);
  for (const n of notes) h[n.midi % 12] += (n.e - n.s) * (0.3 + n.amp);
  return h;
}

function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

function detectKey(hist) {
  let best = { root: 0, mode: "major", score: -2 };
  for (let r = 0; r < 12; r++) {
    const rotated = hist.map((_, i) => hist[(r + i) % 12]);
    for (const [mode, profile] of [["major", PROFILE_MAJOR], ["minor", PROFILE_MINOR]]) {
      const score = pearson(rotated, profile);
      if (score > best.score) best = { root: r, mode, score };
    }
  }
  return best;
}

function bestRootFor(intervals, hist) {
  let best = 0, bestCover = -1;
  for (let r = 0; r < 12; r++) {
    let cover = 0;
    for (const i of intervals) cover += hist[(r + i) % 12];
    if (cover > bestCover) { bestCover = cover; best = r; }
  }
  return best;
}

function customIntervals() {
  const iv = [];
  for (let i = 0; i < 12; i++) if ($("deg" + i).checked) iv.push(i);
  return iv.length ? iv : [0];
}

function chooseScale(hist) {
  const key = $("scale").value;
  const rootChoice = $("root").value;
  let intervals, label, root;

  if (key === "auto") {
    const k = detectKey(hist);
    root = rootChoice === "auto" ? k.root : +rootChoice;
    const mode = rootChoice === "auto" ? k.mode : detectKeyForRoot(hist, root);
    intervals = SCALES[mode].iv;
    label = `${NAMES[root]} ${SCALES[mode].name.toLowerCase()}`;
  } else {
    intervals = key === "custom" ? customIntervals() : SCALES[key].iv;
    root = rootChoice === "auto" ? bestRootFor(intervals, hist) : +rootChoice;
    label = `${NAMES[root]} ${SCALES[key].name.toLowerCase()}`;
  }
  return { intervals, root, label, set: new Set(intervals.map((i) => (root + i) % 12)) };
}

function detectKeyForRoot(hist, root) {
  const rotated = hist.map((_, i) => hist[(root + i) % 12]);
  return pearson(rotated, PROFILE_MAJOR) >= pearson(rotated, PROFILE_MINOR) ? "major" : "minor";
}

function nearestInSet(midi, set) {
  for (let d = 1; d <= 6; d++) {
    if (set.has((((midi - d) % 12) + 12) % 12)) return midi - d;
    if (set.has((((midi + d) % 12) + 12) % 12)) return midi + d;
  }
  return midi;
}

function mergeSamePitch(notes, gapBeats) {
  const byPitch = new Map();
  for (const n of notes) {
    if (!byPitch.has(n.midi)) byPitch.set(n.midi, []);
    byPitch.get(n.midi).push(n);
  }
  const out = [];
  for (const list of byPitch.values()) {
    list.sort((a, b) => a.s - b.s);
    let cur = { ...list[0] };
    for (let i = 1; i < list.length; i++) {
      const n = list[i];
      if (n.s <= cur.e + gapBeats) {
        cur.e = Math.max(cur.e, n.e);
        cur.amp = Math.max(cur.amp, n.amp);
        cur.snapped = cur.snapped || n.snapped;
      } else {
        out.push(cur);
        cur = { ...n };
      }
    }
    out.push(cur);
  }
  return out.sort((a, b) => a.s - b.s || a.midi - b.midi);
}

function processNotes() {
  const bpm = clamp(parseFloat($("bpm").value) || 120, 30, 300);
  const bps = bpm / 60;
  state.bpm = bpm;

  const minAmp = +$("minvel").value;
  const minMs = +$("minms").value;
  const low = +$("low").value;
  const high = +$("high").value;
  const removed = { quiet: 0, short: 0, range: 0, scale: 0 };

  let notes = [];
  for (const r of state.raw) {
    const n = {
      midi: r.pitchMidi,
      amp: r.amplitude,
      s: r.startTimeSeconds * bps,
      e: (r.startTimeSeconds + r.durationSeconds) * bps,
      snapped: false,
    };
    if (n.amp < minAmp) { removed.quiet++; continue; }
    if ((r.durationSeconds * 1000) < minMs) { removed.short++; continue; }
    if (n.midi < low || n.midi > high) { removed.range++; continue; }
    notes.push(n);
  }

  const hist = pcWeights(notes);
  const detected = detectKey(hist);
  const scale = chooseScale(hist);
  state.inSet = scale.set;

  const mode = $("offscale").value;
  if (mode !== "keep") {
    const kept = [];
    for (const n of notes) {
      if (scale.set.has(n.midi % 12)) { kept.push(n); continue; }
      if (mode === "remove") { removed.scale++; continue; }
      n.midi = nearestInSet(n.midi, scale.set);
      n.snapped = true;
      kept.push(n);
    }
    notes = kept;
  }

  const gapBeats = 0.04 * bps;
  notes = mergeSamePitch(notes, gapBeats);

  const denom = +$("grid").value;
  if (denom > 0) {
    const g = 4 / denom;
    for (const n of notes) {
      n.s = Math.round(n.s / g) * g;
      n.e = Math.round(n.e / g) * g;
      if (n.e <= n.s) n.e = n.s + g;
    }
    notes = mergeSamePitch(notes, 0);
  }

  state.notes = notes;

  const snappedCount = notes.filter((n) => n.snapped).length;
  const autoKey = `${NAMES[detected.root]} ${detected.mode}`;
  $("keyLine").textContent = `Key: ${scale.label}`;
  $("statLine").textContent =
    `${notes.length} notes · ${snappedCount} moved into key · removed ${removed.quiet} quiet, ` +
    `${removed.short} short, ${removed.range} out of range` +
    (mode === "remove" ? `, ${removed.scale} off-scale` : "") +
    ` · best guess from audio: ${autoKey}`;
}

/* ---------- Tempo estimate ---------- */

function estimateBpm() {
  const times = [...new Set(state.raw.map((n) => Math.round(n.startTimeSeconds * 40) / 40))].sort((a, b) => a - b);
  const hist = new Float32Array(160);
  for (let i = 0; i < times.length; i++) {
    for (let j = i + 1; j < Math.min(i + 5, times.length); j++) {
      const d = times[j] - times[i];
      if (d < 0.12 || d > 2.5) continue;
      let bpm = 60 / d;
      while (bpm < 70) bpm *= 2;
      while (bpm >= 140) bpm /= 2;
      hist[Math.round(bpm)] += 1;
    }
  }
  let best = 120, bestScore = 0;
  for (let b = 71; b < 140; b++) {
    const score = hist[b - 1] + 2 * hist[b] + hist[b + 1];
    if (score > bestScore) { bestScore = score; best = b; }
  }
  return best;
}

/* ---------- MIDI file ---------- */

function vlq(value) {
  const bytes = [value & 0x7f];
  while ((value >>= 7) > 0) bytes.unshift((value & 0x7f) | 0x80);
  return bytes;
}

function buildMidi(notes, bpm) {
  const events = [];
  for (const n of notes) {
    const vel = clamp(Math.round(30 + n.amp * 97), 1, 127);
    const on = Math.round(n.s * PPQ);
    const off = Math.max(on + 1, Math.round(n.e * PPQ));
    events.push({ t: on, order: 1, bytes: [0x90, n.midi, vel] });
    events.push({ t: off, order: 0, bytes: [0x80, n.midi, 0] });
  }
  events.sort((a, b) => a.t - b.t || a.order - b.order);

  const track = [];
  const mpq = Math.round(60000000 / bpm);
  track.push(0x00, 0xff, 0x51, 0x03, (mpq >> 16) & 255, (mpq >> 8) & 255, mpq & 255);
  track.push(0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);
  let last = 0;
  for (const e of events) {
    track.push(...vlq(e.t - last), ...e.bytes);
    last = e.t;
  }
  track.push(0x00, 0xff, 0x2f, 0x00);

  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 255, PPQ & 255];
  const len = track.length;
  const trackHead = [0x4d, 0x54, 0x72, 0x6b, (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255];
  return new Uint8Array([...header, ...trackHead, ...track]);
}

function downloadMidi() {
  if (!state.notes.length) return;
  const blob = new Blob([buildMidi(state.notes, state.bpm)], { type: "audio/midi" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${state.fileName}-corrected.mid`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- Piano roll ---------- */

function drawRoll() {
  const cv = $("roll");
  const ctx = cv.getContext("2d");
  const notes = state.notes;
  const dpr = window.devicePixelRatio || 1;

  let lo = 48, hi = 84, endBeat = 4;
  if (notes.length) {
    lo = notes.reduce((m, n) => Math.min(m, n.midi), 127) - 2;
    hi = notes.reduce((m, n) => Math.max(m, n.midi), 0) + 2;
    endBeat = notes.reduce((m, n) => Math.max(m, n.e), 0);
  }
  const bps = state.bpm / 60;
  const width = Math.max(600, Math.ceil((endBeat / bps) * PX_PER_SEC) + 40);
  const height = (hi - lo + 1) * ROW_H;

  cv.width = width * dpr;
  cv.height = height * dpr;
  cv.style.width = width + "px";
  cv.style.height = height + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = "#1c2433";
  ctx.fillRect(0, 0, width, height);
  ctx.font = "9px system-ui, sans-serif";
  for (let m = lo; m <= hi; m++) {
    const y = (hi - m) * ROW_H;
    if (state.inSet && state.inSet.has(m % 12)) {
      ctx.fillStyle = "#27324a";
      ctx.fillRect(0, y, width, ROW_H);
    }
    if (m % 12 === 0) {
      ctx.fillStyle = "#55627f";
      ctx.fillRect(0, y + ROW_H - 1, width, 1);
      ctx.fillStyle = "#8d9ab5";
      ctx.fillText(noteName(m), 3, y + ROW_H - 2);
    }
  }
  for (const n of notes) {
    const x = (n.s / bps) * PX_PER_SEC;
    const w = Math.max(2, ((n.e - n.s) / bps) * PX_PER_SEC);
    const y = (hi - n.midi) * ROW_H;
    ctx.fillStyle = n.snapped ? "#e8a33d" : "#6fa0ff";
    ctx.fillRect(x, y + 1, w, ROW_H - 2);
  }
}

/* ---------- MIDI preview playback ---------- */

let playCtx = null;

function stopPlayback() {
  if (playCtx) { playCtx.close(); playCtx = null; }
}

function playPreview() {
  stopPlayback();
  if (!state.notes.length) return;
  $("audio").pause();
  playCtx = new AudioContext();
  const t0 = playCtx.currentTime + 0.1;
  const bps = state.bpm / 60;
  for (const n of state.notes) {
    const start = t0 + n.s / bps;
    const end = t0 + n.e / bps;
    const osc = playCtx.createOscillator();
    const gain = playCtx.createGain();
    osc.type = "triangle";
    osc.frequency.value = 440 * Math.pow(2, (n.midi - 69) / 12);
    const peak = 0.04 + 0.1 * n.amp;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.01);
    gain.gain.setValueAtTime(peak, Math.max(start + 0.01, end - 0.05));
    gain.gain.linearRampToValueAtTime(0, end);
    osc.connect(gain).connect(playCtx.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

/* ---------- Wiring ---------- */

let timer = null;
let needsExtract = false;

function schedule(extract) {
  if (extract) needsExtract = true;
  clearTimeout(timer);
  timer = setTimeout(refresh, 200);
}

function refresh() {
  if (!state.frames) return;
  if (needsExtract) { extractRaw(); needsExtract = false; }
  processNotes();
  drawRoll();
}

function updateReadouts() {
  for (const id of ["onset", "frame", "minlen", "minvel"]) {
    $(id + "V").textContent = $(id).value;
  }
  $("lowN").textContent = noteName(+$("low").value);
  $("highN").textContent = noteName(+$("high").value);
  $("customChips").hidden = $("scale").value !== "custom";
}

function buildControls() {
  const scale = $("scale");
  for (const [key, s] of Object.entries(SCALES)) scale.add(new Option(s.name, key));

  const root = $("root");
  root.add(new Option("Auto", "auto"));
  NAMES.forEach((n, i) => root.add(new Option(n, String(i))));

  const chips = $("customChips");
  const defaults = new Set([0, 2, 4, 7, 9]);
  DEGREES.forEach((d, i) => {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = "deg" + i;
    box.checked = defaults.has(i);
    label.append(box, d);
    chips.appendChild(label);
  });

  document.querySelectorAll("#results input, #results select").forEach((el) => {
    if (el.tagName === "AUDIO") return;
    el.addEventListener("input", () => {
      updateReadouts();
      schedule(el.classList.contains("sens"));
    });
  });
  updateReadouts();

  $("estimate").addEventListener("click", () => {
    if (!state.raw.length) return;
    $("bpm").value = estimateBpm();
    schedule(false);
  });
  $("download").addEventListener("click", downloadMidi);
  $("play").addEventListener("click", playPreview);
  $("stop").addEventListener("click", stopPlayback);
}

async function handleFile(file) {
  if (!file) return;
  stopPlayback();
  state.fileName = file.name.replace(/\.[^.]+$/, "") || "audio";
  $("dropTitle").textContent = file.name;
  $("results").hidden = true;
  try {
    setStatus("Reading audio…", 0.05);
    const mono = await decodeMono(file);
    setStatus("Loading the note model (first run downloads a few MB)…", 0.1);
    await analyze(mono);
    extractRaw();
    needsExtract = false;
    $("bpm").value = estimateBpm();
    if ($("audio").src) URL.revokeObjectURL($("audio").src);
    $("audio").src = URL.createObjectURL(file);
    $("results").hidden = false;
    setStatus("Done. Adjust the settings below, then download the MIDI file.", 1);
    processNotes();
    drawRoll();
  } catch (err) {
    console.error(err);
    setStatus("Could not process this file: " + (err && err.message ? err.message : err), 0, true);
  }
}

buildControls();

const drop = $("drop");
$("file").addEventListener("change", (e) => handleFile(e.target.files[0]));
["dragenter", "dragover"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); })
);
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); })
);
drop.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));
