// What the tools do around the model, on made-up transcripts: no model, no network.
//
//   node --test tools/test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { arrange, shape, questionStart, continues, checks, dropSpans, dropPlan, cutKeeps, dropNote, lengthNote, OPENING_LONGEST, keepsWithout, openingKeep, sentenceWords, openingNote, numbers, ranges, longest, momentsPrompt, listing, checkNotes, KINDS, MAX_SECONDS } from "./lib/moments.mjs";
import { keyRejected, rejectedIn, REJECTED } from "./lib/openrouter.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const run = (tool, args, env = {}) => spawnSync(process.execPath, [path.join(HERE, tool), ...args],
  { encoding: "utf8", env: { ...process.env, OPENROUTER_API_KEY: "", RRAGENT_GATEWAY: "http://127.0.0.1:9", ...env } });

// a transcript from lines of [seconds it lasts, voice, words]; sentences follow each other
// with 0.2 s between them unless a line gives its own start as a fourth value
function transcript(lines) {
  let t = 0;
  return lines.map(([seconds, speaker, text, at]) => {
    const start = at ?? t;
    t = +(start + seconds + 0.2).toFixed(3);
    return { start, end: +(start + seconds).toFixed(3), speaker, text };
  });
}
// what a model answers for one moment
const moment = (first, last, more = {}) => ({ first, last, kind: "story", title: "t", why: "w", payoff: last, drop: [], hook: "", crosstalk: false, ...more });

// a host's question after a pause, an answer with an aside in the middle, the lesson at the end
const INTERVIEW = transcript([
  [4, "A", "Welcome back to the show."],                               // 0
  [6, "A", "What was the hardest scene you ever shot?", 7],             // 1
  [10, "B", "The one in the river, without a doubt."],                  // 2
  [12, "B", "We had three days and the water was freezing."],           // 3
  [9, "B", "By the way, the catering on that film was great."],         // 4  an aside
  [8, "B", "They had this soup, I still think about it."],              // 5  an aside
  [14, "B", "On the last day I went under and nobody noticed."],        // 6
  [11, "B", "That is when I learned to say no to a director."],         // 7  the lesson
  [5, "A", "Let's talk about your new film."],                          // 8
  [20, "B", "It is a comedy, which is new for me."],                    // 9
]);

test("sentence numbers are read and written as ranges", () => {
  assert.deepEqual(numbers("229-231, 240"), [229, 230, 231, 240]);
  assert.deepEqual(numbers("7"), [7]);
  assert.equal(numbers("7-5"), null);
  assert.equal(numbers("abc"), null);
  assert.equal(ranges([229, 230, 231, 240]), "229-231,240");
  assert.equal(ranges([]), "");
});

test("a passage longer than the limit is returned whole, with the sentences that can go", () => {
  const [m] = arrange({ moments: [moment(1, 7, { drop: [4, 5] })] }, INTERVIEW);
  assert.deepEqual([m.first, m.last], [1, 7]);
  assert.equal(m.seconds, 71);
  assert.equal(m.checks.over, 71 - MAX_SECONDS);
  assert.deepEqual(m.drop, [4, 5]);
  // the two asides go from where the first starts to where sentence 6 starts: 17.4 of 71.2 s
  assert.equal(m.kept, 54);
});

test("with a higher limit the same passage fits and nothing is marked", () => {
  const [m] = arrange({ moments: [moment(1, 7, { drop: [4, 5] })] }, INTERVIEW, { limit: 90 });
  assert.equal(m.checks.over, 0);
  assert.deepEqual(m.drop, []);
  assert.equal(m.kept, m.seconds);
});

test("the first and the last sentence, and sentences outside, are never dropped", () => {
  const [m] = arrange({ moments: [moment(1, 7, { drop: [0, 1, 4, 7, 9, 4] })] }, INTERVIEW);
  assert.deepEqual(m.drop, [4]);
});

test("a passage far over the limit loses sentences at its end, one that overlaps a better one goes", () => {
  const long = arrange({ moments: [moment(0, 9)] }, INTERVIEW)[0];
  assert.ok(long.seconds <= longest(MAX_SECONDS));
  assert.deepEqual([long.first, long.last], [0, 8]);
  const two = arrange({ moments: [moment(1, 7), moment(6, 9), moment(8, 9)] }, INTERVIEW);
  assert.deepEqual(two.map((m) => [m.first, m.last]), [[1, 7], [8, 9]]);
});

