// After best-takes' cut.mjs; here every word is the main microphone's, on the recording's
// timeline (one "clip"), and a keep holds after its last word: `tail` seconds by default, a
// keep's own `hold` (a result that needs its time on screen), `end` after the last keep.
//
// From cut.json (which words to keep, in which order) to the pieces of the cut: where each one
// starts and ends in its video, where it sits in the cut, and how much louder or quieter it
// has to be so that every take sounds equally loud. A pause inside a keep becomes what its
// picture shows: where the picture stands still it goes (a jump cut), where it moves it stays,
// muted, and a long stretch of it plays faster (a timelapse). A wait the speaker announced
// ("let's wait until then", cut.json "waits") never goes: it plays as a timelapse when its
// picture moves, else it holds a few seconds before the cut, so that the viewer feels the time
// pass.

import { cutBefore, cutAfter, loudness } from "./voice.mjs";
import { speed, waitSpeed, WAIT_MOVING, WAIT_HOLD } from "./motion.mjs";

// The spans of a wait from–to, as groups of the cut: the whole of it faster when its picture
// moves; else the first WAIT_HOLD seconds as they are, then what moves.
function waitGroups(clip, from, to, moves) {
  const shown = moves(clip, from, to, true);
  const moved = shown.reduce((t, s) => t + s.to - s.from, 0);
  if (moved >= WAIT_MOVING * (to - from)) {
    // a long one at ten times its speed would still take long: its first and last 20 s, the
    // middle left out
    if (to - from > 50) return [{ clip, from, to: from + 20, rate: 10, wait: true }, { clip, from: to - 20, to, rate: 10, wait: true }];
    return [{ clip, from, to, rate: waitSpeed(to - from), wait: true }];
  }
  const hold = Math.min(to, from + WAIT_HOLD);
  return [{ clip, from, to: hold, rate: 1, wait: true },
    ...shown.filter((s) => s.to > hold + 0.4).map((s) => ({ clip, from: Math.max(s.from, hold), to: s.to }))];
}

// "12-40", "12–40", 12 → [12, 40]
export function range(r) {
  const m = String(r).trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? m[1])];
}

