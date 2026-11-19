// What stands out in a recording: the measures of lib/analyse.mjs turned into findings
// ({id, strength: "some" | "strong", text}). Every threshold that does so is here, named, with
// where its value comes from. They are first guesses, to be tuned against recordings with known
// faults; the numbers they read never depend on them.

// quiet / loud: the master for a video is −14 LUFS (lib/targets.mjs: what YouTube's player was
// measured to turn louder sound down to, and Spotify's own figure; what TikTok and Meta's apps do
// is unknown or not published). A voice 12 LU under that needs more gain than a limiter gives
// without lifting the noise with it; 22 LU under, the recording's own noise floor (a phone's
// preamp, 16 bits) is close.
export const QUIET_SOME_LUFS = -26;
export const QUIET_STRONG_LUFS = -36;
// a true peak over −1 dBTP leaves an encoder no headroom (Spotify's and Apple's own advice: −1 dBTP)
export const LOUD_SOME_DBTP = -1;
export const LOUD_STRONG_DBTP = 0;

// noise (A-weighted signal-to-noise ratio: rumble under 40 Hz is little heard): ACX (Audible)
// asks for speech at −18 to −23 dBFS RMS over a floor under −60 dBFS, so about 35 dB; under
// 20 dB the noise is plain beside the voice once it is levelled
export const NOISE_SOME_DB = 35;
export const NOISE_STRONG_DB = 20;
// the noise's kind: changing when its frames spread by 3 dB within a pause (steady noise of
// a 43 ms window spreads by well under 1 dB) or its pauses by 6 dB; rumble when half its power
// lies under 125 Hz; hiss when half lies over 4 kHz (white noise: 83 %, pink: 25 %)
export const NOISE_CHANGING_DB = 3;
export const NOISE_CHANGING_SPREAD_DB = 6;
export const NOISE_RUMBLE_DB = -3;
export const NOISE_HISS_DB = -3;

// hum: a mains harmonic 10 dB over its neighbouring bins is audible in the pauses; 20 dB, or
// hum within 35 dB of the speech, is plain under the voice too
export const HUM_SOME_DB = 10;
export const HUM_STRONG_DB = 20;
export const HUM_STRONG_UNDER_DB = 35;

// clipped: a pile-up at the ceiling 3 times the density 1–3 dB under it (a voice's levels thin
// out towards its peak: about 0.1 to 0.5 there), on 1 in 10 000 samples; strong from 1 in 1000
// (audible distortion on most voices from about 0.1 %)
export const CLIP_PILEUP = 3;
export const CLIP_SOME_SHARE = 1e-4;
export const CLIP_STRONG_SHARE = 1e-3;

// uneven: the 3-s phrase levels of read speech spread by 4 to 6 LU; a step of 4 LU between two
// parts of a recording is heard (a speaker turned away, two takes)
export const UNEVEN_SOME_LU = 8;
export const UNEVEN_STRONG_LU = 12;
// (read passages fall by 4 to 5 LU towards their end in the lab's corpus: a step counts from 6)
export const STEP_SOME_LU = 6;
export const STEP_STRONG_LU = 10;

// tone, against the ANSI S3.5 speech spectrum (the band's distance from it, dB). Voices differ
// from the average by up to about ±5 dB a band (Byrne et al. 1994), so findings start beyond
// that: dull (2–8 kHz under), harsh (2–4 kHz over), boomy (100–250 Hz over), thin (100–500 Hz under)
export const DULL_SOME_DB = -7;
export const DULL_STRONG_DB = -12;
export const HARSH_SOME_DB = 6;
export const HARSH_STRONG_DB = 10;
export const BOOMY_SOME_DB = 6;
export const BOOMY_STRONG_DB = 10;
export const THIN_SOME_DB = -8;
export const THIN_STRONG_DB = -14;
// sibilant: the loudest "s" (5–9 kHz) against the voiced frames' whole power; clean read speech
// lies at −15 to 0 dB (the lab's corpus); a guess until measured on voices de-essed and not
export const SIBILANT_SOME_DB = 1;
export const SIBILANT_STRONG_DB = 6;

// rumble: speech has little under 80 Hz (Byrne et al. 1994: the 63 and 80 Hz bands lie 20 dB
// and more under the 500 Hz band, about 28 dB under 300–3000 Hz together)
export const RUMBLE_SOME_DB = -15;
export const RUMBLE_STRONG_DB = -8;
// thumps and clicks a minute: one a minute is heard as a fault in a short
export const THUMPS_SOME = 1;
export const THUMPS_STRONG = 4;
export const CLICKS_SOME = 2;
export const CLICKS_STRONG = 10;
// a click counts when it stands 30 dB over its neighbourhood: clean read speech (the lab's
// corpus, 2026-11-19) has 1 to 8 plosive releases and lip smacks a file at 15 to 25 dB
export const CLICK_OVER_DB = 30;

