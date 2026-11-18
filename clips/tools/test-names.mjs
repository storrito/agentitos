// What `episode.mjs names` decides around the model's answer, on made-up transcripts and pages:
// no model, no network (a stand-in answers for OpenRouter).
//
//   node --test tools/test-names.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pageOf, pageSources, ownTokens, fold, sounds, onPage, locate, entriesOf, applyNames, clipFixes, namesPrompt, namesListing, APPLY_SOUND, REFUSE_SOUND } from "./lib/names.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// words from sentences of text: each word 0.3 s, 0.2 s between sentences; a sentence is
// [voice, text]; returns { words, sentences } as episode.mjs builds them
function episodeOf(lines) {
  const words = [], sentences = [];
  let t = 0;
  for (const [speaker, text] of lines) {
    const first = words.length;
    for (const w of text.split(" ")) { words.push({ text: w, start: +t.toFixed(2), end: +(t + 0.3).toFixed(2), kind: "word", speaker }); t += 0.3; }
    sentences.push({ first, last: words.length - 1, start: words[first].start, end: words.at(-1).end, speaker, text });
    t += 0.2;
  }
  return { words, sentences };
}

const TALK = episodeOf([
  ["A", "So in Gonzo Girl you play Walker Reed, a fictionalized Hunter Thompson."], // 0
  ["B", "Robert Eggers' Werewolf comes out on December 25th."],                        // 1
  ["A", "Why, Miller?"],                                                              // 2  "mother" was said
  ["B", "My mother called me about the werewolf."],                                   // 3  ordinary words
  ["A", "Reed, you were great in it."],                                               // 4  the same misspelling again
  ["B", "Even J Lo laughed at that."],                                                 // 5  JLaw
  ["A", "For First We Feast I'm Sean Evans."],                                         // 6
  ["B", "Patricia Arquette's debut, with licences from Andoran Tubik oder Kanaki."],  // 7
  ["A", "Lilith Wittmann was there and hot ones too."],                               // 8
]);
const PAGE = pageOf({
  title: "Willem Dafoe | Hot Ones", channel: "First We Feast",
  description: "Robert Eggers' Werwulf on December 25th. Gonzo Girl, Patricia Arquette's debut. JLaw joins. Lilith Wittmann.\nBUY NOW: https://hotones.com/x?y=1",
  chapters: [{ title: "Hot Ones intro" }], tags: ["hot ones", "curaçao"],
}, ["Reade"]);
const SOURCES = pageSources(PAGE);
const fix = (sentence, written, right, sure = "high", more = {}) => ({ sentence, written, right, kind: "person", where: "description", sure, why: "w", ...more });
const NAMES = [{ name: "Werwulf", kind: "work", where: "description" }, { name: "Lilith Wittmann", kind: "person", where: "description" }, { name: "Reade", kind: "person", where: "captions" }];
const judged = (fixes) => entriesOf({ names: NAMES, fixes }, TALK.words, TALK.sentences, SOURCES);
const one = (fixes) => { const e = judged(fixes); assert.equal(e.length, 1, JSON.stringify(e)); return e[0]; };

test("sound: a misspelt name sounds like the name, an ordinary rewrite does not", () => {
  for (const [a, b] of [["Reed", "Reade"], ["Werewolf", "Werwulf"], ["Vitmann", "Wittmann"], ["Klugspiel-Lizenzen", "Glücksspiel-Lizenzen"], ["Kurosawa", "Curaçao"], ["J Lo", "JLaw"]]) {
    assert.ok(sounds(a, b) >= APPLY_SOUND, `${a} ~ ${b}: ${sounds(a, b)}`);
  }
  assert.ok(sounds("Stakelogic", "Platin") < REFUSE_SOUND);
  assert.equal(fold("Curaçao Straße"), "curacaostrasse");
});

