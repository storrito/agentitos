#!/usr/bin/env python3
"""CPU object-aware reframing. Local files only; no inference API or GPU.

All coordinates are in the normalized source frame. A tracker reporting success
is NOT proof of subject identity. See qa.json and review diagnostic.mp4.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

import cv2
import numpy as np

VERSION = "0.1.0"
MODEL_HASHES = {
    "deploy.prototxt": "2d180f723b3109e21f8287f6b3c691390d07b60eed998327cd3259ffa0e50608",
    "model.caffemodel": "52eed8be80522c152a17fb56740de705b79881bde1a167e0e747310523685fc7",
}


def dump(path, data):
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def run_command(cmd):
    subprocess.run([str(x) for x in cmd], check=True)


def probe(path):
    result = subprocess.run([
        "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)
    ], capture_output=True, text=True, check=True)
    data = json.loads(result.stdout)
    video = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), None)
    if video is None:
        raise ValueError("Input has no video stream")
    return {"width": int(video["width"]), "height": int(video["height"]),
            "duration": float(data.get("format", {}).get("duration", 0)),
            "has_audio": any(s.get("codec_type") == "audio" for s in data.get("streams", []))}


def positive(value):
    value = float(value)
    if not math.isfinite(value) or value <= 0:
        raise argparse.ArgumentTypeError("Must be a finite positive number")
    return value


def nonnegative(value):
    value = float(value)
    if not math.isfinite(value) or value < 0:
        raise argparse.ArgumentTypeError("Must be a finite nonnegative number")
    return value


def ints(value, count):
    try:
        values = [int(x) for x in value.split(",")]
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Expected comma-separated integers") from exc
    if len(values) != count:
        raise argparse.ArgumentTypeError(f"Expected {count} comma-separated integers")
    return values


def parse_bbox(value):
    x, y, w, h = ints(value, 4)
    if x < 0 or y < 0 or w < 4 or h < 4:
        raise argparse.ArgumentTypeError("bbox is x,y,width,height; origin >= 0 and size >= 4")
    return [x, y, w, h]


def parse_hsv(value):
    h0, h1, s0, s1, v0, v1 = ints(value, 6)
    if not (0 <= h0 <= h1 <= 179 and 0 <= s0 <= s1 <= 255 and 0 <= v0 <= v1 <= 255):
        raise argparse.ArgumentTypeError("HSV ranges: H 0..179, S/V 0..255; lower <= upper")
    return [h0, h1, s0, s1, v0, v1]


def parse_size(value):
    try:
        w, h = (int(x) for x in value.lower().split("x"))
    except (ValueError, TypeError) as exc:
        raise argparse.ArgumentTypeError("Expected WIDTHxHEIGHT") from exc
    if w < 16 or h < 16 or w % 2 or h % 2:
        raise argparse.ArgumentTypeError("Output dimensions must be even and >= 16")
    return [w, h]


def normalized_clip(src, dst, start, duration, fps, threads):
    # Re-encoding a short CFR working copy avoids inaccurate OpenCV seeks into
    # stream-copied downloads with preroll/B-frames, rotation or non-square pixels.
    run_command([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-threads", threads, "-ss", start, "-i", str(src), "-t", duration,
        "-map", "0:v:0", "-map", "0:a:0?",
        "-vf", f"scale=trunc(iw*sar/2)*2:trunc(ih/2)*2,setsar=1,fps={fps}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-g", fps,
        "-keyint_min", fps, "-pix_fmt", "yuv420p", "-threads", threads,
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(dst)
    ])


def make_tracker(frame, box):
    params = cv2.TrackerCSRT_Params()
    params.template_size = 160
    params.psr_threshold = 0.035
    tracker = cv2.TrackerCSRT_create(params)
    tracker.init(frame, tuple(int(v) for v in box))
    return tracker


def clipped_box(box, width, height):
    x, y, w, h = (float(v) for v in box)
    if not all(math.isfinite(v) for v in (x, y, w, h)):
        return None
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(width, x + w), min(height, y + h)
    if not all(math.isfinite(v) for v in (x0, y0, x1, y1)) or x1 - x0 < 4 or y1 - y0 < 4:
        return None
    return [x0, y0, x1 - x0, y1 - y0]


def scene_score(previous, current):
    """Conservative cut heuristic; an agent/human still has to verify cuts."""
    mae = float(np.mean(cv2.absdiff(previous, current))) / 255
    a = cv2.cvtColor(previous, cv2.COLOR_BGR2HSV)
    b = cv2.cvtColor(current, cv2.COLOR_BGR2HSV)
    ha = cv2.calcHist([a], [0, 1], None, [24, 16], [0, 180, 0, 256])
    hb = cv2.calcHist([b], [0, 1], None, [24, 16], [0, 180, 0, 256])
    cv2.normalize(ha, ha); cv2.normalize(hb, hb)
    hist = float(cv2.compareHist(ha, hb, cv2.HISTCMP_BHATTACHARYYA))
    return mae, hist


class CarDetector:
    def __init__(self, directory, threshold, hsv=None, fraction=0.02):
        directory = Path(directory).expanduser()
        for name, expected in MODEL_HASHES.items():
            path = directory / name
            if not path.is_file():
                raise ValueError(f"Missing {path}. Run tools/fetch_models.py explicitly first.")
            if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise ValueError(f"Checksum mismatch: {path}")
        self.net = cv2.dnn.readNetFromCaffe(str(directory / "deploy.prototxt"), str(directory / "model.caffemodel"))
        self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
        self.threshold, self.hsv, self.fraction = threshold, hsv, fraction

    def detect(self, frame, previous):
        height, width = frame.shape[:2]
        x, y, w, h = previous
        cx, cy = x + w / 2, y + h / 2
        # Local ROI, not an unrestricted whole-frame identity search.
        x0, x1 = max(0, int(cx - 1.8 * w)), min(width, int(cx + 1.8 * w))
        y0, y1 = max(0, int(cy - 1.7 * h)), min(height, int(cy + 1.7 * h))
        roi = frame[y0:y1, x0:x1]
        if roi.shape[0] < 12 or roi.shape[1] < 16:
            return None
        self.net.setInput(cv2.dnn.blobFromImage(roi, .007843, (300, 300), 127.5))
        found = self.net.forward()
        best = None
        for detection in found[0, 0]:
            # VOC class 7 is car. This optional detector is NOT generic.
            if int(detection[1]) != 7 or float(detection[2]) < self.threshold:
                continue
            xyxy = detection[3:7] * [roi.shape[1], roi.shape[0], roi.shape[1], roi.shape[0]] + [x0, y0, x0, y0]
            ax, ay, bx, by = xyxy
            candidate = clipped_box([ax, ay, bx - ax, by - ay], width, height)
            if candidate is None:
                continue
            ax, ay, bw, bh = candidate
            distance = math.hypot(ax + bw / 2 - cx, ay + bh / 2 - cy)
            if distance > max(width * .08, w * 1.3):
                continue
            fraction = 0.0
            if self.hsv:
                patch = frame[int(ay):int(ay + bh), int(ax):int(ax + bw)]
                if patch.size == 0:
                    continue
                hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
                h0, h1, s0, s1, v0, v1 = self.hsv
                mask = cv2.inRange(hsv, np.array([h0, s0, v0]), np.array([h1, s1, v1]))
                fraction = float(np.mean(mask > 0))
                if fraction < self.fraction:
                    continue
            score = distance / max(1, w) - float(detection[2]) * .15 - fraction * .5
            if best is None or score < best[0]:
                best = (score, candidate, float(detection[2]), fraction)
        return None if best is None else {"bbox": best[1], "score": best[2], "color_fraction": best[3]}


def load_seeds(args, width, height):
    raw = {"seeds": [{"time": 0, "bbox": args.bbox}]} if args.bbox else json.loads(Path(args.seeds).read_text(encoding="utf-8"))
    entries = raw if isinstance(raw, list) else raw.get("seeds", [])
    result = {}
    for entry in entries:
        frame = int(entry["frame"]) if "frame" in entry else round(float(entry.get("time", 0)) * args.fps)
        bbox = entry.get("bbox")
        if frame < 0 or not bbox or len(bbox) != 4:
            raise ValueError("Each seed needs local frame/time and bbox [x,y,width,height]")
        good = clipped_box(bbox, width, height)
        if good is None or any(abs(a - b) > .1 for a, b in zip(good, bbox)):
            raise ValueError(f"Seed at frame {frame} lies outside the normalized source")
        if frame in result:
            raise ValueError(f"Duplicate seed at frame {frame}")
        result[frame] = {"bbox": good, "cut": bool(entry.get("cut", False))}
    if 0 not in result:
        raise ValueError("A seed at local frame/time 0 is required")
    return result


def median_smooth(values, radius):
    if radius <= 0 or len(values) < 2:
        return values.copy()
    padded = np.pad(values, (radius, radius), mode="edge")
    return np.array([np.median(padded[i:i + 2 * radius + 1]) for i in range(len(values))])


def camera_path(rows, width, height, fps, size, deadband=.06, max_speed=.167, max_accel=.417, max_gap=.35):
    """Offline smoothing per shot; limits are fractions of SOURCE width per s / s².

    Visibility can conflict with smoothness: do not secretly teleport the crop.
    Report partial/too-wide boxes to QA instead. Never smooth across a shot cut.
    """
    crop_width = height * size[0] / size[1]
    if crop_width > width + 1e-6:
        raise ValueError("Target is wider than the source. Padding/outpainting is outside this skill.")
    paths = np.empty(len(rows), float)
    shot_ids = [r["shot"] for r in rows]
    breaks = [0] + [i for i in range(1, len(rows)) if shot_ids[i] != shot_ids[i - 1]] + [len(rows)]
    dt, vmax, amax = 1 / fps, max_speed * width, max_accel * width
    for start, end in zip(breaks, breaks[1:]):
        part = rows[start:end]
        centers = np.full(len(part), np.nan)
        for i, row in enumerate(part):
            if row["valid"] and row["bbox"] is not None:
                centers[i] = row["bbox"][0] + row["bbox"][2] / 2
        # Only bridge short gaps. A long unknown interval holds the last known center.
        valid = np.flatnonzero(np.isfinite(centers))
        if not len(valid):
            target = np.full(len(part), width / 2)
        else:
            target = centers.copy()
            target[:valid[0]] = width / 2
            for i, j in zip(valid, valid[1:]):
                if j - i <= max(1, round(max_gap * fps)):
                    target[i:j + 1] = np.linspace(centers[i], centers[j], j - i + 1)
                else:
                    target[i + 1:j] = centers[i]
            target[valid[-1] + 1:] = centers[valid[-1]]
            target = median_smooth(target, max(1, round(fps * .067)))
            radius = max(1, round(fps * .25))
            kernel = np.exp(-.5 * (np.arange(-radius, radius + 1) / max(1, fps * .1)) ** 2)
            kernel /= kernel.sum()
            target = np.convolve(np.pad(target, (radius, radius), mode="edge"), kernel, mode="valid")
        camera = float(np.clip(target[0], crop_width / 2, width - crop_width / 2))
        velocity = 0.0
        for k, value in enumerate(target):
            if k == 0:
                paths[start] = camera - crop_width / 2
                continue
            future = target[min(len(target) - 1, k + round(fps * .15))]
            error = future - camera
            tolerance = crop_width * deadband
            desired = 0.0 if abs(error) <= tolerance else float(np.clip((error - math.copysign(tolerance, error)) * 5, -vmax, vmax))
            velocity += float(np.clip(desired - velocity, -amax * dt, amax * dt))
            candidate = camera + velocity * dt
            bounded = float(np.clip(candidate, crop_width / 2, width - crop_width / 2))
            if bounded != candidate:
                velocity = 0.0  # frame boundary is a physical constraint; measure actual acceleration in QA
            camera = bounded
            paths[start + k] = camera - crop_width / 2
    return paths, crop_width


def intervals(rows, predicate, fps):
    found, start = [], None
    for i, row in enumerate(rows + [None]):
        hit = row is not None and predicate(row)
        if hit and start is None:
            start = i
        if not hit and start is not None:
            found.append({"start": round(start / fps, 4), "end": round(i / fps, 4), "frames": i - start})
            start = None
    return found


def build_qa(rows, width, height, fps, size, timing):
    valid = [r for r in rows if r["valid"]]
    inside = sum(r["bbox"][0] >= r["crop_x"] - 1e-3 and r["bbox"][0] + r["bbox"][2] <= r["crop_x"] + r["crop_width"] + 1e-3 for r in valid)
    unverified = intervals(rows, lambda r: not r["valid"], fps)
    clipped = intervals(rows, lambda r: r["valid"] and (r["bbox"][0] < r["crop_x"] - 1e-3 or r["bbox"][0] + r["bbox"][2] > r["crop_x"] + r["crop_width"] + 1e-3), fps)
    # Exclude discontinuities at actual shot boundaries from the motion metrics.
    speed, accel = [], []
    for i in range(1, len(rows)):
        if rows[i]["shot"] == rows[i - 1]["shot"]:
            speed.append((rows[i]["crop_x"] - rows[i - 1]["crop_x"]) * fps)
            if i > 1 and rows[i - 1]["shot"] == rows[i - 2]["shot"]:
                accel.append((rows[i]["crop_x"] - 2 * rows[i - 1]["crop_x"] + rows[i - 2]["crop_x"]) * fps * fps)
    warnings = []
    if unverified:
        warnings.append("Tracking is uncertain or unseeded in some intervals; inspect orange diagnostic markers.")
    if clipped:
        warnings.append("The measured object box is partly outside the crop in some intervals.")
    if any(r["valid"] and r["bbox"][2] > r["crop_width"] for r in rows):
        warnings.append("The subject is wider than the crop; full visibility is geometrically impossible there.")
    return {
        "version": VERSION, "status": "review_required" if warnings else "mechanical_checks_passed",
        "ready_to_publish": False, "human_identity_review_required": True,
        "note": "These are mechanical checks on predicted boxes, NOT independent identity/accuracy verification.",
        "frames": len(rows), "fps": fps, "duration_seconds": len(rows) / fps,
        "source_size": [width, height], "output_size": size,
        "valid_box_frames": len(valid), "box_fully_inside_crop_frames": inside,
        "box_fully_inside_crop_ratio_among_valid": inside / len(valid) if valid else None,
        "unverified_intervals": unverified, "partial_crop_intervals": clipped,
        "cut_times": [r["time"] for r in rows if r["cut"]],
        "max_observed_crop_speed_source_px_s": max(map(abs, speed), default=0),
        "max_observed_crop_acceleration_source_px_s2": max(map(abs, accel), default=0),
        "performance": timing, "warnings": warnings,
    }


def track(source, args, seeds):
    info = probe(source); width, height = info["width"], info["height"]
    sw = min(width, args.track_width); sh = max(16, round(height * sw / width))
    sx, sy = sw / width, sh / height
    cap = cv2.VideoCapture(str(source))
    if not cap.isOpened():
        raise ValueError("OpenCV cannot decode the normalized working copy")
    detector = CarDetector(args.models, args.detect_threshold, args.hsv, args.min_color_fraction) if args.detector == "car-ssd" else None
    tracker = None; previous_box = None; previous_small = None
    rows, shot, frame_index, corrections = [], 0, 0, 0
    last_cut = -args.fps
    wall0, cpu0 = time.perf_counter(), time.process_time()
    detect_every = max(1, round(args.fps / args.detector_rate))
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        small = cv2.resize(frame, (sw, sh), interpolation=cv2.INTER_AREA)
        thumb = cv2.resize(frame, (160, 90), interpolation=cv2.INTER_AREA)
        seed = seeds.get(frame_index)
        cut = False; mae = hist = 0.0
        if frame_index and previous_small is not None and not args.no_cut_detection:
            mae, hist = scene_score(previous_small, thumb)
            cut = (mae >= args.cut_mae or (mae >= .10 and hist >= args.cut_hist)) and frame_index - last_cut > round(args.fps * .15)
        if seed and seed["cut"] and frame_index:
            cut = True
        if cut:
            shot += 1; last_cut = frame_index; tracker = None; previous_box = None
        valid, candidate, raw_success, detection_score = False, None, False, None
        state = "cut_unseeded" if tracker is None else "lost"
        if seed:
            candidate = seed["bbox"]
            tracker = make_tracker(small, [candidate[0] * sx, candidate[1] * sy, max(4, candidate[2] * sx), max(4, candidate[3] * sy)])
            previous_box = candidate
            valid, state = True, "manual_seed"
        elif tracker is not None:
            raw_success, box = tracker.update(small)
            if raw_success:
                candidate = clipped_box([box[0] / sx, box[1] / sy, box[2] / sx, box[3] / sy], width, height)
            if candidate and previous_box:
                old = np.array(previous_box[:2]) + np.array(previous_box[2:]) / 2
                new = np.array(candidate[:2]) + np.array(candidate[2:]) / 2
                ratio = candidate[2] * candidate[3] / max(1, previous_box[2] * previous_box[3])
                valid = bool(np.linalg.norm(new - old) <= width * .06 and .25 <= ratio <= 4)
            state = "tracker_valid" if valid else "suspected_drift" if raw_success else "lost"
            if detector and previous_box and (frame_index % detect_every == 0 or not valid):
                result = detector.detect(frame, candidate if valid else previous_box)
                if result:
                    candidate = result["bbox"]; detection_score = result["score"]
                    tracker = make_tracker(small, [candidate[0] * sx, candidate[1] * sy, max(4, candidate[2] * sx), max(4, candidate[3] * sy)])
                    valid, state = True, "detector_corrected"
                    corrections += 1
            if valid:
                previous_box = candidate
        rows.append({"frame": frame_index, "time": round(frame_index / args.fps, 6), "shot": shot,
                     "cut": bool(cut), "cut_score": {"mae": mae, "hist": hist}, "state": state,
                     "raw_tracker_success": bool(raw_success), "valid": bool(valid),
                     "bbox": [float(v) for v in candidate] if valid and candidate else None,
                     "detection_score": detection_score, "identity_verified": False})
        previous_small = thumb
        frame_index += 1
    cap.release()
    if not rows:
        raise ValueError("No frames decoded")
    if max(seeds) >= len(rows):
        raise ValueError("A seed lies beyond the end of the selected clip")
    wall = time.perf_counter() - wall0
    timing = {"tracking_wall_seconds": wall, "tracking_cpu_seconds": time.process_time() - cpu0,
              "tracking_frames_per_second": len(rows) / max(wall, 1e-9), "detector_corrections": corrections,
              "includes": "decode, resizing, cuts, tracking, detector; excludes normalization and rendering"}
    return rows, timing


def encode_pipe(path, size, fps, source, seconds, threads, with_audio=True):
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
           "-s", f"{size[0]}x{size[1]}", "-r", str(fps), "-i", "-"]
    if with_audio:
        cmd += ["-threads", str(threads), "-i", str(source)]
    cmd += ["-map", "0:v:0"] + (["-map", "1:a:0?"] if with_audio else [])
    cmd += ["-t", str(seconds), "-c:v", "libx264", "-preset", "veryfast", "-threads", str(threads), "-crf", "18",
            "-pix_fmt", "yuv420p", "-g", str(fps), "-keyint_min", str(fps)]
    if with_audio:
        cmd += ["-c:a", "aac", "-b:a", "192k"]
    cmd += ["-movflags", "+faststart", str(path)]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE)


def render(job, data):
    config, rows = data["config"], data["frames"]
    source = job / "source.mp4"
    width, height, fps, size = config["width"], config["height"], config["fps"], config["size"]
    seconds = len(rows) / fps
    out_file, debug_file = job / "vertical.mp4", job / "diagnostic.mp4"
    temp_out, temp_debug = job / "vertical.part.mp4", job / "diagnostic.part.mp4"
    video = encode_pipe(temp_out, size, fps, source, seconds, config["threads"])
    dw = min(960, width); dh = max(2, round(height * dw / width / 2) * 2)
    debug = encode_pipe(temp_debug, [dw, dh], fps, source, seconds, config["threads"], with_audio=False)
    cap = cv2.VideoCapture(str(source))
    samples, wanted = [], set(np.linspace(0, len(rows) - 1, min(6, len(rows)), dtype=int).tolist())
    scale = size[1] / height
    processed = 0
    error = None
    try:
        for row in rows:
            ok, frame = cap.read()
            if not ok:
                raise RuntimeError("Unexpected end of normalized source during render")
            matrix = np.float32([[scale, 0, -row["crop_x"] * scale], [0, scale, 0]])
            # Fractional translation avoids visible integer-crop stepping.
            portrait = cv2.warpAffine(frame, matrix, tuple(size), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
            video.stdin.write(portrait.tobytes())
            view = cv2.resize(frame, (dw, dh), interpolation=cv2.INTER_AREA)
            sx, sy = dw / width, dh / height
            color = (80, 240, 100) if row["valid"] else (0, 165, 255)
            x0, x1 = round(row["crop_x"] * sx), round((row["crop_x"] + row["crop_width"]) * sx)
            cv2.rectangle(view, (x0, 1), (min(dw - 1, x1), dh - 2), (255, 255, 255), 2)
            if row["bbox"]:
                x, y, w, h = row["bbox"]
                cv2.rectangle(view, (round(x * sx), round(y * sy)), (round((x + w) * sx), round((y + h) * sy)), color, 2)
            label = f"{row['time']:.2f}s | shot {row['shot']} | {row['state']}"
            cv2.rectangle(view, (0, 0), (dw, min(32, dh)), (12, 20, 25), -1)
            cv2.putText(view, label, (9, 22), cv2.FONT_HERSHEY_SIMPLEX, .52, color, 1, cv2.LINE_AA)
            debug.stdin.write(view.tobytes())
            if row["frame"] in wanted:
                th = max(2, round(220 * size[1] / size[0]))
                samples.append(cv2.resize(portrait, (220, th)))
            processed += 1
    except Exception as exc:
        error = exc
    finally:
        cap.release()
        for process in (video, debug):
            try:
                process.stdin.close()
            except (BrokenPipeError, OSError):
                pass
        results = [video.wait(), debug.wait()]
    if error or any(results):
        raise RuntimeError(f"Render failed after {processed} frames; see ffmpeg error above") from error
    temp_out.replace(out_file); temp_debug.replace(debug_file)
    if samples:
        # Grid, not a very wide strip that image viewers cannot open.
        cell_h, cell_w = samples[0].shape[:2]
        cols = min(3, len(samples)); grid = np.zeros((math.ceil(len(samples) / cols) * cell_h, cols * cell_w, 3), np.uint8)
        for i, sample in enumerate(samples):
            y, x = divmod(i, cols); grid[y * cell_h:(y + 1) * cell_h, x * cell_w:(x + 1) * cell_w] = sample
        cv2.imwrite(str(job / "contact-sheet.jpg"), grid)
    rendered = probe(out_file)
    expected = len(rows) / fps
    if rendered["width"] != size[0] or rendered["height"] != size[1] or abs(rendered["duration"] - expected) > max(.12, 2 / fps):
        raise RuntimeError("Export dimensions/duration did not match the plan")
    return rendered


def doctor(args):
    print(json.dumps({"version": VERSION, "python": sys.version.split()[0], "opencv": cv2.__version__,
                      "numpy": np.__version__, "csrt_available": hasattr(cv2, "TrackerCSRT_create"),
                      "ffmpeg": bool(shutil.which("ffmpeg")), "ffprobe": bool(shutil.which("ffprobe")),
                      "cpu_count": os.cpu_count(), "gpu_required": False, "api_key_required": False}, indent=2))
    return 0


def inspect(args):
    output = Path(args.out).resolve()
    output.mkdir(parents=True, exist_ok=True)
    normalized_clip(Path(args.input).resolve(), output / "inspect-source.mp4", args.start, .2, args.fps, args.threads)
    cap = cv2.VideoCapture(str(output / "inspect-source.mp4")); ok, frame = cap.read(); cap.release()
    if not ok:
        raise ValueError("Cannot inspect this source time")
    cv2.imwrite(str(output / "first-frame.jpg"), frame)
    info = probe(output / "inspect-source.mp4")
    dump(output / "frame.json", {"width": info["width"], "height": info["height"], "source_start_seconds": args.start,
                                  "seed_format": "x,y,width,height in this first-frame.jpg; never center coordinates"})
    print(f"Inspect {output / 'first-frame.jpg'}; seed coordinates refer to this normalized frame.")
    return 0


def execute(args):
    if args.fps < 1 or args.fps > 120 or args.threads < 1 or args.track_width < 64:
        raise ValueError("fps 1..120, threads >= 1, track-width >= 64 required")
    if not hasattr(cv2, "TrackerCSRT_create"):
        raise ValueError("CSRT missing. Use a clean venv with opencv-contrib-python-headless, not opencv-python.")
    if args.hsv and args.detector == "none":
        raise ValueError("--hsv is an optional detector gate; use --detector car-ssd")
    if not (0 <= args.deadband <= .4 and 0 <= args.min_color_fraction <= 1 and 0 < args.detect_threshold <= 1):
        raise ValueError("Invalid deadband, color fraction or detector threshold")
    source_input = Path(args.input).resolve()
    if not source_input.is_file():
        raise ValueError("Input must be an existing local video file; use a separate downloader for URLs")
    job = Path(args.out).resolve()
    if job.exists() and any(job.iterdir()):
        raise ValueError("Output directory must be empty; choose a new job folder (no destructive overwrite)")
    job.mkdir(parents=True, exist_ok=True)
    args._owned_job = job
    dump(job / "status.json", {"status": "preparing", "version": VERSION})
    normalized_clip(source_input, job / "source.mp4", args.start, args.duration, args.fps, args.threads)
    info = probe(job / "source.mp4")
    width, height = info["width"], info["height"]
    if args.size[0] / args.size[1] > width / height + 1e-6:
        raise ValueError("This full-height crop cannot create a wider target; no padding/outpainting is implemented")
    seeds = load_seeds(args, width, height)
    dump(job / "seeds.used.json", {"seeds": [{"frame": i, **v} for i, v in sorted(seeds.items())]})
    dump(job / "status.json", {"status": "tracking", "version": VERSION})
    rows, timing = track(job / "source.mp4", args, seeds)
    path, crop_width = camera_path(rows, width, height, args.fps, args.size, args.deadband, args.max_speed, args.max_accel, args.max_gap)
    for row, x in zip(rows, path):
        row["crop_x"], row["crop_width"] = float(x), float(crop_width)
    config = {"version": VERSION, "width": width, "height": height, "fps": args.fps, "size": args.size,
              "threads": args.threads, "source_start": args.start, "detector": args.detector,
              "deadband_crop_fraction": args.deadband, "max_speed_source_widths_s": args.max_speed,
              "max_accel_source_widths_s2": args.max_accel, "identity_note": "Predicted boxes are not semantic identity verification"}
    data = {"config": config, "performance": timing, "frames": rows}
    dump(job / "tracking.json", data)
    qa = build_qa(rows, width, height, args.fps, args.size, timing)
    dump(job / "qa.json", qa)
    if not args.track_only:
        dump(job / "status.json", {"status": "rendering", "version": VERSION})
        qa["export"] = render(job, data)
        dump(job / "qa.json", qa)
    dump(job / "status.json", {"status": qa["status"], "version": VERSION, "rendered": not args.track_only,
                               "human_identity_review_required": True})
    print(json.dumps({"out": str(job), "status": qa["status"], "frames": len(rows), "tracking_fps": timing["tracking_frames_per_second"],
                      "human_identity_review_required": True}, indent=2))
    return 2 if qa["status"] == "review_required" else 0


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)
    sub.add_parser("doctor").set_defaults(func=doctor)
    ip = sub.add_parser("inspect", help="Export the correctly normalized first frame for manual selection")
    ip.add_argument("input"); ip.add_argument("--start", type=nonnegative, default=0)
    ip.add_argument("--out", required=True); ip.add_argument("--fps", type=int, default=30)
    ip.add_argument("--threads", type=int, default=2); ip.set_defaults(func=inspect)
    rp = sub.add_parser("run", help="Normalize, track, smooth, render and write QA")
    rp.add_argument("input"); rp.add_argument("--start", type=nonnegative, default=0)
    rp.add_argument("--duration", type=positive, required=True)
    rp.add_argument("--out", required=True)
    seed = rp.add_mutually_exclusive_group(required=True)
    seed.add_argument("--bbox", type=parse_bbox); seed.add_argument("--seeds", help="JSON with local time/frame seeds")
    rp.add_argument("--size", type=parse_size, default=[1080, 1920])
    rp.add_argument("--fps", type=int, default=30); rp.add_argument("--threads", type=int, default=2)
    rp.add_argument("--track-width", type=int, default=960)
    rp.add_argument("--detector", choices=["none", "car-ssd"], default="none")
    rp.add_argument("--models", default=str(Path.home() / ".cache/auto-reframe/mobilenet-ssd"))
    rp.add_argument("--detector-rate", type=positive, default=5)
    rp.add_argument("--detect-threshold", type=positive, default=.35)
    rp.add_argument("--hsv", type=parse_hsv)
    rp.add_argument("--min-color-fraction", type=float, default=.02)
    rp.add_argument("--deadband", type=float, default=.06, help="Fraction of crop width")
    rp.add_argument("--max-speed", type=positive, default=.167, help="Source widths per second")
    rp.add_argument("--max-accel", type=positive, default=.417, help="Source widths per second squared")
    rp.add_argument("--max-gap", type=nonnegative, default=.35)
    rp.add_argument("--no-cut-detection", action="store_true", help="Only after verifying this is one uncut shot")
    rp.add_argument("--cut-mae", type=positive, default=.27)
    rp.add_argument("--cut-hist", type=positive, default=.42)
    rp.add_argument("--track-only", action="store_true")
    rp.set_defaults(func=execute)
    rr = sub.add_parser("render", help="Render from an existing job's tracking.json without re-tracking")
    rr.add_argument("job")
    rr.set_defaults(func=lambda args: (render(Path(args.job).resolve(), json.loads((Path(args.job) / "tracking.json").read_text(encoding="utf-8"))), 0)[1])
    return p


def main():
    args = parser().parse_args()
    cv2.setNumThreads(getattr(args, "threads", 2))
    for binary in ("ffmpeg", "ffprobe"):
        if not shutil.which(binary):
            print(f"Missing dependency: {binary}", file=sys.stderr); return 1
    try:
        return args.func(args)
    except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError, cv2.error) as exc:
        print(f"auto-reframe: {exc}", file=sys.stderr)
        owned = getattr(args, "_owned_job", None)
        if owned is not None:
            # Never alter a rejected non-empty directory; only update a job we created.
            dump(owned / "status.json", {"status": "failed", "version": VERSION,
                                        "error": str(exc), "finished_export": False})
            print("Job files retained for diagnosis; no result claimed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
