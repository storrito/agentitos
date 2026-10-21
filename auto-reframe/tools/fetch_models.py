#!/usr/bin/env python3
"""Explicit, checksum-verified download for the OPTIONAL car detector.

The model's original licensing/provenance is separate from this skill's MIT code.
No network access is performed by reframe.py. Do not include model weights in Git.
"""
import argparse
import hashlib
from pathlib import Path
import tempfile
import urllib.request

COMMIT = "bb17b6c3eef36d80be441ae8e5339be66e8e3b7a"
BASE = f"https://raw.githubusercontent.com/chuanqi305/MobileNet-SSD/{COMMIT}/"
FILES = {
    "deploy.prototxt": ("deploy.prototxt", 44667, "2d180f723b3109e21f8287f6b3c691390d07b60eed998327cd3259ffa0e50608"),
    "model.caffemodel": ("mobilenet_iter_73000.caffemodel", 23306119, "52eed8be80522c152a17fb56740de705b79881bde1a167e0e747310523685fc7"),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dest", default=str(Path.home() / ".cache/auto-reframe/mobilenet-ssd"))
    args = parser.parse_args()
    dest = Path(args.dest).expanduser().resolve(); dest.mkdir(parents=True, exist_ok=True)
    print("Source: https://github.com/chuanqi305/MobileNet-SSD")
    print("Check the upstream model's rights/license for your intended use. It is not relicensed by this skill.")
    for name, (remote, length, sha) in FILES.items():
        target = dest / name
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == sha:
            print(f"verified: {name}"); continue
        request = urllib.request.Request(BASE + remote, headers={"User-Agent": "auto-reframe/0.1.0"})
        temp = None
        try:
            with tempfile.NamedTemporaryFile(dir=dest, prefix=name + ".", suffix=".part", delete=False) as out:
                temp = Path(out.name); digest = hashlib.sha256(); size = 0
                with urllib.request.urlopen(request, timeout=60) as response:
                    while chunk := response.read(1024 * 1024):
                        size += len(chunk)
                        if size > length:
                            raise RuntimeError(f"Unexpected file size: {name}")
                        out.write(chunk); digest.update(chunk)
            if size != length or digest.hexdigest() != sha:
                raise RuntimeError(f"Checksum/length mismatch: {name}")
            temp.replace(target)
            print(f"downloaded and verified: {name}")
        finally:
            if temp is not None:
                temp.unlink(missing_ok=True)
    print(f"Ready: --models {dest}")


if __name__ == "__main__":
    main()
