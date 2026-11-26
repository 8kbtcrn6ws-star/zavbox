// Small PeerJS helper for the Zavbox TV menu and phone controller.
// Same approach as Party Mode: free public PeerJS broker + Google STUN, no TURN, no account.
export const PEERJS_CDN = "https://cdn.jsdelivr.net/npm/peerjs@1.5.5/+esm";
export const STUN_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];
export const ROOM_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const PREFIX = "zb-";

export function randomCode(len = 4) {
  const limit = 256 - (256 % ROOM_LETTERS.length);
  let out = "";
  while (out.length < len) {
    const bytes = new Uint8Array(len * 2);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit && out.length < len) out += ROOM_LETTERS[b % ROOM_LETTERS.length];
    }
  }
  return out;
}

export function normalizeCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function peerIdFromCode(code) {
  return PREFIX + normalizeCode(code);
}

export function codeFromPeerId(id) {
  const s = String(id || "");
  return s.startsWith(PREFIX) ? s.slice(PREFIX.length) : normalizeCode(s);
}

// Same ICE set Party Mode can use: Google STUN, plus PeerJS' documented free TURN as a fallback.
const PEERJS_TURN = {
  urls: ["turn:eu-0.turn.peerjs.com:3478", "turn:us-0.turn.peerjs.com:3478"],
  username: "peerjs",
  credential: "peerjsp"
};

export function peerOptions() {
  return { debug: 0, config: { iceServers: [...STUN_SERVERS, PEERJS_TURN], sdpSemantics: "unified-plan" } };
}

export async function loadPeer() {
  if (globalThis.Peer) return globalThis.Peer;
  if (globalThis.peerjs?.Peer) return globalThis.peerjs.Peer;
  const mod = await import("peerjs");
  return mod.Peer || mod.default?.Peer || mod.default;
}

function parse(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const msg = JSON.parse(raw);
    return msg && typeof msg === "object" && typeof msg.t === "string" ? msg : null;
  } catch {
    return null;
  }
}

export class TvHost {
  constructor() {
    this.peer = null;
    this.code = null;
    this.peerId = null;
    this.conns = new Map();
    this.handlers = {};
    this.closed = false;
  }

  on(event, fn) {
    this.handlers[event] = fn;
  }

  emit(event, detail) {
    this.handlers[event]?.(detail);
  }

  connectedCount() {
    return this.conns.size;
  }

  async open() {
    const Peer = await loadPeer();
    let lastErr;
    for (let i = 0; i < 5; i++) {
      const code = randomCode(4);
      const id = peerIdFromCode(code);
      try {
        await this.#listen(Peer, id);
        this.code = code;
        this.peerId = id;
        return { code, peerId: id };
      } catch (err) {
        lastErr = err;
        this.peer?.destroy();
        this.peer = null;
      }
    }
    throw lastErr || new Error("Could not start the phone link.");
  }

  #listen(Peer, id) {
    return new Promise((resolve, reject) => {
      const peer = new Peer(id, peerOptions());
      this.peer = peer;
      let settled = false;
      const timer = setTimeout(() => {
        fail(Object.assign(new Error("Connection service unreachable, try again"), { code: "BROKER_UNREACHABLE" }));
      }, 8000);
      const fail = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.off("open", onOpen);
        reject(e);
      };
      const onOpen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(id);
      };
      peer.on("open", onOpen);
      peer.on("error", (e) => {
        const type = e?.type;
        if (settled) {
          this.emit("error", { message: e?.message || String(e), type });
          return;
        }
        if (type === "unavailable-id") fail(Object.assign(new Error("Room code taken"), { code: "ID_TAKEN" }));
        else fail(Object.assign(new Error(e?.message || "Connection service unreachable"), { code: "BROKER_UNREACHABLE" }));
      });
      peer.on("disconnected", () => {
        if (!this.closed) {
          try { peer.reconnect(); } catch { /* ignore */ }
        }
      });
      peer.on("connection", (conn) => this.#accept(conn));
    });
  }

  #accept(conn) {
    const id = conn.peer;
    conn.on("open", () => {
      this.conns.set(id, conn);
      try { conn.send({ t: "welcome", code: this.code }); } catch { /* ignore */ }
      this.emit("join", { count: this.conns.size });
    });
    conn.on("data", (raw) => {
      const msg = parse(raw);
      if (!msg) return;
      if (msg.t === "nav" && typeof msg.k === "string") this.emit("nav", { key: msg.k, from: id });
      if (msg.t === "hello") {
        try { conn.send({ t: "welcome", code: this.code }); } catch { /* ignore */ }
      }
    });
    const gone = () => {
      this.conns.delete(id);
      this.emit("leave", { count: this.conns.size });
    };
    conn.on("close", gone);
    conn.on("error", gone);
  }

  broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const conn of this.conns.values()) {
      try { conn.send(msg); } catch {
        try { conn.send(payload); } catch { /* ignore */ }
      }
    }
  }

  close() {
    this.closed = true;
    for (const conn of this.conns.values()) {
      try { conn.close(); } catch { /* ignore */ }
    }
    this.conns.clear();
    try { this.peer?.destroy(); } catch { /* ignore */ }
  }
}

export class PhoneClient {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.handlers = {};
  }

  on(event, fn) {
    this.handlers[event] = fn;
  }

  emit(event, detail) {
    this.handlers[event]?.(detail);
  }

  async connect(code) {
    const id = peerIdFromCode(code);
    if (!normalizeCode(code) || normalizeCode(code).length < 4) {
      throw Object.assign(new Error("That room code does not look right."), { code: "BAD_CODE" });
    }
    const Peer = await loadPeer();
    const peer = new Peer(undefined, peerOptions());
    this.peer = peer;
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(Object.assign(new Error("Connection service unreachable, try again"), { code: "BROKER_UNREACHABLE" })), 8000);
      peer.on("open", () => { clearTimeout(t); resolve(); });
      peer.on("error", (e) => {
        clearTimeout(t);
        reject(Object.assign(new Error(e?.message || "Connection service unreachable, try again"), { code: e?.type || "BROKER_UNREACHABLE" }));
      });
    });
    const conn = peer.connect(id, { reliable: true });
    this.conn = conn;
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(Object.assign(new Error("No TV with that code. Check the code or scan the QR again."), { code: "ROOM_NOT_FOUND" })), 10000);
      conn.on("open", () => { clearTimeout(t); resolve(); });
      conn.on("error", (e) => {
        clearTimeout(t);
        reject(Object.assign(new Error(e?.message || "Can't reach the TV."), { code: e?.type || "ICE_FAILED" }));
      });
      peer.on("error", (e) => {
        if (e?.type === "peer-unavailable") {
          clearTimeout(t);
          reject(Object.assign(new Error("No TV with that code. Check the code or scan the QR again."), { code: "ROOM_NOT_FOUND" }));
        }
      });
    });
    conn.on("data", (raw) => {
      const msg = parse(raw);
      if (msg) this.emit("message", msg);
    });
    conn.on("close", () => this.emit("close"));
    try { conn.send({ t: "hello" }); } catch { /* ignore */ }
    return { code: normalizeCode(code), peerId: id };
  }

  send(msg) {
    if (!this.conn) return;
    try { this.conn.send(msg); } catch { /* ignore */ }
  }

  nav(key) {
    this.send({ t: "nav", k: key });
  }

  close() {
    try { this.conn?.close(); } catch { /* ignore */ }
    try { this.peer?.destroy(); } catch { /* ignore */ }
  }
}
