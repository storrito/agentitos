// A beat shown "beside" the person: the frame is shared. One geometry per video and frame (with or
// without captions), whatever the material, so that beats in a row need no rule of their own.
//
// Tall and square frames, built from the bottom up: the face at its target height (22 % of the
// frame's) ends where the apps' bottom zone begins; above it the hair's room (35 % of the face's
// height); above that the captions' band when there are captions (as high as their block can be,
// moved there while the beat shows); the material gets what is left above, from the safe box's
// top, over the safe width. Only when that is less than a material needs (MATERIAL_LEAST) does the
// face give way, never under 12 % of the frame (said then). The person's video is moved into the
// field under the seam by one transform (scale, then a shift, origin at the top left) on a
// wrapper of the host; where it is then narrower than the field, the person shows as a card.
//
// Wide frames (a sketch, not measured): the person is a tall field on the left third (filled with
// the video when the face then still fits, else the face at the target), the material the rest of
// the safe box, clear of the captions, which stay where they are.
//
// The proportions come from a layout study of 240 published Shorts (where a screen and a face are
// seen at once, the face is under the screen in 66 % of the frames) and platform-zones' boxes at
// run time. The collection's layout skill (its `beside` command, not merged yet) will give these
// fields: ask it here, and nothing else in b-roll changes. The answer already carries its names.
//
//   besideLayout({ width, height, zones, face, source, captions }) →
//     { side,
//       material: { field },                          the material's field
//       speaker:  { field, card, scale, left, top,    the person's field, what of it the video
//                   face, facePct, assumed },          fills, the video's scale and place, the
//                                                      face in the frame then
//       captions: { where, box, font, shift } | null, "seam" (moved onto box by shift) or "stay"
//       room, warnings, notes }
//   frameFace(face, source, width, height)           → the face in px of the frame (cover fit)
//   assumedFace(width, height)                       → the usual framing of a talking head
//
// Boxes are [x, y, w, h] in px of the frame. `face` is the face (forehead to chin, cheek to cheek)
// in px of the SOURCE video, `source` its size [w, h] (none: the frame's); the host fills the frame
// with it (object-fit: cover). `captions` is where the captions stand without b-roll,
// { left, width, top, bottom, size } (agentitos' captions' area.json).

// The face's height, of the frame's. Published Shorts show 18 % (the study's median, FACE_NORM);
// the owner found the person's card too small at that and asked for a little more. 0.22 is the
// most that still leaves a number its field under two lines of captions in a 9:16 frame with the
// usual apps. The more is taken only as far as the video stays sharp (aim()).
export const FACE_TARGET = 0.22;
export const FACE_NORM = 0.18;
export const FACE_LEAST = 0.12;      // the face gives way to the material down to this, no further
export const HAIR = 0.35;            // room above a face box for the hair (and text above a head), of its height
export const MATERIAL_LEAST = 0.18;  // the material's field at least this high, of the frame's (a number with a two-line label)
export const SOFT = 1.25;            // the source's own pixels enlarged more than this look soft
const FACE_MOST = 0.35;              // wide frames: a face that fills its tall field at most this, of the frame's height
const SIDE = 1.2;                    // wider than this (width / height): the person at the left

export const isSide = (width, height) => width / height > SIDE;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const overlaps = ([x, y, w, h], [X, Y, W, H]) => x < X + W && X < x + w && y < Y + H && Y < y + h;

// The height the face aims at, in px of the frame: the target, but where the source's own pixels
// would be enlarged over SOFT for it, only what stays sharp, and never less for that than the
// norm asks (a small face is enlarged for the norm as it always was, and said to look soft).
// `fh` is the face's height as the host shows the source, `cover` how much that enlarges it.
export function aim(height, fh, cover = 1) {
  const want = FACE_TARGET * height, sharp = (SOFT / cover) * fh;
  return want <= sharp ? want : Math.max(sharp, Math.min(want, FACE_NORM * height));
}

