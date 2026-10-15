// The settings a person changes on a built short, as HyperFrames composition variables.
//
// build.mjs declares them on the composition's <html data-composition-variables>: the world,
// the title, the speakers' names and colours, the end card. A harness that shows the
// composition can offer them as controls (pchat's HyperFrames project does) and keeps the
// values in the project's variables.json; `hyperframes render --variables-file` and the
// preview give them to the page as window.__hfVariables. Every layer applies them to the
// built plan when it loads (`applyVariables`, inlined into the compositions), and qa.mjs
// does the same, so the preview, the check and the video agree.
//
// What a variable cannot change takes a build: the format, the length (an end card that was
// not built), and over footage the step between a dark world and a light one (the light ones
// frame the clip).

import fs from "node:fs";
import path from "node:path";

export const WORLD_NAMES = ["cosmos", "aurora", "bokeh", "neon", "noir", "editorial", "geometry"];
const LIGHT = new Set(["editorial", "geometry"]);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// The worlds a variable may pick: over footage only those of the built kind.
export function worldChoices(plan) {
  if (!plan.video) return WORLD_NAMES;
  return WORLD_NAMES.filter((w) => LIGHT.has(w) === LIGHT.has(plan.world));
}

// [{id, type, label, default, options}] for data-composition-variables
export function declarations(plan) {
  const named = (plan.turns || []).length > 0;
  const out = [
    { id: "world", type: "enum", label: "World", default: plan.world,
      options: worldChoices(plan).map((w) => ({ value: w, label: cap(w) })) },
    { id: "title", type: "string", label: "Title", default: plan.title || "" },
    { id: "subtitle", type: "string", label: "Subtitle", default: plan.subtitle || "" },
  ];
  for (const sp of plan.speakers || []) {
    out.push({ id: `name_${sp.id}`, type: "string", label: `Name of voice ${sp.id}`, default: named ? sp.name : "" });
    out.push({ id: `color_${sp.id}`, type: "color", label: `Colour of voice ${sp.id}`, default: sp.color });
  }
  if (plan.cta) {
    out.push({ id: "cta", type: "string", label: "End card", default: plan.cta.text || "" });
    out.push({ id: "handle", type: "string", label: "Handle", default: plan.cta.handle || "" });
  }
  return out;
}

// The attribute value, escaped for single quotes.
export function declarationsAttribute(plan) {
  return JSON.stringify(declarations(plan)).replace(/&/g, "&amp;").replace(/'/g, "&#39;");
}

// The plan with the values set. Self-contained (no outer names), so that build.mjs inlines
// its source into the compositions; values that do not fit are left out.
export function applyVariables(plan, values) {
  if (!values || typeof values !== "object") return plan;
  var v = values, p = Object.assign({}, plan), light = { editorial: 1, geometry: 1 };
  var worlds = ["cosmos", "aurora", "bokeh", "neon", "noir", "editorial", "geometry"];
  if (typeof v.world === "string" && worlds.indexOf(v.world) >= 0 && (!plan.video || !light[v.world] === !light[plan.world])) p.world = v.world;
  if (typeof v.title === "string") p.title = v.title;
  if (typeof v.subtitle === "string") p.subtitle = v.subtitle;
  if (p.cta) {
    var cta = Object.assign({}, p.cta);
    if (typeof v.cta === "string") cta.text = v.cta;
    if (typeof v.handle === "string") cta.handle = v.handle;
    p.cta = cta;
  }
  var touched = false;
  p.speakers = (plan.speakers || []).map(function (sp) {
    var s = Object.assign({}, sp), name = v["name_" + sp.id], color = v["color_" + sp.id];
    if (typeof name === "string") { touched = true; s.name = name.trim(); }
    if (typeof color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(color)) s.color = color;
    return s;
  });
  if (touched) {
    // names given: a chip at every change of voice; none: no chips, the colours carry the turns
    var named = p.speakers.some(function (sp) { return sp.name && sp.name !== String(sp.id); });
    p.speakers = p.speakers.map(function (sp) { return sp.name ? sp : Object.assign({}, sp, { name: String(sp.id) }); });
    p.turns = [];
    if (named) (plan.phrases || []).forEach(function (ph) {
      if (ph.speaker != null && (!p.turns.length || p.turns[p.turns.length - 1].speaker !== ph.speaker)) p.turns.push({ t: ph.tIn, speaker: ph.speaker });
    });
  }
  return p;
}

// The values of a project, artifacts/<name>/variables.json beside its composition/.
export function readVariables(compositionDir) {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(compositionDir, "..", "variables.json"), "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
