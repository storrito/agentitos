// The geometry every part of the solver shares. A box is [x, y, w, h] in px: of the frame, or of
// the source where a name says so. Two boxes touch only when they overlap by more than EPS, so
// that a text set exactly on an edge does not count as lying on what ends there.

export const EPS = 0.05;
export const X1 = (b) => b[0] + b[2], Y1 = (b) => b[1] + b[3];
export const area = (b) => Math.max(0, b[2]) * Math.max(0, b[3]);
export const inter = (a, b) => {
  const w = Math.min(X1(a), X1(b)) - Math.max(a[0], b[0]);
  const h = Math.min(Y1(a), Y1(b)) - Math.max(a[1], b[1]);
  return w > EPS && h > EPS ? w * h : 0;
};
export const contains = (o, i) => i[0] >= o[0] - EPS && i[1] >= o[1] - EPS && X1(i) <= X1(o) + EPS && Y1(i) <= Y1(o) + EPS;
export const grow = (b, g) => [b[0] - g, b[1] - g, b[2] + 2 * g, b[3] + 2 * g];
// the part of b inside w, or null where they do not overlap
export const clipBox = (b, w) => { const x0 = Math.max(b[0], w[0]), y0 = Math.max(b[1], w[1]), x1 = Math.min(X1(b), X1(w)), y1 = Math.min(Y1(b), Y1(w)); return x1 - x0 > EPS && y1 - y0 > EPS ? [x0, y0, x1 - x0, y1 - y0] : null; };
// what spans all the boxes, as its edges [x0, y0, x1, y1] (not as a box)
export const hullOf = (boxes) => [Math.min(...boxes.map((f) => f[0])), Math.min(...boxes.map((f) => f[1])), Math.max(...boxes.map((f) => X1(f))), Math.max(...boxes.map((f) => Y1(f)))];
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const median = (v) => { const a = [...v].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
export const r1 = (v) => Math.round(v * 10) / 10;
export const r2 = (v) => Math.round(v * 100) / 100;
export const pct = (v) => `${Math.round(v * 100)} %`;
export const boxText = (b) => `x ${Math.round(b[0])}–${Math.round(X1(b))}, y ${Math.round(b[1])}–${Math.round(Y1(b))}`;
export const ratioOf = (r) => { const [a, b] = String(r).split(":").map(Number); return a / b; };