// narrow: where the voice ends at the top. 16 kHz and more is a full recording (AAC at 128 kbit/s
// cuts at about 16 kHz); under 12 kHz it sounds muffled beside other videos; 8 kHz and under is
// a 16 kHz source (or a call). A bottom over 200 Hz (a telephone's band) is named with it, never
// alone: a high voice or a room's rumble over the voice's lows moves the bottom as far
export const NARROW_SOME_HZ = 12000;
export const NARROW_STRONG_HZ = 8000;
export const NARROW_BOTTOM_HZ = 200;
// …and ends in a cliff: a resampled source falls by 30 dB and more within one band, a low-pass
// (a dull microphone, a filter) by a few dB: that one is `dull`, not `narrow`
export const NARROW_CLIFF_DB = 20;

// dc: an offset over −40 dBFS costs headroom and clicks at every cut; over −26 dBFS strong
export const DC_SOME_DB = -40;
export const DC_STRONG_DB = -26;

// one channel: channels 6 dB apart sound lopsided on headphones; 20 dB apart, one is dead
export const CHANNEL_SOME_DB = 6;
export const CHANNEL_STRONG_DB = 20;
// inverted: a mono mix (a phone's speaker) loses more than 6 dB of the voice
export const INVERTED_SOME_DB = -6;
export const INVERTED_STRONG_DB = -15;

// roomy: a reverberation time over 0.5 s is heard as a hall on a voice; the estimate must not
// be of low confidence
export const ROOMY_SOME_S = 0.5;
export const ROOMY_STRONG_S = 0.8;

// The noise's kind, from its numbers (null without noise to measure); low noise that is the
// hum's harmonics is hum, not rumble
export function noiseKind(n, hum) {
  if (!n) return null;
  if ((n.fluctuationDb ?? 0) >= NOISE_CHANGING_DB || (n.spreadDb ?? 0) >= NOISE_CHANGING_SPREAD_DB) return "changing";
  if ((n.lowDb ?? -99) >= NOISE_RUMBLE_DB) return hum?.hz && hum.overDb >= HUM_SOME_DB ? "hum" : "rumble";
  if ((n.highDb ?? -99) >= NOISE_HISS_DB) return "hiss";
  return "broadband";
}

const f1 = (x) => { const r = Math.round(x * 10) / 10; return (r < 0 ? "−" : "") + Math.abs(r).toFixed(1); };
const i0 = (x) => { const r = Math.round(x); return (r < 0 ? "−" : "") + Math.abs(r); };
const kHz = (hz) => (hz >= 1000 ? `${+(hz / 1000).toFixed(1)} kHz` : `${hz} Hz`);
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const pct = (x) => (x >= 0.01 ? `${+(x * 100).toFixed(1)} %` : `${+(x * 100).toPrecision(2)} %`);

