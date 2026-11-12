# footage

Footage of a subject for a video that is cut from it: found on YouTube's search page, fetched (a YouTube video, a direct link, a file), and laid out so that an agent can judge it before a second of it is used: each source's facts, the stretches its viewers replayed most, its own cuts and a contact sheet.

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
node tools/footage.mjs search "Boston Dynamics Atlas wheels"          # candidates, from the search page only
node tools/footage.mjs fetch footage/atlas NL65Awuv8gU press.mp4      # a YouTube id, a link or a file each
node tools/footage.mjs look footage/atlas                             # facts, most replayed, cuts, a sheet per source
node tools/footage.mjs strip footage/atlas yt_NL65Awuv8gU 0:20 0:26   # a stretch, two frames a second
node tools/footage.mjs proxy                                          # is a proxy for YouTube saved?
```

Requirements: Node 20+, ffmpeg (with ffprobe) and curl. yt-dlp from the PATH, else a copy is downloaded once into `~/.cache/agentitos/`, as [clips](../clips/) does. No npm packages, no model, no key.

## Two stages, because metadata lies

`search` proves that videos of a plausible length exist under a searchable name, from channels whose footage is not taken down as a rule. It does not prove that they show the subject: a documentary about a machine that was never filmed, illustrated with photographs and stock footage, passes it with eight candidates. So a `SHORTLIST` means "worth fetching", and the confirmation is the picture: `fetch`, `look`, and the agent's eyes on the sheet.

The search reads the flat result page (`yt-dlp --flat-playlist`), which YouTube does not guard; it never opens a video, since a few such calls get a machine turned away for hours. The resolution is therefore not known before the download.

## What `look` writes

`<dir>/sources.json`, one entry per source:

```json
{"stem": "yt_NL65Awuv8gU", "file": "footage/atlas/yt_NL65Awuv8gU.mp4",
 "title": "Atlas on a Roll", "channel": "Boston Dynamics", "url": "https://www.youtube.com/watch?v=NL65Awuv8gU",
 "views": 748135, "license": null, "duration": 170.88, "width": 1920, "height": 1080,
 "replayed": [{"from": 42, "to": 44, "value": 1}], "cuts": [3.2, 7.84, 12.1],
 "sheet": "footage/atlas/sheet-yt_NL65Awuv8gU.jpg", "every": 3.6}
```

- `replayed`: the five stretches of YouTube's "most replayed" curve with the highest value, in seconds of the source. Only much-watched videos carry the curve. It is measured attention of the source's own viewers and ranks moments within a source, never across sources.
- `cuts`: the source's own cuts, by ffmpeg's scene score over 0.25. A dissolve stays unseen and fast motion can trip it, so a cut inside a chosen stretch is a question for the agent's eyes (`strip`), not a verdict.
- `sheet`: 48 frames over the whole source, 8 a row, each with its time; `every` is the seconds between two frames.

Beside each YouTube source lies `<stem>.info.json` with the facts kept (id, title, channel, link, upload date, views, license, the curve); yt-dlp's own file runs to megabytes.

## YouTube from a server

YouTube answers a download from a data centre's address with "Sign in to confirm you're not a bot", often from the first call (measured on a Sprite, 2026-11-12: the search answered, every download was refused, also with a PO-token provider). A proxy with a household or mobile address gets the same video a browser would:

- `YT_PROXY` in the environment, else the machine's secret of that name: [rragent](https://github.com/storrito/rragent) keeps a machine's secrets in `secrets.json` of its folder, typed by the person into a password field of the page and never shown to a bot; the tool looks for that file above the working directory (`FOOTAGE_SECRETS` names another).
- Only downloads go through it, never the search: a proxy is paid by the gigabyte.
- Its address and login are never printed, also not in yt-dlp's errors.
- A proxy's address changes between calls and single addresses are refused too (four of five downloads came through on that day): a refusal is tried twice more, after 20 s and 40 s, as clips' `episode.mjs` does. Then the tool prints `BOTCHECK` and ends with exit 4, and the agent goes on without YouTube.

The tool does nothing else to get past YouTube: no cookies, no other player clients, no token providers.

## Whose footage

The tool fetches what its caller names. What may be used is the person's to answer for; the skill keeps to what an agent can check: it marks channels whose footage is taken down as a rule (film studios, TV and streaming), tells the agent to leave out excerpts of films and broadcasts whoever uploaded them, to prefer the maker's own or press footage, and to keep every source's owner and link for the credit. The b-roll skill (pull request 37) draws its line elsewhere, on purpose: it shows only material the person may use, since it illustrates their own talk.

## From another skill

A folder never imports another's code: a skill runs this tool as a program, found through `FOOTAGE` (the path of `tools/footage.mjs`), else beside it (`../footage/tools/footage.mjs`), else in the machine's clone (`/home/sprite/skills/footage/tools/footage.mjs`), and reads `sources.json`. Every step prints one line of what it did and what to do next; an error is one sentence on stdout, exit 1 (`BOTCHECK`: exit 4).