test("sentence numbers the transcript does not have are brought into it", () => {
  const [m] = arrange({ moments: [moment(-3, 40)] }, INTERVIEW, { limit: 200 });
  assert.deepEqual([m.first, m.last], [0, 9]);
  assert.deepEqual(arrange({ moments: [moment(5, 2)] }, INTERVIEW), []);
});

test("what goes with a dropped sentence runs to the next kept sentence, not into a voice that still speaks", () => {
  assert.deepEqual(dropSpans(INTERVIEW, 1, 7, [4, 5]), [[INTERVIEW[4].start, INTERVIEW[6].start]]);
  assert.deepEqual(dropSpans(INTERVIEW, 1, 7, []), []);
  // B answers while A still asks: cutting B would cut A, so B stays
  const talkOver = transcript([[5, "A", "So is it true?"], [3, "B", "Yes, it is.", 4], [6, "A", "Tell me more."]]);
  assert.deepEqual(dropSpans(talkOver, 0, 2, [1]), []);
});

test("the words of a cut clip that stay: one keep, or one on each side of what is left out", () => {
  // ten words from 1.0 s on, as best-takes numbers them; the clip's air holds a word before and after
  const words = Array.from({ length: 12 }, (_, i) => ({ i: 100 + i, start: 0.5 + i * 0.5, end: 0.9 + i * 0.5 }));
  const whole = keepsWithout(words, [1.0, 5.9]);
  assert.deepEqual(whole.keeps, [[101, 110]]);
  assert.equal(whole.left, 0);
  const cut = keepsWithout(words, [1.0, 5.9], [[2.5, 4.0]]);
  assert.deepEqual(cut.keeps, [[101, 103], [107, 110]]);
  assert.equal(cut.left, 3);
  assert.deepEqual(keepsWithout(words, [1.0, 5.9], [[0, 10]]).keeps, []);
});

test("a wrong option of moments is answered in one sentence that says what to write", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clips-test-"));
  for (const [args, said] of [
    [["moments", dir, "--max-seconds", "5"], /--max-seconds 5: a short is 15 to 600 seconds long/],
    [["moments", dir, "--max-seconds", "soon"], /--max-seconds takes a whole number/],
    [["moments", dir, "--longer"], /Unknown option --longer: episode\.mjs moments <dir> \[--count N\] \[--max-seconds N\]/],
  ]) {
    const r = run("episode.mjs", args);
    assert.equal(r.status, 1);
    assert.match(r.stdout, said);
    assert.equal(r.stdout.trim().split("\n").length, 1);
  }
  fs.rmSync(dir, { recursive: true });
});

test("prepare refuses sentences to drop that are not inside the moment, before anything is cut", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clips-test-"));
  fs.writeFileSync(path.join(dir, "words.json"), "[]");
  fs.writeFileSync(path.join(dir, "sentences.json"), JSON.stringify(INTERVIEW));
  for (const drop of ["1", "7", "0-3", "soup"]) {
    const r = run("clips.mjs", ["prepare", dir, path.join(dir, "01"), "1-7", "--drop", drop]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /sentence numbers inside 1-7, never its first or last sentence, as in --drop 2-3\./);
    assert.ok(!fs.existsSync(path.join(dir, "01")));
  }
  fs.rmSync(dir, { recursive: true });
});

test("prepare refuses a payoff that is not a kept sentence of the moment, before anything is cut", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clips-test-"));
  fs.writeFileSync(path.join(dir, "words.json"), "[]");
  fs.writeFileSync(path.join(dir, "sentences.json"), JSON.stringify(INTERVIEW));
  for (const args of [["--payoff", "9"], ["--payoff", "line"], ["--payoff", "4", "--drop", "4-5"]]) {
    const r = run("clips.mjs", ["prepare", dir, path.join(dir, "01"), "1-7", ...args]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^--payoff \S+: one sentence number of 1-7 that is not dropped, as moments\.json gives it/);
    assert.ok(!fs.existsSync(path.join(dir, "01")));
  }
  fs.rmSync(dir, { recursive: true });
});

