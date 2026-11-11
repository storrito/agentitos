#!/usr/bin/env node
// workflow-diagram: a workflow as a page of a few cards, from a
// workflow.json the agent writes. The look is style/style.css and
// style/icons/ beside this folder; nothing of it is decided here.
//
//   diagram.mjs build <workflow.json> [--out <folder>]
//   diagram.mjs picture <workflow.json> [--width <px>] [--out <file.png>]
//   diagram.mjs icons

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const skill = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const styleDir = path.join(skill, 'style');
const iconDir = path.join(styleDir, 'icons');

const HELP = `workflow-diagram: a workflow as a page of a few cards, for a phone as for a wide screen.

  diagram.mjs build <workflow.json> [--out <folder>]
      writes index.html beside the JSON (or into --out): the page the person opens.
  diagram.mjs picture <workflow.json> [--width <px>] [--out <file.png>]
      builds, then takes a picture of the page as it looks at that width
      (390, a phone, by default; 1400 for a wide screen): for you to look at, or
      for where a page cannot go (a message, a document). Needs Chrome.
  diagram.mjs icons
      the names an "icon" can take.

workflow.json:
  {"lang": "en",                       en or de; another language brings "labels"
   "title": "How a Story gets made",
   "subtitle": "You do two small things. Everything else happens by itself.",
   "steps": [                          2 to 6
     {"who": "you",                    you | auto | event (something outside happens)
      "icon": "folder",
      "title": "Drop a folder in Dropbox",
      "text": "Put a video into a new folder in **Instagram Stories**.",
      "items": ["Instagram Story", "Facebook page"],      optional, up to 5
      "chips": ["11:00", "13:00"],                         optional, up to 6
      "small": "You get a message with the exact time.",  optional
      "note": {"title": "Want something different?",      optional
               "text": "Write what should change."}}],
   "promise": "Nothing goes online without your OK.",     optional
   "labels": {"you": "…", "auto": "…", "event": "…",      only for other languages:
              "youKey": "…", "autoKey": "…", "eventKey": "…"}}   the card's word, the legend's

**bold** is the only markup; everything else is shown as written.`;

const LABELS = {
  en: { you: 'You', auto: 'Automatic', event: 'When', youKey: 'You do this', autoKey: 'Happens automatically', eventKey: 'When this happens' },
  de: { you: 'Du', auto: 'Automatisch', event: 'Wenn', youKey: 'Das machst du', autoKey: 'Passiert automatisch', eventKey: 'Wenn das passiert' },
};
const ROLES = ['event', 'you', 'auto'];

// Words a person who is not technical does not know: the tool names them, the agent rewrites.
const JARGON = ['webhook', 'hook', 'api', 'cron', 'json', 'trigger', 'slot', 'token', 'endpoint', 'polling', 'payload', 'composio'];

// The most a card holds before it stops being read at a glance.
const MAX = { title: 60, subtitle: 110, promise: 90, stepTitle: 34, text: 170, item: 40, items: 5, chip: 14, chips: 6, small: 80, noteTitle: 40, noteText: 150 };

function fail(lines) {
  for (const line of [].concat(lines)) console.error(line);
  process.exit(1);
}

function iconNames() {
  return fs.readdirSync(iconDir).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)).sort();
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const plain = (s) => String(s).replace(/\*\*/g, '');
const shown = (file) => path.relative(process.cwd(), file) || file;

