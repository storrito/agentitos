#!/usr/bin/env node
// Footage wider than the short cut to its frame, the window on whoever speaks: agentitos' clips
// skill does it (its tools/frame.mjs), this runs it with the same arguments.
//
//   node tools/frame.mjs <video> <transcript.json> --aspect 9:16 --out <framed.mp4>

import { runClips } from "./lib/clips.mjs";

process.exit(runClips("frame.mjs", process.argv.slice(2)));
