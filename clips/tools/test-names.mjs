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
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pageOf, pageSources, ownTokens, fold, sounds, onPage, locate, entriesOf, applyNames, clipFixes, namesPrompt, namesListing, parts, APPLY_SOUND, REFUSE_SOUND } from "./lib/names.mjs";

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

test("applied: the page writes the name, only the spelling differs, at the place the model pointed to; the same spelling elsewhere only proposed", () => {
  const [e, other] = judged([fix(0, "Reed", "Reade")]);
  assert.equal(e.status, "applied");
  assert.equal(e.where, "its own captions");
  assert.deepEqual(e.places.map((p) => p.sentence), [0], "one place an entry");
  assert.deepEqual([other.status, other.places.map((p) => p.sentence)], ["proposed", [4]]);
  assert.match(other.because, /not pointed to here/);
  // one word for two: J Lo → JLaw
  assert.equal(one([fix(5, "J Lo", "JLaw")]).status, "applied");
  // the transcript writes "werewolf" in lower case elsewhere (the creature), but the page writes
  // the film with the same words before it ("Robert Eggers' Werwulf"): applied there, only there
  const film = one([fix(1, "Werewolf", "Werwulf")]);
  assert.equal(film.status, "applied");
  assert.deepEqual(film.places.map((p) => p.sentence), [1]);
  // in lower case, as a live transcription wrote it: applied at the page's phrase only
  const live = episodeOf([["B", "And Robert Eggers' werewolf on December 25th."], ["A", "A werewolf howls."]]);
  const l = entriesOf({ names: [], fixes: [fix(0, "werewolf", "Werwulf")] }, live.words, live.sentences, SOURCES);
  assert.deepEqual(l.map((x) => [x.status, x.places.map((p) => p.sentence)]), [["applied", [0]], ["proposed", [1]]]);
  // without the page's words around it, an ordinary word stays proposed
  const bare = entriesOf({ names: [], fixes: [fix(1, "werewolf", "Werwulf")] }, live.words, live.sentences, SOURCES);
  const own = bare.find((x) => x.places[0].sentence === 1);
  assert.equal(own.status, "proposed");
  assert.match(own.because, /"werewolf" is an ordinary word in this transcript/);
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

// The reviewer's inputs (clips-names review, 2026-11-19), the sentences and the model's answers as
// they were: one place pointed to, the same spelling elsewhere meaning another name or a noun
test("the same spelling where the model did not point is never applied: Lou Reed, An American Werewolf, the noun Flair", () => {
  const dafoe = episodeOf([
    ["B", "So in Gonzo Girl you play Walker Reed, a slightly fictionalized Hunter S."],
    ["B", "This year alone, you can catch him in Robert Eggers' Werewolf on December 25th."],
    ["A", "I grew up on Lou Reed records."],
    ["A", "Lou Reed was my hero, and An American Werewolf in London scared me."],
  ]);
  const page = pageSources(pageOf({ title: "Willem Dafoe | Hot Ones", description: "Robert Eggers' Werwulf on December 25th." }, ["Reade", "Werwulf"]));
  const d = entriesOf({ names: [], fixes: [fix(0, "Reed", "Reade"), fix(1, "Werewolf", "Werwulf")] }, dafoe.words, dafoe.sentences, page, { lang: "en" });
  const applied = applyNames(dafoe.words, d).map((w) => w.text).join(" ");
  assert.match(applied, /Walker Reade, /);
  assert.match(applied, /Eggers' Werwulf on/);
  assert.match(applied, /Lou Reed records\. Lou Reed was/);
  assert.match(applied, /An American Werewolf in London/);
  assert.equal(d.filter((e) => e.status === "applied").length, 2);
  // German: the noun said ("den Flair so ein bisschen") beside the rapper ("mit Flair, Ghetto Sport")
  const rap = episodeOf([
    ["A", "dann habe ich halt viel Klamotten gemacht mit Flair äh haben wir damals Ghetto Sport gemacht."],
    ["D", "Also natürlich auch noch so den Flair so ein bisschen."],
  ]);
  const tags = pageSources(pageOf({ title: "Prinz Pi | Hiphop.de Talks", tags: ["Fler", "Kollegah"] }));
  const g = entriesOf({ names: [], fixes: [fix(0, "mit Flair", "mit Fler")] }, rap.words, rap.sentences, tags, { lang: "de" });
  assert.deepEqual(g.map((e) => [e.status, e.places[0].sentence]), [["applied", 0], ["proposed", 1]], "the pointed place applied, the noun's place only proposed");
  assert.match(applyNames(rap.words, g).map((w) => w.text).join(" "), /mit Fler äh .* den Flair so/);
});

test("a word that is part of a longer name is not that name by itself: no Tinashe Mongeau", () => {
  // the review's input (gYEAdTt5-j8): the speech model wrote the guest Tinashe as "Tana Mongeau"
  const ep = episodeOf([
    ["B", "Tana Mongeau, welcome to Call Her Daddy."],
    ["B", "And when Tana Mongeau came out, the pregame was never the same."],
    ["C", "We're all like, what is Tana doing and whose car is that?"],
  ]);
  const page = pageSources(pageOf({ title: "Tinashe | Call Her Daddy" }));
  const fixes = [fix(0, "Tana Mongeau", "Tinashe"), fix(1, "Tana Mongeau", "Tinashe"), fix(2, "Tana", "Tinashe")];
  const e = entriesOf({ names: [], fixes }, ep.words, ep.sentences, page, { lang: "en" });
  const taken = applyNames(ep.words, e.map((x) => (x.status === "proposed" ? { ...x, status: "applied" } : x))).map((w) => w.text).join(" ");
  assert.doesNotMatch(taken, /Tinashe Mongeau/, "every proposal taken: still no Tinashe Mongeau");
  assert.match(taken, /what is Tinashe doing/);
  assert.equal(e.filter((x) => /part of the longer name "Tana Mongeau"/.test(x.refused || "")).length, 2);
  // the same for a spelling elsewhere beside another first name or inside a title
  const lou = episodeOf([["B", "You play Walker Reed, right?"], ["A", "I grew up on Lou Reed records."]]);
  const l = entriesOf({ names: [], fixes: [fix(0, "Reed", "Reade")] }, lou.words, lou.sentences, pageSources(pageOf({ title: "x" }, ["Reade"])), { lang: "en" });
  assert.match(l.find((x) => x.status === "refused").refused, /"Lou Reed"/);
});

test("the lower-case rule needs the page to write the name, not any word of that spelling; in German it is off", () => {
  // the review's probe: a page that writes the ordinary word "fall"
  const ep = episodeOf([["A", "After the fahl of the empire everything changed."]]);
  const fall = entriesOf({ names: [], fixes: [fix(0, "fahl", "Fall")] }, ep.words, ep.sentences, pageSources(pageOf({ title: "x", description: "After the fall of the empire, a documentary." })), { lang: "en" });
  assert.equal(fall[0].status, "proposed");
  // the name at the start of a sentence of the description is no name either
  const opens = entriesOf({ names: [], fixes: [fix(0, "fahl", "Fall")] }, ep.words, ep.sentences, pageSources(pageOf({ title: "x", description: "Watch it. Fall of the empire, after the war." })), { lang: "en" });
  assert.equal(opens[0].status, "proposed");
  // the name as the page writes it, inside a sentence: applied
  const name = episodeOf([["B", "And Robert Eggers' werewolf on December 25th."]]);
  const desc = pageSources(pageOf({ title: "x", description: "Catch him in Robert Eggers' Werwulf on December 25th." }));
  assert.equal(entriesOf({ names: [], fixes: [fix(0, "werewolf", "Werwulf")] }, name.words, name.sentences, desc, { lang: "en" })[0].status, "applied");
  // German: a capital on the page does not tell a name from a noun, so the rule does not lift
  const de = episodeOf([["A", "Das war so, weil Kurt das wollte."]]);
  const weil = entriesOf({ names: [], fixes: [fix(0, "weil", "Weill")] }, de.words, de.sentences, pageSources(pageOf({ title: "x", description: "Über so Weill Kurt das Werk." })), { lang: "de" });
  assert.equal(weil[0].status, "proposed");
  assert.match(weil[0].because, /capitalises its nouns/);
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
  assert.equal(judged([fix(0, "Reed", "Reade", "medium")])[0].status, "proposed");
  // the list counts and names them
  const text = namesListing({ names: NAMES, entries: judged([fix(0, "Reed", "Reade"), fix(2, "Miller", "mother", "low", { kind: "word" }), fix(6, "First We Feast I'm", "First We Feast")]) }, TALK.words);
  assert.match(text, /1 correction applied, 2 proposed, 1 refused/);
  assert.match(text, /"Reed" → "Reade" \(its own captions; sure\), at 0:02, sentence 0: “So in Gonzo Girl you play Walker \[Reed, → Reade\] a fictionalized/);
  // an entry of several places (a list from before) shows every one of them
  const two = { ...judged([fix(0, "Reed", "Reade")])[0] };
  two.places = [two.places[0], { ...two.places[0], sentence: 4, first: TALK.sentences[4].first, last: TALK.sentences[4].first }];
  const both = namesListing({ names: [], entries: [two] }, TALK.words);
  assert.match(both, /at 2 places:\n {8}0:02, sentence 0: “So in Gonzo Girl[^\n]*\n {8}0:02, sentence 4: “…[^\n]*werewolf\. \[Reed, → Reade\] you were great/);
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
  assert.equal(r.missed.length, 0, "the second Reed is not applied, so nothing to map");
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
// the second look's answer for a request: every place asked about, "yes" unless `look` says else
// (look: id → "no" | "unsure"), by the numbers in its prompt
const LOOKS = [];
function lookAnswer(body, look = {}) {
  const prompt = JSON.parse(body).messages[0].content;
  LOOKS.push(prompt);
  const ids = [...prompt.matchAll(/^(\d+)\. NAME: /gm)].map((m) => Number(m[1]));
  return { places: ids.map((id) => ({ id, who: "the one on the page", same: look[id] || "yes", why: "w" })) };
}
const isLook = (body) => JSON.parse(body).response_format?.json_schema?.name === "look";

async function namesWith(dir, answer, args = [], look = {}) {
  let calls = 0;
  const server = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url.endsWith("/key")) return res.end("{}");
      calls++;
      const content = isLook(body) ? (look === null ? {} : lookAnswer(body, typeof look === "function" ? look(body) : look)) : answer;
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }], usage: { cost: 0.012, prompt_tokens: 10, completion_tokens: 5 } }));
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
  assert.match(r.out, /1 correction applied, 2 proposed, 1 refused/);
  assert.match(r.out, /Next: episode\.mjs moments/);
  assert.match(r.out, /Each entry is one place\. The proposed ones are not applied and never will be by themselves: take one only where its sentence shows that name was said there/);
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
  assert.equal(again.calls, 2, "the names and their second look");
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

