---
name: footage
description: Finds and fetches footage of a subject (a YouTube search, a link, an upload) and lays it out on contact sheets to judge whether it is real, moving and usable; for a video cut from footage, and as other skills' footage step.
license: MIT
metadata:
  title: "Find footage"
  title-de: "Footage finden"
  summary: "Footage of your subject found, fetched and laid out on a sheet, so that only real, moving pictures of it go into your video."
  summary-de: "Material zu deinem Thema gefunden, geholt und auf einem Bogen ausgelegt, damit nur echte, bewegte Bilder davon in dein Video kommen."
  ask: "What should the footage show? Name the subject (a machine, an event, a product), or bring a link or a video file."
  ask-de: "Was soll das Material zeigen? Nenne das Motiv (eine Maschine, ein Ereignis, ein Produkt) oder bring einen Link oder eine Videodatei mit."
  placeholder: "The subject, a link or a video"
  placeholder-de: "Das Motiv, ein Link oder ein Video"
  inputs: "video"
---

# footage

`<skill>` is the folder of this file. Run `node <skill>/tools/footage.mjs …` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

Your folder: `footage/<name>/`, `<name>` one short slug of the subject.

## What it needs

Node 20+, ffmpeg and curl; yt-dlp from the PATH, else the tool gets a copy once. No model, no key. When something is missing, say so in one sentence; never install it.

YouTube turns a machine in a data centre away ("Sign in to confirm you're not a bot"): the search still answers, the download does not. A proxy for the downloads is the machine's secret `YT_PROXY`; `node <skill>/tools/footage.mjs proxy` says whether one is saved. When a download from YouTube is wanted and none is, put a password field into your answer and say what it is for; never ask for it in the chat, never print it:

```hiccup
[:div
 [:p "YouTube turns this machine away. With a proxy the downloads work: paste its address here, it is saved on this machine and I never see it."]
 [:secret {:name "YT_PROXY" :label "Proxy for YouTube (http://user:password@host:port)"}]]
```

## From a subject to footage you looked at

### 1. Find it

```bash
node <skill>/tools/footage.mjs search "<subject>" ["<subject>" …]
```

Once for all subjects of the job. It reads YouTube's search page only: id, length, channel, title; `x` marks what is under a minute or from a channel whose footage gets taken down. `SHORTLIST` means worth fetching, never footage confirmed: a documentary made of photographs passes it.

Take two or three candidates a subject, in this order: the maker's own channel or press footage; a news agency's raw footage; an independent creator's own recording. A link or a file the person brings needs no search.

### 2. Fetch it

```bash
node <skill>/tools/footage.mjs fetch footage/<name> <source> [<source> …]
```

A source is a YouTube id or link, a direct link to a video file (a maker's press page, an agency), or a file (`uploads/<file>`). YouTube comes up to 1080p, one after the other. `BOTCHECK` (exit 4) means YouTube turned the download away, three times when a proxy is saved: stop downloading from YouTube now, go on with what came, a file or a direct link, or say that there is no footage. Never a loop of retries, never another way in.

### 3. Look at it

```bash
node <skill>/tools/footage.mjs look footage/<name>
```

For every source: its facts, the stretches its viewers replayed most (YouTube's curve on much-watched videos: what people watch twice), its own cuts, and `footage/<name>/sheet-<stem>.jpg`, 48 frames with their times. Everything is in `footage/<name>/sources.json`.

Look at every sheet. A source is out when it is:

- stills, renderings or animations only (unless the story is about a concept);
- people talking, with a little footage in between;
- a film, TV or streaming excerpt, whatever the uploader's name;
- carrying another broadcaster's logo or burnt-in subtitles across the picture (a small logo in a corner can be cut away later);
- AI-made "archive" footage;
- not the subject at all: titles lie, check the picture against the claim.

No source left: say so, with what you saw, and take another subject or ask for a file. Do not use what failed.

A stretch closer up, before you decide or when you choose shots:

```bash
node <skill>/tools/footage.mjs strip footage/<name> <stem> <from> <to>
```

Two frames a second, each with the source's time. A stretch for a clip holds none of the source's own cuts (`cuts` in `sources.json`): a cut inside a clip looks like a mistake.

### 4. Say what you have

One sentence per source that passed: whose it is, what it shows, how long, and the sheet for the person to see. Note for each its link and its owner as a credit will name it (`title`, `channel`, `url`, `license` in `sources.json`): a video made from it credits the owner on screen and in the post text.

```hiccup
[:div
 [:p "Boston Dynamics' own film, 2:51: Atlas rolling on wheels, close and in motion, no logos."]
 [:img {:src "uploads/footage-atlas-sheet.jpg" :style {:max-width "100%"}}]
 [:button {:class "primary" :send "Take the Boston Dynamics film"} "Take it"] " "
 [:button {:send "Look for other footage of Atlas on wheels"} "Look further"]]
```

A picture in the chat lies under `uploads/`: copy the sheet there first.

## For another skill

A skill runs the tool as a program, never imports its code: `FOOTAGE` naming `tools/footage.mjs`, else `<skill>/../footage/tools/footage.mjs` beside it, else `/home/sprite/skills/footage/tools/footage.mjs`. It reads `<dir>/sources.json` (`stem`, `file`, `title`, `channel`, `url`, `views`, `license`, `duration`, `width`, `height`, `replayed`, `cuts`, `sheet`); the judgement of the sheets stays with its agent. Without the tool such a skill says: "The footage needs agentitos' footage skill beside this one (or FOOTAGE naming its tools/footage.mjs)."

## UI in the chat

A ```hiccup block in your answer becomes part of the page. EDN hiccup, data only. `:send "text"` on a button sends that text as the person's next message; pictures point at `uploads/…`; `[:secret {:name … :label …}]` is a password field for a secret of the machine.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else. Several picks from one list (which sources to take): checkboxes and one button whose `:send` holds `{checked}`.
- A button only where a click makes you act at once. Never one that only leads to your next question: they type what to look for instead.
- The button that moves on gets `:class "primary"`.
- Never a path of `footage/`, a YouTube id, the proxy or a raw error in the chat: sources by their owner and what they show.

## Rules

- The person answers for what they publish. You bring only footage whose owner you can name, and name it.
- A proxy is for the download of a video the person could watch in their browser. Nothing else goes through it, and a refusal through it ends the try.