test("the moments come in the order of the episode; of two that overlap, the one that opens better stays", () => {
  const out = arrange({ moments: [moment(8, 9, { opens: 9 }), moment(1, 3, { opens: 6 }), moment(6, 7, { opens: 6 })] }, INTERVIEW, { limit: 90 });
  assert.deepEqual(out.map((m) => [m.first, m.opens]), [[1, 6], [6, 6], [8, 9]]);
  assert.ok(out.every((m) => !("score" in m) && !("weak" in m) && !("points" in m) && !("rank" in m)));
  // a rating out of the scale is brought into it
  assert.deepEqual(arrange({ moments: [moment(1, 3, { opens: 40 }), moment(8, 9, { opens: "x" })] }, INTERVIEW).map((m) => m.opens), [10, 1]);
  const two = arrange({ moments: [moment(1, 7, { opens: 3 }), moment(6, 9, { opens: 8 })] }, INTERVIEW, { limit: 90 });
  assert.deepEqual(two.map((m) => [m.first, m.last]), [[6, 9]]);
  // on the same rating, the one the model listed first
  const tie = arrange({ moments: [moment(6, 9, { opens: 5 }), moment(1, 7, { opens: 5 })] }, INTERVIEW, { limit: 90 });
  assert.deepEqual(tie.map((m) => [m.first, m.last]), [[6, 9]]);
});

test("each moment carries the checks the tool counts, an exchange is a kind of its own", () => {
  const [m] = arrange({ moments: [moment(1, 7, { kind: "exchange" })] }, INTERVIEW);
  assert.equal(m.kind, "exchange");
  assert.ok(KINDS.includes("exchange"));
  assert.deepEqual(m.checks, { question: true, conjunction: false, voices: 2, over: 12, asked: null, stays: [], refused: [], trimmed: null, still: 12 });
  assert.equal(arrange({ moments: [moment(2, 3, { kind: "banter" })] }, INTERVIEW)[0].kind, "claim");
  // shape: the same moment over other sentences keeps what still fits
  const wider = shape({ ...m, drop: [4, 5] }, 1, 8, INTERVIEW, 59);
  assert.deepEqual([wider.first, wider.last, wider.drop, wider.payoff, wider.checks.asked], [1, 8, [4, 5], 7, null]);
  assert.equal(shape({ ...m, payoff: 9 }, 1, 8, INTERVIEW, 200).payoff, null);
});