// ---------------------------------------------------------------- fetch, start to end
// fetch on a link with stand-ins: a yt-dlp on the PATH that answers from files (the page, the
// sound, the video's own captions) or refuses, and an OpenRouter that writes the words down and
// answers the names (or answers nothing usable). No network, no model.
const STUB = `#!/usr/bin/env node
const fs = require("fs"), a = process.argv.slice(2), o = a[a.indexOf("-o") + 1];
fs.appendFileSync(process.env.STUB_LOG, a.join(" ") + "\\n");
if (a.includes("-J")) {
  if (process.env.STUB_INFO === "refuse") { console.error("ERROR: [youtube] abc: Video unavailable. This content isn't available."); process.exit(1); }
  process.stdout.write(fs.readFileSync(process.env.STUB_INFO, "utf8"));
} else if (a.includes("--write-subs")) {
  fs.writeFileSync(o + ".en.json3", JSON.stringify({ events: [{ tStartMs: 200, dDurationMs: 3000, segs: [{ utf8: "you play Walker Reade, then Hunter." }] }] }));
} else fs.copyFileSync(process.env.STUB_AUDIO, o.replace("%(ext)s", "m4a"));
`;
const HEARD = [["you", 0.3, 0.5], ["play", 0.55, 0.8], ["Walker", 0.9, 1.3], ["Reed,", 1.35, 1.7], ["then", 1.9, 2.1], ["Hunter.", 2.2, 2.7]];

