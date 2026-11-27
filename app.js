import { TvHost } from "./net.js";
import {
  THEMES, GRAPHICS, THEME_IDS_LIST, GRAPHIC_IDS_LIST,
  getSettings, setSetting, resetSettings, applySettings, cycleValue,
  withGraphicsParams, hashPin, hasPin, setPinHash, clearPinHash,
  wasPinPrompted, markPinPrompted, pinMatches, playUiSound
} from "./settings.js";

const STORAGE_KEY = "zavbox.localGames.v1";
const PARTY_URL = "https://8kbtcrn6ws-star.github.io/party-mode/";

const shelfEl = document.getElementById("shelf");
const libraryShelfEl = document.getElementById("library-shelf");
const hostStatus = document.getElementById("host-status");
const roomCodeEl = document.getElementById("room-code");
const qrEl = document.getElementById("qr");
const addDialog = document.getElementById("add-dialog");
const addForm = document.getElementById("add-form");
const addFeedback = document.getElementById("add-feedback");
const launchEl = document.getElementById("launch");
const settingsLink = document.getElementById("settings-link");
const fullscreenBtn = document.getElementById("btn-fullscreen");

/** @type {{games: object[], controller?: object}} */
let catalog = { games: [] };
let screen = "games";
let leaveNoticeGame = null;
let focusId = "game-party-mode";
let joinUrl = "";
const host = new TvHost();

const pin = { mode: "unlock", buffer: "", pending: "", locked: false };
const hapticLog = [];
const lockEl = document.getElementById("lock-screen");
const lockCard = document.getElementById("lock-card");
const lockTitle = document.getElementById("lock-title");
const lockSub = document.getElementById("lock-sub");
const lockFeedback = document.getElementById("lock-feedback");
const pinDots = document.getElementById("pin-dots");
const pinPrompt = document.getElementById("pin-prompt");

const LOCK_COPY = {
  unlock: ["Enter PIN", "Use the phone pad, the number keys, or the buttons below."],
  set: ["Choose a PIN", "Enter a new 4-digit PIN. It stays on this TV only."],
  confirm: ["Confirm PIN", "Enter the same 4 digits again."],
  "verify-off": ["Turn off PIN", "Enter the current PIN to turn the lock off."],
  "verify-change": ["Current PIN", "Enter the current PIN, then choose a new one."]
};

window.__zavbox = {
  host,
  get focusId() { return focusId; },
  get screen() { return screen; },
  get settings() { return getSettings(); },
  setSetting,
  get locked() { return !lockEl.hidden && pin.locked; },
  get pinLength() { return pin.buffer.length; },
  get pinMode() { return pin.mode; },
  get hasPin() { return hasPin(); },
  get hapticLog() { return hapticLog.slice(); },
  enterDigit,
  sendHaptic
};


function sendHaptic(kind) {
  if (!getSettings().haptics) return;
  hapticLog.push(kind);
  if (hapticLog.length > 40) hapticLog.shift();
  host.broadcast({ t: "haptic", k: kind });
}

function sendPrefs() {
  const s = getSettings();
  host.broadcast({ t: "prefs", haptics: s.haptics, locked: !lockEl.hidden });
}

function paintSettings() {
  const s = getSettings();
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set("val-theme", THEMES[s.theme].label);
  set("val-graphics", GRAPHICS[s.graphics].label);
  set("val-haptics", s.haptics ? "On" : "Off");
  set("val-sounds", s.uiSounds ? "On" : "Off");
  set("val-volume", Math.round(s.uiVolume * 100) + "%");
  set("val-motion", s.reducedMotion ? "On" : "Off");
  set("val-overscan", s.overscan + "%");
  set("val-fps", s.showFps ? "On" : "Off");
  set("val-pin", hasPin() ? "On" : "Off");
  const change = document.getElementById("btn-pin-change");
  if (change) change.hidden = !hasPin();
  updateFullscreenLabel();
}