test("the page: the description without links, chapters, tags and the own captions' words, in their order of trust", () => {
  assert.doesNotMatch(PAGE.description, /https?:/);
  assert.deepEqual(SOURCES.map((s) => s.label), ["the title", "the channel", "the description", "the chapters", "the tags", "its own captions"]);
  assert.equal(onPage("Werwulf", SOURCES), "the description");
  assert.equal(onPage("Werwulf's", SOURCES), "the description", "a name with an ending the page does not write");
  assert.equal(onPage("Reade", SOURCES), "its own captions");
  assert.equal(onPage("Curaçao", SOURCES), "the tags", "case aside, the accents count");
  assert.equal(onPage("Curacao", SOURCES), null);
  assert.equal(onPage("Kanaki", SOURCES), null);
  // what the own captions write that the transcript never does: capitalised inside a sentence
  const own = ownTokens([{ text: "you" }, { text: "play" }, { text: "Walker" }, { text: "Reade," }, { text: "done." }, { text: "Next" }], TALK.words);
  assert.deepEqual(own, ["Reade"]);
});

test("locate: the written words in their sentence, without case or punctuation", () => {
  assert.deepEqual(locate(TALK.words, TALK.sentences[0], "walker reed"), [6, 7]);
  assert.equal(locate(TALK.words, TALK.sentences[1], "Reed"), null);
});

test("applied: the page writes the name, only the spelling differs, every place of the same misspelling", () => {
  const e = one([fix(0, "Reed", "Reade")]);
  assert.equal(e.status, "applied");
  assert.equal(e.where, "its own captions");
  assert.deepEqual(e.places.map((p) => p.sentence), [0, 4], "the same misspelling in sentence 4 too");
  // one word for two: J Lo → JLaw
  assert.equal(one([fix(5, "J Lo", "JLaw")]).status, "applied");
  // the transcript writes "werewolf" in lower case elsewhere (the creature): the film only proposed
  const film = one([fix(1, "Werewolf", "Werwulf")]);
  assert.equal(film.status, "proposed");
  assert.match(film.because, /"Werewolf" is an ordinary word in this transcript/);
});

test("never an ordinary word made a name, and a name for an ordinary word only proposed", () => {
  // the transcript writes "mother" in lower case: a model that wants a name of it is never applied
  const bad = one([fix(3, "mother", "Miller")]);
  assert.notEqual(bad.status, "applied");
  // "werewolf" in lower case in sentence 3 is the creature: not the film's places
  const film = one([fix(1, "Werewolf", "Werwulf")]);
  assert.deepEqual(film.places.map((p) => p.sentence), [1]);
  // a name heard for a word ("Why, Miller?" for "Why, mother?"): proposed, doubtful
  const word = one([fix(2, "Miller", "mother", "low", { kind: "word" })]);
  assert.equal(word.status, "proposed");
  assert.equal(word.sure, "doubtful");
  assert.match(word.because, /ordinary word, not a name/);
});

test("refused: what would change what was said, and a name already right", () => {
  const why = (f) => { const e = one([f]); assert.equal(e.status, "refused", JSON.stringify(e)); return e.refused; };
  assert.match(why(fix(6, "First We Feast I'm", "First We Feast")), /leaves out words/);
  assert.match(why(fix(7, "Arquette's", "Arquette")), /ending/);
  assert.match(why(fix(0, "Reed", "Platin")), /does not sound like/);
  assert.match(why(fix(1, "Werewolf", "Werwulf of the Night")), /more or fewer words/);
  assert.match(why(fix(8, "Wittmann", "Whitman")), /writes it so already/);
  assert.match(why(fix(4, "Hunter", "Hunter")), /not in sentence/);
});