async function fetchWith({ info, names }, args = []) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clips-fetch-"));
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "yt-dlp"), STUB, { mode: 0o755 });
  const audio = path.join(tmp, "sound.m4a");
  // three seconds of a tone between pauses, where the words lie
  spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=220:duration=3.2", "-af", "volume='if(between(t,0.25,2.8),1,0.001)':eval=frame", "-c:a", "aac", audio]);
  let infoFile = "refuse";
  if (info) { infoFile = path.join(tmp, "info.json"); fs.writeFileSync(infoFile, JSON.stringify(info)); }
  let chats = 0;
  const server = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url.endsWith("/key")) return res.end("{}");
      if (req.url.endsWith("/audio/transcriptions")) return res.end(JSON.stringify({ words: HEARD.map(([word, start, end]) => ({ word, start, end, type: "word", speaker: "0" })), usage: { cost: 0.0011 } }));
      chats++;
      const content = isLook(body) ? JSON.stringify(lookAnswer(body)) : typeof names === "string" ? names : JSON.stringify(names);
      res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { cost: 0.002 } }));
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const dir = path.join(tmp, "episode");
  const r = await new Promise((ok) => {
    const child = spawn(process.execPath, [path.join(HERE, "episode.mjs"), "fetch", "https://www.youtube.com/watch?v=abcdefghijk", dir, ...args], { env: { ...process.env,
      PATH: `${bin}:${process.env.PATH}`, STUB_INFO: infoFile, STUB_AUDIO: audio, STUB_LOG: path.join(tmp, "calls.log"),
      OPENROUTER_API_KEY: "test", OPENROUTER_BASE_URL: `http://127.0.0.1:${server.address().port}` } });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (err += d));
    child.on("close", (status) => ok({ status, out, err }));
  });
  server.close();
  const read = (f) => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) : null);
  const result = { ...r, chats, calls: fs.readFileSync(path.join(tmp, "calls.log"), "utf8"), page: read("page.json"), words: read("words.json"), raw: read("words.raw.json"), list: read("names.json") };
  fs.rmSync(tmp, { recursive: true });
  return result;
}
const INFO = { id: "abcdefghijk", title: "Dafoe | Hot Ones", channel: "First We Feast", duration: 3, language: "en", subtitles: { en: [{ ext: "json3" }] }, automatic_captions: { "en-orig": [] } };
const READE = { names: [{ name: "Reade", kind: "person", where: "captions" }], fixes: [fix(0, "Reed", "Reade")] };