function adjustFocusedSetting(dir) {
  const s = getSettings();
  if (focusId === "set-theme") setSetting("theme", cycleValue(THEME_IDS_LIST, s.theme, dir));
  else if (focusId === "set-graphics") setSetting("graphics", cycleValue(GRAPHIC_IDS_LIST, s.graphics, dir));
  else if (focusId === "set-haptics") setSetting("haptics", !s.haptics);
  else if (focusId === "set-sounds") setSetting("uiSounds", !s.uiSounds);
  else if (focusId === "set-volume") {
    const step = dir === "left" ? -0.1 : 0.1;
    setSetting("uiVolume", Math.max(0, Math.min(1, Math.round((s.uiVolume + step) * 10) / 10)));
  } else if (focusId === "set-motion") setSetting("reducedMotion", !s.reducedMotion);
  else if (focusId === "set-overscan") setSetting("overscan", s.overscan + (dir === "left" ? -1 : 1));
  else if (focusId === "set-fps") setSetting("showFps", !s.showFps);
  else return false;
  paintSettings();
  playUiSound("move");
  sendHaptic("move");
  sendPrefs();
  return true;
}

function paintPinDots() {
  pinDots.querySelectorAll("span").forEach((el, i) => el.classList.toggle("is-on", i < pin.buffer.length));
}

function openLock(mode) {
  pin.mode = mode;
  pin.buffer = "";
  const copy = LOCK_COPY[mode] || LOCK_COPY.unlock;
  lockTitle.textContent = copy[0];
  lockSub.textContent = copy[1];
  lockFeedback.textContent = "";
  paintPinDots();
  lockEl.hidden = false;
  pin.locked = mode === "unlock";
  focusId = "pin-1";
  paintFocus();
  sendPrefs();
}

function closeLock() {
  lockEl.hidden = true;
  pin.buffer = "";
  pin.pending = "";
  pin.locked = false;
  paintPinDots();
  sendPrefs();
}

function showPinPrompt() {
  if (pinPrompt.open) return;
  pinPrompt.showModal();
  focusId = "prompt-set";
  paintFocus();
}

function closePinPrompt() {
  if (pinPrompt.open) pinPrompt.close();
  markPinPrompted();
}

function wrongPin(message) {
  pin.buffer = "";
  paintPinDots();
  lockFeedback.textContent = message || "That PIN did not work. Try again.";
  lockCard.classList.remove("is-shake");
  void lockCard.offsetWidth;
  lockCard.classList.add("is-shake");
  playUiSound("err");
  sendHaptic("error");
}

function enterDigit(d) {
  if (lockEl.hidden) return;
  if (!/^[0-9]$/.test(d)) return;
  if (pin.buffer.length >= 4) return;
  pin.buffer += d;
  paintPinDots();
  playUiSound("move");
  sendHaptic("move");
  lockFeedback.textContent = "";
  if (pin.buffer.length === 4) window.setTimeout(() => { acceptPin(); }, 80);
}

function pinBackspace() {
  if (lockEl.hidden || !pin.buffer) return;
  pin.buffer = pin.buffer.slice(0, -1);
  paintPinDots();
  playUiSound("move");
}

async function acceptPin() {
  const code = pin.buffer;
  if (code.length !== 4) return;
  if (pin.mode === "unlock") {
    if (await pinMatches(code)) {
      pin.buffer = "";
      closeLock();
      playUiSound("ok");
      sendHaptic("select");
      focusId = "game-party-mode";
      showScreen("games");
    } else {
      wrongPin();
    }
    return;
  }
  if (pin.mode === "set") {
    pin.pending = code;
    pin.buffer = "";
    paintPinDots();
    openLock("confirm");
    playUiSound("ok");
    return;
  }
  if (pin.mode === "confirm") {
    if (code === pin.pending) {
      setPinHash(await hashPin(code));
      pin.pending = "";
      pin.buffer = "";
      markPinPrompted();
      closeLock();
      paintSettings();
      playUiSound("ok");
      sendHaptic("select");
      focusId = "set-pin";
      showScreen("settings");
    } else {
      pin.pending = "";
      wrongPin("Those numbers did not match. Try again.");
      pin.mode = "set";
      const copy = LOCK_COPY.set;
      lockTitle.textContent = copy[0];
      lockSub.textContent = copy[1];
    }
    return;
  }
  if (pin.mode === "verify-off") {
    if (await pinMatches(code)) {
      clearPinHash();
      closeLock();
      paintSettings();
      playUiSound("ok");
      focusId = "set-pin";
      showScreen("settings");
    } else wrongPin();
    return;
  }
  if (pin.mode === "verify-change") {
    if (await pinMatches(code)) {
      pin.pending = "";
      openLock("set");
      playUiSound("ok");
    } else wrongPin();
  }
}

