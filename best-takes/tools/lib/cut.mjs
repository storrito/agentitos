// From cut.json (which words to keep, in which order) to the pieces of the cut: where each one
// starts and ends in its video, where it sits in the cut, and how much louder or quieter it
// has to be so that every take sounds equally loud. A pause inside a keep becomes what its
// picture shows: where it moves no more than while the person speaks it goes (a jump cut),
// where something moves clearly more it stays, muted, and a long stretch of it plays faster (a
// timelapse). A wait the speaker announced
// ("let's wait until then", cut.json "waits") never goes: it plays as a timelapse when its
// picture moves, else it holds a few seconds before the cut, so that the viewer feels the time
// pass.
//
// Speech not written down (an item of kind "unwritten": voice the transcribe skill found no
// words for, nearly always an attempt it skipped) never passes for a pause: a keep that runs
// across one is an error until it says "unwritten": "cut" or "keep".
//
// Sound alone (settings.audio, no picture): a pause goes, and where the cut joins two stretches
// that were not one in the recording it lays the room's own quiet between them, as a cutter of
// narration does: BREATH.sentence after a sentence, BREATH.inside within one, a keep's "breath"
// (seconds) before it where it begins a new part. A wait plays its own sound.

import { cutBefore, cutAfter, loudness, HOP } from "./voice.mjs";
import { speed, waitSpeed, WAIT_MOVING, WAIT_HOLD, SAMPLES, BASE_SECONDS, BASE_LONGEST, MOVING, moving, median, limit } from "./motion.mjs";