test("fetch: a page without a description still gives the names their page (the own captions), the cost of the words and of the names", async () => {
  const r = await fetchWith({ info: INFO, names: READE });
  assert.equal(r.status, 0, r.out + r.err);
  assert.equal(r.page.description, "");
  assert.deepEqual(r.page.own, ["Reade"], "the own captions' word the transcript never writes");
  assert.match(r.calls, /--write-subs --sub-langs en /, "the video's own captions, not the automatic ones");
  assert.match(r.out, /\(\$0\.00\d+ for the words\)/);
  assert.match(r.out, /1 correction applied, 0 proposed, 0 refused/);
  assert.match(r.out, /\(\$0\.0040\)/, "the names and their second look");
  assert.equal(r.words.find((w) => w.was).text, "Reade,");
  assert.equal(r.raw.find((w) => w.text === "Reed,").start, r.words.find((w) => w.was).start);
});

test("fetch: YouTube refuses the page's facts: the words still come, the names go by no page, the line says so", async () => {
  const r = await fetchWith({ info: null, names: READE });
  assert.equal(r.status, 0, r.out + r.err);
  assert.ok(r.words.length >= HEARD.length);
  assert.match(r.out, /YouTube gave no facts of the video \(title, description, chapters\): the names had no page to go by\./);
  assert.doesNotMatch(r.calls, /--write-subs/, "no own captions asked for without the facts");
  assert.equal(r.list.entries[0].status, "proposed", "no page: nothing applied by itself");
});

