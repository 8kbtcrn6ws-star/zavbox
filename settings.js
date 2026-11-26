// Zavbox settings, PIN hash, themes and launch params. All of this stays on the TV (localStorage).
export const SETTINGS_KEY = "zavbox.settings.v1";
export const PIN_HASH_KEY = "zavbox.pin.hash";
export const PIN_PROMPTED_KEY = "zavbox.pin.prompted";
export const PIN_SEEDED_KEY = "zavbox.pin.seeded";
const PIN_PEPPER = "zavbox.pin.v1:";
// Factory lock: peppered SHA-256 only. Digits are not stored in this repo.
const DEFAULT_PIN_HASH = "43418f02eb830ad46cb1fb9d5dd1eddc621b8ed76fda8a48f476b3562a03f241";

export const THEMES = {
  neon: { id: "neon", label: "Neon Blue" },
  crimson: { id: "crimson", label: "Crimson" },
  emerald: { id: "emerald", label: "Emerald" },
  sunset: { id: "sunset", label: "Sunset" },
  mono: { id: "mono", label: "Mono" }
};

export const GRAPHICS = {
  basic: { id: "basic", label: "Basic", quality: "low" },
  high: { id: "high", label: "High", quality: "high" }
};

export const DEFAULTS = {
  theme: "neon",
  graphics: "high",
  haptics: true,
  uiSounds: true,
  uiVolume: 0.6,
  reducedMotion: false,
  overscan: 0,
  showFps: false
};

const THEME_IDS = Object.keys(THEMES);
const GRAPHIC_IDS = Object.keys(GRAPHICS);

/** @type {typeof DEFAULTS} */
let current = { ...DEFAULTS };

export function getSettings() {
  return { ...current };
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeGraphics(value) {
  if (value === "basic" || value === "performance" || value === "low") return "basic";
  if (value === "high" || value === "quality" || value === "balanced" || value === "medium") return "high";
  return DEFAULTS.graphics;
}

export function normalizeSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    theme: THEMES[s.theme] ? s.theme : DEFAULTS.theme,
    graphics: normalizeGraphics(s.graphics),
    haptics: s.haptics !== false,
    uiSounds: s.uiSounds !== false,
    uiVolume: Number.isFinite(Number(s.uiVolume)) ? clamp(Number(s.uiVolume), 0, 1) : DEFAULTS.uiVolume,
    reducedMotion: s.reducedMotion === true,
    overscan: Math.round(clamp(Number(s.overscan) || 0, 0, 8)),
    showFps: s.showFps === true
  };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    current = normalizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    current = { ...DEFAULTS };
  }
  return getSettings();
}

export function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
}

export function setSetting(key, value) {
  const next = normalizeSettings({ ...current, [key]: value });
  current = next;
  saveSettings();
  applySettings();
  return getSettings();
}

export function resetSettings() {
  current = { ...DEFAULTS };
  saveSettings();
  applySettings();
  return getSettings();
}

export function cycleValue(ids, currentId, dir) {
  const i = Math.max(0, ids.indexOf(currentId));
  const next = (i + (dir === "left" ? -1 : 1) + ids.length) % ids.length;
  return ids[next];
}

export const THEME_IDS_LIST = THEME_IDS;
export const GRAPHIC_IDS_LIST = GRAPHIC_IDS;

export function applySettings() {
  const s = current;
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.motion = s.reducedMotion ? "reduce" : "full";
  root.style.setProperty("--safe", s.overscan ? s.overscan + "vw" : "0px");
  const fps = document.getElementById("fps-meter");
  if (fps) fps.hidden = !s.showFps;
  if (s.showFps) startFpsMeter();
}

let fpsRaf = 0;
let fpsFrames = 0;
let fpsT = 0;
function startFpsMeter() {
  const el = document.getElementById("fps-meter");
  if (!el || fpsRaf) return;
  const tick = (t) => {
    if (!current.showFps) {
      fpsRaf = 0;
      fpsFrames = 0;
      fpsT = 0;
      return;
    }
    if (!fpsT) fpsT = t;
    fpsFrames++;
    if (t - fpsT >= 500) {
      el.textContent = String(Math.round((fpsFrames * 1000) / (t - fpsT)));
      fpsFrames = 0;
      fpsT = t;
    }
    fpsRaf = requestAnimationFrame(tick);
  };
  fpsRaf = requestAnimationFrame(tick);
}

export function withGraphicsParams(url) {
  const g = GRAPHICS[current.graphics] || GRAPHICS.high;
  const u = new URL(url, window.location.href);
  u.searchParams.set("quality", g.quality);
  u.searchParams.set("q", g.quality);
  return u.href;
}

export async function hashPin(pin) {
  const data = new TextEncoder().encode(PIN_PEPPER + String(pin));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function getPinHash() {
  try {
    return localStorage.getItem(PIN_HASH_KEY) || "";
  } catch {
    return "";
  }
}

export function hasPin() {
  return getPinHash().length === 64;
}

export function setPinHash(hash) {
  if (!hash || hash.length !== 64) return;
  localStorage.setItem(PIN_HASH_KEY, hash);
}

export function clearPinHash() {
  localStorage.removeItem(PIN_HASH_KEY);
  try { localStorage.setItem(PIN_SEEDED_KEY, "1"); } catch {}
}

/** Install the factory hash once, on a fresh TV. Does not restore it after the user turns the lock off. */
export function ensureDefaultPin() {
  try {
    if (localStorage.getItem(PIN_SEEDED_KEY) === "1") return;
    if (getPinHash().length !== 64) localStorage.setItem(PIN_HASH_KEY, DEFAULT_PIN_HASH);
    localStorage.setItem(PIN_SEEDED_KEY, "1");
    markPinPrompted();
  } catch {}
}

export function wasPinPrompted() {
  try {
    return localStorage.getItem(PIN_PROMPTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markPinPrompted() {
  localStorage.setItem(PIN_PROMPTED_KEY, "1");
}

export async function pinMatches(pin) {
  if (!hasPin()) return false;
  const hex = await hashPin(pin);
  return hex === getPinHash();
}

let audioCtx = null;
function audio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

export function playUiSound(kind) {
  if (!current.uiSounds) return;
  const vol = current.uiVolume;
  if (vol <= 0) return;
  try {
    const c = audio();
    if (c.state === "suspended") c.resume().catch(() => {});
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "sine";
    const t = c.currentTime;
    const v = 0.045 * vol;
    if (kind === "ok") {
      o.frequency.setValueAtTime(520, t);
      o.frequency.exponentialRampToValueAtTime(880, t + 0.06);
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      o.start(t);
      o.stop(t + 0.11);
    } else if (kind === "err") {
      o.type = "square";
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(140, t + 0.12);
      g.gain.setValueAtTime(v * 0.8, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.start(t);
      o.stop(t + 0.15);
    } else {
      o.frequency.value = 660;
      g.gain.setValueAtTime(v * 0.7, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      o.start(t);
      o.stop(t + 0.045);
    }
    o.connect(g);
    g.connect(c.destination);
  } catch {
    /* UI sound is optional */
  }
}

loadSettings();
ensureDefaultPin();
