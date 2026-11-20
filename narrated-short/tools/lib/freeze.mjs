// The room a freeze needs in the first beat's clip, counted in frames as agentitos' freeze-cutout
// counts it (cutout.mjs: STYLES, BLEND and its lead, 2026-11-20; copied, since a skill never imports
// another's code): 0.2 s of the clip before the frozen frame, and after it the pop, the blend back
// into the moving picture and 0.2 s more. At 30 fps that is 1.17 s for a strong pop, 0.93 s for a
// soft one; cutout.mjs says them rounded up to a tenth, 1.2 s and 1.0 s, and so does this skill's
// text (references/beats.md). build asks this before it runs freeze-cutout, so that the agent learns
// what is missing and by how much; where the two ever differ, freeze-cutout's own refusal still says it.

const POP = { strong: 0.7, soft: 0.45 };   // how long the picture stands, s
const BLEND = 0.25;                        // the cutout going out while the picture moves again, s
const LEAD = 0.2;                          // clip before the frozen frame, and after the blend, s

const r2 = (x) => Math.round(x * 100) / 100;
const upTenth = (x) => Math.ceil(x * 10 - 1e-9) / 10;

// the seconds a freeze needs before and after it, as the texts say them (rounded up to a tenth)
export function freezeNeeds(pop = "strong", fps = 30) {
  const lead = Math.ceil(LEAD * fps), tail = Math.round((POP[pop] ?? POP.strong) * fps) + Math.round(BLEND * fps) + lead;
  return { lead, tail, before: upTenth(lead / fps), after: upTenth(tail / fps) };
}

// whether a freeze at `at` s fits a clip of `seconds` s; where it does not, one sentence of what is
// missing, by how much, and what to do (null where it fits)
export function freezeRoom(at, seconds, pop = "strong", fps = 30) {
  const need = freezeNeeds(pop, fps);
  const n = Math.floor(seconds * fps + 0.5), k = Math.round(at * fps);
  if (k >= need.lead && k + need.tail <= n) return null;
  const len = r2(seconds), whole = r2(need.before + need.after);
  if (len < whole) return `the first beat is ${len} s long, ${r2(whole - len)} s short of the ${whole} s a freeze needs (${need.before} s before it, ${need.after} s after it): a longer first beat, or no "freeze"`;
  if (k < need.lead) return `the freeze at ${at} s has ${r2(Math.max(0, at))} s of the beat before it, ${r2(Math.max(0.01, need.before - at))} s short of the ${need.before} s it needs: "freeze" at ${need.before} s or later`;
  const left = r2(Math.max(0, len - at));
  return `the freeze at ${at} s has ${left} s of the ${len} s beat after it, ${r2(Math.max(0.01, need.after - left))} s short of the ${need.after} s it needs: "freeze" at ${r2(len - need.after)} s or earlier, or a longer first beat`;
}