test("fetch: a model answer that is no answer leaves the words as written, in one sentence", async () => {
  const r = await fetchWith({ info: INFO, names: "Here are the names you asked for." });
  assert.equal(r.status, 0, r.out + r.err);
  assert.equal(r.chats, 2, "asked once more, then given up");
  assert.match(r.out, /The names were not checked \(the model gave no list of names twice \(an answer that is not one, \$0\.0040\)\): the words stay as the transcription wrote them; episode\.mjs names \S+ tries again\.\n$/);
  assert.equal(r.raw, null);
  assert.ok(r.words.some((w) => w.text === "Reed,"));
});

test("fetch --no-names: no model call for the names, and the line says how to check them later", async () => {
  const r = await fetchWith({ info: INFO, names: READE }, ["--no-names"]);
  assert.equal(r.status, 0, r.out + r.err);
  assert.equal(r.chats, 0);
  assert.equal(r.list, null);
  assert.match(r.out, /The names were not checked \(--no-names\): the words keep the speech model's spellings; episode\.mjs names \S+ checks them later \(a cent or two\)\.\n$/);
});

// ---------------------------------------------------------------- a prepared clip, the list changed
test("clips.mjs names: after --take or --leave the clip's fixes follow the list, the agent's own stay, and it says to build again", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clips-names-clip-"));
  const episode = path.join(tmp, "episode"), clip = path.join(tmp, "01");
  fs.mkdirSync(episode); fs.mkdirSync(path.join(clip, "takes", "source"), { recursive: true });
  const entries = judged([fix(0, "Reed", "Reade"), fix(1, "Werewolf", "Werwulf")]);
  const list = (status) => fs.writeFileSync(path.join(episode, "names.json"), JSON.stringify({ entries: entries.map((e) => (e.to === "Reade" ? { ...e, status } : e)) }));
  list("applied");
  const reed = TALK.words.findIndex((w) => w.text === "Reed,"), wolf = TALK.words.findIndex((w) => w.text === "Werewolf");
  const words = [reed, wolf, wolf + 1].map((k, i) => ({ i, text: TALK.words[k].text, start: TALK.words[k].start, end: TALK.words[k].end, kind: "word" }));
  fs.writeFileSync(path.join(clip, "takes", "source", "words.json"), JSON.stringify({ words }));
  fs.writeFileSync(path.join(clip, "clip.json"), JSON.stringify({ from: 0, to: 20, range: "0-1", episode }));
  fs.writeFileSync(path.join(clip, "takes", "cut.json"), JSON.stringify({ keep: [{ words: "0-2" }], fixes: { 2: "comes-out" } }));
  const names = () => spawnSync(process.execPath, [path.join(HERE, "clips.mjs"), "names", clip], { encoding: "utf8" });
  const cut = () => JSON.parse(fs.readFileSync(path.join(clip, "takes", "cut.json"), "utf8"));
  let r = names();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(cut().fixes, { 0: "Reade,", 1: "Werwulf", 2: "comes-out" });
  assert.match(r.stdout, /"Reed" → "Reade" \(word 0\), "Werewolf" → "Werwulf" \(word 1\) in cut\.json "fixes"/);
  assert.match(r.stdout, /Next: node \S+takes\.mjs build \S+takes \(the captions and the hook keep their place: only the words' text changes\), then check\./);
  // the agent spells the film otherwise by hand: theirs stays
  fs.writeFileSync(path.join(clip, "takes", "cut.json"), JSON.stringify({ ...cut(), fixes: { ...cut().fixes, 1: "WERWULF" } }));
  // --leave on Reade: its fix goes, the others stay
  list("proposed");
  r = names();
  assert.deepEqual(cut().fixes, { 1: "WERWULF", 2: "comes-out" });
  assert.match(r.stdout, /Taken back from cut\.json "fixes" \(the list no longer applies them\): word 0 "Reed,"\./);
  // --take again: back
  list("applied");
  r = names();
  assert.deepEqual(cut().fixes, { 0: "Reade,", 1: "WERWULF", 2: "comes-out" });
  // again with nothing changed: says so, no build needed
  r = names();
  assert.match(r.stdout, /Nothing changed in cut\.json\./);
  fs.rmSync(tmp, { recursive: true });
});

// ---------------------------------------------------------------- the clip's words, real timings
test("clip mapping on a real clip's timings: no place changes any word but the one corrected, none is blanked", () => {
  // the robe passage of Hot Ones: the episode's words (fetch) and the clip's (best-takes) of the
  // same 45 s; every episode word is taken as a place whose name is its own word spelled otherwise
  const { from, to, episode, clip } = JSON.parse(fs.readFileSync(path.join(HERE, "test-data", "names-robe-clip.json"), "utf8"));
  let changed = 0, left = 0;
  for (const w of episode) {
    const c = parts(w.text).core;
    if (!/\p{L}{2}/u.test(c)) continue;
    const e = [{ n: 1, status: "applied", from: c, to: `${c}h`, places: [{ start: w.start, end: w.end }] }];
    const r = clipFixes(clip, e, from, to - from);
    const keys = Object.keys(r.fixes);
    assert.ok(keys.length <= 1, `"${w.text}" at ${w.start} changed ${keys.length} words`);
    assert.ok(!Object.values(r.fixes).includes(""), `"${w.text}" blanked a word`);
    if (!keys.length) { left++; continue; }
    const got = clip.find((x) => String(x.i) === keys[0]);
    assert.equal(fold(parts(got.text).core), fold(c), `"${w.text}" at ${w.start} was put on the clip's "${got.text}"`);
    changed++;
  }
  assert.ok(changed > 0.9 * (changed + left), `${changed} mapped, ${left} left`);
  // the review's cases: a short neighbour that reaches into the place, a word heard otherwise
  const W = (arr) => arr.map(([text, start, end], i) => ({ i, text, start, end, kind: "word" }));
  const one = (words, from, to, s, e) => clipFixes(W(words), [{ n: 1, status: "applied", from, to, places: [{ start: 100 + s, end: 100 + e }] }], 100);
  assert.deepEqual(one([["play", 9.3, 9.6], ["a", 9.7, 10.05], ["Reed,", 10.05, 10.35], ["yes", 10.4, 10.7]], "Reed", "Reade", 10.0, 10.3).fixes, { 2: "Reade," });
  assert.deepEqual(one([["für", 10.0, 10.2], ["Killer", 10.25, 10.6], ["Maul", 10.6, 10.95], ["zwei?", 10.95, 11.3]], "Killer Maul", "Kill Em All", 10.3, 11.0).fixes, { 1: "Kill Em All", 2: "" });
  const das = one([["dass", 9.6, 9.9], ["das", 10.0, 10.3], ["geschrieben", 10.3, 10.9]], "Lars", "Laas", 10.0, 10.3);
  assert.deepEqual(das.fixes, {});
  assert.equal(das.missed[0].why, "the clip heard something else there");
});

test("names --take with --also: the numbers mean the list the agent read, and a number in --take and --leave is an error", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clips-names-"));
  fs.writeFileSync(path.join(dir, "episode.json"), JSON.stringify({ title: "t", channel: "c", lang: "en" }));
  fs.writeFileSync(path.join(dir, "words.json"), JSON.stringify(TALK.words));
  fs.writeFileSync(path.join(dir, "page.json"), JSON.stringify(PAGE));
  const first = { names: NAMES, fixes: [fix(0, "Reed", "Reade"), fix(2, "Miller", "mother", "low", { kind: "word" })] };
  assert.equal((await namesWith(dir, first)).status, 0);
  const read = () => JSON.parse(fs.readFileSync(path.join(dir, "names.json"), "utf8"));
  const miller = read().entries.find((e) => e.from === "Miller").n;
  // the new answer lists something before it, so the numbers move
  const second = { names: NAMES, fixes: [fix(1, "Werewolf", "Werwulf", "medium"), ...first.fixes] };
  const r = await namesWith(dir, second, ["--take", String(miller), "--also", "Roz Chast"]);
  assert.equal(r.status, 0, r.out);
  const now = read().entries.find((e) => e.from === "Miller");
  assert.equal(now.status, "applied", "the entry the agent read was taken, whatever its new number");
  assert.notEqual(now.n, miller);
  assert.match(fs.readFileSync(path.join(dir, "sentences.txt"), "utf8"), /Why, mother\?/);
  const both = await namesWith(dir, second, ["--take", "1", "--leave", "1"]);
  assert.equal(both.status, 1);
  assert.match(both.out, /^Correction 1 is in both --take and --leave: name each in one of them\.\n$/);
  fs.rmSync(dir, { recursive: true });
});

// ---------------------------------------------------------------- the second look
test("the second look: a place the first call pointed to wrongly (another Lars, a cousin Damian) becomes a proposal, a right one stays applied", async () => {
  // the review's trap sentences (runs3), added to real passages of tE_bV1XJ4do and d13OiuxIdFM
  const ep = episodeOf([
    ["A", "Also Lars hat Ey Mama geschrieben, das war der erste Song."],
    ["J", "Der Lars aus meiner alten Klasse spielt heute Cello im Orchester."],
    ["B", "My cousin Damian came to the wedding too."],
    ["B", "And then Damian sang the whole Eurovision song with us."],
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clips-names-look-"));
  fs.writeFileSync(path.join(dir, "episode.json"), JSON.stringify({ title: "t", channel: "c", lang: "de" }));
  fs.writeFileSync(path.join(dir, "words.json"), JSON.stringify(ep.words));
  fs.writeFileSync(path.join(dir, "page.json"), JSON.stringify(pageOf({ title: "Laas über Ey Mama | Talk", tags: ["Laas", "Damiano David", "Damiano"] })));
  const answer = { names: [], fixes: [fix(0, "Lars", "Laas"), fix(1, "Lars", "Laas"), fix(2, "Damian", "Damiano"), fix(3, "Damian", "Damiano")] };
  // the second look says no where the passage speaks of someone else
  const look = (body) => {
    const prompt = JSON.parse(body).messages[0].content, out = {};
    for (const m of prompt.matchAll(/^(\d+)\. NAME: [^\n]*\n {3}([^\n]*)/gm)) if (/\[\[Lars\]\] aus meiner alten Klasse|cousin \[\[Damian\]\]/.test(m[2])) out[m[1]] = "no";
    return out;
  };
  LOOKS.length = 0;
  const r = await namesWith(dir, answer, [], look);
  assert.equal(r.status, 0, r.out);
  assert.equal(r.calls, 2, "one call for the names, one for the second look of all places");
  const text = fs.readFileSync(path.join(dir, "sentences.txt"), "utf8");
  assert.match(text, /Also Laas hat Ey Mama/);
  assert.match(text, /Der Lars aus meiner alten Klasse/);
  assert.match(text, /My cousin Damian came/);
  assert.match(text, /And then Damiano sang/);
  assert.match(r.out, /"Lars" → "Laas" \([^)]*the second look: someone or something else \(w; Laas: the one on the page\)/);
  assert.match(r.out, /\(the title; sure; Laas: the one on the page\)/, "an applied place says who the name is");
  // the second look sees the page and the passage with the words marked, not the whole transcript
  assert.match(LOOKS[0], /Tags:\n"""\nLaas, Damiano David, Damiano/);
  assert.match(LOOKS[0], /\d\. NAME: Laas \(written: Lars\)\n {3}Also Laas hat|\d\. NAME: Laas \(written: Lars\)\n {3}Also \[\[Lars\]\] hat Ey Mama/);
  // no answer from the second look: nothing applied by itself
  const none = await namesWith(dir, answer, [], null);
  assert.match(none.out, /0 corrections applied/);
  fs.rmSync(dir, { recursive: true });
});
