#!/usr/bin/env python3
"""Who speaks when: label every transcript word with a speaker (A, B, C …).

Runs fully local with sherpa-onnx: pyannote segmentation finds speech turns,
a TitaNet voice embedding clusters them into speakers. Each word then takes the
speaker whose turn overlaps it most; very short flips (a word or two, usually
crosstalk or a mis-cut) are smoothed into the surrounding speaker.

  .venv/bin/python tools/diarize.py audio.wav transcript.json [--speakers N] [--out labelled.json]

Without --speakers the number of voices is estimated (cluster threshold).
Setup: see README ("Real podcasts: speakers and fillers").
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np
import sherpa_onnx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, "models", "diarize")
SR = 16000


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def turns(audio, speakers, threshold):
    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                model=os.path.join(MODELS, "sherpa-onnx-pyannote-segmentation-3-0", "model.onnx")),
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=os.path.join(MODELS, "nemo_en_titanet_small.onnx")),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=speakers or -1, threshold=threshold),
        min_duration_on=0.3,
        min_duration_off=0.5,
    )
    if not config.validate():
        sys.exit("diarize: models missing – see README (Real podcasts: speakers and fillers)")
    sd = sherpa_onnx.OfflineSpeakerDiarization(config)
    return [(r.start, r.end, r.speaker) for r in sd.process(audio).sort_by_start_time()]


def sentence_prints(audio, words):
    """Transcript sentences (split after . ? ! and at pauses ≥ 0.35 s) with a voice print each."""
    ext = sherpa_onnx.SpeakerEmbeddingExtractor(
        sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=os.path.join(MODELS, "nemo_en_titanet_small.onnx")))
    groups, cur = [], []
    for i, w in enumerate(words):
        if cur and w["start"] - words[cur[-1]]["end"] >= 0.35:
            groups.append(cur); cur = []
        cur.append(i)
        if w["text"].rstrip().endswith((".", "?", "!")):
            groups.append(cur); cur = []
    if cur:
        groups.append(cur)
    spans = [(words[g[0]]["start"], words[g[-1]]["end"]) for g in groups]
    embs = []
    for a, b in spans:
        # short sentences get a little more audio: TitaNet needs ~0.8 s to say anything useful
        seg = audio[int(a * SR):int(max(b, a + 0.8) * SR)]
        st = ext.create_stream(); st.accept_waveform(SR, seg); st.input_finished()
        e = np.array(ext.compute(st)); embs.append(e / (np.linalg.norm(e) + 1e-9))
    return groups, spans, np.array(embs)


def refine(audio, words, labels):
    """Second opinion per sentence: segmentation boundaries are often a few words off (a host's
    question swallowed by the guest's answer). A sentence whose own voice print clearly matches
    another speaker better than the one it was given is moved to that speaker as a whole."""
    groups, spans, embs = sentence_prints(audio, words)
    names = sorted(set(labels))
    if len(names) < 2:
        return labels, 0
    dur = np.array([b - a for a, b in spans])
    major = [max(set(labels[i] for i in g), key=lambda s: sum(1 for i in g if labels[i] == s)) for g in groups]
    cents = {}
    for s in names:
        idx = [k for k in range(len(groups)) if major[k] == s and dur[k] >= 0.7]
        if idx:
            c = embs[idx].T @ dur[idx]
            cents[s] = c / (np.linalg.norm(c) + 1e-9)
    out, moved = list(labels), 0
    for k, g in enumerate(groups):
        if dur[k] < 0.7:
            continue
        # a voice that only got fragments has no print of its own: a mixed sentence that does
        # not sound like its majority speaker at all belongs to the fragment's speaker
        if major[k] in cents and float(embs[k] @ cents[major[k]]) < 0.3:
            minor = [s for s in set(labels[i] for i in g) if s != major[k] and s not in cents]
            if minor:
                for i in g:
                    out[i] = minor[0]
                moved += 1
                continue
        if any(s not in cents for s in names):
            continue
        sims = {s: float(embs[k] @ cents[s]) for s in names}
        best = max(sims, key=sims.get)
        mixed = len(set(labels[i] for i in g)) > 1
        if (best != major[k] and sims[best] - sims[major[k]] > 0.15) or (mixed and best == major[k]) or (mixed and sims[best] - sims[major[k]] > 0.05):
            if any(out[i] != best for i in g):
                moved += 1
            for i in g:
                out[i] = best
    return out, moved


def sentence_turns(audio, words, speakers):
    """Fallback for tightly edited clips (shorts): pyannote finds no pauses there and returns
    one long segment. Instead embed every transcript sentence on its own and cluster the
    sentences into the requested number of voices (average-linkage on cosine distance)."""
    groups, spans, embs = sentence_prints(audio, words)
    dur = np.array([b - a for a, b in spans])
    # cluster only the sentences long enough for a reliable voice print (average linkage on
    # cosine distance); a lone "Ja." would otherwise become a speaker of its own
    core = [i for i in range(len(spans)) if dur[i] >= 0.7] or list(range(len(spans)))
    clusters = [[i] for i in core]
    def cdist(x, y):
        return 1 - float(np.mean(embs[x] @ embs[y].T))
    while len(clusters) > max(1, speakers):
        best = None
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                d = cdist(clusters[i], clusters[j])
                if best is None or d < best[0]:
                    best = (d, i, j)
        _, i, j = best
        clusters[i] += clusters.pop(j)
    # every sentence (short ones too) goes to the voice it resembles most
    cents = [embs[c].T @ dur[c] for c in clusters]
    cents = [c / (np.linalg.norm(c) + 1e-9) for c in cents]
    lab = [int(np.argmax([e @ c for c in cents])) for e in embs]
    return [(a, b, lab[i]) for i, (a, b) in enumerate(spans)]


def label(words, segs, keep_all=False):
    out = []
    for w in words:
        best, bestOv = None, 0.0
        for a, b, s in segs:
            ov = min(b, w["end"]) - max(a, w["start"])
            if ov > bestOv:
                best, bestOv = s, ov
        if best is None:  # in a gap: nearest turn
            mid = (w["start"] + w["end"]) / 2
            best = min(segs, key=lambda t: min(abs(t[0] - mid), abs(t[1] - mid)))[2] if segs else 0
        out.append(best)
    # smooth: a run shorter than 3 words and 0.8 s between two runs of the same speaker is noise
    runs = []
    for i, s in enumerate(out):
        if runs and runs[-1][0] == s:
            runs[-1][2] = i
        else:
            runs.append([s, i, i])
    for k in range(1, len(runs) - 1):
        s, a, b = runs[k]
        dur = words[b]["end"] - words[a]["start"]
        if runs[k - 1][0] == runs[k + 1][0] and (b - a + 1) < 3 and dur < 0.8:
            for i in range(a, b + 1):
                out[i] = runs[k - 1][0]
    # a "speaker" with only a few seconds in total is a split-off of a real one (end of a
    # question, a laugh): give its words to the neighbouring speaker
    total = sum(w["end"] - w["start"] for w in words) or 1
    talk = {}
    for w, s in zip(words, out):
        talk[s] = talk.get(s, 0) + w["end"] - w["start"]
    # (not when the number of voices was given: then a short reply is a real second speaker)
    tiny = set() if keep_all else {s for s, d in talk.items() if d < max(2.5, 0.03 * total) and len(talk) > 1}
    for i, s in enumerate(out):
        if s in tiny:
            prev = next((out[j] for j in range(i - 1, -1, -1) if out[j] not in tiny), None)
            nxt = next((out[j] for j in range(i + 1, len(out)) if out[j] not in tiny), None)
            out[i] = prev if prev is not None else nxt
    # stable names in order of appearance
    names = {}
    return [names.setdefault(s, "ABCDEFGH"[len(names) % 8]) for s in out]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("transcript")
    ap.add_argument("--speakers", type=int, default=0, help="number of voices (0 = estimate)")
    ap.add_argument("--threshold", type=float, default=0.6, help="cluster distance when estimating")
    ap.add_argument("--out", help="write here (default: overwrite the transcript)")
    a = ap.parse_args()

    data = json.load(open(a.transcript))
    words = data if isinstance(data, list) else data["words"]
    audio = decode(a.audio)
    segs = turns(audio, a.speakers, a.threshold)
    labels = label(words, segs, keep_all=a.speakers > 0)
    if a.speakers > 1 and len(set(labels)) < a.speakers:
        print(f"diarize: segmentation found {len(set(labels))} voice(s) in {len(segs)} segment(s) – clustering sentences instead", file=sys.stderr)
        segs = sentence_turns(audio, words, a.speakers)
        labels = label(words, segs, keep_all=True)
    if a.speakers != 1:
        labels, moved = refine(audio, words, labels)
        if moved:
            print(f"diarize: {moved} sentence(s) moved to the voice they match", file=sys.stderr)
    for w, s in zip(words, labels):
        w["speaker"] = s
    json.dump(data, open(a.out or a.transcript, "w"), indent=0, ensure_ascii=False)
    changes = sum(1 for x, y in zip(labels, labels[1:]) if x != y)
    print(f"diarize: {len(set(labels))} speakers, {changes} turn changes, {len(segs)} segments", file=sys.stderr)


if __name__ == "__main__":
    main()