// the face in the upper third, in the middle: what a talking head usually is (px of the frame)
export function assumedFace(width, height) {
  const h = Math.round(0.2 * height), w = Math.round(0.75 * h);
  return [Math.round(width / 2 - w / 2), Math.round(height / 3 - h / 2), w, h];
}

// a face box in px of the source, kept inside it; null when it is no box
export function faceBox(face, sw, sh) {
  if (!Array.isArray(face) || face.length !== 4 || !face.every(Number.isFinite)) return null;
  let [x, y, w, h] = face;
  if (w <= 0 || h <= 0) return null;
  x = clamp(x, 0, sw - 1); y = clamp(y, 0, sh - 1);
  return [x, y, Math.min(w, sw - x), Math.min(h, sh - y)];
}

// the source's face in px of the frame, as the host shows the source (filling the frame, cut at its
// edges); also how much the source's own pixels are enlarged
export function frameFace(face, source, width, height) {
  const [sw, sh] = Array.isArray(source) && source.length === 2 && source.every((v) => v > 0) ? source : [width, height];
  const box = faceBox(face, sw, sh);
  if (!box) return null;
  const c = Math.max(width / sw, height / sh), ox = (width - sw * c) / 2, oy = (height - sh * c) / 2;
  return { box: [ox + c * box[0], oy + c * box[1], c * box[2], c * box[3]], cover: c };
}

