// The sweep's page: one small map per case and text need (which placement wins where, where the
// text goes), the thresholds in words and numbers, what the checker said. For people who change
// the weights: it shows at a glance what a change moves.
//
//   buildHtml(data) → html     data: what sweep.mjs writes as sweep.json
//
// Six kinds of placement: unchanged (neutral), zoom (blue), smaller (orange), a crop that fills
// the frame (aqua), a crop as a band (violet; which band, 4:5, 1:1 or of a free height, is said in
// the tooltip and the table), panel (yellow). The kinds that share a map (blue + orange; orange +
// aqua + violet; yellow + aqua) were checked against each other for contrast, in light and dark.
// Every tile also carries its text's place as a sign, and a table repeats the maps.

const KINDS = ["full", "zoom", "inset", "fill", "band", "panel"];
// the kind of a winner: a crop of the frame's own ratio fills the frame, any other is a band
const kindOf = (q, frame) => (q.fit === "crop" ? (q.crop === frame ? 3 : 4) : q.fit === "panel" ? 5 : KINDS.indexOf(q.fit));
const bandOf = (q, frame) => (q.fit !== "crop" || q.crop === frame ? 0 : q.crop === "4:5" ? 1 : q.crop === "1:1" ? 2 : 3);
const PLACES = ["none", "above-head", "below-chin", "beside", "band-above", "band-below", "beside-ground"];
const num = (v, d = 1) => Number(v).toFixed(d);
const fitName = (q) => (q.fit === "crop" ? `crop ${q.crop}` : q.fit);
const placeOf = (t) => (!t ? 0 : t.where === "beside" && t.on === "ground" ? 6 : PLACES.indexOf(t.where));
const mm = (v) => (v.length ? [Math.min(...v), Math.max(...v)] : null);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function buildHtml(data) {
  const { cells, cases, needs, grid, defaults: D, summary: S, checked, against } = data;
  const frameOf = Object.fromEntries(cases.map((c) => [c.id, c.frame]));
  const part = (c, n, pred = () => true) => cells.filter((q) => q.case === c && q.need === n && pred(q));
  const src = (c) => cases.find((q) => q.id === c).source;
  const top = (q) => 100 * q.face[1] / src(q.case)[1], chin = (q) => 100 * (q.face[1] + q.face[3]) / src(q.case)[1];
  const cap = (q) => q.text.find((t) => t.role === "caption"), hook = (q) => q.text.find((t) => t.role === "hook");
  const share = (n, of) => (n && Math.round(100 * n / of) === 0 ? "under 1 %" : `${Math.round(100 * n / of)} %`);

  // the cells, compact: [kind, scale of covering ×100, enlargement ×100, caption's place, hook's place, hook's font, soft signs, which band]
  const compact = {};
  for (const c of cases) for (const n of needs) {
    const list = [];
    for (const h of grid.height) for (const e of grid.eyes) for (const o of grid.offset) {
      const q = cells.find((x) => x.case === c.id && x.need === n.id && x.h === h && x.e === e && x.o === o);
      const soft = q.problems.reduce((m, p) => m | (p.level !== "soft" ? 0 : p.code === "crop" ? (p.kind === "face" ? 1 : 2) : p.code === "margin" ? (p.kind === "face" ? 4 : 8) : p.code === "enlarged" ? 16 : 0), 0);
      list.push([kindOf(q, c.frame), Math.round(q.zoom * 100), Math.round(q.enlargement * 100), placeOf(cap(q)), placeOf(hook(q)), hook(q)?.font || 0, soft, bandOf(q, c.frame)]);
    }
    compact[`${c.id}.${n.id}`] = list;
  }

  // ---- the thresholds, per case -------------------------------------------------------------
  const capFont = (tall) => (tall ? D.caption.font.tall : D.caption.font.wide), capH = (n, tall) => (n * D.caption.line + D.caption.padEm) * capFont(tall);
  const rules = {};
  {
    // (a) upright into 9:16
    const z = S.a, [W, H] = z.size, s = z.safe, w = z.wide, n = z.needs;
    const pH = (px) => `${num(100 * px / H)} % of the frame's height (${Math.round(px)} px)`;
    const below = (lines, fh) => 100 * (s[1] + s[3] - capH(lines, true) - Math.max(D.free.belowMin, D.free.below * fh * H / 100)) / H;
    const hookMin = D.hookCard.minFont * D.hookCard.heightEm, hookFull = D.hookCard.font * D.hookCard.heightEm, up = D.free.aboveMin;
    const zooms = mm(["cap1", "cap2", "hook", "hookcap2"].flatMap((k) => n[k].zoomRange || []));
    rules.a = [
      ["Unchanged", `the picture passes as long as the face lies in the safe box and the text has room: the hairline no higher than ${pH(s[1])}, the chin no lower than ${pH(s[1] + s[3])}, the right cheek not past ${num(100 * (s[0] + s[2]) / W)} % of the width (${s[0] + s[2]} px), the left one not before ${num(100 * s[0] / W)} % (${s[0]} px). Up to ${n.cap1.allFullUpTo} % face height that holds for every cell of the grid (one or two caption lines); in all for ${share(n.cap1.fits.full, n.cap1.cells)} of the cells with one line, ${share(n.hookcap2.fits.full, n.hookcap2.cells)} with a hook plus two lines.`],
      ["Captions below or above:", `They stay below the chin as long as there is room under it down to the safe box's bottom: the chin at ${num(below(1, 50))}–${num(below(1, 15))} % of the frame's height at most for one line (a large to a small face), ${num(below(2, 50))}–${num(below(2, 15))} % for two. With the chin lower they stand above the head. In the grid: below up to a chin at ${num(n.cap1.chin.below[1])} %, above from ${num(n.cap1.chin.above[0])} % (one line); ${num(n.cap2.chin.below[1])} % and ${num(n.cap2.chin.above[0])} % (two).`],
      ["Room above the head", `needs the hairline at ${pH(s[1] + capH(1, true) + up)} at least for one line, ${pH(s[1] + capH(2, true) + up)} for two, ${pH(w[1] + hookMin + up)} for the hook card at its smallest (${D.hookCard.minFont} px type; ${num(100 * (w[1] + hookFull + up) / H)} % at its full ${D.hookCard.font} px), ${pH(w[1] + hookMin + D.gap + capH(2, true) + up)} for a hook plus two lines (${num(100 * (w[1] + hookFull + D.gap + capH(2, true) + up) / H)} % with the full card). With the eyes at 25–30 % of the height the card lacks this room even with a small face.`],
      ["A zoom", `wins where the face only just leaves the safe box or sits a little too high: ${num(zooms[0], 2)}× to ${num(zooms[1], 2)}× in the grid. It does not help when the face and the text together are taller than the safe box (${s[3]} px): zooming makes the face larger.`],
      ["Only smaller", `(the picture smaller over a blurred ground) does it pass from ${n.cap1.onlySmallerFrom} % face height with captions, from ${n.hook.onlySmallerFrom} % with a hook, from ${n.hookcap2.onlySmallerFrom} % with a hook plus two lines. In the grid the picture shrinks to between ${num(n.cap1.insetRange[1], 2)} and ${num(n.cap2.insetRange[0], 2)} of its size (captions) and down to ${num(n.hookcap2.insetRange[0], 2)} (a hook plus lines). With the head very high (the eyes at 25 %) the picture moves down and the card stands on the ground above it.`],
    ];
  }
  // what the cells of one case say, in general terms: which kind wins how often, by text need, by
  // face height, and where the text goes
  const W8 = D.weights, PLACE_EN = { "above-head": "above the head", "below-chin": "below the chin", beside: "beside the face", "beside (ground)": "on the ground beside the picture", "band-above": "on the ground above the picture", "band-below": "on the ground below the picture", none: "without a place" };
  const KIND_EN = ["unchanged", "zoomed in", "the whole picture smaller", "a crop that fills the frame", "a crop as a band", "a panel"];
  const general = (id) => {
    const cs = cases.find((q) => q.id === id), all = cells.filter((q) => q.case === id), N = all.length, [sw, sh] = cs.source, [W, H] = S[id].size;
    const kind = (q) => kindOf(q, cs.frame), s0 = Math.max(W / sw, H / sh), sc = Math.min(W / sw, H / sh);
    // a source of another ratio than the frame: "unchanged" is its middle filling the frame
    const names = Math.abs((sw / sh) / (W / H) - 1) < 0.02 ? KIND_EN : ["the picture's middle fills the frame", KIND_EN[1], KIND_EN[2], "a crop around the face that fills the frame", KIND_EN[4], KIND_EN[5]];
    const shares = (list) => [0, 3, 1, 4, 2, 5].map((k) => [k, list.filter((q) => kind(q) === k).length]).filter(([, n]) => n).map(([k, n]) => `${names[k]} ${share(n, list.length)}`).join(", ");
    const bands = all.filter((q) => kind(q) === 4), bandNames = [["4:5", (q) => q.crop === "4:5"], ["1:1", (q) => q.crop === "1:1"], ["of a free height", (q) => q.crop === "band"]].map(([n, f]) => [n, bands.filter(f).length]).filter(([, n]) => n);
    const fills = (q) => [0, 1, 3].includes(kind(q));
    const upTo = (nid) => grid.height.filter((h) => grid.height.filter((x) => x <= h).every((x) => part(id, nid, (q) => q.h === x).every(fills))).at(-1);
    const never = (nid) => grid.height.find((h) => grid.height.filter((x) => x >= h).every((x) => !part(id, nid, (q) => q.h === x).some(fills)));
    const places = (role) => {
      const t = {}, list = all.filter((q) => needs.find((n) => n.id === q.need).needs.some((x) => x.role === role));
      for (const q of list) { const x = q.text.find((y) => y.role === role), k = !x ? "none" : x.where === "beside" && x.on === "ground" ? "beside (ground)" : x.where; t[k] = (t[k] || 0) + 1; }
      return Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${PLACE_EN[k] || k} ${share(n, list.length)}`).join(", ");
    };
    const hooks = all.filter((q) => hook(q)), fullHook = hooks.filter((q) => !hook(q).shrunk).length;
    const sizeLine = (nid, label) => { const u = upTo(nid), n = never(nid); return `${label}: ${u ? `up to ${u} % face height in every cell` : "at no face height in every cell"}${n ? `, from ${n} % in none` : ""}`; };
    return [
      ["What wins:", `${shares(all)}${bandNames.length ? ` (bands: ${bandNames.map(([n, k]) => `${n} in ${k} cells`).join(", ")})` : ""}. To fill the frame the source is enlarged ${num(s0, 2)}×${s0 > W8.enlarge.forbiddenFrom ? ` (over ${W8.enlarge.forbiddenFrom}×: forbidden)` : s0 > W8.enlarge.softFrom ? ` (over ${num(W8.enlarge.softFrom, 1)}×: a soft problem that costs ${num(Math.max(0, (s0 - W8.enlarge.softFrom) / (W8.enlarge.forbiddenFrom - W8.enlarge.softFrom)) * W8.enlarge.costAtForbidden, 2)} points)` : ` (up to ${num(W8.enlarge.softFrom, 1)}× that costs nothing)`}, as the whole picture it stands at ${num(sc, 2)}× with ${Math.round(100 * (1 - (sc * sw * sc * sh) / (W * H)))} % ground.`],
      ["By text need:", needs.map((n) => `${n.name}: ${shares(part(id, n.id))}`).join("; ") + "."],
      ["Filling the frame, by face height", `(the picture's middle, a zoom or a crop around the face, no ground). ${sizeLine("cap1", "One caption line")}; ${sizeLine("hookcap2", "a hook plus two lines")}.`],
      ["Captions:", `${places("caption")}.`],
      ["Hook:", `${places("hook")}; at its full size in ${share(fullHook, hooks.length)} of the cells with a hook.`],
    ];
  };
  {
    // (b) wide into 9:16: the general lines, and what a source of 720 lines changes
    const fullS = 1920 / 720, bandS = 1350 / 720, sqS = 1080 / 720;
    rules.b = [...general("b"),
      ["With 720 lines", `(a source of 1280×720, the still people judged) the crop that fills the frame would be enlarged ${num(fullS, 2)}× and drops out (over ${W8.enlarge.forbiddenFrom}×). Then the 4:5 band leads (${num(bandS, 2)}×, mildly soft, ${num(Math.max(0, bandS - W8.enlarge.softFrom) / (W8.enlarge.forbiddenFrom - W8.enlarge.softFrom) * W8.enlarge.costAtForbidden, 2)} points) before the square (${num(sqS, 1)}×, crisp) and the whole picture as a strip.`]];
  }
  {
    // (c) upright into 16:9
    const z = S.c, [W, H] = z.size, all = cells.filter((q) => q.case === "c"), panels = all.filter((q) => q.fit === "panel"), sc = H / src("c")[1];
    const small = panels.filter((q) => q.scale < sc - 0.001), right = panels.filter((q) => q.side === "right"), crops = all.filter((q) => q.fit !== "panel");
    rules.c = [
      ["The panel", `wins in ${panels.length} of ${all.length} cells: the whole take as a tall panel (${num(sc * src("c")[0])}×${H} px), the text beside it on the ground, the hook at the top of the column at ${D.hookBig.font} px, the captions at its bottom.`],
      ["The 16:9 crop", `around the face wins in ${crops.length} cells${crops.length ? `: only with a small face (${Math.min(...crops.map((q) => q.h))}–${Math.max(...crops.map((q) => q.h))} % of the source's height) that has room in the crop together with the text` : ""}. It enlarges the source ${num(W / src("c")[0], 2)}× and shows only ${Math.round(100 * (H / (W / src("c")[0])) / src("c")[1])} % of its height; in return it fills the frame, and the face is ${num((W / src("c")[0]) / sc, 1)} times as large as in the panel. Whether it is really to be preferred to the panel nobody has judged on pictures yet.`],
      ["Smaller than the frame's height", `is the panel in ${small.length} cells (down to ${panels.length ? num(Math.min(...panels.map((q) => q.scale)) / sc, 2) : "–"} of the height): whenever the hairline lies higher than ${num(100 * z.safe[1] / H)} % of the source's height or the chin lower than ${num(100 * (z.safe[1] + z.safe[3]) / H)} %.`],
      ["Left or right:", `The panel stands on the left, except in ${right.length} cells with a hook in which a large face (from ${right.length ? Math.min(...right.map((q) => q.h)) : "–"} % height) sits left of the middle.`],
      general("c")[3], general("c")[4],
    ];
  }
  for (const id of ["e", "f", "g", "h"]) if (S[id]) rules[id] = general(id);
  {
    // (d) wide into 16:9
    const z = S.d, [W, H] = z.size, s = z.safe, n = z.needs, mid = (q) => q.o === 0;
    const pH = (px) => `${num(100 * px / H)} % of the frame's height (${Math.round(px)} px)`;
    const c1 = part("d", "cap1", (q) => mid(q) && q.fit === "full"), c2 = part("d", "cap2", (q) => mid(q) && q.fit === "full");
    const belowMax = (list) => num(Math.max(...list.filter((q) => cap(q).where === "below-chin").map(chin))), elseMin = (list) => num(Math.min(...list.filter((q) => cap(q).where !== "below-chin").map(chin)));
    const hk = part("d", "hook", (q) => q.fit === "full"), hb = D.hookBig;
    const zooms = mm(["cap1", "cap2", "hook", "hookcap2"].flatMap((k) => n[k].zoomRange || []));
    const besideFull = part("d", "hook", (q) => mid(q) && q.fit === "full" && hook(q).where === "beside");
    rules.d = [
      ["Unchanged", `the picture passes in ${share(n.cap1.fits.full, n.cap1.cells)} of the cells with captions and in ${share(n.hook.fits.full, n.hook.cells)} with a hook: up to ${n.cap1.allFullUpTo} % face height always (captions), up to ${n.hook.allFullUpTo} % with a hook too. The face must lie between ${pH(s[1])} and ${pH(s[1] + s[3])}.`],
      ["Captions below or beside:", `They stand at the bottom on the frame's middle as long as there is room under the chin; else they move into a column beside the face (at least ${D.caption.minWidth.wide} px wide), seldom above the head. In the grid, with the face in the middle: below up to a chin at ${belowMax(c1)} % of the frame's height, beside from ${elseMin(c1)} % (one line); ${belowMax(c2)} % and ${elseMin(c2)} % (two). The span comes from the margin under the chin, which grows with the face. A face that sits to one side leaves the frame's middle free for longer.`],
      ["Hook:", `Two big lines need ${hb.minFont * hb.widthEm} px of width and ${Math.round(hb.minFont * hb.heightEm)} px of height. They stand above the head from a hairline at ${num(Math.min(...hk.filter((q) => hook(q).where === "above-head").map(top)))} % of the frame's height. With it higher they stand beside the face: unchanged that works with the face in the middle up to ${besideFull.length ? Math.max(...besideFull.map((q) => q.h)) : "–"} % face height, above that a zoom (${zooms ? `${num(zooms[0], 2)}× to ${num(zooms[1], 2)}×` : "none in this grid"}) pushes the face to the side.`],
      ["Smaller", `the picture gets only in ${share(n.hook.fits.inset || 0, n.hook.cells)} of the cells with a hook (${share(n.cap1.fits.inset || 0, n.cap1.cells)} with captions): with a large face at the very top or the very bottom of the picture${n.hook.insetRange ? `, to between ${num(n.hook.insetRange[0], 2)} and ${num(n.hook.insetRange[1], 2)} of its size` : ""}.`],
    ];
  }

  const caseHead = Object.fromEntries(cases.map((c) => [c.id, `${c.name[0].toUpperCase()}${c.name.slice(1).replace(" source ", ` source (${c.source.join("×")}) `)}`]));
  // the weights: the terms, and, for a sweep run with other weights than the skill's, how many
  // winners they change
  const W9 = D.weights;
  const movedOf = (c) => { const m = Object.entries(against.cases[c.id].moves).sort((a, b) => b[1] - a[1])[0]; return `${c.id}: ${against.cases[c.id].changed} of ${against.cases[c.id].cells}${m ? ` (most often ${esc(m[0])}, ${m[1]} cells)` : ""}`; };
  const weightsCard = `<div class="card">
  <h2>The ranking's weights</h2>
  <p>A candidate with a hard problem ranks behind every one without, one that leaves a text without a place behind every one that places it. After that points count (fewer is better), from <code>${esc(against ? against.weights : "weights.json")}</code>:</p>
  <ul class="plain">
    <li><b>Enlargement:</b> free up to ${num(W9.enlarge.softFrom, 2)}×, over it a soft problem with a cost that rises in a straight line to ${num(W9.enlarge.costAtForbidden, 1)} points at ${num(W9.enlarge.forbiddenFrom, 2)}×; over that forbidden. (People judged stills of one take: 1.5× crisp, 1.875× mildly soft but fine, 2.67× too soft to publish.)</li>
    <li><b>The subject's size:</b> ${num(W9.subject.worth, 2)} points off for every per cent of the frame's height the face is tall, up to ${W9.subject.enough} %.</li>
    <li><b>Visible ground:</b> ${num(W9.ground.cost, 2)} points for every per cent of the frame the sharp picture does not fill.</li>
    <li><b>Small terms:</b> ${num(W9.soft.cost, 2)} for a soft problem, ${num(W9.text.away, 2)} for every step a text stands from its usual place, ${num(W9.text.hookSmaller, 2)} for a hook made smaller.</li>
  </ul>
  ${against ? `<p>Against the skill's own weights the winner changes in so many cells: ${cases.map(movedOf).join("; ")}.</p>` : ""}
</div>`;
  const sections = cases.map((c) => `
<section class="case" id="case-${c.id}" data-case="${c.id}">
  <h2><span class="tag">${c.id}</span>${caseHead[c.id]}</h2>
  <p class="sub">Zones for ${esc(S[c.id].platforms.join(", "))} (the usual ones of the frame, asked of platform-zones).</p>
  <div class="maps">${needs.map((n) => `
    <figure class="map" data-need="${n.id}"><figcaption>${esc(n.name[0].toUpperCase() + n.name.slice(1))}</figcaption><div class="plot" tabindex="0" role="img" aria-label="${esc(caseHead[c.id])}, ${esc(n.name)}: a map of the winning placement by face height and eye line; the same values are in the table below"></div><div class="xlab">Eye line, % of the source's height from the top</div></figure>`).join("")}
  </div>
  <h3>Thresholds</h3>
  <ol class="rules">${rules[c.id].map(([t, x]) => `<li><b>${esc(t)}</b> ${esc(x).replace(/ %/g, "\u00a0%").replace(/(\d) px/g, "$1\u00a0px")}</li>`).join("")}</ol>
  <details class="tab"><summary>The four maps as a table</summary><div class="scroll"><table></table></div></details>
</section>`).join("");

  const differ = (d) => { const list = Object.entries(d || {}); return list.length ? ` (the others: ${list.map(([k, n]) => `${n} × ${esc(k)}`).join("; ")})` : ""; };
  const ck = checked ? `<p>Each of the ${checked.boxes.n.toLocaleString("en-GB")} winners went with its boxes through platform-zones' checker (<code>zones.mjs layout</code>): ${checked.boxes.fails} fail, and for ${checked.boxes.agree.toLocaleString("en-GB")} every finding agrees too${differ(checked.boxes.differences)}. ${checked.pages.n} of them were measured as a page in Chrome by their letters: ${checked.pages.fails} fail, ${checked.pages.agree} agree in every finding${differ(checked.pages.differences)}.</p>` : `<p>This run was computed without the checker.</p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Placement sweep</title>
<style>
:root{color-scheme:light;--page:#f9f9f7;--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--border:rgba(11,11,11,.10);
--f-full:#e1e0d9;--f-zoom:#2a78d6;--f-inset:#eb6834;--f-fill:#1baf7a;--f-band:#6250d6;--f-panel:#eda100;--on-full:#0b0b0b;--on-fill:#fff;--on-panel:#0b0b0b}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,.10);
--f-full:#383835;--f-zoom:#3987e5;--f-inset:#d95926;--f-fill:#199e70;--f-band:#9085e9;--f-panel:#c98500;--on-full:#f0efec;--on-fill:#fff;--on-panel:#fff}}
:root[data-theme="dark"]{color-scheme:dark;--page:#0d0d0d;--surface:#1a1a19;--ink:#f0efec;--ink2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,.10);
--f-full:#383835;--f-zoom:#3987e5;--f-inset:#d95926;--f-fill:#199e70;--f-band:#9085e9;--f-panel:#c98500;--on-full:#f0efec;--on-fill:#fff;--on-panel:#fff}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1240px;margin:0 auto;padding:28px 16px 64px}
h1{font-size:28px;line-height:1.2;margin:0 0 8px;text-wrap:balance}
h2{font-size:19px;margin:0 0 2px;display:flex;align-items:baseline;gap:10px}
h3{font-size:15px;margin:22px 0 6px}
p{margin:0 0 10px;max-width:78ch}
.lead{color:var(--ink2);font-size:16px}
.sub{color:var(--ink2);font-size:13px}
.tag{font-size:13px;font-weight:600;color:var(--ink2);border:1px solid var(--border);border-radius:6px;padding:0 7px;text-transform:uppercase}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
.card,.case{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px 18px 16px;margin-top:18px}
.key{display:flex;flex-wrap:wrap;gap:8px 18px;margin:8px 0 0;padding:0;list-style:none;font-size:13px;color:var(--ink2)}
.key li{display:flex;align-items:center;gap:6px}
.sw{width:14px;height:14px;border-radius:3px;flex:none}
.sign{font-size:12px;color:var(--ink);width:14px;text-align:center}
.toc{display:flex;flex-wrap:wrap;gap:6px 14px;margin:10px 0 0;font-size:13px}
.toc a{color:var(--ink2);text-decoration:none;display:flex;align-items:baseline;gap:6px}
.toc a:hover{color:var(--ink);text-decoration:underline}
.case{scroll-margin-top:64px}
.filter{position:sticky;top:0;z-index:5;background:var(--page);padding:12px 0 10px;margin-top:14px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;border-bottom:1px solid var(--grid)}
.filter .label{font-size:13px;color:var(--ink2)}
.seg{display:flex;flex-wrap:wrap;gap:4px}
.seg button{font:inherit;font-size:13px;font-variant-numeric:tabular-nums;color:var(--ink2);background:transparent;border:1px solid var(--border);border-radius:7px;padding:4px 10px;cursor:pointer}
.seg button:hover{background:var(--grid)}
.seg button[aria-pressed="true"]{background:var(--ink);color:var(--surface);border-color:var(--ink)}
.maps{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:22px 20px;margin-top:14px}
figure{margin:0;min-width:0}
figcaption{font-size:13px;font-weight:600;margin:0 0 6px 30px}
.plot{display:grid;grid-template-columns:28px repeat(${grid.eyes.length},minmax(0,1fr));gap:2px;outline:none;border-radius:6px}
.plot:focus-visible{box-shadow:0 0 0 2px var(--f-zoom)}
.yt,.xt{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums;display:flex;align-items:center;justify-content:center}
.yt{justify-content:flex-end;padding-right:6px}
.xt{height:18px}
.ylab{font-size:11px;color:var(--muted);margin:0 0 4px 30px}
.xlab{font-size:11px;color:var(--muted);margin:2px 0 0 30px}
.tile{height:36px;border-radius:3px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:10px;line-height:1.25;font-weight:600;letter-spacing:.02em;color:var(--on-fill);cursor:default;white-space:nowrap;overflow:visible}
.tile.on{box-shadow:0 0 0 2px var(--surface),0 0 0 4px var(--ink)}
.f0{background:var(--f-full);color:var(--on-full)}.f1{background:var(--f-zoom)}.f2{background:var(--f-inset)}.f3{background:var(--f-fill)}.f4{background:var(--f-band)}.f5{background:var(--f-panel);color:var(--on-panel)}
.rules{margin:0;padding-left:20px;max-width:92ch}
.rules li{margin:0 0 7px;color:var(--ink2)}
.rules b{color:var(--ink);font-weight:600}
details.tab{margin-top:12px;font-size:13px}
details.tab summary{cursor:pointer;color:var(--ink2)}
.scroll{overflow-x:auto;margin-top:8px}
table{border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums;min-width:720px}
th,td{text-align:left;padding:4px 10px 4px 0;border-bottom:1px solid var(--grid);vertical-align:top}
th{font-weight:600;color:var(--ink2)}
#tip{position:fixed;z-index:20;pointer-events:none;background:var(--surface);color:var(--ink);border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:9px 11px;font-size:12.5px;line-height:1.45;max-width:290px;display:none}
#tip b{display:block;font-size:14px;margin-bottom:2px}
#tip span{display:block;color:var(--ink2)}
ul.plain{margin:0;padding-left:20px;max-width:92ch;color:var(--ink2)}
ul.plain li{margin-bottom:5px}
</style></head>
<body><main>
<h1>Placement sweep</h1>
<p class="lead">Where the face sits in a recording decides how the picture goes into the frame and where the text goes. The solver computed that for ${cells.length.toLocaleString("en-GB")} made-up cases: faces from ${grid.height[0]} to ${grid.height.at(-1)} % of the source's height, the eye line at ${grid.eyes[0]} to ${grid.eyes.at(-1)} %, the face up to ${grid.offset.at(-1)} % of the width off the middle, in ${cases.length} pairs of source and frame (9:16, 16:9, 4:5, 1:1) with ${needs.length} text needs each. No face here is a real one: read the maps as what the weights do, not as what looks good.</p>
<nav class="toc" aria-label="Cases">${cases.map((c) => `<a href="#case-${c.id}"><span class="tag">${c.id}</span>${caseHead[c.id].replace(/ \(\d+×\d+\)/, "")}</a>`).join("")}</nav>

<div class="card">
  <h2>How to read the maps</h2>
  <p>Every cell is a face: larger towards the top, lower in the picture towards the right. The colour says which placement wins, the signs in the cell where the text goes (H hook, C captions). The pointer or the arrow keys give the numbers, and under every case the same values stand as a table.</p>
  <ul class="key" aria-label="Placements">
    <li><span class="sw" style="background:var(--f-full)"></span>Unchanged (a source of another shape: its middle fills the frame)</li>
    <li><span class="sw" style="background:var(--f-zoom)"></span>Zoomed in</li>
    <li><span class="sw" style="background:var(--f-fill)"></span>A crop around the face that fills the frame</li>
    <li><span class="sw" style="background:var(--f-band)"></span>A crop as a band (4:5, 1:1 or of a free height)</li>
    <li><span class="sw" style="background:var(--f-inset)"></span>The whole picture smaller over a ground</li>
    <li><span class="sw" style="background:var(--f-panel)"></span>A panel at one side</li>
  </ul>
  <ul class="key" aria-label="Places of the text">
    <li><span class="sign">▲</span>above the head</li>
    <li><span class="sign">▼</span>below the chin</li>
    <li><span class="sign">▶</span>beside the face</li>
    <li><span class="sign">△</span>on the ground above the picture</li>
    <li><span class="sign">▽</span>on the ground below the picture</li>
    <li><span class="sign">▷</span>on the ground beside the picture</li>
  </ul>
</div>

<div class="filter" role="group" aria-label="Where the face sits across">
  <span class="label">The face across, % of the source's width off the middle</span>
  <div class="seg">${grid.offset.map((o) => `<button type="button" data-o="${o}" aria-pressed="${o === 0}">${o > 0 ? "+" : o < 0 ? "−" : ""}${Math.abs(o)}${o === 0 ? " (middle)" : ""}</button>`).join("")}</div>
</div>
${sections}

${weightsCard}

<div class="card">
  <h2>Against the checker</h2>
  ${ck}
</div>

<div class="card">
  <h2>Assumptions</h2>
  <ul class="plain">
    <li>A face is ${num(data.face.aspect, 2)} times as wide as it is tall (hairline to chin, cheek to cheek), its eyes ${Math.round(100 * data.face.eyes)} % below its top.</li>
    <li>Captions: ${D.caption.font.tall} px type in 9:16, 4:5 and 1:1, ${D.caption.font.wide} px in 16:9, line height ${num(D.caption.line, 2)}, set on the frame's middle and as wide as the centred safe box (in 1:1 at most as wide as the profile grid's 3:4 crop shows).</li>
    <li>A hook in 9:16: a card of two lines across the wide stretch, ${D.hookCard.font} px type, which may shrink to ${D.hookCard.minFont} px; in 4:5 and 1:1 (no wide stretch) the same card at the top of the safe box. In 16:9: two big lines, ${D.hookBig.font} px, down to ${D.hookBig.minFont} px.</li>
    <li>Free means: not in the face and not in its margin. Above the hairline ${Math.round(100 * D.free.above)} % of the face's height (at least ${D.free.aboveMin} px), below the chin ${Math.round(100 * D.free.below)} % (at least ${D.free.belowMin} px), beside the cheeks ${Math.round(100 * D.free.beside)} % of the face's width. Whether the wall there is calm the solver does not see.</li>
    <li>Enlarging the source's pixels over ${num(D.weights.enlarge.softFrom, 2)}× is a soft problem, over ${D.weights.enlarge.forbiddenFrom}× a hard one. The weights were set by hand from one judged still, not yet from measurements of published videos.</li>
    <li>The zones come from platform-zones at every run, the solver holds none of their numbers. Made ${esc(data.made)}.</li>
  </ul>
</div>
</main>
<div id="tip" role="status"></div>
<script>
const G = ${JSON.stringify(grid)}, NEEDS = ${JSON.stringify(needs.map((n) => ({ id: n.id, name: n.name })))}, CELLS = ${JSON.stringify(compact)};
const FIT = ["Unchanged", "Zoomed in", "Smaller", "A crop that fills the frame", "A crop as a band", "A panel at one side"];
const BAND = ["", " 4:5", " 1:1", " of a free height"];
const SAME = ${JSON.stringify(Object.fromEntries(cases.map((c) => [c.id, Math.abs((c.source[0] / c.source[1]) / (S[c.id].size[0] / S[c.id].size[1]) - 1) < 0.02])))};
const SIGN = ["", "▲", "▼", "▶", "△", "▽", "▷"];
const PLACE = ["without a place", "above the head", "below the chin", "beside the face", "on the ground above the picture", "on the ground below the picture", "on the ground beside the picture"];
const nH = G.height.length, nE = G.eyes.length, nO = G.offset.length;
let off = G.offset.indexOf(0);
const num = (v, d) => v.toFixed(d);
const cell = (key, hi, ei) => CELLS[key][(hi * nE + ei) * nO + off];
function fitText(c, cid) {
  const [f, z, enl] = c;
  if (f === 0 && !SAME[cid]) return "The picture's middle fills the frame, the source at " + num(enl / 100, 2) + "×";
  if (f === 0) return enl > 100 ? "Unchanged, the source enlarged " + num(enl / 100, 2) + "×" : "Unchanged";
  if (f === 1) return "Zoomed in, " + num(z / 100, 2) + "×";
  if (f === 2) return "The whole picture, the source at " + enl + " %";
  if (f === 5) return "A panel, the source at " + enl + " %";
  if (f === 4) return "A crop as a band" + BAND[c[7]] + ", the source at " + num(enl / 100, 2) + "×";
  if (f === 3) return "A crop around the face that fills the frame, the source at " + num(enl / 100, 2) + "×";
  return FIT[f] + ", the source at " + num(enl / 100, 2) + "×";
}
function lines(c, need) {
  const out = [];
  if (need.indexOf("hook") === 0) out.push("Hook: " + PLACE[c[4]] + (c[5] ? ", " + c[5] + " px" : ""));
  if (need.indexOf("cap") >= 0) out.push("Captions: " + PLACE[c[3]]);
  const soft = [];
  if (c[6] & 1) soft.push("the face cut where a feed crops the frame");
  if (c[6] & 2) soft.push("text cut where a feed crops the frame");
  if (c[6] & 4) soft.push("the face in the safe box's margin");
  if (c[6] & 16) soft.push("the source enlarged over " + ${JSON.stringify(String(D.weights.enlarge.softFrom))} + "×");
  if (soft.length) out.push("Soft: " + soft.join(", "));
  return out;
}
const tip = document.getElementById("tip");
function showTip(tile, x, y) {
  const d = tile._d;
  tip.textContent = "";
  const b = document.createElement("b"); b.textContent = fitText(d.c, d.cid); tip.append(b);
  for (const l of ["A face " + d.h + " % tall, the eyes at " + d.e + " %, " + G.offset[off] + " % off the middle"].concat(lines(d.c, d.need))) { const s = document.createElement("span"); s.textContent = l; tip.append(s); }
  tip.style.display = "block";
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, x + 14)) + "px";
  tip.style.top = Math.max(8, Math.min(innerHeight - r.height - 8, y + 16)) + "px";
}
function hideTip() { tip.style.display = "none"; document.querySelectorAll(".tile.on").forEach((t) => t.classList.remove("on")); }
function render() {
  document.querySelectorAll(".case").forEach((sec) => {
    const cid = sec.dataset.case;
    sec.querySelectorAll(".map").forEach((fig) => {
      const need = fig.dataset.need, key = cid + "." + need, plot = fig.querySelector(".plot");
      plot.textContent = "";
      if (!fig.querySelector(".ylab")) { const y = document.createElement("div"); y.className = "ylab"; y.textContent = "Face height, % of the source's height"; fig.insertBefore(y, plot); }
      const tiles = [];
      for (let hi = nH - 1; hi >= 0; hi--) {
        const yt = document.createElement("div"); yt.className = "yt"; yt.textContent = G.height[hi]; plot.append(yt);
        for (let ei = 0; ei < nE; ei++) {
          const c = cell(key, hi, ei), t = document.createElement("div");
          t.className = "tile f" + c[0];
          t._d = { c, h: G.height[hi], e: G.eyes[ei], need, cid };
          if (c[4]) { const s = document.createElement("span"); s.textContent = "H" + SIGN[c[4]]; t.append(s); }
          if (c[3]) { const s = document.createElement("span"); s.textContent = "C" + SIGN[c[3]]; t.append(s); }
          t.addEventListener("pointermove", (ev) => { hideTip(); t.classList.add("on"); showTip(t, ev.clientX, ev.clientY); });
          t.addEventListener("pointerleave", hideTip);
          plot.append(t); tiles.push(t);
        }
      }
      plot.append(document.createElement("div"));
      for (let ei = 0; ei < nE; ei++) { const xt = document.createElement("div"); xt.className = "xt"; xt.textContent = G.eyes[ei]; plot.append(xt); }
      // the same on the keyboard: arrows move through the tiles
      let at = -1;
      const focusAt = (i) => { at = Math.max(0, Math.min(tiles.length - 1, i)); hideTip(); const t = tiles[at], r = t.getBoundingClientRect(); t.classList.add("on"); showTip(t, r.left + r.width / 2, r.bottom - 8); };
      plot.onkeydown = (ev) => { const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: nE, ArrowUp: -nE }[ev.key]; if (!step) return; ev.preventDefault(); focusAt(at < 0 ? 0 : at + step); };
      plot.onfocus = () => { if (plot.matches(":focus-visible")) focusAt(at < 0 ? 0 : at); };
      plot.onblur = hideTip;
    });
    // the table view of the four maps
    const table = sec.querySelector("table");
    table.textContent = "";
    const head = table.createTHead().insertRow();
    for (const h of ["Face height %", "Eye line %"].concat(NEEDS.map((n) => n.name))) { const th = document.createElement("th"); th.textContent = h; head.append(th); }
    const body = table.createTBody();
    for (let hi = 0; hi < nH; hi++) for (let ei = 0; ei < nE; ei++) {
      const row = body.insertRow();
      row.insertCell().textContent = G.height[hi]; row.insertCell().textContent = G.eyes[ei];
      for (const n of NEEDS) { const c = cell(cid + "." + n.id, hi, ei); row.insertCell().textContent = fitText(c, cid) + "; " + lines(c, n.id).join("; "); }
    }
  });
}
document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => {
  off = G.offset.indexOf(+b.dataset.o);
  document.querySelectorAll(".seg button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  render();
}));
render();
</script>
</body></html>`;
}