test("the prompt holds the description for the channel's followers, the limit and the order to give", () => {
  const ep = { title: "Julia Garner Eats Spicy Wings", channel: "First We Feast", description: "Julia Garner (Ozark, Weapons) takes on the wings." };
  const p = momentsPrompt(ep, "0 [0:00–0:04] A: Hi.\n", 5, 59);
  assert.ok(p.startsWith("0 [0:00–0:04] A: Hi.\n"), "the transcript first, for the provider's cache");
  assert.ok(p.includes(`The video's description, as the channel's followers see it:\n"""\nJulia Garner (Ozark, Weapons) takes on the wings.\n"""`));
  assert.match(p, /everyone the title or the description names, so such a name needs no introduction/);
  // nothing ranks the moments, so the model is not asked to rank them
  assert.match(p, /Pick 8 moments that work as vertical shorts of this channel/);
  assert.match(p, /List the moments in the order of the episode/);
  assert.doesNotMatch(p, /best first|fillers|the \d+ best/);
  assert.match(p, /up to 59 seconds here/);
  assert.ok(p.includes(`(up to ${longest(59)})`));
  assert.match(p, /exchanges \(a quick back-and-forth with a laugh/);
  assert.match(p, /opens: how well the moment's first sentence works on someone who has seen nothing of the episode, 1 to 10, judged on that alone/);
  assert.doesNotMatch(p, /Score|0 to 2/);
  assert.doesNotMatch(momentsPrompt({ title: "T" }, "", 3, 90), /The video's description/);
});

test("the list shows the moments in the order of the episode, says that the order ranks nothing, and only the checks that need a look", () => {
  const ms = arrange({ moments: [moment(8, 9, { opens: 4 }), moment(2, 7, { drop: [4, 5], hook: "He nearly drowned", opens: 7 })] }, INTERVIEW);
  const out = listing({ limit: 59, count: 1, inventory: { story: 2, answer: 1 }, moments: ms, ideas: [] }, INTERVIEW, 3);
  const lines = out.split("\n");
  assert.match(lines[0], /^Inside: 0 claims, 2 stories, 0 numbers, 0 mistakes, 0 how-tos, 1 answers, 0 exchanges — too thin/);
  assert.match(lines[1], /^The moments in the order of the episode \(the order says nothing about which is better/);
  assert.equal(lines[2], "1. 2-7 [0:13, 65 s] opens 7/10 · story · t");
  assert.equal(lines[3], "   answers the question at sentence 1 just before it: start there when the question belongs to it; 6 s over the 59: 48 s without the sentences 4-5");
  assert.ok(out.includes("strongest line (7): „That is when I learned to say no to a director.“"));
  assert.ok(out.includes("hook on screen: „He nearly drowned“"));
  assert.match(out, /\n2\. 8-9 \[1:18, 25 s\] opens 4\/10/);
  assert.doesNotMatch(out, /score|Fillers|\/10 weak/);
});

test("a key that OpenRouter turns away is told from everything else, and said in one sentence", async () => {
  const or = { base: "https://openrouter.example/api/v1", headers: { Authorization: "Bearer k" }, gateway: false };
  const answers = (status, body) => async (url, init) => {
    assert.equal(url, "https://openrouter.example/api/v1/key");
    assert.equal(init.headers.Authorization, "Bearer k");
    return { status, json: async () => body };
  };
  assert.equal(await keyRejected(or, answers(401, { error: { message: "User not found.", code: 401 } })), "401 User not found.");
  assert.equal(await keyRejected(or, answers(403, {})), "403");
  assert.equal(await keyRejected(or, answers(200, { data: {} })), null);
  // another API behind OPENROUTER_BASE_URL, no network, a gateway that adds the key itself: not a rejection
  assert.equal(await keyRejected(or, answers(404, {})), null);
  assert.equal(await keyRejected(or, async () => { throw new Error("fetch failed"); }), null);
  assert.equal(await keyRejected({ ...or, gateway: true }, async () => { throw new Error("never asked"); }), null);
  assert.equal(await keyRejected(null), null);

  assert.equal(rejectedIn('The transcription with google/gemini-3.5-transcribe failed (OpenRouter 401: {"error":{"message":"User not found.","code":401}}); check OPENROUTER_API_KEY'), "401");
  assert.equal(rejectedIn("OpenRouter 429: rate limited"), null);
  assert.match(REJECTED("401 User not found."), /^OpenRouter turned the key away \(401 User not found\.\), so nothing was written: put a valid OPENROUTER_API_KEY/);
});

test("the question an answer answers is noted where it starts, with what the asker says to set it up; nothing moves", () => {
  const [m] = arrange({ moments: [moment(2, 7)] }, INTERVIEW);
  assert.deepEqual([m.first, m.last, m.checks.asked], [2, 7, 1]);
  assert.equal(m.moved, undefined);
  // from the middle of the answer too, as long as only the answering voice spoke since the question
  assert.equal(questionStart(INTERVIEW.slice(0, 3).concat(transcript([[3, "B", "It was cold.", 23.4]])), 3), 1);
  // "So in that film you play a diver." before the question belongs to it; the greeting 3 s earlier does not
  const setUp = transcript([[3, "A", "Good to have you."], [5, "A", "So in that film you play a diver.", 6], [4, "A", "How long can you hold your breath?"], [8, "B", "Four minutes, on a good day."]]);
  assert.equal(questionStart(setUp, 3), 1);
  assert.deepEqual([arrange({ moments: [moment(3, 3)] }, setUp)[0].first, arrange({ moments: [moment(3, 3)] }, setUp)[0].checks.asked], [3, 1]);
});

test("a start that answers no question stays where the model put it", () => {
  const at = (lines, first, floor) => questionStart(transcript(lines), first, floor);
  // the moment opens with the question itself
  assert.equal(questionStart(INTERVIEW, 1), 1);
  // what the other voice said last is no question
  assert.equal(at([[5, "A", "That is a wild story."], [9, "B", "You know what I read in the comments all the time."]], 1), 1);
  // the question is more than 15 s back
  assert.equal(at([[5, "A", "What happened on that day?"], [16, "B", "Well, it started in the morning."], [9, "B", "Then the storm came."]], 2), 2);
  // a remark of the asker stands between the question and the start
  assert.equal(at([[4, "A", "Is that really true?"], [3, "B", "Yes."], [3, "A", "I never knew that."], [8, "B", "Nobody did, we kept it quiet."]], 3), 3);
  // a "Really?" is a reaction, not a question to answer
  assert.equal(at([[9, "B", "We sold the company in a week."], [1, "A", "Really?"], [8, "B", "Yes, to the first one who asked."]], 2), 2);
  // a "mhm" of the asker in the answer does not hide the question
  assert.equal(at([[4, "A", "How did you start out?"], [5, "B", "With nothing, honestly."], [0.6, "A", "Mhm."], [7, "B", "I slept in the office."]], 3), 0);
  // the voice asks itself
  assert.equal(at([[4, "B", "Why did we do that?"], [7, "B", "Because nobody stopped us."]], 1), 1);
  // YouTube's captions: no voices, nobody is known to ask
  assert.equal(at([[4, null, "How did you start out?"], [7, null, "With nothing, honestly."]], 1), 1);
  // the question belongs to another moment
  assert.equal(at([[4, "A", "How did you start out?"], [7, "B", "With nothing, honestly."]], 1, 1), 1);
  const taken = arrange({ moments: [moment(0, 1), moment(2, 7)] }, INTERVIEW, { limit: 200 });
  assert.deepEqual(taken.map((m) => [m.first, m.last, m.checks.asked]).sort(), [[0, 1, null], [2, 7, null]]);
});

test("a conjunction counts as one in the middle of a voice's turn, not where it opens a turn", () => {
  const talk = transcript([
    [5, "A", "So in that film you play a diver."],         // 0  opens the talk
    [6, "B", "I do, and I nearly drowned."],                // 1
    [5, "B", "And then they asked for another take."],      // 2  goes on in B's turn
    [0.5, "A", "Mhm."],                                     // 3
    [6, "B", "Or we would have lost the light."],           // 4  goes on over the "mhm"
    [4, "A", "But you did it anyway?"],                     // 5  opens A's turn
    [5, "B", "So I did it, yes.", 60],                      // 6  after a long pause: a new start
  ]);
  assert.deepEqual(talk.map((_, k) => continues(talk, k)), [false, false, true, false, true, false, false]);
});

test("the checks count how a moment opens, its voices and its length against the limit", () => {
  assert.deepEqual(checks(INTERVIEW, 1, 7), { question: true, conjunction: false, voices: 2, over: 12 });
  assert.deepEqual(checks(INTERVIEW, 2, 7, 90), { question: false, conjunction: false, voices: 1, over: 0 });
  // the question comes in the asker's second sentence; a voice that only says "mhm" is not counted
  const setUp = transcript([[5, "A", "So in that film you play a diver."], [4, "A", "How long can you hold your breath?"], [8, "B", "Four minutes."], [0.6, "C", "Wow."]]);
  assert.deepEqual(checks(setUp, 0, 3), { question: true, conjunction: false, voices: 2, over: 0 });
  // a question the other voice asks later is not how the moment opens
  const later = transcript([[6, "B", "We sold it in a week."], [4, "A", "To whom?"], [5, "B", "And nobody knew."]]);
  assert.equal(checks(later, 0, 2).question, false);
  assert.equal(checks(later, 2, 2).conjunction, false);
});

test("the payoff is a sentence of the moment and is never dropped", () => {
  const [m] = arrange({ moments: [moment(1, 7, { payoff: 5, drop: [4, 5] })] }, INTERVIEW);
  assert.equal(m.payoff, 5);
  assert.deepEqual(m.drop, [4]);
  assert.equal(arrange({ moments: [moment(1, 7, { payoff: 9 })] }, INTERVIEW)[0].payoff, null);
  assert.equal(arrange({ moments: [moment(2, 7, { payoff: 1 })] }, INTERVIEW)[0].payoff, null);
});

test("the strongest line as the opening keep: the whole line, played again where it was said", () => {
  const line = ["and", "I", "put", "them", "in,", "and", "I", "couldn't", "close", "my", "mouth."].map((text, k) => ({ i: 149 + k, text }));
  // best-takes refuses a word in two keeps unless the keep that repeats it says "again"
  assert.deepEqual(openingKeep(line), { words: "149-159", why: "the strongest line first", again: true });
  assert.equal(openingKeep([{ i: 4, text: "No." }]).words, "4");
});

// Real words: Hot Ones with Willem Dafoe (YqugY2zTIoI), the episode's sentences and the words
// best-takes wrote down anew in two cut clips (e2e run, 2026-11-18), timed in each clip.
const HULA = { from: 180.35, sentences: {
  66: { start: 233, end: 235.1, speaker: "A", text: "And that was a very popular show." },
  67: { start: 236.1, end: 237.7, speaker: "C", text: "Which was called hula, right?" },
  68: { start: 237.7, end: 238.4, speaker: "A", text: "It was called hula." } },
  words: [[158, "a", 53.62, 53.68], [159, "very", 53.68, 53.89], [160, "popular", 53.98, 54.37], [161, "show.", 54.4, 54.68],
    [163, "Which", 55.78, 55.98], [164, "was", 55.98, 56.16], [165, "called", 56.18, 56.61], [166, "Hula,", 56.74, 57.06], [167, "right?", 57.06, 57.28],
    [168, "It", 57.28, 57.39], [169, "was", 57.4, 57.52], [170, "called", 57.54, 57.78], [171, "Hula.", 57.78, 58.08], [172, "In", 58.08, 58.24],
    [173, "fact,", 58.29, 58.54], [174, "once,", 58.72, 59.2]].map(([i, text, start, end]) => ({ i, text, start, end })) };
const TEETH = { from: 295.65, sentences: {
  99: { start: 341.2, end: 343.5, speaker: "A", text: "And then he told me to put in these teeth." },
  100: { start: 344.3, end: 347.2, speaker: "A", text: "And I put them in, and I couldn't close my mouth." },
  101: { start: 347.8, end: 349.9, speaker: "A", text: "And so I'm always like this." } },
  words: [[145, "put", 46.6, 46.8], [146, "in", 46.8, 47.02], [147, "these", 47.02, 47.28], [148, "teeth,", 47.3, 47.75], [149, "and", 48.6, 48.86],
    [150, "I", 48.86, 48.9], [151, "put", 48.94, 49.12], [152, "them", 49.12, 49.42], [153, "in,", 49.42, 49.65], [154, "and", 50.07, 50.3],
    [155, "I", 50.3, 50.35], [156, "couldn't", 50.37, 50.56], [157, "close", 50.58, 50.88], [158, "my", 50.89, 51.08], [159, "mouth.", 51.08, 51.54],
    [160, "And", 52.09, 52.43], [161, "so", 52.69, 52.99], [162, "I'm", 52.99, 53.2]].map(([i, text, start, end]) => ({ i, text, start, end })) };
const printed = (c, k) => openingNote(sentenceWords(c.words, c.sentences[k], c.from), k);

test("the opening keep is the strongest line's own words, no neighbour's, as prepare prints it on real words", () => {
  // the ±0.25 s of a moment's edges gave "right? It was called Hula. In" here
  assert.match(printed(HULA, 68), /put \{"words":"168-171","why":"the strongest line first","again":true\} at the top/);
  assert.match(printed(HULA, 67), /"words":"163-167"/);
  assert.match(printed(HULA, 66), /"words":"158-161"/);
  assert.match(printed(TEETH, 100), /"words":"149-159"/);
  // an "and" it begins with is the agent's to judge: the "I" after it is one sound with it here
  assert.match(printed(TEETH, 100), /It begins on "and": start a word later only where/);
  assert.doesNotMatch(printed(HULA, 68), /It begins on/);
  // a clip that heard an edge word differently: the words whose middle lies inside the sentence
  const misheard = HULA.words.map((w) => (w.i === 168 ? { ...w, text: "Id" } : w));
  assert.deepEqual(sentenceWords(misheard, HULA.sentences[68], HULA.from).map((w) => w.i), [168, 169, 170, 171]);
  assert.match(openingNote([], 68), /No word of the strongest line \(sentence 68\)/);
});

// Real words: Call Her Daddy with Jennifer Lawrence (PXagY52HcYQ), sentences 204-227 and their
// words, as clips-eval fetched them; sentences.json is not in time order where two voices overlap.
const PX = JSON.parse(fs.readFileSync(path.join(HERE, "test-data", "PXagY52HcYQ-204-227.json"), "utf8"));
const PXS = []; for (const [k, s] of Object.entries(PX.sentences)) PXS[Number(k)] = s;

test("a dropped sentence is cut by its own words; one another voice speaks over stays, and the message says so", () => {
  // the drop of a saved run (s5 run1, moment 196-227): 206 and 224-225 played in full while
  // prepare said they were left out, because the next kept sentence started before them
  const drop = [206, 208, 224, 225];
  const plan = dropPlan(PXS, 204, 227, drop);
  assert.deepEqual(plan.cut, [208]);
  assert.deepEqual(plan.stays.map(([k]) => k), [206, 224, 225]);
  const said = [PXS[204].start, PXS[227].end];
  const r = cutKeeps(PX.words, PXS, 204, 227, drop, 0, said);
  const kept = new Set(r.keeps.flatMap(([x, y]) => PX.words.filter((w) => w.i >= x && w.i <= y).map((w) => w.i)));
  const own = (k) => PX.words.filter((w) => w.i >= PXS[k].first && w.i <= PXS[k].last);
  // nothing said to be gone plays, nothing of a kept sentence goes
  assert.ok(own(208).every((w) => !kept.has(w.i)));
  for (const k of [205, 207, 209, 226]) assert.ok(own(k).every((w) => kept.has(w.i)), `sentence ${k} keeps its words`);
  const note = dropNote(r.plan, r.gone, r.folded, r.keeps, PXS);
  assert.match(note, /^Left out inside it: the sentences 208 \(/);
  assert.match(note, /Sentence 206 stays: another voice speaks over it \(sentence 207/);
  assert.match(note, /Sentence 224 stays/);
  // the moment as moments.json holds it marks what stays, its length counts it in
  const m = shape(moment(204, 227, { drop, payoff: 210 }), 204, 227, PXS, 30);
  assert.deepEqual([m.drop, m.checks.stays], [[208], [206, 224, 225]]);
  assert.ok(m.kept > m.seconds - 6);
});

test("an aside of another voice inside a dropped sentence goes with it; a piece too short to stand alone between two cuts too", () => {
  const t = transcript([[3, "A", "So tell me."], [6, "B", "It started in a garage, a tiny one, we had no money."], [0.6, "A", "Right.", 4.5],
    [3, "B", "Then we sold it.", 9.4], [0.5, "B", "Um."], [3, "B", "And that was that."], [2, "A", "Wow."]]);
  const plan = dropPlan(t, 0, 6, [1]);
  assert.deepEqual([plan.cut, plan.asides, plan.stays], [[1], [2], []]);
  const words = [];
  t.forEach((s, k) => s.text.split(" ").forEach((text, n, all) => {
    const d = (s.end - s.start) / all.length;
    words.push({ i: words.length, text, start: +(s.start + n * d).toFixed(3), end: +(s.start + (n + 1) * d - 0.02).toFixed(3) });
  }));
  const r = cutKeeps(words, t, 0, 6, [3, 5], 0, [t[0].start, t[6].end]);
  // "Um." between the two dropped sentences would be a keep of one word: it goes with them
  assert.deepEqual(r.folded.map((w) => w.text), ["Um."]);
  assert.equal(r.keeps.length, 2);
  assert.match(dropNote(r.plan, r.gone, r.folded, r.keeps, t), /and between two cuts \d+ "Um\." \(too short to stand alone\)/);
});

test("a passage trimmed to 1.7 times the limit says so, and of its payoff; a drop of more than half of it is not taken", () => {
  // INTERVIEW 1-9 runs about 104 s; at a limit of 40 at most 68 s are returned
  const [m] = arrange({ moments: [moment(1, 9, { payoff: 9 })] }, INTERVIEW, { limit: 40 });
  assert.ok(m.last < 9 && m.payoff == null);
  assert.deepEqual(m.checks.trimmed, { from: 9, payoff: 9 });
  assert.match(checkNotes(m, 40), new RegExp(`the model's passage ran to sentence 9, over 68 s: its end was cut back to ${m.last}; read where it really ends, the strongest line it named \\(9\\) lies past it`));
  assert.equal(arrange({ moments: [moment(1, 3)] }, INTERVIEW, { limit: 40 })[0].checks.trimmed, null);
  // 1-7 is 75 s; dropping 3-6 would take 46 s of it
  const [all] = arrange({ moments: [moment(1, 7, { drop: [3, 4, 5, 6] })] }, INTERVIEW, { limit: 59 });
  assert.deepEqual([all.drop, all.checks.refused, all.kept], [[], [3, 4, 5, 6], all.seconds]);
  assert.match(checkNotes(all, 59), /the model marked 3-6 to drop, more than half of it: not taken/);
});

test("the limit travels: a moment still over it after its drop is said to be in the list and by prepare, an opening counts", () => {
  // INTERVIEW 1-7 is 75 s; without 4-5 it is about 57 s: still over a limit of 50
  const [m] = arrange({ moments: [moment(1, 7, { drop: [4, 5], payoff: 7 })] }, INTERVIEW, { limit: 50 });
  assert.equal(m.checks.still, m.kept - 50);
  assert.match(checkNotes(m, 50), new RegExp(`${m.kept} s without the sentences 4-5, still ${m.kept - 50} s over: drop more of it, run moments again with a higher --max-seconds where the platforms take it, or take another moment; never one over the limit`));
  assert.equal(arrange({ moments: [moment(1, 7, { drop: [4, 5] })] }, INTERVIEW, { limit: 59 })[0].checks.still, 0);
  assert.equal(lengthNote(58.4, 59), null);
  assert.match(lengthNote(64.6, 59), /^⚠ Without what is left out the moment is still about 65 s of words, over the 59 s a short may be here: drop more/);
  // the opening: none for the first sentence, none too long, none that brings the short over the limit
  const line = TEETH.words.filter((w) => w.i >= 149 && w.i <= 159);
  assert.match(openingNote(line, 100, { first: 85, estimate: 50, limit: 59 }), /"words":"149-159"/);
  assert.match(openingNote(line, 100, { first: 100, estimate: 50, limit: 59 }), /is the moment's first sentence: it opens the short already, so no opening keep/);
  assert.match(openingNote(line, 100, { first: 85, estimate: 57, limit: 59 }), /would bring the short to about 60 s, over the 59 s: no opening keep/);
  const long = line.map((w, k) => ({ ...w, end: w.end + (k === line.length - 1 ? OPENING_LONGEST : 0) }));
  assert.match(openingNote(long, 100, { first: 85, estimate: 20, limit: 100 }), /too long to open a short with \(at most 10 s\), so no opening keep/);
});

test("prepare refuses a limit that is no length of a short, before anything is cut", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clips-test-"));
  fs.writeFileSync(path.join(dir, "words.json"), "[]");
  fs.writeFileSync(path.join(dir, "sentences.json"), JSON.stringify(INTERVIEW));
  const r = run("clips.mjs", ["prepare", dir, path.join(dir, "01"), "1-7", "--max-seconds", "5"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^--max-seconds 5: how long the short may be, 15 to 600 seconds/);
  assert.ok(!fs.existsSync(path.join(dir, "01")));
  fs.rmSync(dir, { recursive: true });
});

// moments against a stand-in for OpenRouter that answers `content` (the reviewer's stub inputs)
async function momentsWith(content, { finish = "stop", count = 3 } = {}) {
  let calls = 0;
  const server = http.createServer((req, res) => {
    let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url.endsWith("/key")) return res.end("{}");
      calls++;
      res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }], usage: { cost: 0.01 } }));
    });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clips-moments-"));
  fs.writeFileSync(path.join(dir, "episode.json"), JSON.stringify({ title: "t", channel: "c", duration: 600 }));
  fs.writeFileSync(path.join(dir, "sentences.json"), JSON.stringify(INTERVIEW));
  fs.writeFileSync(path.join(dir, "sentences.txt"), INTERVIEW.map((s, k) => `${k} ${s.speaker}: ${s.text}`).join("\n") + "\n");
  const child = spawn(process.execPath, [path.join(HERE, "episode.mjs"), "moments", dir, "--count", String(count)],
    { env: { ...process.env, OPENROUTER_API_KEY: "test", OPENROUTER_BASE_URL: `http://127.0.0.1:${server.address().port}` } });
  let out = "", err = "";
  child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (err += d));
  const status = await new Promise((ok) => child.on("close", ok));
  server.close(); fs.rmSync(dir, { recursive: true });
  return { status, out, err, calls };
}
const INVENTORY = (n) => Object.fromEntries(KINDS.map((k, i) => [k, i === 0 ? n : 0]));
const answer = (moments, n = 9) => JSON.stringify({ inventory: INVENTORY(n), moments, ideas: [] });