function handlePinNav(key) {
  if (key >= "0" && key <= "9") { enterDigit(key); return; }
  if (key === "b" || key === "back") {
    if (pin.buffer) pinBackspace();
    else if (pin.mode !== "unlock") {
      closeLock();
      focusId = "set-pin";
      showScreen("settings");
    }
    return;
  }
  if (key === "a" || key === "ok") {
    if (focusId === "pin-back") pinBackspace();
    else if (focusId === "pin-ok") acceptPin();
    else {
      const el = document.querySelector(`[data-focus="${cssEscape(focusId)}"]`);
      const digit = el?.getAttribute("data-digit");
      if (digit) enterDigit(digit);
    }
    return;
  }
  if (key === "home") return;
  if (key === "left" || key === "right" || key === "up" || key === "down") {
    const order = ["pin-1", "pin-2", "pin-3", "pin-4", "pin-5", "pin-6", "pin-7", "pin-8", "pin-9", "pin-back", "pin-0", "pin-ok"];
    let i = order.indexOf(focusId);
    if (i < 0) i = 0;
    const col = i % 3;
    const row = Math.floor(i / 3);
    if (key === "left") i = row * 3 + Math.max(0, col - 1);
    if (key === "right") i = row * 3 + Math.min(2, col + 1);
    if (key === "up") i = Math.max(0, row - 1) * 3 + col;
    if (key === "down") i = Math.min(3, row + 1) * 3 + col;
    focusId = order[i];
    paintFocus();
    playUiSound("move");
    sendHaptic("move");
  }
}