// words: every word, filler and noise of every video, numbered in one row (words.json)
// voices: per video { env, thr, blocks, duration }
// moves(clip, from, to, wait): the spans of a pause in which the picture moves (activity.mjs;
// for a wait, anything that changes), [] without
// returns { pieces, removed, words (the cut's, timed in the cut), errors, warnings }
export function plan(words, cut, settings, voices, moves = () => []) {
  const errors = [], warnings = [], removed = [];
  const fps = settings.fps, maxPause = settings.pause, target = settings.loudness;
  const used = new Map(), hooked = new Set();
  const waits = new Set((cut.waits || []).map(Number));
  let pieces = [];
  if (!Array.isArray(cut.keep) || !cut.keep.length) errors.push('cut.json has no "keep": list the word ranges to keep, in the order they play.');
  for (const i of waits) if (!(i >= 0 && i < words.length)) errors.push(`"waits": ${i} is no word number (0–${words.length - 1})`);
  for (const i of waits) if (words[i] && words[i].kind !== "word") warnings.push(`"waits": ${i} is "${words[i].text}", no word said: a wait goes after the last word said before it`);
  const usedWaits = new Set();

  // the sound before and after a word in its own video, whether kept or not
  const before = (w) => (w.i > 0 && words[w.i - 1].clip === w.clip ? words[w.i - 1].end : 0);
  const after = (w) => (w.i + 1 < words.length && words[w.i + 1].clip === w.clip ? words[w.i + 1].start : voices[w.clip].duration);

  (cut.keep || []).forEach((keep, k) => {
    const r = range(keep.words);
    const name = `keep ${k + 1} (${keep.words})`;
    if (!r) return errors.push(`${name}: "words" is a range like "12-40"`);
    const [a, b] = r;
    if (a > b || b >= words.length) return errors.push(`${name}: the words are numbered 0–${words.length - 1}`);
    const items = words.slice(a, b + 1);
    const other = items.find((w) => w.clip !== items[0].clip);
    if (other) return errors.push(`${name} runs from video ${items[0].clip} into video ${other.clip}: end it at ${other.i - 1}, start the next keep at ${other.i}`);
    // a hook ("hook": true) shows a moment ahead that plays again in its place: its words may be
    // in another keep too; any other word plays once
    if (!keep.hook) {
      for (const w of items) {
        if (used.has(w.i)) return errors.push(`${name}: word ${w.i} "${w.text}" is in keep ${used.get(w.i) + 1} already (a hook that repeats a moment says "hook": true)`);
      }
      for (const w of items) used.set(w.i, k);
    } else {
      for (const w of items) hooked.add(w.i);
    }

    // the kept words in groups that play without a cut: a cut where a filler ("äh") is left
    // out, and where a pause is longer than maxPause (unless the keep says "sounds": "keep" or
    // "pauses": "keep", which plays its pauses as they are); between two groups the spans of
    // the pause in which the picture moves. Events ("[Kamera klackert]") stay.
    const groups = [];
    let cur = [];
    const close = () => { if (cur.length) groups.push(cur); cur = []; };
    for (const w of items) {
      if (w.kind === "filler" && keep.sounds !== "keep") {
        removed.push({ kind: "filler", clip: w.clip, from: w.start, to: w.end, words: [w.i, w.i], text: w.text });
        close();
        continue;
      }
      const last = cur.at(-1);
      if (last && waits.has(last.i) && w.start > last.end) {
        usedWaits.add(last.i);
        const parts = waitGroups(w.clip, last.end, w.start, moves);
        removed.push({ kind: "pause", wait: true, clip: w.clip, from: last.end, to: w.start, words: [last.i, w.i],
          moving: parts.map((s) => ({ from: +s.from.toFixed(3), to: +s.to.toFixed(3), rate: +(s.rate ?? speed(s.to - s.from)).toFixed(2) })) });
        close();
        groups.push(...parts);
      } else if (last && keep.pauses !== "keep" && w.start - last.end > maxPause) {
        const shown = moves(w.clip, last.end, w.start);
        removed.push({ kind: "pause", clip: w.clip, from: last.end, to: w.start, words: [last.i, w.i],
          moving: shown.map((s) => ({ from: +s.from.toFixed(3), to: +s.to.toFixed(3), rate: +speed(s.to - s.from).toFixed(2) })) });
        close();
        for (const s of shown) groups.push({ clip: w.clip, from: s.from, to: s.to });
      }
      cur.push(w);
    }
    close();
    // a wait after the keep's last word: the pause up to the next keep's first word, when that
    // follows in the same video
    const lastWord = items.filter((w) => w.kind === "word").at(-1);
    const nextRange = range(cut.keep[k + 1]?.words);
    const next = nextRange && words[nextRange[0]];
    if (lastWord && waits.has(lastWord.i) && next && next.clip === lastWord.clip && next.start > lastWord.end + 0.5) {
      usedWaits.add(lastWord.i);
      const parts = waitGroups(lastWord.clip, lastWord.end, next.start - 0.3, moves);
      removed.push({ kind: "pause", wait: true, clip: lastWord.clip, from: lastWord.end, to: next.start, words: [lastWord.i, next.i],
        moving: parts.map((s) => ({ from: +s.from.toFixed(3), to: +s.to.toFixed(3), rate: +(s.rate ?? speed(s.to - s.from)).toFixed(2) })) });
      groups.push(...parts);
    }
    groups.forEach((g, n) => {
      if (!Array.isArray(g)) {
        // what the picture shows in a pause, after the words before it and before the ones after
        const spokenBefore = groups.slice(0, n).reverse().find(Array.isArray), spokenAfter = groups.slice(n + 1).find(Array.isArray);
        const prev = pieces.at(-1);
        const from = Math.max(g.from, prev && prev.keep === k ? prev.out : -Infinity, spokenBefore ? spokenBefore.at(-1).end : -Infinity);
        // up to the quiet before the next words, where their own piece starts: a muted picture
        // must not take the breath and the first sound of a sentence
        const v = voices[g.clip];
        const to = Math.min(g.to, spokenAfter ? cutBefore(v.env, v.thr, spokenAfter[0].start, Math.max(from, before(spokenAfter[0]))) : Infinity);
        if (to - from >= 0.4) pieces.push({ clip: g.clip, in: from, out: to, words: [], keep: k, adjust: 0, rate: g.rate ?? speed(to - from), mute: true, wait: !!g.wait });
        return;
      }
      const v = voices[g[0].clip], first = g[0], last = g.at(-1);
      const from = Math.max(0, cutBefore(v.env, v.thr, first.start, before(first)));
      let to = Math.min(v.duration, cutAfter(v.env, v.thr, last.end, after(last)));
      // the keep's last words: held after they end, with their sound up to the next words of
      // the recording; a longer hold goes on with the picture alone
      let held = null;
      if (!groups.slice(n + 1).some(Array.isArray)) {
        const final = k === (cut.keep || []).length - 1;
        const hold = Number(keep.hold ?? (final ? settings.end : settings.tail)) || 0;
        const wanted = Math.min(v.duration, last.end + hold);
        to = Math.min(v.duration, Math.max(to, Math.min(wanted, after(last) - 0.12)));
        if (wanted - to >= 0.3) held = { clip: first.clip, in: to, out: wanted, words: [], keep: k, adjust: 0, rate: 1, mute: true, hold: true };
      }
      // the words' room before them is the picture's when it showed the pause
      const shown = pieces.at(-1);
      const start = shown?.mute && shown.keep === k ? Math.max(from, shown.out) : from;
      pieces.push({ clip: first.clip, in: start, out: to, words: g.map((w) => w.i), keep: k, adjust: Number(keep.gain) || 0 });
      if (held) pieces.push(held);
    });
  });

  for (const i of waits) {
    if (words[i]?.kind === "word" && !usedWaits.has(i)) warnings.push(`"waits": ${i} ("${words[i].text}") plays no wait: it must be the last word of a keep with a later keep after it, or a word inside a keep followed by a pause`);
  }

  // words in no keep: what the cut leaves out, in runs
  let run = null;
  for (const w of words) {
    const kept = used.has(w.i) || hooked.has(w.i);
    if (!kept && run && run.clip === w.clip && run.words[1] === w.i - 1) { run.words[1] = w.i; run.to = w.end; run.text.push(w.text); continue; }
    if (run) removed.push({ ...run, text: run.text.join(" ") });
    run = kept ? null : { kind: "dropped", clip: w.clip, from: w.start, to: w.end, words: [w.i, w.i], text: [w.text] };
  }
  if (run) removed.push({ ...run, text: run.text.join(" ") });
  removed.sort((x, y) => x.clip - y.clip || x.from - y.from);

  // pieces that follow each other in their video without a gap play as one
  pieces = pieces.reduce((out, p) => {
    const q = out.at(-1);
    if (q && q.clip === p.clip && q.keep === p.keep && Math.abs(p.in - q.out) < 0.04 && q.adjust === p.adjust && !q.mute && !p.mute) { q.out = p.out; q.words.push(...p.words); }
    else out.push({ ...p });
    return out;
  }, []);

  // on whole frames, one after the other; a piece that plays faster takes less time than its range
  let at = 0;
  pieces = pieces.filter((p) => {
    const rate = p.rate || 1;
    const frames = Math.round(((p.out - p.in) / rate) * fps);
    if (frames < 1) { if (p.words.length) warnings.push(`words ${p.words[0]}–${p.words.at(-1)} are shorter than a frame and left out`); return false; }
    p.out = p.in + (frames / fps) * rate;
    p.start = at / fps;
    p.duration = frames / fps;
    at += frames;
    return true;
  });

  // the level: pieces of one take (the same video, forward, of one keep or less than 5 s apart:
  // a pause cut out of a keep does not end its take) are measured together and get one gain,
  // so that the level does not jump inside a take
  const takes = [];
  for (const p of pieces) {
    if (p.mute) { p.lufs = null; p.gain = 0; continue; }
    const t = takes.at(-1), q = t?.pieces.at(-1);
    if (q && q.clip === p.clip && p.in >= q.out - 0.05 && (p.keep === q.keep || p.in - q.out < 5)) t.pieces.push(p);
    else takes.push({ clip: p.clip, pieces: [p] });
  }
  for (const t of takes) {
    const spans = t.pieces.map((p) => [p.in, p.out]);
    const total = spans.reduce((s, [a, b]) => s + b - a, 0);
    // under 3 s a level is guesswork: measure the take's surroundings too
    const pad = total < 3 ? (3 - total) / (2 * spans.length) : 0;
    t.lufs = loudness(voices[t.clip].blocks, spans.map(([a, b]) => [a - pad, b + pad]));
    const gain = t.lufs == null ? 0 : target - t.lufs;
    for (const p of t.pieces) {
      p.lufs = t.lufs;
      p.gain = +Math.max(-24, Math.min(24, gain + p.adjust)).toFixed(1);
    }
    const first = t.pieces[0].words[0], last = t.pieces.at(-1).words.at(-1);
    if (t.lufs == null) warnings.push(`words ${first}–${last}: no voice to measure, their level stays as recorded`);
    else if (gain > 24) warnings.push(`words ${first}–${last} are very quiet (${t.lufs} LUFS): raised by the most there is, 24 dB, still ${(gain - 24).toFixed(1)} dB short`);
    else if (gain > 15) warnings.push(`words ${first}–${last} were recorded quietly (${t.lufs} LUFS) and are raised by ${gain.toFixed(1)} dB: the room's noise rises with them, listen to that piece`);
  }

  // the cut's own words, timed in the cut (for subtitles), with the spelling of "fixes"
  const fixes = cut.fixes || {};
  const timed = [];
  for (const p of pieces) {
    for (const i of p.words) {
      const w = words[i];
      if (w.kind !== "word") continue;
      const text = fixes[i] ?? fixes[String(i)] ?? w.text;
      if (!text) continue;
      const s = p.start + Math.max(0, w.start - p.in), e = p.start + Math.min(p.duration, w.end - p.in);
      timed.push({ i, text, start: +s.toFixed(3), end: +Math.max(e, s + 0.05).toFixed(3) });
    }
  }
  return { pieces, removed, takes, words: timed, duration: at / fps, errors, warnings };
}