// The spans of a wait from–to, as groups of the cut: the whole of it faster when its picture
// moves; else the first WAIT_HOLD seconds as they are, then what moves. A wait was announced,
// so any movement counts, not only more than while speaking.
function waitGroups(clip, from, to, motion) {
  const shown = moving(motion(clip, from, to), from, to);
  const moved = shown.reduce((t, s) => t + s.to - s.from, 0);
  if (moved >= WAIT_MOVING * (to - from)) return [{ clip, from, to, rate: waitSpeed(to - from), wait: true }];
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
// motion(clip, from, to): how much the picture moves from–to, [{ t, change }] (motion.mjs'
// activity); without it (--pauses tight) no pause shows anything
// returns { pieces, removed, words (the cut's, timed in the cut), motion (per video: how much
// it moves while speaking), errors, warnings }
// the room's quiet between two stretches of sound alone, seconds: as the hand-made cut of a
// six-minute narration read with retries had it (2026-11-18), on top of the quiet the cut points
// leave (about 0.25 s)
export const BREATH = { sentence: 0.42, inside: 0.2 };

// The quietest three seconds of a recording (blocks of 0.25 s, the window whose loudest block is
// the quietest), with no frame of voice in it (over `thr`): the room's own quiet. Without three
// such seconds, the longest quiet there is down to a quarter of a second; digital silence only
// when the room has nothing else. → { from, to }, or null when every quarter second holds voice
// (the breaths are silence then).
export function roomQuiet(env, thr = Infinity, seconds = 3) {
  const per = Math.round(0.25 / HOP), blocks = [];
  for (let f = 0; f + per <= env.length; f += per) {
    let sum = 0, top = 0;
    for (let k = f; k < f + per; k++) { sum += env[k] * env[k]; top = Math.max(top, env[k]); }
    blocks.push({ rms: Math.sqrt(sum / per), voice: top > thr });
  }
  for (let n = Math.min(Math.round(seconds / 0.25), blocks.length); n >= 1; n--) {
    let best = -1, least = Infinity, live = false;
    for (let i = 0; i + n <= blocks.length; i++) {
      const w = blocks.slice(i, i + n);
      if (w.some((b) => b.voice)) continue;
      const alive = Math.min(...w.map((b) => b.rms)) > 1e-5, top = Math.max(...w.map((b) => b.rms));
      if (best < 0 || (alive && !live) || (alive === live && top < least)) { best = i; least = top; live = alive; }
    }
    if (best >= 0) return { from: best * 0.25, to: (best + n) * 0.25 };
  }
  return null;
}

export function plan(words, cut, settings, voices, motion = null) {
  const errors = [], warnings = [], removed = [];
  const audio = !!settings.audio;
  const fps = settings.fps, maxPause = settings.pause;
  const used = new Map(), played = new Set();
  const waits = new Set((cut.waits || []).map(Number));
  const samples = motion || (() => []);

  // How much a video's picture moves while its person speaks: the median over the words of its
  // keeps, their pauses over maxPause left out; of long keeps the first part of each, together
  // BASE_LONGEST seconds. With under BASE_SECONDS of speech, the median over those stretches
  // whole, their pauses in. Measured the first time a pause of the video asks.
  const bases = {};
  const baseOf = (clip) => {
    if (bases[clip]) return bases[clip];
    const all = [], spoken = [];
    const keeps = (cut.keep || []).map((keep) => {
      const r = range(keep.words);
      return r && r[1] < words.length ? words.slice(r[0], r[1] + 1).filter((w) => w.clip === clip) : [];
    }).filter((items) => items.length);
    const share = Math.min(1, BASE_LONGEST / keeps.reduce((t, items) => t + items.at(-1).end - items[0].start, 0));
    for (const kept of keeps) {
      const end = kept[0].start + share * (kept.at(-1).end - kept[0].start);
      const items = kept.filter((w) => w.start < end);
      const got = samples(clip, items[0].start, end);
      all.push(...got);
      // the stretches of speech: words with less than maxPause between them, as one
      const talk = [];
      for (const w of items) {
        const last = talk.at(-1);
        if (last && w.start - last[1] <= maxPause) last[1] = Math.max(last[1], w.end);
        else talk.push([w.start, w.end]);
      }
      // a sample stands for the quarter second before it
      spoken.push(...got.filter((s) => talk.some(([a, b]) => s.t - 1 / SAMPLES >= a - 0.01 && s.t <= b + 0.01)));
    }
    const enough = spoken.length >= BASE_SECONDS * SAMPLES;
    const base = median(enough ? spoken : all);
    return (bases[clip] = { base, limit: limit(base), seconds: (enough ? spoken : all).length / SAMPLES, enough });
  };
  // a pause the tool decided on, in a few words for check (what it did and why), once its
  // pieces are known: { most: the most its picture changed, shown: spans that move, kept: s }
  const decided = new Map();
  const pauseWhy = (r, { most, shown, kept, fast }) => {
    if (audio) return "cut: sound alone, a breath of the room's quiet in its place";
    if (!motion) return "cut (tight)";
    if (!shown) return most < MOVING ? "cut: the picture stands still" : "cut: the picture moves no more than while speaking";
    if (!kept) return "cut: what moves in it is too short to show";
    const { base, limit: least } = baseOf(r.clip);
    return `${kept < r.to - r.from - 0.3 ? `${kept.toFixed(1)} s of it kept` : "kept"}${fast ? " as a timelapse" : ", muted"}: something moves in it` +
      (least > MOVING ? ` (${(most / base).toFixed(1)}× as much as while speaking)` : "");
  };
  const waitWhy = (parts) => (audio ? `the wait: ${WAIT_HOLD} s of it as recorded, then the cut` : parts.some((p) => p.rate > 1) ? "the wait: a timelapse, its picture moves" : `the wait: held ${WAIT_HOLD} s before the cut, its picture stands still`);
  let pieces = [];
  if (!Array.isArray(cut.keep) || !cut.keep.length) errors.push('cut.json has no "keep": list the word ranges to keep, in the order they play.');
  for (const i of waits) if (!(i >= 0 && i < words.length)) errors.push(`"waits": ${i} is no word number (0–${words.length - 1})`);

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
    // a word plays once, unless a keep says it plays it again ("again": true, a line said
    // later that opens the video as its hook); the other keeps never share a word
    if (!keep.again) {
      for (const w of items) {
        if (used.has(w.i)) return errors.push(`${name}: word ${w.i} "${w.text}" is in keep ${used.get(w.i) + 1} already (a line that should play twice, as a hook: "again": true on the keep that repeats it)`);
      }
      for (const w of items) used.set(w.i, k);
    }
    // voice without words inside the keep: the words around it may be of two attempts
    const unheard = items.filter((w) => w.kind === "unwritten");
    if (unheard.length && !["cut", "keep"].includes(keep.unwritten)) {
      return errors.push(`${name} runs across speech not written down (${unheard.map((u) => `[${u.i}] at ${u.start.toFixed(1)} s, ${(u.end - u.start).toFixed(1)} s long`).join("; ")}): voice the speech model wrote no words for, nearly always an attempt it skipped, so the words on either side may be of different attempts, a sentence spliced. End the keep before it, or start it after it at the first word of the attempt that follows; where the words after it begin in the middle of a sentence it holds that attempt's start: "unwritten": "keep" on the keep plays it as recorded ("unwritten": "cut" cuts it out)`);
    }
    if (keep.breath != null && !(Number.isFinite(Number(keep.breath)) && Number(keep.breath) >= 0)) return errors.push(`${name}: "breath" is the seconds of quiet before it, e.g. 1`);
    for (const w of items) played.add(w.i);

    // the kept words in groups that play without a cut: a cut where a filler ("äh") is left
    // out, and where a pause is longer than maxPause (unless the keep says "sounds": "keep" or
    // "pauses": "keep", which plays its pauses as they are); between two groups the spans of
    // the pause in which the picture moves more than while speaking. Events ("[Kamera
    // klackert]") stay.
    const groups = [];
    let cur = [];
    const close = () => { if (cur.length) groups.push(cur); cur = []; };
    for (const w of items) {
      if (w.kind === "filler" && keep.sounds !== "keep") {
        removed.push({ kind: "filler", clip: w.clip, from: w.start, to: w.end, words: [w.i, w.i], text: w.text });
        close();
        continue;
      }
      if (w.kind === "unwritten" && keep.unwritten === "cut") {
        removed.push({ kind: "unwritten", clip: w.clip, from: w.start, to: w.end, words: [w.i, w.i], why: 'speech not written down, cut as its keep says ("unwritten": "cut")' });
        close();
        continue;
      }
      const last = cur.at(-1);
      if (last && waits.has(last.i) && w.start > last.end) {
        const parts = waitGroups(w.clip, last.end, w.start, samples);
        removed.push({ kind: "pause", wait: true, clip: w.clip, from: last.end, to: w.start, words: [last.i, w.i], why: waitWhy(parts),
          moving: parts.map((s) => ({ from: +s.from.toFixed(3), to: +s.to.toFixed(3), rate: +(s.rate ?? speed(s.to - s.from)).toFixed(2) })) });
        close();
        groups.push(...parts);
      } else if (last && keep.pauses !== "keep" && w.start - last.end > maxPause) {
        // what moves more than while speaking
        const least = motion ? baseOf(w.clip).limit : MOVING;
        const got = samples(w.clip, last.end, w.start);
        const shown = moving(got, last.end, w.start, least);
        const pause = { kind: "pause", clip: w.clip, from: last.end, to: w.start, words: [last.i, w.i],
          moving: shown.map((s) => ({ from: +s.from.toFixed(3), to: +s.to.toFixed(3), rate: +speed(s.to - s.from).toFixed(2) })) };
        removed.push(pause);
        decided.set(pause, { most: Math.max(0, ...got.map((s) => s.change)), shown: shown.length, kept: 0, fast: false });
        close();
        for (const s of shown) groups.push({ clip: w.clip, from: s.from, to: s.to, pause });
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
      const parts = waitGroups(lastWord.clip, lastWord.end, next.start - 0.3, samples);
      removed.push({ kind: "pause", wait: true, clip: lastWord.clip, from: lastWord.end, to: next.start, words: [lastWord.i, next.i], why: waitWhy(parts),
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
        if (to - from < 0.4) return;
        // sound alone: a wait plays its own sound, as recorded
        pieces.push({ clip: g.clip, in: from, out: to, words: [], keep: k, adjust: 0, rate: audio ? 1 : g.rate ?? speed(to - from), mute: !audio, wait: !!g.wait });
        const d = decided.get(g.pause);
        if (d) { d.kept += to - from; d.fast ||= pieces.at(-1).rate > 1; }
        return;
      }
      const v = voices[g[0].clip], first = g[0], last = g.at(-1);
      const from = Math.max(0, cutBefore(v.env, v.thr, first.start, before(first)));
      const to = Math.min(v.duration, cutAfter(v.env, v.thr, last.end, after(last)));
      // the words' room before them is the picture's when it showed the pause
      const shown = pieces.at(-1);
      const start = shown && !shown.words.length && shown.keep === k ? Math.max(from, shown.out) : from;
      pieces.push({ clip: first.clip, in: start, out: to, words: g.map((w) => w.i), keep: k, adjust: Number(keep.gain) || 0 });
    });
  });

  for (const [pause, d] of decided) pause.why = pauseWhy(pause, d);

  // words in no keep: what the cut leaves out, in runs
  let run = null;
  for (const w of words) {
    if (!played.has(w.i) && run && run.clip === w.clip && run.words[1] === w.i - 1) { run.words[1] = w.i; run.to = w.end; run.text.push(w.text); continue; }
    if (run) removed.push({ ...run, text: run.text.join(" ") });
    run = played.has(w.i) ? null : { kind: "dropped", clip: w.clip, from: w.start, to: w.end, words: [w.i, w.i], text: [w.text] };
  }
  if (run) removed.push({ ...run, text: run.text.join(" ") });
  removed.sort((x, y) => x.clip - y.clip || x.from - y.from);

  // pieces that follow each other in their video without a gap play as one
  pieces = pieces.reduce((out, p) => {
    const q = out.at(-1);
    // (sound alone: a keep that asks for a breath before it stays a piece of its own)
    // and a wait (no words) stays one of its own, as on a video
    const breath = audio && q && q.keep !== p.keep && cut.keep[p.keep]?.breath != null;
    const wait = audio && q && (!q.words.length || !p.words.length);
    if (q && q.clip === p.clip && Math.abs(p.in - q.out) < 0.04 && q.adjust === p.adjust && !q.mute && !p.mute && !breath && !wait) { q.out = p.out; q.words.push(...p.words); }
    else out.push({ ...p });
    return out;
  }, []);

  // sound alone: the room's quiet where two stretches that were not one in the recording meet
  if (audio) {
    const rooms = {};
    const quietOf = (clip) => (rooms[clip] ??= { ...(roomQuiet(voices[clip].env, voices[clip].thr) ?? { silent: true, from: 0, to: 3 }), at: 0 });
    const fixes = cut.fixes || {};
    const out = [];
    for (const p of pieces) {
      const prev = out.at(-1);
      const asked = prev && prev.keep !== p.keep ? cut.keep[p.keep]?.breath : undefined;
      // a breath where two stretches of words meet; none beside a wait, which is the pause, unless the keep asks
      if (prev && p.words.length && (asked != null || (prev.words.length && !(prev.clip === p.clip && Math.abs(p.in - prev.out) < 0.04)))) {
        const said = [...prev.words].reverse().map((i) => words[i]).find((w) => w.kind === "word");
        let left = asked != null ? Math.max(0, Number(asked))
          : said && endsSentence(fixes[said.i] ?? said.text) ? BREATH.sentence : BREATH.inside;
        const room = quietOf(prev.clip), span = room.to - room.from;
        while (left > 0.005) {
          if (room.at + Math.min(left, span) > span + 1e-6) room.at = 0;
          const d = Math.min(left, span - room.at);
          // (a recording with no quarter second free of voice: silence)
          out.push({ clip: prev.clip, in: room.from + room.at, out: room.from + room.at + d, words: [], keep: p.keep, adjust: 0, rate: 1, quiet: true, ...(room.silent ? { mute: true } : {}) });
          room.at += d; left -= d;
        }
      }
      out.push(p);
    }
    pieces = out;
  }

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
    if (p.mute || !p.words.length) { p.lufs = null; p.gain = 0; continue; }
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
  }
  // the takes go to the loudest one's level, to one another only: the cut's voice as a whole is
  // brought to its loudness afterwards (voice-sound's level stage, lib/tracks.mjs), its peaks held
  const aim = Math.max(...takes.map((t) => t.lufs).filter((l) => l != null));
  for (const t of takes) {
    const gain = t.lufs == null ? 0 : aim - t.lufs;
    for (const p of t.pieces) {
      p.lufs = t.lufs;
      p.gain = +Math.max(-24, Math.min(24, gain + p.adjust)).toFixed(1);
    }
    const first = t.pieces[0].words[0], last = t.pieces.at(-1).words.at(-1);
    if (t.lufs == null) warnings.push(`words ${first}–${last}: no voice to measure, their level stays as recorded`);
    else if (gain > 24) warnings.push(`words ${first}–${last} are very quiet (${t.lufs} LUFS): raised by the most there is, 24 dB, still ${(gain - 24).toFixed(1)} dB short`);
    else if (gain > 15) warnings.push(`words ${first}–${last} were recorded quietly (${t.lufs} LUFS) and are raised by ${gain.toFixed(1)} dB: the room's noise rises with them, listen to that piece`);
  }

  // sound alone: what plays without words (the room's quiet, a wait) at the level of the take before it
  if (audio) {
    let gain = pieces.find((p) => p.words.length)?.gain ?? 0;
    for (const p of pieces) { if (p.words.length) gain = p.gain; else if (!p.mute) p.gain = gain; }
  }

  // the cut's own words, timed in the cut (for subtitles), with the spelling of "fixes"
  const fixes = cut.fixes || {};
  const timed = [];
  const lang = locale(settings.lang);
  let prior = null; // the item the cut plays right before, whatever its kind
  for (const p of pieces) {
    for (const i of p.words) {
      const w = words[i], played = prior;
      prior = i;
      if (w.kind !== "word") continue;
      const fixed = fixes[i] ?? fixes[String(i)];
      let text = fixed ?? w.text;
      if (!text) continue;
      // The text is read as the cut plays it, not as the speech model wrote the recording: what
      // stood right before this word in its video (a filler, which the text never shows, or
      // anything the cut left out) is gone, so the word may now begin a sentence it did not
      // begin before. Only the text changes; its number and its times stay.
      const last = timed.at(-1), was = w.i > 0 && words[w.i - 1].clip === w.clip ? words[w.i - 1] : null;
      const lost = !!was && (played !== was.i || was.kind === "filler" || (was.kind === "word" && last?.i !== was.i));
      if (lost && last) sentenceEndOfFiller(last, words.slice(last.i + 1, w.i), words[last.i].clip === w.clip);
      // a spelling the agent set in "fixes" is theirs (an account name may be lower-case on purpose)
      if (lost && fixed == null && (!last || endsSentence(last.text))) text = capitalised(text, lang);
      const s = p.start + Math.max(0, w.start - p.in), e = p.start + Math.min(p.duration, w.end - p.in);
      timed.push({ i, text, start: +s.toFixed(3), end: +Math.max(e, s + 0.05).toFixed(3) });
    }
  }
  return { pieces, removed, takes, words: timed, motion: bases, duration: at / fps, errors, warnings };
}