test("proposed: the model's knowledge, a case alone, a model not sure; the words that stay split a correction", () => {
  const known = judged([fix(7, "Andoran Tubik oder Kanaki", "Anjouan Tobique oder Kahnawake", "medium", { where: "knowledge" })]);
  assert.deepEqual(known.map((e) => [e.from, e.to, e.status]), [["Andoran", "Anjouan", "proposed"], ["Tubik", "Tobique", "proposed"], ["Kanaki", "Kahnawake", "proposed"]]);
  assert.match(known[0].because, /the model's knowledge/);
  // a piece that is no name keeps the run together; one ordinary word for another is refused
  const malta = episodeOf([["A", "Die Lizenz kam aus'm Alter, sagt sie."]]);
  const m = entriesOf({ names: [], fixes: [fix(0, "aus'm Alter", "aus Malta", "low")] }, malta.words, malta.sentences, SOURCES);
  assert.deepEqual(m.map((e) => [e.from, e.to, e.status]), [["aus'm Alter", "aus Malta", "proposed"]]);
  const swap = entriesOf({ names: [], fixes: [fix(0, "sagt sie", "sagte sie")] }, malta.words, malta.sentences, SOURCES);
  assert.match(swap[0].refused, /no name on either side/);
  const cased = one([fix(8, "hot ones", "Hot Ones")]);
  assert.equal(cased.status, "proposed");
  assert.match(cased.because, /only the case/);
  assert.equal(one([fix(0, "Reed", "Reade", "medium")]).status, "proposed");
  // the list counts and names them
  const text = namesListing({ names: NAMES, entries: judged([fix(0, "Reed", "Reade"), fix(2, "Miller", "mother", "low", { kind: "word" }), fix(6, "First We Feast I'm", "First We Feast")]) }, TALK.words);
  assert.match(text, /1 correction applied, 1 proposed, 1 refused/);
  assert.match(text, /"Reed" → "Reade" \(its own captions; sure\), 2 places: 0:02 “So in Gonzo Girl you play Walker \[Reed, → Reade\] a fictionalized/);
});

test("applying keeps the times and the punctuation, merges two words into one, and is undone from the words as written", () => {
  const entries = judged([fix(0, "Reed", "Reade"), fix(5, "J Lo", "JLaw")]);
  const raw = structuredClone(TALK.words);
  const words = applyNames(raw, entries);
  assert.deepEqual(raw, TALK.words, "the words as written are not changed");
  const reade = words.find((w) => w.was === "Reed,");
  assert.equal(reade.text, "Reade,");
  assert.equal(reade.start, TALK.words[7].start);
  const jlaw = words.find((w) => w.text === "JLaw");
  const [j, lo] = TALK.words.filter((w, i) => i > 0 && (w.text === "J" || (w.text === "Lo" && TALK.words[i - 1].text === "J")));
  assert.deepEqual([jlaw.start, jlaw.end, jlaw.was], [j.start, lo.end, "J Lo"]);
  assert.equal(words.length, TALK.words.length - 1);
  // nothing applied: the words as written
  assert.deepEqual(applyNames(raw, entries.map((e) => ({ ...e, status: "proposed" }))), TALK.words);
});

test("a cut clip: its own words where a correction lies get best-takes' fixes, a word heard otherwise is left to the agent", () => {
  const entries = judged([fix(0, "Reed", "Reade"), fix(5, "J Lo", "JLaw"), fix(1, "Werewolf", "Werwulf")]);
  // the clip is cut from 1.0 s; best-takes wrote its words anew, a little otherwise
  const from = 1.0;
  const at = (i) => ({ start: +(TALK.words[i].start - from + 0.03).toFixed(2), end: +(TALK.words[i].end - from - 0.02).toFixed(2) });
  const reed = TALK.words.findIndex((w) => w.text === "Reed,"), wolf = TALK.words.findIndex((w) => w.text === "Werewolf"), jIdx = TALK.words.findIndex((w) => w.text === "J");
  const clip = [
    { i: 0, text: "Walker", kind: "word", ...at(reed - 1) },
    { i: 1, text: "Reid,", kind: "word", ...at(reed) },
    { i: 2, text: "äh", kind: "filler", ...at(reed + 1) },
    { i: 3, text: "Werwulf", kind: "word", ...at(wolf) },
    { i: 4, text: "Jay", kind: "word", ...at(jIdx) },
    { i: 5, text: "Low", kind: "word", ...at(jIdx + 1) },
  ];
  const r = clipFixes(clip, entries, from);
  assert.deepEqual(r.fixes, { 1: "Reade,", 4: "JLaw", 5: "" });
  assert.equal(r.missed.length, 1, "the second Reed lies outside these words");
  // heard as something else entirely: not fixed, named
  const other = clipFixes([{ i: 0, text: "Banana", kind: "word", ...at(reed) }], entries.filter((e) => e.to === "Reade"), from, 2);
  assert.deepEqual(other.fixes, {});
  assert.equal(other.missed[0].heard, "Banana");
});

test("the prompt holds the page without links and the numbered sentences", () => {
  const p = namesPrompt(PAGE, TALK.sentences);
  assert.match(p, /Werwulf/);
  assert.match(p, /own uploaded captions[^\n]*\n"""\nReade/);
  assert.match(p, /\n5: Even J Lo laughed at that\.\n/);
  assert.doesNotMatch(p, /https?:/);
});

// ---------------------------------------------------------------- the command
async function namesWith(dir, answer, args = []) {
  let calls = 0;
  const server = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url.endsWith("/key")) return res.end("{}");
      calls++;
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: "stop" }], usage: { cost: 0.012, prompt_tokens: 10, completion_tokens: 5 } }));
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const child = spawn(process.execPath, [path.join(HERE, "episode.mjs"), "names", dir, ...args],
    { env: { ...process.env, OPENROUTER_API_KEY: "test", OPENROUTER_BASE_URL: `http://127.0.0.1:${server.address().port}` } });
  let out = "", err = "";
  child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (err += d));
  const status = await new Promise((ok) => child.on("close", ok));
  server.close();
  return { status, out, err, calls };
}

test("names: applies what is sure, writes the list and the words as written, takes and leaves by number without the model", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clips-names-"));
  fs.writeFileSync(path.join(dir, "episode.json"), JSON.stringify({ title: "t", channel: "c" }));
  fs.writeFileSync(path.join(dir, "words.json"), JSON.stringify(TALK.words));
  fs.writeFileSync(path.join(dir, "page.json"), JSON.stringify(PAGE));
  const answer = { names: NAMES, fixes: [fix(0, "Reed", "Reade"), fix(2, "Miller", "mother", "low", { kind: "word" }), fix(0, "Reed", "Platin")] };
  const r = await namesWith(dir, answer);
  assert.equal(r.status, 0, r.out + r.err);
  assert.match(r.out, /1 correction applied, 1 proposed, 1 refused/);
  assert.match(r.out, /Next: episode\.mjs moments/);
  const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  assert.deepEqual(read("words.raw.json"), TALK.words);
  assert.match(fs.readFileSync(path.join(dir, "sentences.txt"), "utf8"), /Walker Reade, a fictionalized/);
  assert.equal(read("names.json").found.length, 3, "the model's own answer is kept");
  // the proposed one taken, the applied one left out: no model asked
  const proposed = read("names.json").entries.find((e) => e.status === "proposed").n;
  const applied = read("names.json").entries.find((e) => e.status === "applied").n;
  const t = await namesWith(dir, answer, ["--take", String(proposed), "--leave", String(applied)]);
  assert.equal(t.status, 0, t.out);
  assert.equal(t.calls, 0);
  const text = fs.readFileSync(path.join(dir, "sentences.txt"), "utf8");
  assert.match(text, /Why, mother\?/);
  assert.match(text, /Walker Reed,/);
  // a refused one is never taken; the error says why in one sentence
  const refused = read("names.json").entries.find((e) => e.status === "refused").n;
  const no = await namesWith(dir, answer, ["--take", String(refused)]);
  assert.equal(no.status, 1);
  assert.match(no.out, /^Correction \d+ is refused \(.*\): it is never applied; a name the tool cannot reach is fixed in the clip's cut\.json "fixes"\.\n$/);
  // asked again, what was taken stays taken
  const again = await namesWith(dir, answer);
  assert.equal(again.calls, 1);
  assert.match(fs.readFileSync(path.join(dir, "sentences.txt"), "utf8"), /Why, mother\?/);
  fs.rmSync(dir, { recursive: true });
});

test("names: without OpenRouter the words stay and the line says so", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clips-names-"));
  fs.writeFileSync(path.join(dir, "words.json"), JSON.stringify(TALK.words));
  const r = await new Promise((ok) => {
    const child = spawn(process.execPath, [path.join(HERE, "episode.mjs"), "names", dir], { env: { ...process.env, OPENROUTER_API_KEY: "", RRAGENT_GATEWAY: "http://127.0.0.1:9" } });
    let out = ""; child.stdout.on("data", (d) => (out += d)); child.on("close", (status) => ok({ status, out }));
  });
  assert.equal(r.status, 1);
  assert.match(r.out, /^No OpenRouter .*the words stay as the transcription wrote them\.\n$/);
  assert.ok(!fs.existsSync(path.join(dir, "words.raw.json")));
  fs.rmSync(dir, { recursive: true });
});
