import { PhoneClient, normalizeCode } from "./net.js";

const statusEl = document.getElementById("status");
const roomLabel = document.getElementById("room-label");
const form = document.getElementById("join-form");
const codeInput = document.getElementById("code");
const errEl = document.getElementById("err");
const pad = document.getElementById("pad");
const homeWrap = document.getElementById("home-wrap");
const hint = document.getElementById("hint");

const client = new PhoneClient();
const numpad = document.getElementById("numpad");
let hapticsOn = true;
let lastLocalHaptic = 0;
window.__zavboxPhone = { client, get hapticsOn() { return hapticsOn; } };

function canVibrate() {
  return typeof navigator.vibrate === "function";
}

function haptic(kind) {
  if (!hapticsOn) return;
  if (!canVibrate()) return;
  const pattern = kind === "select" || kind === "ok" ? 24 : kind === "error" ? [30, 40, 30] : 12;
  try { navigator.vibrate(pattern); } catch { /* not supported */ }
}

function showLocked(on) {
  document.body.classList.toggle("is-locked", !!on);
  if (numpad) numpad.hidden = !on;
}

function setStatus(state, text) {
  statusEl.dataset.state = state;
  statusEl.textContent = text;
}

function codeFromLocation() {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(location.search);
  return normalizeCode(hash.get("code") || query.get("code") || "");
}

function showPad(code) {
  form.hidden = true;
  pad.hidden = false;
  homeWrap.hidden = false;
  roomLabel.textContent = "Room " + code;
  hint.hidden = false;
}

function showJoin(prefill) {
  form.hidden = false;
  pad.hidden = true;
  homeWrap.hidden = true;
  if (prefill) codeInput.value = prefill;
  hint.hidden = true;
}

client.on("message", (msg) => {
  if (msg.t === "launch") {
    setStatus("ready", msg.message || "The game is opening on the TV. Scan the QR code on that screen with this phone.");
  }
  if (msg.t === "welcome" && msg.code) {
    roomLabel.textContent = "Room " + msg.code;
  }
  if (msg.t === "prefs") {
    if (typeof msg.haptics === "boolean") hapticsOn = msg.haptics;
    if (typeof msg.locked === "boolean") showLocked(msg.locked);
  }
  if (msg.t === "haptic") {
    if (Date.now() - lastLocalHaptic < 80) return;
    haptic(msg.k || "move");
  }
});

client.on("close", () => {
  setStatus("error", "The TV connection closed. If Party Mode is on the TV, scan the QR code on that screen. Otherwise reopen this page and join again.");
});

async function connect(code) {
  const clean = normalizeCode(code);
  errEl.textContent = "";
  setStatus("loading", "Joining the TV.");
  document.getElementById("btn-join").disabled = true;
  try {
    const info = await client.connect(clean);
    showPad(info.code);
    setStatus("ready", "Connected. Move with the D-pad, press A to play.");
    window.__zavboxPhone.connected = true;
    window.__zavboxPhone.code = info.code;
  } catch (err) {
    document.getElementById("btn-join").disabled = false;
    showJoin(clean);
    const text = err?.message || "Could not reach the TV.";
    errEl.textContent = text;
    setStatus("error", text);
    window.__zavboxPhone.connected = false;
    window.__zavboxPhone.error = err?.code || "ERROR";
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  connect(codeInput.value);
});

function sendKey(key) {
  if (!window.__zavboxPhone.connected) return;
  const kind = key === "a" || key === "ok" ? "select" : (key === "back" ? "move" : (key.length === 1 && key >= "0" && key <= "9") ? "move" : "move");
  lastLocalHaptic = Date.now();
  haptic(kind);
  client.nav(key);
}

function bindPress(btn) {
  const key = btn.getAttribute("data-key");
  let hold = 0;
  const start = (event) => {
    event.preventDefault();
    btn.classList.add("is-down");
    sendKey(key);
    if (key === "left" || key === "right" || key === "up" || key === "down") {
      window.clearInterval(hold);
      hold = window.setInterval(() => sendKey(key), 220);
    }
  };
  const stop = () => {
    btn.classList.remove("is-down");
    window.clearInterval(hold);
  };
  btn.addEventListener("pointerdown", start);
  btn.addEventListener("pointerup", stop);
  btn.addEventListener("pointerleave", stop);
  btn.addEventListener("pointercancel", stop);
}

for (const btn of document.querySelectorAll("[data-key]")) bindPress(btn);

const initial = codeFromLocation();
if (initial) {
  codeInput.value = initial;
  connect(initial);
} else {
  setStatus("loading", "Type the room code shown on the TV.");
  showJoin("");
}
