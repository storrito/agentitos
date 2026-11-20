// An in-place complex FFT of a power of two (iterative radix 2), with its tables made once per
// size. The analysis runs two real channels through one transform (left as the real part, right
// as the imaginary part) and takes them apart with `split`.

export function fftOf(n) {
  if (n & (n - 1)) throw new Error(`the FFT needs a power of two, not ${n}`);
  const bits = Math.log2(n);
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }

  // re, im: Float64Array(n), transformed in place
  function fft(re, im) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const a = start + k, b = a + half;
          const wr = cos[t], wi = sin[t];
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }
  return fft;
}

// The power of bin k of each of the two real signals packed into one transform (z = x0 + i·x1):
// X0[k] = (Z[k] + conj Z[n−k]) / 2, X1[k] = (Z[k] − conj Z[n−k]) / 2i.
export function split(re, im, n, k, out) {
  const j = (n - k) % n;
  const a = re[k] + re[j], b = im[k] - im[j], c = im[k] + im[j], d = re[k] - re[j];
  out[0] = (a * a + b * b) / 4;
  out[1] = (c * c + d * d) / 4;
  return out;
}

export function hann(n) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}