function check(spec) {
  const problems = [];
  const warnings = [];
  const text = (value, name, max, required) => {
    if (value === undefined || value === null || value === '') {
      if (required) problems.push(`${name} is missing: write it.`);
      return;
    }
    if (typeof value !== 'string') return problems.push(`${name} must be a text.`);
    const n = plain(value).length;
    if (n > max) problems.push(`${name} has ${n} characters, at most ${max} fit: say it shorter ("${plain(value).slice(0, 40)}…").`);
    const words = plain(value).toLowerCase().split(/[^a-zäöüß]+/);
    for (const j of JARGON) if (words.includes(j)) warnings.push(`${name} says "${j}": say what the person notices instead, unless it is their own word.`);
  };

  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) return { problems: ['The file must hold one map: {"title": …, "steps": […]}.'], warnings };
  const lang = spec.lang || 'en';
  if (!LABELS[lang]) {
    const l = spec.labels || {};
    const missing = Object.keys(LABELS.en).filter((k) => typeof l[k] !== 'string' || !l[k]);
    if (missing.length) problems.push(`"lang": "${lang}" has no built-in words: give "labels" with ${missing.join(', ')} in that language.`);
  }
  text(spec.title, 'title', MAX.title, true);
  text(spec.subtitle, 'subtitle', MAX.subtitle, false);
  text(spec.promise, 'promise', MAX.promise, false);

  const steps = spec.steps;
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 6) {
    const n = Array.isArray(steps) ? steps.length : 0;
    problems.push(`steps must be 2 to 6 cards, this has ${n}: ${n > 6 ? 'join what the person does not notice into one step.' : 'say what starts it and what comes out.'}`);
    return { problems, warnings };
  }
  const icons = iconNames();
  steps.forEach((step, i) => {
    const at = `step ${i + 1}`;
    if (typeof step !== 'object' || step === null) return problems.push(`${at} must be a map: {"who": …, "icon": …, "title": …}.`);
    if (!ROLES.includes(step.who)) problems.push(`${at}: "who" must be one of ${ROLES.join(', ')}.`);
    if (!icons.includes(step.icon)) problems.push(`${at}: no icon "${step.icon}": take one of ${icons.join(', ')}.`);
    text(step.title, `${at} title`, MAX.stepTitle, true);
    text(step.text, `${at} text`, MAX.text, false);
    text(step.small, `${at} small`, MAX.small, false);
    for (const [key, max, each] of [['items', MAX.items, MAX.item], ['chips', MAX.chips, MAX.chip]]) {
      if (step[key] === undefined) continue;
      if (!Array.isArray(step[key])) { problems.push(`${at}: "${key}" must be a list of texts.`); continue; }
      if (step[key].length > max) problems.push(`${at}: ${step[key].length} ${key}, at most ${max} fit.`);
      step[key].forEach((v, k) => text(v, `${at} ${key} ${k + 1}`, each, true));
    }
    if (step.note !== undefined) {
      if (typeof step.note !== 'object' || step.note === null) problems.push(`${at}: "note" must be {"title": …, "text": …}.`);
      else { text(step.note.title, `${at} note title`, MAX.noteTitle, false); text(step.note.text, `${at} note text`, MAX.noteText, true); }
    }
  });
  return { problems, warnings };
}

const SHIELD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2L20 5V11C20 16 16.5 20 12 22C7.5 20 4 16 4 11V5z"/><path d="M8 12l3 3 5-6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function page(spec) {
  const lang = spec.lang || 'en';
  const labels = { ...(LABELS[lang] || {}), ...(spec.labels || {}) };
  const steps = spec.steps;
  const cols = steps.length <= 4 ? steps.length : 3;
  const used = ROLES.filter((r) => steps.some((s) => s.who === r));
  const icon = (name) => fs.readFileSync(path.join(iconDir, `${name}.svg`), 'utf8').trim().replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" ');

  const card = (step, i) => {
    const body = [`<h2>${rich(step.title)}</h2>`];
    if (step.text) body.push(`<p>${rich(step.text)}</p>`);
    if (step.items?.length) body.push(`<ul class="items">${step.items.map((v) => `<li>${rich(v)}</li>`).join('')}</ul>`);
    if (step.chips?.length) body.push(`<div class="chips">${step.chips.map((v) => `<span>${esc(v)}</span>`).join('')}</div>`);
    if (step.small) body.push(`<p class="small">${rich(step.small)}</p>`);
    if (step.note) body.push('<div class="grow"></div>', `<div class="note">${step.note.title ? `<b>${rich(step.note.title)}</b> ` : ''}${rich(step.note.text)}</div>`);
    return `<li class="card ${step.who}">
      <div class="num">${i + 1}</div>
      <div class="who">${esc(labels[step.who])}</div>
      <div class="icon">${icon(step.icon)}</div>
      <div class="body">
        ${body.join('\n        ')}
      </div>
    </li>`;
  };

  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(plain(spec.title))}</title>
<!-- Built by workflow-diagram from workflow.json: change that file and build again, never this one. -->
<style>
${fs.readFileSync(path.join(styleDir, 'style.css'), 'utf8').trim()}
</style>
</head>
<body>
<main class="page" data-cols="${cols}">
  <h1>${rich(spec.title)}</h1>${spec.subtitle ? `\n  <p class="sub">${rich(spec.subtitle)}</p>` : ''}
  <div class="key">${used.map((r) => `<span class="${r}"><i></i>${esc(labels[`${r}Key`])}</span>`).join('')}</div>
  <ol class="steps">
    ${steps.map(card).join('\n    ')}
  </ol>${spec.promise ? `\n  <div class="promise"><span class="shield">${SHIELD}</span><span>${rich(spec.promise)}</span></div>` : ''}
