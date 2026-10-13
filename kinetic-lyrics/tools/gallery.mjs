// A page to scroll through every word effect and every exit of the engine: one small
// HyperFrames project per effect, each in its own HyperFrames player.
//
//   node tools/gallery.mjs [--port 8092] [--rebuild] [--no-serve]
//
// Builds gallery/<id>/ for each demo (again only when the engine or the tools changed
// since, or with --rebuild), writes gallery/index.html and serves it with the
// HyperFrames runtime and player of the `hyperframes` on the PATH. A player is only
// mounted while its card is on screen: every demo runs its own three.js world.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "gallery");
const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const PORT = Number(argv[argv.indexOf("--port") + 1]) || (flag("--port") ? 0 : 8092);

// the word with the effect is the one in [brackets]
const WORDS = [
  ["rise", "Die Buchstaben steigen wie losgelassene Ballons auf, jeder in seinem Tempo, leicht schwankend", "Ballons [schweben] davon"],
  ["drop", "Die Buchstaben fallen schwer von oben und federn beim Aufprall nach", "Dann [fällt] der Groschen"],
  ["flicker", "Die Buchstaben fangen von unten Feuer und züngeln warm weiter", "Wir sitzen am [Lagerfeuer]"],
  ["glow", "Helles Aufleuchten, das abklingt", "Eine [brillante] Idee"],
  ["sparkle", "Buchstaben ploppen mit kleinen Sternen auf", "Das war einfach [magisch]"],
  ["fog", "Große Buchstaben tauchen einzeln aus treibendem Nebel auf, erst grau", "Alles liegt im [Nebel]"],
  ["whisper", "Klein, leise, kursiv: die Buchstaben werden nacheinander eingehaucht, ohne Glühen", "Sie [flüstert] mir zu"],
  ["slam", "Riesiger Einschlag mit Wackeln", "Und dann der [Knall]"],
  ["glitch", "Digitales Zittern, RGB-Versatz", "Das System ist [abgestürzt]"],
  ["wave", "Eine Welle läuft immer wieder durch das Wort", "Die [Wellen] am Meer"],
  ["spin", "3D-Drehung", "Alles [dreht] sich"],
  ["pulse", "Herzschlag", "Mein [Herz] rast"],
  ["shatter", "Buchstaben zerspringen", "Der Spiegel [zerbricht]"],
  ["flash", "Neonröhren zünden stotternd, Buchstabe für Buchstabe; später summt einer kurz aus", "Dann geht das [Licht] an"],
  ["streak", "Schießt mit Bewegungsunschärfe herein", "Sie rennt [blitzschnell] los"],
  ["count", "Die Zahl zählt hoch (Zahlwörter)", "Das kostet [500] Euro"],
  ["blink", "Öffnet sich wie ein Auge und blinzelt einmal", "Ich [sehe] alles"],
  ["redact", "Erscheint unter einem Zensurbalken, der weggezogen wird", "Das ist streng [geheim]"],
  ["bounce", "Die Buchstaben springen nacheinander von der Linie hoch und landen gestaucht; ab und zu hüpft einer nach", "Der Welpe [hüpft] herum"],
  ["depth", "Steigt flach liegend aus der Tiefe auf und richtet sich auf", "Aus der [Tiefe] des Raums"],
  ["blur", "Wird aus starker Unschärfe scharf", "Langsam wird es [klar]"],
  ["window", "Das Wort teilt sich beim nächsten Wort in der Mitte und schwingt wie zwei Fensterflügel auf, Licht fällt durch den Spalt", "Ich mache das [Fenster] auf"],
];
// what the engine sets by itself: the plain entrance and the one for no time
const ENGINE = [
  ["mask", "Standard für jedes Wort ohne eigenen Effekt: die Buchstaben gleiten aus einer Maske herein", "Die [Worte] gleiten herein"],
  ["snap", "Sehr schneller, kurzer Einstieg", "[Zack], und fertig"],
];
// the first phrase leaves with the exit, the second shows what follows
const EXITS = [
  ["lift", "Standard: die Buchstaben steigen nach oben hinaus", "Die Worte steigen hinaus"],
  ["zoom", "Fliegt durch die Kamera", "Mitten durch die Kamera"],
  ["blur", "Löst sich in Unschärfe auf", "Und alles löst sich auf"],
  ["scatter", "Die Wörter treiben auseinander", "Alles treibt auseinander"],
  ["mow", "Ein Rasenmäher mäht die Buchstaben bis auf die Stoppeln ab, Zeile für Zeile", "Wer will den Rasen mähen?"],
];
const AFTER = "Und weiter geht's";

