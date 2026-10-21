import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools/reframe.py"
spec = importlib.util.spec_from_file_location("auto_reframe", TOOL)
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


def row(i, box=None, shot=0, valid=True):
    return {"frame": i, "time": i / 30, "shot": shot, "cut": False, "valid": valid,
            "bbox": box if box is not None else [350, 300, 100, 80]}


class PureTests(unittest.TestCase):
    def test_single_frame_path_is_finite(self):
        path, width = r.camera_path([row(0)], 1920, 1080, 30, [1080, 1920])
        self.assertEqual(len(path), 1)
        self.assertTrue(np.isfinite(path).all())
        self.assertAlmostEqual(width, 607.5)

    def test_path_resets_at_cuts(self):
        rows = [row(i, [350, 300, 100, 80]) for i in range(10)]
        rows += [row(i, [1450, 300, 100, 80], shot=1) for i in range(10, 20)]
        path, _ = r.camera_path(rows, 1920, 1080, 30, [1080, 1920])
        self.assertGreater(path[10] - path[9], 800)
        self.assertTrue(np.allclose(np.diff(path[:10]), 0))

    def test_unknown_shot_holds_center(self):
        rows = [row(i, shot=1, valid=False) for i in range(10)]
        for x in rows:
            x["bbox"] = None
        path, width = r.camera_path(rows, 1920, 1080, 30, [1080, 1920])
        self.assertTrue(np.allclose(path, (1920 - width) / 2))

    def test_target_geometry(self):
        with self.assertRaises(ValueError):
            r.camera_path([row(0)], 320, 180, 30, [1920, 100])

    def test_bounded_pan(self):
        rows = [row(i, [350 + i * 3, 300, 100, 80]) for i in range(90)]
        path, _ = r.camera_path(rows, 1920, 1080, 30, [1080, 1920])
        self.assertLessEqual(np.max(np.abs(np.diff(path))) * 30, 1920 * .167 + 1e-5)
        self.assertGreaterEqual(path.min(), 0)
        self.assertLessEqual(path.max(), 1920 - 607.5)

    def test_uncertainty_is_not_hidden(self):
        rows = [row(i, valid=(i != 1)) for i in range(3)]
        for x in rows:
            x["crop_x"], x["crop_width"] = 100, 607.5
            if not x["valid"]:
                x["bbox"] = None
        qa = r.build_qa(rows, 1920, 1080, 30, [1080, 1920], {})
        self.assertEqual(qa["status"], "review_required")
        self.assertFalse(qa["ready_to_publish"])
        self.assertTrue(qa["human_identity_review_required"])
        self.assertEqual(qa["unverified_intervals"][0]["frames"], 1)

    def test_nonfinite_box_is_rejected(self):
        self.assertIsNone(r.clipped_box([float('nan'), 0, 20, 20], 320, 180))

    def test_parse_hsv_and_box_validation(self):
        self.assertEqual(r.parse_bbox("10,20,30,40"), [10, 20, 30, 40])
        with self.assertRaises(Exception):
            r.parse_hsv("200,210,0,255,0,255")
        with self.assertRaises(Exception):
            r.parse_bbox("-1,20,30,40")
        with self.assertRaises(Exception):
            r.parse_size("181x320")


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe") and hasattr(cv2, "TrackerCSRT_create"),
                     "ffmpeg/ffprobe and contrib CSRT required")
class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="auto-reframe-test-")
        self.work = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def synthetic(self, cut=False):
        source = self.work / "synthetic.mp4"
        rng = np.random.default_rng(9)
        bg = rng.integers(10, 35, (180, 320, 3), dtype=np.uint8)
        patch = rng.integers(50, 245, (30, 40, 3), dtype=np.uint8)
        writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*"mp4v"), 30, (320, 180))
        self.assertTrue(writer.isOpened())
        for i in range(30):
            frame = bg.copy()
            x = 70 + i
            if cut and i >= 15:
                frame = 255 - bg
                x = 220 + i - 15
            frame[65:95, x:x + 40] = patch
            writer.write(frame)
        writer.release()
        return source

    def command(self, *args):
        result = subprocess.run([sys.executable, str(TOOL), *map(str, args)], capture_output=True, text=True)
        self.assertIn(result.returncode, [0, 2], result.stdout + result.stderr)
        return result

    def test_silent_video_complete_render(self):
        source = self.synthetic()
        out = self.work / "silent-job"
        self.command("run", source, "--duration", "1", "--bbox", "70,65,40,30", "--size", "180x320",
                     "--track-width", "320", "--no-cut-detection", "--out", out)
        for name in ["vertical.mp4", "diagnostic.mp4", "contact-sheet.jpg", "tracking.json", "qa.json", "status.json"]:
            self.assertTrue((out / name).is_file(), name)
        info = r.probe(out / "vertical.mp4")
        self.assertEqual([info["width"], info["height"]], [180, 320])
        self.assertFalse(info["has_audio"])
        self.assertAlmostEqual(info["duration"], 1, delta=.1)
        rows = json.loads((out / "tracking.json").read_text())["frames"]
        self.assertEqual(len(rows), 30)

    def test_explicit_cut_resets_tracker_and_camera(self):
        source = self.synthetic(cut=True)
        seeds = self.work / "seeds.json"
        seeds.write_text(json.dumps({"seeds": [{"frame": 0, "bbox": [70, 65, 40, 30]},
                                               {"frame": 15, "bbox": [220, 65, 40, 30], "cut": True}]}))
        out = self.work / "cut-job"
        self.command("run", source, "--duration", "1", "--seeds", seeds, "--size", "180x320",
                     "--no-cut-detection", "--track-only", "--out", out)
        rows = json.loads((out / "tracking.json").read_text())["frames"]
        self.assertNotEqual(rows[14]["shot"], rows[15]["shot"])
        self.assertTrue(rows[15]["cut"])
        self.assertEqual(rows[15]["state"], "manual_seed")
        self.assertGreater(rows[15]["crop_x"] - rows[14]["crop_x"], 80)

    def test_unseeded_automatic_cut_requires_review(self):
        source = self.synthetic(cut=True)
        out = self.work / "unseeded-cut"
        result = self.command("run", source, "--duration", "1", "--bbox", "70,65,40,30",
                              "--size", "180x320", "--track-only", "--out", out)
        self.assertEqual(result.returncode, 2)
        rows = json.loads((out / "tracking.json").read_text())["frames"]
        self.assertTrue(any(x["cut"] for x in rows))
        self.assertTrue(any(x["state"] == "cut_unseeded" and x["bbox"] is None for x in rows))
        qa = json.loads((out / "qa.json").read_text())
        self.assertEqual(qa["status"], "review_required")

    def test_nonempty_job_directory_is_not_overwritten(self):
        source = self.synthetic()
        out = self.work / "existing"; out.mkdir()
        (out / "keep.txt").write_text("keep me")
        result = subprocess.run([sys.executable, str(TOOL), "run", str(source), "--duration", "1",
                                 "--bbox", "70,65,40,30", "--out", str(out)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual((out / "keep.txt").read_text(), "keep me")


if __name__ == "__main__":
    unittest.main()