test("moments: an answer that is no answer is an error that says what to do, never a thin episode or a stack trace", async () => {
  for (const content of [null, "Here are the moments you asked for: 1-7 is great.", '{"inventory":{"claim":3},"moments":[{"first":1,"last":7,"kind":"st', "[]"]) {
    const r = await momentsWith(content, { finish: typeof content === "string" && content.startsWith('{"inv') ? "length" : "stop" });
    assert.equal(r.status, 1, String(content));
    assert.match(r.out, /^Picking the moments failed \(the model gave no list of moments twice .*\): run moments again in a few minutes; when it fails again, tell the person/);
    assert.doesNotMatch(r.out + r.err, /TypeError|read sentences\.txt yourself|too thin/);
    assert.equal(r.calls, 2, "tried once more, not three times");
  }
  // an empty list where the model counted plenty is no answer either
  const none = await momentsWith(answer([]));
  assert.equal(none.status, 1);
  assert.match(none.out, /^The model listed no moments although it counted 9 pieces in the episode .*: that is no answer, not a thin episode; run moments again/);
  // every moment out of the episode
  const out = await momentsWith(answer([{ ...moment(5000, 5010), opens: 7 }]));
  assert.equal(out.status, 1);
  assert.match(out.out, /^None of the model's 1 moments is a range of this episode's sentences \(0–9\)/);
});

test("moments: a thin episode is said as one, and fewer moments than asked are said", async () => {
  const thin = await momentsWith(answer([], 1));
  assert.equal(thin.status, 0);
  assert.match(thin.out, /too thin for many clips/);
  const few = await momentsWith(answer([{ ...moment(1, 3), opens: 7 }]), { count: 3 });
  assert.equal(few.status, 0);
  assert.match(few.err, /the model gave 1 moments that hold, of the 3 asked for/);
});