const SECTIONS = [
  { title: "Wort-Effekte", note: "Die Regie (und der Chat-Agent) wählt sie im Staging als fx.", kind: "word", demos: WORDS },
  { title: "Nur in der Engine", note: "Die Engine setzt sie selbst: mask ist der normale Einstieg, snap die Notlösung, wenn für einen Effekt keine Zeit bleibt.", kind: "engine", demos: ENGINE },
  { title: "Abgänge", note: "Wie eine ganze Phrase geht: exit im Staging.", kind: "exit", demos: EXITS },
];

const STEP = 0.38, WORD = 0.32, START = 0.4;

function timed(texts, t0) {
  return texts.map((text, k) => ({ text, start: +(t0 + k * STEP).toFixed(3), end: +(t0 + k * STEP + WORD).toFixed(3), concept: null }));
}

// transcript and staging of one demo
function demo(kind, fx, sentence) {
  const staging = (phrases, words) => ({ hook: "", world: "aurora", phrases, words, notes: [], quotes: [], charts: [] });
  const phrase = (first, last, hero, exit) => ({
    first, last, hero, minor: [...Array(last - first + 1).keys()].map((k) => first + k).filter((i) => i !== hero),
    mood: "dawn", layout: "inline", exit,
  });
  if (kind === "exit") {
    const a = sentence.split(" "), b = AFTER.split(" ");
    const words = [...timed(a, START), ...timed(b, START + a.length * STEP + 1.4)];
    const hero = a.length - 1;
    words[hero].emphasis = 0.85;
    return { words, staging: staging([phrase(0, hero, hero, fx), phrase(a.length, words.length - 1, words.length - 1, "lift")], []) };
  }
  const texts = sentence.split(" ");
  const at = texts.findIndex((w) => w.startsWith("["));
  const words = timed(texts.map((w) => w.replace(/[[\]]/g, "")), START);
  Object.assign(words[at], { fx, emphasis: 0.9, hero: true });
  return { words, staging: staging([phrase(0, words.length - 1, at, "lift")], []) };
}

const id = (kind, fx) => (kind === "exit" ? `exit-${fx}` : fx);

// the moment a card shows while it is not played: the effect done, the phrase still there
function still(kind, fx, sentence) {
  const words = sentence.split(" ");
  if (kind === "exit") return +(START + (words.length - 1) * STEP + 0.6).toFixed(2);
  const at = words.findIndex((w) => w.startsWith("["));
  return +(START + at * STEP + (fx === "window" ? 1.3 : 1.0)).toFixed(2);
}