function localGames() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function allGames() {
  return catalog.games.concat(localGames());
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setHostStatus(state, text) {
  hostStatus.dataset.state = state;
  hostStatus.textContent = text;
}

function fallbackCoverStyle(id) {
  let hash = 0;
  const seed = String(id || "game");
  for (let i = 0; i < seed.length; i++) hash = (hash * 33 + seed.charCodeAt(i)) >>> 0;
  const a = hash % 360;
  const b = (a + 46 + (hash % 50)) % 360;
  const c = (a + 200 + (hash % 90)) % 360;
  return `background:linear-gradient(165deg,hsl(${a} 64% 14%) 0%,hsl(${b} 72% 28%) 48%,hsl(${c} 82% 46%) 100%)`;
}

function coverTitleMarkup(title) {
  const words = String(title || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 2) {
    return `<span>${escapeHtml(words[0])}</span><span>${escapeHtml(words[1])}</span>`;
  }
  return escapeHtml(words.join(" "));
}

function renderShelf(into, includeUtility) {
  const games = allGames();
  const cards = games.map((game, index) => {
    const focus = "game-" + game.id;
    const src = game.cover || game.art || "";
    const width = Number(game.coverWidth || game.artWidth) || (game.cover ? 1200 : 1280);
    const height = Number(game.coverHeight || game.artHeight) || (game.cover ? 1600 : 800);
    const alt = game.coverAlt || game.artAlt || "";
    const art = src
      ? `<img class="art" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="${width}" height="${height}" ${index === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}>`
      : `<div class="art art-fallback" style="${fallbackCoverStyle(game.id)}" role="img" aria-label="${escapeHtml(alt || ((game.title || "Game") + " cover"))}"></div>`;
    const badge = game.origin === "external"
      ? `<p class="origin-badge">Someone else's game</p>`
      : "";
    const credit = game.credit ? `<p class="credit">${escapeHtml(game.credit)}</p>` : "";
    return `<article class="game-card" data-focus="${escapeHtml(focus)}" data-game="${escapeHtml(game.id)}">
      <div class="cover">
        ${art}
        <p class="cover-title" aria-hidden="true">${coverTitleMarkup(game.title)}</p>
        ${badge}
      </div>
      <div class="meta">
        <h2>${escapeHtml(game.title)}</h2>
        <p class="desc">${escapeHtml(game.description || "")}</p>
        ${credit}
        <button type="button" class="play" data-play="${escapeHtml(game.id)}"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2z" fill="currentColor"/></svg>Play</button>
      </div>
    </article>`;
  }).join("");

  const extras = includeUtility ? `
    <button type="button" class="tile add" data-focus="tile-add">
      <span class="tile-icon plus" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></span>
      <span class="tile-copy">
        <strong>Add Game</strong>
        <span>Saved on this TV. It needs a phone controller, like Party Mode.</span>
      </span>
    </button>
    <div class="tile status-tile" data-focus="tile-status">
      <span class="tile-icon star" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M12 2.8l2.75 5.6 6.15.9-4.45 4.33 1.05 6.12L12 16.86l-5.5 2.9 1.05-6.13L3.1 9.3l6.15-.9z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg></span>
      <span class="tile-copy">
        <strong>New games show up automatically</strong>
        <span id="${into === shelfEl ? "tile-status-text" : "tile-status-text-lib"}">${escapeHtml(hostStatus.textContent)}</span>
      </span>
      <span class="tile-check" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M7.4 12.3l3 3 6.2-6.4" fill="none" stroke="#06210f" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    </div>` : "";

  const chevron = (dir, label, d) => `<button type="button" class="chev ${dir === "left" ? "prev" : "next"}" data-nav="${dir}" aria-label="${label}" tabindex="-1"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
  into.innerHTML = `<div class="track-wrap">
      ${chevron("left", "Previous", "M14.5 5.5 8 12l6.5 6.5")}
      <div class="track">${cards}</div>
      ${chevron("right", "Next", "M9.5 5.5 16 12l-6.5 6.5")}
    </div>
    <div class="tray">${extras}</div>`;
}

function syncStatusTiles() {
  for (const id of ["tile-status-text", "tile-status-text-lib"]) {
    const el = document.getElementById(id);
    if (el) el.textContent = hostStatus.textContent;
  }
}

function render() {
  renderShelf(shelfEl, true);
  renderShelf(libraryShelfEl, true);
  paintFocus();
}

function currentRows() {
  const nav = ["nav-games", "nav-library", "nav-settings", "nav-about"];
  if (!lockEl.hidden) {
    return [["pin-1", "pin-2", "pin-3", "pin-4", "pin-5", "pin-6", "pin-7", "pin-8", "pin-9", "pin-back", "pin-0", "pin-ok"]];
  }
  if (pinPrompt.open) {
    return [nav, ["prompt-set", "prompt-skip"]];
  }
  if (!launchEl.hidden && launchEl.dataset.mode === "leave") {
    return [["leave-continue", "leave-back"]];
  }
  if (addDialog.open) {
    return [nav, ["add-title", "add-url", "add-desc", "add-cover", "add-submit", "add-cancel"]];
  }
  if (screen === "settings") {
    const ids = [...document.querySelectorAll("#screen-settings [data-focus]")].filter((el) => !el.hidden).map((el) => el.getAttribute("data-focus"));
    return [nav, ids];
  }
  if (screen === "about") return [nav];
  const shelf = screen === "library" ? libraryShelfEl : shelfEl;
  const ids = [...shelf.querySelectorAll("[data-focus]")].map((el) => el.getAttribute("data-focus"));
  return [nav, ids];
}

function focusableSet() {
  return new Set(currentRows().flat());
}

function showScreen(name) {
  screen = name;
  for (const key of ["games", "library", "settings", "about"]) {
    const el = document.getElementById("screen-" + key);
    const on = key === name;
    el.hidden = !on;
    el.classList.toggle("is-on", on);
  }
  for (const btn of document.querySelectorAll(".pill[data-screen]")) {
    btn.classList.toggle("is-on", btn.getAttribute("data-screen") === name);
  }
  paintFocus();
}

function isPaintTarget(el) {
  if (el.closest("dialog")) return addDialog.open;
  const section = el.closest(".screen");
  if (section) return !section.hidden;
  return true;
}

function paintFocus() {
  const allowed = focusableSet();
  if (!allowed.has(focusId)) {
    const rows = currentRows();
    focusId = (rows[1] && rows[1][0]) || rows[0][0];
  }
  for (const el of document.querySelectorAll("[data-focus]")) {
    const on = isPaintTarget(el) && el.getAttribute("data-focus") === focusId;
    el.classList.toggle("is-selected", on);
    el.classList.toggle("is-focus", on);
    if (el.classList.contains("pill") || el.classList.contains("row-btn") || el.classList.contains("set-row") || el.classList.contains("play") || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "BUTTON") {
      el.tabIndex = on ? 0 : -1;
    }
    if (on) {
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      if (document.activeElement !== el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "BUTTON")) {
        try { el.focus({ preventScroll: true }); } catch { /* ignore */ }
      }
    }
  }
}

function moveFocus(dir) {
  const rows = currentRows();
  let r = 0, c = 0, found = false;
  rows.forEach((row, ri) => {
    const ci = row.indexOf(focusId);
    if (ci >= 0) { r = ri; c = ci; found = true; }
  });
  if (!found) {
    focusId = rows[0][0];
    paintFocus();
    return;
  }
  if (dir === "left") c = Math.max(0, c - 1);
  if (dir === "right") c = Math.min(rows[r].length - 1, c + 1);
  if (dir === "up") {
    r = Math.max(0, r - 1);
    c = Math.min(c, rows[r].length - 1);
  }
  if (dir === "down") {
    r = Math.min(rows.length - 1, r + 1);
    c = Math.min(c, rows[r].length - 1);
  }
  focusId = rows[r][c];
  paintFocus();
}

function activate() {
  const el = document.querySelector(`[data-focus="${cssEscape(focusId)}"]`);
  if (!el) return;
  if (focusId.startsWith("nav-")) {
    showScreen(el.getAttribute("data-screen"));
    return;
  }
  if (focusId.startsWith("game-")) {
    launchGame(focusId.slice(5));
    return;
  }
  if (focusId === "tile-add") {
    openAdd();
    return;
  }
  if (focusId === "tile-status") return;
  if (focusId === "set-fullscreen") {
    toggleFullscreen();
    return;
  }
  if (focusId === "set-theme" || focusId === "set-graphics" || focusId === "set-haptics" || focusId === "set-sounds" || focusId === "set-volume" || focusId === "set-motion" || focusId === "set-overscan" || focusId === "set-fps") {
    adjustFocusedSetting("right");
    return;
  }
  if (focusId === "set-pin") {
    if (hasPin()) openLock("verify-off");
    else { pin.pending = ""; openLock("set"); }
    return;
  }
  if (focusId === "set-pin-change") {
    pin.pending = "";
    openLock("verify-change");
    return;
  }
  if (focusId === "set-reset") {
    resetSettings();
    paintSettings();
    sendPrefs();
    playUiSound("ok");
    return;
  }
  if (focusId === "prompt-set") {
    closePinPrompt();
    pin.pending = "";
    openLock("set");
    return;
  }
  if (focusId === "prompt-skip") {
    closePinPrompt();
    focusId = "game-party-mode";
    showScreen("games");
    return;
  }
  if (focusId.startsWith("pin-")) {
    handlePinNav("a");
    return;
  }
  if (focusId === "add-submit") {
    addForm.requestSubmit();
    return;
  }
  if (focusId === "add-cancel") {
    closeAdd();
    return;
  }
  if (focusId === "leave-continue") {
    confirmLeaveNotice();
    return;
  }
  if (focusId === "leave-back") {
    closeLeaveNotice();
    return;
  }
}

function goBack() {
  if (isLeaveNoticeOpen()) {
    closeLeaveNotice();
    return;
  }
  if (addDialog.open) {
    closeAdd();
    return;
  }
  if (screen !== "games") {
    focusId = "nav-games";
    showScreen("games");
  }
}

function goHome() {
  if (isLeaveNoticeOpen()) closeLeaveNotice();
  if (addDialog.open) closeAdd();
  focusId = "game-party-mode";
  showScreen("games");
}

function cssEscape(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value);
  return String(value).replace(/"/g, '\\"');
}

function gameById(id) {
  return allGames().find((g) => g.id === id);
}

function launchHeading() {
  return launchEl.querySelector("#launch-heading") || launchEl.querySelector("h2");
}

function launchBody() {
  return launchEl.querySelector("#launch-body") || launchEl.querySelector(".launch-body");
}

function isLeaveNoticeOpen() {
  return Boolean(launchEl) && !launchEl.hidden && launchEl.dataset.mode === "leave";
}

function resetLaunchChrome() {
  const badge = launchEl.querySelector(".launch-badge");
  const actions = launchEl.querySelector(".launch-actions");
  const credit = launchEl.querySelector(".launch-credit");
  if (badge) badge.hidden = true;
  if (actions) actions.hidden = true;
  if (credit) {
    credit.hidden = true;
    credit.textContent = "";
  }
  launchEl.setAttribute("role", "status");
  launchEl.removeAttribute("aria-modal");
  launchEl.removeAttribute("aria-labelledby");
  launchEl.removeAttribute("aria-describedby");
}

function showLeaveNotice(game) {
  leaveNoticeGame = game;
  resetLaunchChrome();
  launchEl.hidden = false;
  launchEl.dataset.mode = "leave";
  launchEl.setAttribute("role", "alertdialog");
  launchEl.setAttribute("aria-modal", "true");
  launchEl.setAttribute("aria-labelledby", "launch-heading");
  launchEl.setAttribute("aria-describedby", "launch-body");
  const badge = launchEl.querySelector(".launch-badge");
  const actions = launchEl.querySelector(".launch-actions");
  const credit = launchEl.querySelector(".launch-credit");
  const heading = launchHeading();
  const body = launchBody();
  if (badge) badge.hidden = false;
  if (actions) actions.hidden = false;
  if (heading) heading.textContent = game.title || "Someone else's game";
  if (body) {
    body.textContent = game.notice || (String(game.title || "This game") + " is made by its own developers, not by Zavbox. You're leaving Zavbox to play it.");
  }
  if (credit) {
    credit.hidden = !game.credit;
    credit.textContent = game.credit || "";
  }
  focusId = "leave-continue";
  paintFocus();
}

function closeLeaveNotice() {
  if (!isLeaveNoticeOpen()) return;
  const game = leaveNoticeGame;
  leaveNoticeGame = null;
  launchEl.hidden = true;
  launchEl.dataset.mode = "";
  resetLaunchChrome();
  focusId = game ? "game-" + game.id : "game-party-mode";
  paintFocus();
}

function confirmLeaveNotice() {
  const game = leaveNoticeGame;
  if (!game || !game.play) return;
  const url = game.play;
  let hostName = "its own site";
  try { hostName = new URL(url, window.location.href).hostname; } catch { /* keep fallback */ }
  host.broadcast({
    t: "launch",
    game: game.id,
    url,
    message: (game.title || "The game") + " is opening on the TV at " + hostName + ". It is not a Zavbox game."
  });
  launchEl.dataset.mode = "leaving";
  const actions = launchEl.querySelector(".launch-actions");
  if (actions) actions.hidden = true;
  const heading = launchHeading();
  const body = launchBody();
  if (heading) heading.textContent = "Opening " + (game.title || "the game");
  if (body) body.textContent = "This TV is leaving Zavbox and opening " + (game.title || "the game") + " on " + hostName + ".";
  window.setTimeout(() => { window.location.href = url; }, 700);
}

function launchGame(id) {
  const game = gameById(id);
  if (!game || !game.play) return;
  if (game.origin === "external" || game.notice) {
    showLeaveNotice(game);
    return;
  }
  const isParty = id === "party-mode" || game.play.startsWith("https://8kbtcrn6ws-star.github.io/party-mode/");
  const isAirTennis = id === "air-tennis" || game.play.startsWith("https://8kbtcrn6ws-star.github.io/air-tennis/");
  const url = withZavboxFlag(isParty || isAirTennis ? withGraphicsParams(game.play) : game.play);
  host.broadcast({
    t: "launch",
    game: id,
    url,
    message: isParty
      ? "Party Mode is opening on the TV. On that screen, choose Party Mode, then scan the QR code it shows with this phone to drive."
      : "The game is opening on the TV. If it shows its own QR code, scan that with this phone to play."
  });
  resetLaunchChrome();
  launchEl.dataset.mode = "opening";
  launchEl.hidden = false;
  const heading = launchHeading();
  const body = launchBody();
  if (isParty) {
    if (heading) heading.textContent = "Opening Party Mode";
    if (body) body.textContent = "This TV is leaving Zavbox and opening the game. On the next screen, choose Party Mode, then scan the QR code it shows with your phone to drive.";
  } else {
    if (heading) heading.textContent = "Opening " + game.title;
    if (body) body.textContent = "This TV is leaving Zavbox and opening the game. If that screen shows a QR code, scan it with your phone to play.";
  }
  window.setTimeout(() => { window.location.href = url; }, 700);
}

// Zav's own games only start when opened from Zavbox; they look for ?from=zavbox.
const OWN_GAMES_ORIGIN = "https://8kbtcrn6ws-star.github.io";
function withZavboxFlag(url) {
  try {
    const u = new URL(url, window.location.href);
    if (u.origin === OWN_GAMES_ORIGIN && !u.pathname.startsWith("/zavbox/")) u.searchParams.set("from", "zavbox");
    return u.href;
  } catch {
    return url;
  }
}

function openAdd() {
  addFeedback.textContent = "";
  addFeedback.dataset.kind = "";
  addDialog.showModal();
  focusId = "add-title";
  paintFocus();
}

function closeAdd() {
  if (addDialog.open) addDialog.close();
  focusId = "tile-add";
  paintFocus();
}

function isSafeUrl(value) {
  try {
    const u = new URL(value, window.location.href);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = document.getElementById("add-title-input").value.trim();
  const url = document.getElementById("add-url").value.trim();
  const description = document.getElementById("add-desc").value.trim();
  const cover = document.getElementById("add-cover").value.trim();
  if (!title || !description) {
    addFeedback.dataset.kind = "error";
    addFeedback.textContent = "A title and a short description are needed.";
    return;
  }
  if (!isSafeUrl(url)) {
    addFeedback.dataset.kind = "error";
    addFeedback.textContent = "Use an http or https address for the play link.";
    return;
  }
  if (cover && !isSafeUrl(cover)) {
    addFeedback.dataset.kind = "error";
    addFeedback.textContent = "Use an http or https address for the cover image, or leave it blank.";
    return;
  }
  const list = localGames();
  list.push({
    id: "local-" + Date.now().toString(36),
    title,
    description,
    play: url,
    local: true,
    origin: "local",
    controller: "dpad-ab",
    ...(cover ? { cover, coverAlt: "Cover art for " + title } : {})
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  addForm.reset();
  closeAdd();
  render();
  setHostStatus(hostStatus.dataset.state || "ready", hostStatus.textContent);
  syncStatusTiles();
});

document.getElementById("add-cancel").addEventListener("click", closeAdd);
document.getElementById("leave-continue").addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  confirmLeaveNotice();
});
document.getElementById("leave-back").addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  closeLeaveNotice();
});
addDialog.addEventListener("close", () => {
  if (focusId.startsWith("add-")) {
    focusId = "tile-add";
    paintFocus();
  }
});

document.querySelector(".pills").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-screen]");
  if (!btn) return;
  focusId = btn.getAttribute("data-focus");
  showScreen(btn.getAttribute("data-screen"));
});

document.body.addEventListener("click", (event) => {
  const play = event.target.closest("[data-play]");
  if (play) {
    event.preventDefault();
    launchGame(play.getAttribute("data-play"));
    return;
  }
  const focusEl = event.target.closest("[data-focus]");
  if (!focusEl) return;
  focusId = focusEl.getAttribute("data-focus");
  paintFocus();
  if (focusEl.matches(".tile.add, .row-btn, .pill, .set-row") || focusEl.closest("#pin-pad, #pin-prompt")) activate();
});

function handleNavKey(key) {
  if (!launchEl.hidden && launchEl.dataset.mode === "leaving") return;
  if (!lockEl.hidden) {
    handlePinNav(key);
    return;
  }
  if (pinPrompt.open) {
    if (key === "left" || key === "right" || key === "up" || key === "down") moveFocus(key);
    else if (key === "a") activate();
    else if (key === "b" || key === "home") {
      closePinPrompt();
      focusId = "game-party-mode";
      showScreen("games");
    }
    return;
  }
  const prev = focusId;
  const adjustable = focusId === "set-theme" || focusId === "set-graphics" || focusId === "set-haptics" || focusId === "set-sounds" || focusId === "set-volume" || focusId === "set-motion" || focusId === "set-overscan" || focusId === "set-fps";
  if ((key === "left" || key === "right") && adjustable) {
    adjustFocusedSetting(key);
    return;
  }
  if (key === "left" || key === "right" || key === "up" || key === "down") moveFocus(key);
  else if (key === "a") activate();
  else if (key === "b") goBack();
  else if (key === "home") goHome();
  if (focusId !== prev && (key === "left" || key === "right" || key === "up" || key === "down")) {
    playUiSound("move");
    sendHaptic("move");
  }
  if (key === "a") sendHaptic("select");
}

window.__zavbox.handleNav = handleNavKey;

// Carousel chevrons (mouse/touch) reuse the same left/right nav as the keyboard and phone.
document.body.addEventListener("click", (event) => {
  const chev = event.target.closest("[data-nav]");
  if (chev) handleNavKey(chev.getAttribute("data-nav"));
});

document.addEventListener("keydown", (event) => {
  if (!lockEl.hidden) {
    if (/^[0-9]$/.test(event.key)) { event.preventDefault(); enterDigit(event.key); return; }
    if (event.key === "Backspace") { event.preventDefault(); pinBackspace(); return; }
  }
  const inField = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  const map = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
    Enter: "a",
    " ": "a",
    Escape: "b",
    Backspace: inField ? null : "b",
    Home: "home",
    KeyH: event.metaKey || event.ctrlKey ? null : "home"
  };
  if (event.code === "KeyF" && !inField && !event.metaKey && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    toggleFullscreen();
    return;
  }
  const key = map[event.key] || map[event.code];
  if (!key) return;
  if (inField && (key === "left" || key === "right" || key === "up" || key === "down" || key === "a")) return;
  event.preventDefault();
  handleNavKey(key);
});

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    setHostStatus(hostStatus.dataset.state || "ready", "This browser blocked full screen. Use the browser's own full-screen control, or press F if it is allowed.");
  }
  updateFullscreenLabel();
}

function updateFullscreenLabel() {
  const label = document.getElementById("val-fullscreen");
  if (label) label.textContent = document.fullscreenElement ? "Exit" : "Enter";
}
document.addEventListener("fullscreenchange", updateFullscreenLabel);

host.on("join", ({ count }) => {
  setHostStatus("ready", count === 1 ? "1 phone connected. Use the D-pad to move, A to play." : count + " phones connected. Use the D-pad to move, A to play.");
  syncStatusTiles();
  sendPrefs();
});
host.on("leave", ({ count }) => {
  setHostStatus("ready", count ? count + " phone" + (count === 1 ? "" : "s") + " connected." : "Waiting for a phone. Scan the code to control this TV.");
  syncStatusTiles();
});
host.on("nav", ({ key }) => handleNavKey(key));
host.on("error", (e) => {
  setHostStatus("error", e.message || "The phone link hit a problem. Keyboard and mouse still work.");
  syncStatusTiles();
});

async function drawQr(url) {
  qrEl.classList.remove("is-empty");
  qrEl.replaceChildren();
  try {
    const qrcode = (await import("qrcode-generator")).default;
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    qrEl.innerHTML = qr.createSvgTag(2, 0);
    const svg = qrEl.querySelector("svg");
    if (svg) {
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.setAttribute("aria-hidden", "true");
    }
  } catch {
    qrEl.classList.add("is-empty");
    qrEl.textContent = "QR unavailable. Type the room code on the phone.";
  }
}

async function startHost() {
  setHostStatus("loading", "Starting the phone link.");
  try {
    const info = await host.open();
    roomCodeEl.textContent = info.code;
    joinUrl = new URL("controller.html", window.location.href).href + "#code=" + info.code;
    settingsLink.textContent = "Phone page: " + joinUrl;
    await drawQr(joinUrl);
    setHostStatus("ready", "Waiting for a phone. Scan the code to control this TV.");
    syncStatusTiles();
    window.__zavbox.code = info.code;
    window.__zavbox.joinUrl = joinUrl;
  } catch (err) {
    roomCodeEl.textContent = "----";
    qrEl.classList.add("is-empty");
    qrEl.textContent = "No QR. Keyboard and mouse still work.";
    settingsLink.textContent = "The phone link did not start. You can still use a keyboard or mouse.";
    setHostStatus("error", err?.message || "Connection service unreachable. Keyboard and mouse still work on this TV.");
    syncStatusTiles();
    window.__zavbox.hostError = err?.code || "BROKER_UNREACHABLE";
  }
}

async function boot() {
  try {
    const res = await fetch("games.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    if (!data || !Array.isArray(data.games)) throw new Error("bad manifest");
    catalog = data;
  } catch (err) {
    console.error(err);
    catalog = { games: [] };
  }
  applySettings();
  paintSettings();
  render();
  if (hasPin()) openLock("unlock");
  await startHost();
  sendPrefs();
  if (!hasPin() && !wasPinPrompted() && lockEl.hidden) showPinPrompt();
}

boot();