export function findingsOf(m) {
  const out = [];
  const add = (id, strong, text) => out.push({ id, strength: strong ? "strong" : "some", text });
  const L = m.levels, speech = L?.speechLufs;
  if (speech != null && speech < QUIET_SOME_LUFS)
    add("quiet", speech < QUIET_STRONG_LUFS, `The voice is quiet: ${f1(speech)} LUFS while it speaks, ${i0(-14 - speech)} LU under where the platforms play it.`);
  const tp = m.loudness?.truePeakDb;
  if (tp != null && tp > LOUD_SOME_DBTP) add("loud", tp > LOUD_STRONG_DBTP, `Its peaks reach ${f1(tp)} dBTP: no headroom left for the platforms' encoders.`);
  const snr = L?.snrADb ?? L?.snrDb;
  if (snr != null && snr < NOISE_SOME_DB)
    add("noise", snr < NOISE_STRONG_DB, `Noise ${i0(snr)} dB under the speech (A-weighted)${m.noise?.kind ? `, ${m.noise.kind}` : ""}.`);
  const h = m.hum;
  if (h?.hz && h.overDb >= HUM_SOME_DB)
    add("hum", h.overDb >= HUM_STRONG_DB || (h.underSpeechDb != null && h.underSpeechDb <= HUM_STRONG_UNDER_DB),
      `Hum at ${h.hz} Hz, ${h.harmonics} harmonic${h.harmonics === 1 ? "" : "s"}, ${i0(h.overDb)} dB over the noise beside it${h.underSpeechDb != null ? `, ${i0(h.underSpeechDb)} dB under the speech` : ""}.`);
  const c = m.clipping;
  if (c) {
    const share = Math.max(c.pileUp >= CLIP_PILEUP ? c.share : 0, c.exactShare);
    if (share >= CLIP_SOME_SHARE)
      add("clipped", share >= CLIP_STRONG_SHARE, `Clipped: ${pct(share)} of the samples sit at a ceiling of ${f1(c.ceilingDb)} dBFS${c.ceilingDb < -0.5 ? " (turned down after it clipped)" : ""}.`);
  }
  const ph = L?.phrases, st = L?.step;
  const stepped = st && Math.abs(st.lu) >= STEP_SOME_LU && L.drift && st.residualLu < L.drift.residualLu;
  if ((ph?.spreadLu ?? 0) >= UNEVEN_SOME_LU || stepped) {
    const strong = (ph?.spreadLu ?? 0) >= UNEVEN_STRONG_LU || (stepped && Math.abs(st.lu) >= STEP_STRONG_LU);
    add("uneven", strong, stepped
      ? `The level steps by ${f1(st.lu)} LU at ${clock(st.at)} (from ${f1(st.beforeLufs)} to ${f1(st.afterLufs)} LUFS).`
      : `The level of its phrases spreads over ${f1(ph.spreadLu)} LU.`);
  }
  const t = m.tone;
  if (t) {
    if (t.highDiff != null && t.highDiff <= DULL_SOME_DB) add("dull", t.highDiff <= DULL_STRONG_DB, `Dull: 2–8 kHz lie ${i0(-t.highDiff)} dB under a voice's average spectrum.`);
    if (t.presenceDiff != null && t.presenceDiff >= HARSH_SOME_DB) add("harsh", t.presenceDiff >= HARSH_STRONG_DB, `Harsh: 2–4 kHz lie ${i0(t.presenceDiff)} dB over a voice's average spectrum.`);
    const boom = t.bands.find((b) => b.lo === 100)?.diff;
    if (boom != null && boom >= BOOMY_SOME_DB) add("boomy", boom >= BOOMY_STRONG_DB, `Boomy: 100–250 Hz lie ${i0(boom)} dB over a voice's average spectrum.`);
    if (t.lowDiff != null && t.lowDiff <= THIN_SOME_DB) add("thin", t.lowDiff <= THIN_STRONG_DB, `Thin: 100–500 Hz lie ${i0(-t.lowDiff)} dB under a voice's average spectrum.`);
    if (t.sibilanceDb != null && t.sibilanceDb >= SIBILANT_SOME_DB) add("sibilant", t.sibilanceDb >= SIBILANT_STRONG_DB, `Sibilant: its loudest "s" reach ${f1(t.sibilanceDb)} dB against its vowels.`);
  }
  const lo = m.low;
  // (the pauses' low end counts only without hum: hum's own fundamental lies under 80 Hz)
  const hummed = h?.hz && h.overDb >= HUM_SOME_DB;
  const rumbly = Math.max(lo?.below80Db ?? -99, hummed ? -99 : lo?.pauses80Db ?? -99);
  if (rumbly >= RUMBLE_SOME_DB)
    add("rumble", rumbly >= RUMBLE_STRONG_DB, `Rumble under 80 Hz, ${i0(-rumbly)} dB under the voice's middle (300–3000 Hz).`);
  if (lo && lo.thumps.perMinute >= THUMPS_SOME && lo.thumps.count >= 2)
    add("thumps", lo.thumps.perMinute >= THUMPS_STRONG, `${lo.thumps.count} thumps (pops, wind, handling), the first at ${lo.thumps.at.slice(0, 3).map(clock).join(", ")}.`);
  const k = m.clicks, loudClicks = k?.over?.[CLICK_OVER_DB] ?? 0, perMinute = loudClicks / Math.max(1 / 60, (m.analysed?.seconds ?? 60) / 60);
  if (k && perMinute >= CLICKS_SOME && loudClicks >= 2)
    add("clicks", perMinute >= CLICKS_STRONG, `${loudClicks} clicks (${+perMinute.toFixed(1)} a minute), the strongest at ${k.at.slice(0, 3).map((x) => clock(x.t)).join(", ")}.`);
  const bw = m.bandwidth;
  const cut = bw?.topHz != null && bw.topHz <= NARROW_SOME_HZ && (bw.cliffDb ?? 0) >= NARROW_CLIFF_DB;
  if (cut)
    add("narrow", bw.topHz <= NARROW_STRONG_HZ, `Band-limited: the voice ends at ${kHz(bw.topHz)}, cut off (a source of a lower sample rate, a call)${bw.bottomHz > NARROW_BOTTOM_HZ ? `, and starts only at ${kHz(bw.bottomHz)}` : ""}.`);
  if (m.dc && m.dc.db >= DC_SOME_DB) add("dc", m.dc.db >= DC_STRONG_DB, `A DC offset of ${f1(m.dc.db)} dBFS.`);
  const ch = m.channels;
  if (ch) {
    const diff = ch.silentChannel ? Infinity : Math.abs(ch.levelDifferenceDb ?? 0);
    if (diff >= CHANNEL_SOME_DB)
      add("one-channel", diff >= CHANNEL_STRONG_DB, ch.silentChannel ? `The ${ch.silentChannel} channel is silent: the voice is on one side only.`
        : `The ${ch.levelDifferenceDb > 0 ? "left" : "right"} channel is ${i0(diff)} dB louder than the other.`);
    if (ch.monoLossDb != null && ch.monoLossDb <= INVERTED_SOME_DB && (ch.correlation ?? 0) < 0)
      add("inverted", ch.monoLossDb <= INVERTED_STRONG_DB, `One channel is the other inverted: a mono mix (a phone's speaker) loses ${i0(-ch.monoLossDb)} dB of the voice.`);
  }
  const r = m.room;
  if (r?.rt60 != null && r.confidence !== "low" && r.confidence !== "none" && r.rt60 >= ROOMY_SOME_S)
    add("roomy", r.rt60 >= ROOMY_STRONG_S, `Roomy: the sound hangs on about ${r.rt60.toFixed(1)} s after the voice stops.`);
  return out;
}