// ---------------------------------------------------------------- build
function newest(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((m, e) => {
    const p = path.join(dir, e.name);
    return Math.max(m, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }, 0);
}

async function buildAll() {
  const sources = Math.max(newest(path.join(ROOT, "engine")), newest(path.join(ROOT, "tools")));
  const jobs = [];
  for (const s of SECTIONS) {
    for (const [fx, , sentence] of s.demos) {
      const dir = path.join(OUT, id(s.kind, fx));
      const done = path.join(dir, "index.html");
      if (!flag("--rebuild") && fs.existsSync(done) && fs.statSync(done).mtimeMs > sources) continue;
      const src = path.join(dir, "source");
      fs.mkdirSync(src, { recursive: true });
      const { words, staging } = demo(s.kind, fx, sentence);
      fs.writeFileSync(path.join(src, "transcript.json"), JSON.stringify(words, null, 1));
      fs.writeFileSync(path.join(src, "staging.json"), JSON.stringify(staging, null, 1));
      jobs.push({ name: id(s.kind, fx), args: [path.join(ROOT, "tools", "build.mjs"), path.join(src, "transcript.json"),
        "--aspect", "9:16", "--size", "720x1280", "--tail", "1.2", "--staging", path.join(src, "staging.json"), "--out", dir] });
    }
  }
  if (!jobs.length) return console.log("gallery: every demo is up to date");
  console.log(`gallery: building ${jobs.length} demos`);
  let failed = 0;
  const run = ({ name, args }) => new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    child.on("close", (code) => {
      if (code) { failed++; console.log(`  ✗ ${name}\n${log.trim().split("\n").slice(-6).join("\n")}`); }
      else console.log(`  ✓ ${name}`);
      resolve();
    });
  });
  const queue = [...jobs];
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await run(queue.shift()); }));
  if (failed) process.exitCode = 1;
}

