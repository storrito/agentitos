// What the tools do around the model, on made-up transcripts: no model, no network.
//
//   node --test tools/test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { arrange, dropSpans, keepsWithout, numbers, ranges, longest, MAX_SECONDS } from "./lib/moments.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const run = (tool, args, env = {}) => spawnSync(process.execPath, [path.join(HERE, tool), ...args],
  { encoding: "utf8", env: { ...process.env, OPENROUTER_API_KEY: "", RRAGENT_GATEWAY: "http://127.0.0.1:9", ...env } });

// a transcript from lines of [seconds it lasts, voice, words]; sentences follow each other
// with 0.2 s between them unless a line gives its own start as a fourth value
function transcript(lines) {
  let t = 0;
  return lines.map(([seconds, speaker, text, at]) => {
    const start = at ?? t;
    t = start + seconds + 0.2;
    return { start, end: start + seconds, speaker, text };
  });
}
// what a model answers for one moment
const moment = (first, last, more = {}) => ({ first, last, kind: "story", title: "t", why: "w", cold: 2, one: 2, ends: 2, alone: 2, drop: [], hook: "", crosstalk: false, ...more });

// a host's question, an answer with an aside in the middle, the lesson at the end: 80 s
const INTERVIEW = transcript([
  [4, "A", "Welcome back to the show."],                               // 0
  [6, "A", "What was the hardest scene you ever shot?"],                // 1
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
  assert.equal(m.over, 71 - MAX_SECONDS);
  assert.deepEqual(m.drop, [4, 5]);
  // the two asides go from where the first starts to where sentence 6 starts: 17.4 of 71.2 s
  assert.equal(m.kept, 54);
});

test("with a higher limit the same passage fits and nothing is marked", () => {
  const [m] = arrange({ moments: [moment(1, 7, { drop: [4, 5] })] }, INTERVIEW, { limit: 90 });
  assert.equal(m.over, 0);
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
  // B answers while A still asks: the dropped answer starts only where A ends
  const talkOver = transcript([[5, "A", "So is it true?"], [3, "B", "Yes.", 4], [6, "A", "Tell me more."]]);
  assert.deepEqual(dropSpans(talkOver, 0, 2, [1]), [[5, talkOver[2].start]]);
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
