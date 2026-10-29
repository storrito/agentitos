// How long a video or a sound file is, in seconds.

import { execFileSync } from "node:child_process";

export const duration = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