// ---------------------------------------------------------------- page
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page() {
  const card = (kind, [fx, what, sentence]) => {
    const text = kind === "exit"
      ? `<b>${esc(sentence)}</b> → ${esc(AFTER)}`
      : esc(sentence).replace(/\[([^\]]+)\]/, "<b>$1</b>");
    return `<article class="card" id="${id(kind, fx)}">
      <div class="stage" data-src="${id(kind, fx)}/index.html" data-still="${still(kind, fx, sentence)}"><span class="hint">${esc(fx)}</span></div>
      <h3><code>${esc(fx)}</code></h3><p>${esc(what)}</p><p class="ex">„${text}“</p></article>`;
  };
  const nav = SECTIONS.flatMap((s) => s.demos.map(([fx]) => `<a href="#${id(s.kind, fx)}">${esc(fx)}</a>`)).join("");
  const sections = SECTIONS.map((s) => `<section><h2>${s.title}</h2><p class="note">${s.note}</p>
    <div class="grid">${s.demos.map((d) => card(s.kind, d)).join("")}</div></section>`).join("");
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kinetic Effekte</title>
<style>
:root { --bg: #0d0f14; --card: #161a22; --line: #262c38; --ink: #eef1f6; --dim: #9aa3b2; --accent: #ffd27a; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.45 system-ui, sans-serif; }
header { position: sticky; top: 0; z-index: 2; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--line); padding: 12px 16px; }
header h1 { margin: 0 0 6px; font-size: 18px; }
header h1 small { margin-left: 8px; color: var(--dim); font-size: 13px; font-weight: 400; }
nav { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
nav a { flex: none; color: var(--dim); text-decoration: none; font: 12px ui-monospace, monospace; padding: 3px 8px; border: 1px solid var(--line); border-radius: 99px; }
nav a:hover { color: var(--ink); border-color: var(--dim); }
main { max-width: 1400px; margin: 0 auto; padding: 8px 16px 64px; }
h2 { margin: 28px 0 2px; font-size: 20px; }
.note { margin: 0 0 14px; color: var(--dim); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; scroll-margin-top: 90px; }
.card:target { outline: 2px solid var(--accent); }
.stage { position: relative; aspect-ratio: 9 / 16; background: #000; display: grid; place-items: center; }
.stage hyperframes-player { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; }
.card { cursor: pointer; transition: border-color .15s; }
.card.playing { border-color: var(--accent); }
.hint { color: #333a48; font: 600 22px ui-monospace, monospace; }
.card h3 { margin: 10px 12px 2px; font-size: 16px; }
.card h3 code { color: var(--accent); }
.card p { margin: 0 12px 4px; color: var(--dim); font-size: 13px; }
.card p.ex { margin-bottom: 12px; color: var(--ink); }
</style>
<script src="vendor/hyperframes-player.js"></script></head><body>
<header><h1>Kinetic – Wort-Animationen und Abgänge <small>Maus über eine Karte spielt sie ab</small></h1><nav>${nav}</nav></header>
<main>${sections}</main>
<script>
// a player only while its card is near the screen: each demo runs its own WebGL world.
// It rests on its still frame and plays from the start while the pointer is over the card.
const show = (stage) => {
  const p = stage.querySelector("hyperframes-player");
  if (!p || !p.dataset.ready) return;
  if (stage.closest(".card").classList.contains("playing")) { p.seek(0); p.play(); }
  else { p.pause(); p.seek(Number(stage.dataset.still)); }
};
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const stage = e.target, player = stage.querySelector("hyperframes-player");
    if (e.isIntersecting && !player) {
      const p = document.createElement("hyperframes-player");
      for (const a of ["loop", "muted"]) p.setAttribute(a, "");
      p.addEventListener("ready", () => { p.dataset.ready = "1"; show(stage); }, { once: true });
      p.setAttribute("src", stage.dataset.src);
      stage.append(p);
    } else if (!e.isIntersecting && player) player.remove();
  }
}, { rootMargin: "150px 0px" });
for (const card of document.querySelectorAll(".card")) {
  const stage = card.querySelector(".stage");
  io.observe(stage);
  const set = (on) => { card.classList.toggle("playing", on); show(stage); };
  card.addEventListener("mouseenter", () => set(true));
  card.addEventListener("mouseleave", () => set(false));
  // touch screens have no hover: a tap plays, the next one stops
  card.addEventListener("click", (ev) => { if (ev.pointerType !== "mouse") set(!card.classList.contains("playing")); });
}
</script></body></html>`;
}

// ---------------------------------------------------------------- serve
function hyperframesModules() {
  const bin = spawnSync("sh", ["-c", "readlink -f \"$(command -v hyperframes)\""], { encoding: "utf8" }).stdout.trim();
  for (let d = bin; d && d !== path.dirname(d); d = path.dirname(d)) if (path.basename(d) === "node_modules") return d;
  return null;
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff",
  ".mp4": "video/mp4", ".wav": "audio/wav", ".mp3": "audio/mpeg" };

// the composition page for the player: the timeline registry and the runtime in the head
const withRuntime = (html) => html.includes("hyperframes-runtime.js") ? html
  : html.replace(/<head[^>]*>/i, (m) => `${m}<script>window.__timelines = window.__timelines || {};</script><script src="/vendor/hyperframes-runtime.js"></script>`);

function serve() {
  const nm = hyperframesModules();
  if (!nm) console.log("gallery: hyperframes is not on the PATH – the players need its runtime");
  const vendor = nm && {
    "/vendor/hyperframes-player.js": path.join(nm, "@hyperframes/player/dist/hyperframes-player.global.js"),
    "/vendor/hyperframes-runtime.js": path.join(nm, "hyperframes/dist/hyperframe.runtime.iife.js"),
  };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = vendor?.[url] ?? path.join(OUT, url === "/" ? "index.html" : url);
    if (!vendor?.[url] && !file.startsWith(OUT + path.sep) && file !== path.join(OUT, "index.html")) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(404).end("not found"); return; }
    const type = TYPES[path.extname(file)] ?? "application/octet-stream";
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "no-cache");
    if (type.startsWith("text/html") && url !== "/") { res.end(withRuntime(fs.readFileSync(file, "utf8"))); return; }
    fs.createReadStream(file).pipe(res);
  });
  server.listen(PORT, () => console.log(`gallery on http://localhost:${server.address().port}`));
}

await buildAll();
fs.writeFileSync(path.join(OUT, "index.html"), page());
if (!flag("--no-serve")) serve();
