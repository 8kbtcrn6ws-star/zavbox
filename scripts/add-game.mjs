#!/usr/bin/env node
/**
 * Add a game to Zavbox's games.json (and optionally copy a local folder).
 *
 * Examples:
 *   node scripts/add-game.mjs --id my-game --title "My Game" --description "A short accurate description." --url https://example.com/game --cover art/my-game-cover.webp
 *   node scripts/add-game.mjs --id my-game --title "My Game" --description "A short accurate description." --dir /path/to/runnable-build --cover /path/to/cover.webp --art /path/to/shot.webp
 *
 * The game must be launchable on a TV and then playable with a phone
 * as the controller, the way Party Mode is (D-pad + A/B for the Zavbox
 * menu; the game supplies its own phone join after Play).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "games.json");

function arg(flag) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return "";
  return process.argv[i + 1] || "";
}

function usage(message) {
  if (message) console.error(message);
  console.error(`Usage:
  node scripts/add-game.mjs --id <id> --title <title> --description <text> (--url <url> | --dir <folder>) [--cover <image>] [--art <image>] [--alt <text>] [--notes <text>]`);
  process.exit(message ? 1 : 0);
}

const id = arg("--id").trim();
const title = arg("--title").trim();
const description = arg("--description").trim();
const url = arg("--url").trim();
const dir = arg("--dir").trim();
const artIn = arg("--art").trim();
const coverIn = arg("--cover").trim();
const alt = arg("--alt").trim();
const notes = arg("--notes").trim();

if (process.argv.includes("--help") || process.argv.includes("-h")) usage("");
if (!id || !/^[a-z0-9-]+$/.test(id)) usage("Need a lowercase id made of letters, numbers and hyphens.");
if (!title || !description) usage("Need --title and --description.");
if (!url && !dir) usage("Need --url for a live game, or --dir for a local runnable folder.");
if (url && dir) usage("Use either --url or --dir, not both.");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.games.some((g) => g.id === id)) usage("A game with that id is already in games.json.");

let play = url;
let origin = "live";
if (dir) {
  const source = path.resolve(dir);
  if (!fs.existsSync(path.join(source, "index.html"))) {
    usage("The folder needs an index.html entry point.");
  }
  const dest = path.join(root, "games", id);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(source, dest, { recursive: true });
  play = "games/" + id + "/index.html";
  origin = "bundled";
  console.log("Copied", source, "to", dest);
}

function copyImage(input, destName, label) {
  const src = path.resolve(input);
  if (fs.existsSync(src) && fs.statSync(src).isFile()) {
    const ext = path.extname(src).toLowerCase() || ".webp";
    const destRel = path.join("art", destName + ext);
    fs.mkdirSync(path.join(root, "art"), { recursive: true });
    fs.copyFileSync(src, path.join(root, destRel));
    return destRel.split(path.sep).join("/");
  }
  if (/^https?:\/\//i.test(input)) return input;
  usage("Could not find that " + label + " file.");
}

let art = "";
if (artIn) art = copyImage(artIn, id, "artwork");

let cover = "";
if (coverIn) cover = copyImage(coverIn, id + "-cover", "cover");
else if (art) cover = art;

const game = {
  id,
  title,
  description,
  play,
  origin,
  controller: "dpad-ab",
  notes: notes || "After Play, the game must offer its own phone join, the way Party Mode does with its QR code."
};
if (cover) {
  game.cover = cover;
  game.coverWidth = coverIn ? 1200 : 1280;
  game.coverHeight = coverIn ? 1600 : 800;
  game.coverAlt = alt || ("Cover art for " + title);
}
if (art) {
  game.art = art;
  game.artWidth = 1280;
  game.artHeight = 800;
  game.artAlt = alt || ("A screenshot of " + title);
}

manifest.games.push(game);

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log("Added", title, "to games.json");
