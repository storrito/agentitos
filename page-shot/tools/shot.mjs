#!/usr/bin/env node
// A web page or a post on X as a picture: the one page capture of agentitos, which the other
// skills (b-roll, …) run as a program instead of keeping their own. Made for agents: it prints
// what it took and what to do next.
//
//   node tools/shot.mjs <url> <file.png> [--desktop] [--from <px>] [--height <px>] [--scale <n>]
//
//   a page       as a phone shows it (430 css px wide, its first 640 px), --desktop as a laptop
//                (1440 × 900); --from that far down the page, --height more or less of it;
//                at twice the density (--scale)
//   a post on X  (x.com/…/status/…, twitter.com/…) as its card, through X's embed page, cut to it
//
// With Node 22 or later, Chrome is driven through its DevTools protocol (no npm package): reduced
// motion, a cookie banner clicked away in every frame, animations played to their end, the page
// scrolled to --from. Older Node: Chrome's own --screenshot, the page as it first shows.
//
// Writes <file.png> and beside it <file.png>.json: {url, kind: "page" | "post", credit (the source
// in a few words: "X / @jack", "spiegel.de"), width, height, banner}. Prints one line on stdout;
// an error is one sentence on stdout, exit 1.

import fs from "node:fs";
import path from "node:path";
import { shot, postOf } from "./lib/chrome.mjs";

const USAGE = "Usage: shot.mjs <https://…> <file.png> [--desktop] [--from <px>] [--height <px>] [--scale <n>]";
const FLAGS = ["desktop"];
const VALUED = ["from", "height", "scale"];

const fail = (msg) => { console.log(msg); process.exit(1); };
const rel = (p) => path.relative(process.cwd(), p) || ".";

const pos = [], opts = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (!a.startsWith("--")) { pos.push(a); continue; }
  const k = a.slice(2);
  if (FLAGS.includes(k)) { opts[k] = true; continue; }
  if (!VALUED.includes(k)) fail(`Unknown option ${a}. ${USAGE}`);
  if (i + 1 >= args.length || !Number.isFinite(Number(args[i + 1]))) fail(`${a} needs a number.`);
  opts[k] = Number(args[++i]);
}
const [url, file] = pos;
if (!url || !file || !/^https?:\/\//.test(url)) fail(USAGE);
if (!/\.png$/i.test(file)) fail("The picture is a PNG: give a file name ending in .png.");

const post = postOf(url);
const from = opts.from || 0;
// a phone's first screen, not all of it: what is to be read shows bigger in a frame
const height = opts.height || (opts.desktop ? 900 : 640);
const scale = opts.scale || 2;
let r;
try {
  r = post
    ? await shot({ url: post.embed, label: url, out: file, width: 550, height: 1600, scale, transparent: true, mobile: false })
    : await shot({ url, out: file, from, width: opts.desktop ? 1440 : 430, height, scale, mobile: !opts.desktop });
} catch (e) { fail(`✗ ${e.message}`); }

const credit = post ? post.credit : new URL(url).hostname.replace(/^www\./, "");
fs.writeFileSync(`${file}.json`, JSON.stringify({ url, kind: post ? "post" : "page", credit, width: r.width, height: r.height, banner: r.banner || null }, null, 1) + "\n");
console.log(`${rel(path.resolve(file))}: ${post ? `the post as its card (${post.credit})` : `the page as a ${opts.desktop ? "laptop" : "phone"} shows it${from ? `, from ${from} px down` : ""}`}, ${r.width}×${r.height}${r.banner ? `; a cookie banner closed („${r.banner}“)` : ""}.` +
  (r.plain ? ` (This Node, ${process.versions.node}, has no WebSocket of its own (Node 22 and later have one): the page as it first shows, a cookie banner and animations as they are.)` : "") +
  ` Look at it before you use it: a banner still in the way, a login wall, a site's notice that it blocks automated visits, an empty or half-drawn page is no picture of it.`);