export function besideLayout({ width, height, zones, face, source, captions }) {
  const [sx, sy, sw, sh] = zones.safe;
  const u = Math.min(width, height) / 1080;
  const margin = Math.round(24 * u);
  const warnings = [], notes = [];
  const given = frameFace(face, source, width, height);
  const assumed = !given;
  const [fx, fy, fw, fh] = given ? given.box : assumedFace(width, height);
  const cover = given ? given.cover : 1;
  const cap = captions && Number.isFinite(captions.top) && Number.isFinite(captions.bottom) && captions.bottom > captions.top ? captions : null;
  const bottom = sy + sh - margin;   // the face ends above the apps' bottom zone

  let side = isSide(width, height), material, person, room, capOut = null, scale, faceTop;
  if (side) {
    // the person on the left third, the material on the rest, above the captions where they stand
    const pw = Math.round(width / 3);
    const mx = Math.max(sx, pw + Math.round(40 * u)), mw = sx + sw - mx;
    let mb = sy + sh;
    const capBox = cap && [cap.left ?? 0, cap.top, cap.width ?? width, cap.bottom - cap.top];
    if (capBox && overlaps(capBox, [mx, sy, mw, sh])) mb = Math.max(sy + sh * 0.4, cap.top - margin);
    material = [mx, sy, mw, Math.round(mb - sy)];
    person = [0, 0, pw, height];
    room = [sy, bottom];
    if (capBox) capOut = { where: "stay", box: capBox.map(Math.round), font: cap.size ?? null, shift: { x: 0, y: 0 } };
    // the face at the target, or larger where that lets the video fill its tall field
    const fits = Math.min(FACE_MOST * height, (room[1] - room[0]) / (1 + HAIR));
    const fill = Math.max(pw / width, height / height);
    scale = aim(height, fh, cover) / fh;
    if (scale < fill && fill * fh <= fits) scale = fill;
    const H = fh * scale, block = H * (1 + HAIR);
    faceTop = room[0] + Math.max(0, room[1] - room[0] - block) * 0.35 + HAIR * H;
  } else {
    // from the bottom up: the face, the hair's room, the captions' band, the material above
    const bandH = cap ? cap.bottom - cap.top : 0;
    const above = (H) => bottom - H * (1 + HAIR) - (cap ? bandH : 0) - margin - sy;   // the material's height
    let H = aim(height, fh, cover);
    if (H < FACE_TARGET * height - 0.5) notes.push(`the face is small in the video: it shows at ${Math.round((H / height) * 100)} % of the frame's height, not ${Math.round(FACE_TARGET * 100)} %, so that the video stays sharp`);
    const least = MATERIAL_LEAST * height;
    if (above(H) < least) {
      const fit = (bottom - (cap ? bandH : 0) - margin - sy - least) / (1 + HAIR);
      H = Math.max(FACE_LEAST * height, fit);
      notes.push(`the material needs room: the face gives way to ${Math.round((H / height) * 100)} % of the frame's height${H <= FACE_LEAST * height + 0.5 ? " (the least it may be)" : ""}`);
    }
    faceTop = bottom - H;
    const seam = Math.round(faceTop - HAIR * H);
    const mb = (cap ? seam - bandH : seam) - margin;
    material = [sx, sy, sw, Math.round(mb - sy)];
    person = [0, seam, width, height - seam];
    room = [seam, bottom];
    if (cap) {
      const top = seam - bandH;
      capOut = { where: "seam", box: [Math.round(cap.left ?? sx), Math.round(top), Math.round(cap.width ?? sw), Math.round(bandH)], font: cap.size ?? null, shift: { x: 0, y: Math.round(seam - cap.bottom) } };
    }
    scale = H / fh;
  }

  // the source's own pixels enlarged: soft above SOFT, never more than twice
  const native = scale * cover;
  if (native > 2) { scale = 2 / cover; warnings.push("the face is small in the video: it is enlarged twice at most and stays under its target height"); }
  else if (native > SOFT) warnings.push(`the person's video is enlarged ×${native.toFixed(1)} in its field and looks soft`);
  const H = fh * scale;
  if (!side) faceTop = room[1] - H;   // the face ends where the bottom zone begins

  const [px, py, pw, ph] = person;
  let x = px + pw / 2 - scale * (fx + fw / 2);
  let y = faceTop - scale * fy;
  // a video at least as large as the field covers it (no strip of the panel inside the field),
  // unless that pushes the face out of its room or its field
  const vw = width * scale, vh = height * scale;
  if (vw >= pw) {
    const cx = clamp(x, px + pw - vw, px), l = cx + scale * fx;
    if (l >= px && l + scale * fw <= px + pw) x = cx;
  }
  if (vh >= ph) {
    const cy = clamp(y, py + ph - vh, py), t = cy + scale * fy;
    if (t - HAIR * H >= Math.min(py, room[0]) - 1 && t + H <= room[1] + 1) y = cy;
  }
  const sx0 = Math.max(px, x), sy0 = Math.max(py, y), sx1 = Math.min(px + pw, x + vw), sy1 = Math.min(py + ph, y + vh);
  const card = [sx0, sy0, Math.max(0, sx1 - sx0), Math.max(0, sy1 - sy0)].map(Math.round);
  const faceAt = [x + scale * fx, y + scale * fy, scale * fw, scale * fh].map(Math.round);
  const facePct = Math.round((faceAt[3] / height) * 1000) / 10;

  if (faceAt[1] + faceAt[3] > room[1] + 1) warnings.push(`the face reaches under what the apps cover at the bottom (its chin at y ${faceAt[1] + faceAt[3]}, free to ${room[1]})`);
  if (faceAt[1] - HAIR * faceAt[3] < card[1] - 1) warnings.push("the top of the head is cut by the field's edge");
  if (faceAt[0] < card[0] - 1 || faceAt[0] + faceAt[2] > card[0] + card[2] + 1) warnings.push("the face is cut at the side of its field");
  if (capOut && overlaps(capOut.box, faceAt)) warnings.push("the captions cover the face");
  if (card[2] < pw - 1 || card[3] < ph - 1) notes.push(`the face is large in the video: the person shows as a card of ${card[2]}×${card[3]} in the field, the face ${facePct} % of the frame`);

  return {
    side,
    material: { field: material.map(Math.round) },
    speaker: { field: person.map(Math.round), card, scale: +scale.toFixed(4), left: Math.round(x), top: Math.round(y), face: faceAt, facePct, assumed },
    captions: capOut,
    room, warnings, notes,
  };
}