// A sentence ends on . ! ? or …, also inside quotes or brackets. Not after a token that begins with
// a digit ("3." is an ordinal in German, "12.03." a date) or one with a full stop inside ("z.B."):
// there the full stop is part of the token, and the word after it is left as the model wrote it.
export function endsSentence(text) {
  if (!/[.!?…]["'“”‘’»«)\]]*$/u.test(text)) return false;
  if (/^\p{N}/u.test(text)) return false;
  return !/\..*\./u.test(text);
}

// The first letter in upper case when it is a lower-case letter, by Unicode's rules for the
// language when one is known. A word that begins with a digit or a symbol stays as it is, and so
// does one with a capital inside ("iPhone", "eBay"): that is a name spelled so.
export function capitalised(text, lang = "und") {
  const [first, ...rest] = [...text];
  if (!/^\p{Ll}$/u.test(first) || /\p{Lu}/u.test(rest.join(""))) return text;
  return first.toLocaleUpperCase(lang) + rest.join("");
}

// The speech model sometimes ends a sentence on the filler ("fertig, äh. Und"): when the filler is
// cut out, that sentence end is the speaker's and goes onto the word before it, in place of the
// comma it had. Only when nothing but fillers and noises lie between the two words in one video;
// a comma a filler carried ("äh,") marks the filler, not the sentence, and goes with it.
function sentenceEndOfFiller(last, between, sameClip) {
  if (!sameClip || !between.length || between.some((w) => w.kind === "word") || endsSentence(last.text)) return;
  const mark = between.filter((w) => w.kind === "filler").at(-1)?.text.match(/[.!?…]+$/u)?.[0];
  if (mark) last.text = last.text.replace(/[,;:]+$/u, "") + mark;
}

// the language of the words as a locale for upper-casing; a tag Intl does not take counts as none
function locale(lang) {
  try { return lang ? Intl.getCanonicalLocales(lang)[0] : "und"; } catch { return "und"; }
}