</main>
</body>
</html>
`;
}

function chrome() {
  const named = process.env.CHROME_PATH;
  if (named) return fs.existsSync(named) ? named : null;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      const file = path.join(dir, name);
      if (dir && fs.existsSync(file)) return file;
    }
  }
  return null;
}

// A picture of the page as a browser of that width shows it, as tall as the page is.
function picture(html, png, width) {
  const bin = chrome();
  if (!bin) fail('No browser to take the picture: google-chrome is not on this machine (or CHROME_PATH names no file). The page itself is built; open that.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-diagram-'));
  const base = ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${path.join(tmp, 'profile')}`];
  try {
    // How tall the page is at this width: asked of a copy of it in a frame of
    // exactly that width, since Chrome gives a page it only reads (--dump-dom)
    // a window of at least 500 px and less than the height asked for, and
    // only a picture the size it was told. The copy says its height to the
    // frame's page, whose text Chrome prints.
    fs.writeFileSync(path.join(tmp, 'measure.html'), fs.readFileSync(html, 'utf8').replace('</body>',
      '<script>parent.postMessage(Math.ceil(document.querySelector(".page").getBoundingClientRect().height), "*")</script>\n</body>'));
    const frame = path.join(tmp, 'frame.html');
    fs.writeFileSync(frame, `<!doctype html><body style="margin:0"><script>addEventListener("message", (e) => { document.documentElement.dataset.height = e.data; })</script><iframe src="measure.html" style="display:block;border:0;width:${width}px;height:1000px"></iframe></body>`);
    const dom = spawnSync(bin, [...base, '--window-size=2600,1200', '--virtual-time-budget=2000', '--dump-dom', pathToFileURL(frame).href], { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
    const height = Number(/data-height="(\d+)"/.exec(dom.stdout || '')?.[1]);
    if (!height) fail(`The browser did not open the page (${(dom.stderr || dom.error?.message || 'no answer').trim().split('\n').pop()}): run the command again.`);
    fs.rmSync(png, { force: true });
    spawnSync(bin, [...base, '--force-device-scale-factor=2', `--window-size=${width},${height}`, `--screenshot=${png}`, pathToFileURL(html).href], { encoding: 'utf8', timeout: 60000 });
    if (!fs.existsSync(png)) fail('The browser took no picture: run the command again.');
    return height;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function options(args, known) {
  const got = { file: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (known.includes(a)) { got[a.slice(2)] = args[++i]; if (!got[a.slice(2)]) fail(`${a} needs a value.`); }
    else if (a.startsWith('--')) fail(`No option "${a}" here: ${known.join(', ') || 'none'} (diagram.mjs --help).`);
    else if (!got.file) got.file = a;
    else fail(`One workflow at a time: "${a}" is one too many.`);
  }
  if (!got.file) fail('Name the workflow\'s JSON: diagram.mjs build <workflow.json>.');
  return got;
}

function build(file, folder) {
  if (!fs.existsSync(file)) fail(`${file} does not exist: write it first (diagram.mjs --help shows its shape).`);
  let spec;
  try { spec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { fail(`${file} is not valid JSON (${e.message}): fix it and build again.`); }
  const { problems, warnings } = check(spec);
  if (problems.length) fail([...problems, `Nothing built: fix ${file} and build again.`]);
  folder = path.resolve(folder || path.dirname(file));
  fs.mkdirSync(folder, { recursive: true });
  const html = path.join(folder, 'index.html');
  fs.writeFileSync(html, page(spec));
  console.log(`wrote ${shown(html)}`);
  for (const w of warnings) console.log(`check: ${w}`);
  return html;
}

const [command, ...args] = process.argv.slice(2);
if (!command || command === '--help' || command === '-h' || command === 'help') {
  console.log(HELP);
} else if (command === 'icons') {
  console.log(iconNames().join('\n'));
} else if (command === 'build') {
  const got = options(args, ['--out']);
  build(got.file, got.out);
  console.log('Next: show the person the page (a button that opens index.html beside the chat).');
} else if (command === 'picture') {
  const got = options(args, ['--width', '--out']);
  const width = got.width === undefined ? 390 : Number(got.width);
  if (!Number.isInteger(width) || width < 320 || width > 2400) fail('--width is the width of the screen in px, 320 to 2400: 390 for a phone, 1400 for a wide screen.');
  const html = build(got.file, null);
  const png = path.resolve(got.out || path.join(path.dirname(html), `workflow-${width}.png`));
  const height = picture(html, png, width);
  console.log(`wrote ${shown(png)} (the page at ${width} px wide, ${height} px tall; the file at 2×)`);
} else {
  fail(`No command "${command}": build, picture or icons (diagram.mjs --help).`);
}
