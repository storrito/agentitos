#!/usr/bin/env node
// A long video as the source of several shorts: agentitos' clips skill does it (its
// tools/episode.mjs: fetch, moments, cut), this runs it with the same arguments.
//
//   node tools/episode.mjs fetch <url|file> <dir> | moments <dir> [--count N] | cut <dir> <first>-<last> <clip.mp4>

import { runClips } from "./lib/clips.mjs";

process.exit(runClips("episode.mjs", process.argv.slice(2)));
