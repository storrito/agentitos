# agentitos

A collection of agent skills, one top-level folder each. [README.md](README.md) holds the conventions in full; this is what an agent working on the collection must not miss.

## Reuse what a skill already does

Before writing code for a job, look whether a skill here does it, and call its tool instead of doing it again:

| need | skill | how |
| --- | --- | --- |
| what the apps cover of a video (buttons, names, captions of Instagram, TikTok, YouTube, Facebook, Snapchat, Pinterest, LinkedIn, X) | [platform-zones](platform-zones/) | `tools/zones.mjs zones [platform…] --size WxH --json`: whatever must be seen stays in its `safe` box, text is centred on the frame in its `centred` box; nothing to be read under its `covers`; never write safe-zone numbers into a skill. Its SKILL.md's "Laying out a frame" holds the rules for placing text, captions, faces and Story stickers |
| whether a frame is laid out well (text under the buttons, on a face, on other text, cut off, stickers on each other) | [platform-zones](platform-zones/) | `tools/zones.mjs layout <page.html> [platform…]`, or `tools/measure.js` in your own page and `layout <boxes.json>` |
| Instagram's stickers (link, poll, question, countdown, …) on a Story, picture or video | Storrito | `<insta-…>` elements in the story's HTML; [story-from-link](story-from-link/) shows how, platform-zones says where |
| captions in a video | [captions](captions/) | `tools/captions.mjs build <words.json> <folder> --style … [--platform …]`, mount the clip it prints |
| a brand's colours, fonts, logo, voice | [brand-kit](brand-kit/) | read `brand/DESIGN.md` of the working directory; without one, draft it with `tools/site.mjs <url> <dir>` (or story-from-link's `page.mjs`) and `tools/kit.mjs draft <dir> brand`, as story-from-link does |
| the best take of each part of talking-to-camera recordings, without slips and "äh"s | [best-takes](best-takes/) | its tools, as its SKILL.md describes |
| a wide video cropped to 9:16 or square, following one subject that moves without speaking (a car, an athlete, a product), on the CPU, offline | [auto-reframe](auto-reframe/) | its tools; people talking go to clips' `tools/frame.mjs` |
| a long video's words with speakers, its moments that stand alone as shorts, a moment cut out, footage framed 9:16 on whoever speaks | [clips](clips/) | `tools/episode.mjs fetch / moments / cut`, `tools/frame.mjs` |
| a thumbnail and a short intro for a video | [thumbnail-and-intro](thumbnail-and-intro/) | its `job.json` and tools |
| what an rragent bot did meanwhile (its messages, tools, waits) | [agent-timeline](agent-timeline/) | `tools/timeline.mjs` |
| voice, music or a picture made by a model (a voiceover with every word's time, a music bed, a background) | [launch-video](launch-video/) | `tools/launch.mjs voice`, `music`, `image` (OpenRouter; no HeyGen account) |
| text checked against the apps' buttons in a HyperFrames film | [launch-video](launch-video/) | `tools/launch.mjs check <work> <composition>` after `zones` |
| an Instagram Story, scheduled through Storrito | [story-from-link](story-from-link/) | its tools |
| the texts for a video on each platform (captions, titles, descriptions, tags, hashtags, mentions) within the platforms' limits | [video-descriptions](video-descriptions/) | `tools/descriptions.mjs read`, then `check` and `overview` on the agent's `descriptions.json` |
| a finished video checked and published on the person's accounts through Storrito (Reels, TikTok, Shorts, Facebook, LinkedIn, Pinterest, Snapchat, Threads, X; long-form on YouTube) | [publish-video](publish-video/) | `tools/publish.mjs check`, `accounts`, then `publish` with video-descriptions' `descriptions.json` ; a skill that makes videos hands them over to it instead of calling Storrito's schedule procedures itself |

A new skill that needs one of these says so in its SKILL.md and README ("needs agentitos' captions skill beside this one"), and fails with that sentence when it is missing.

## Vertical slices

- A folder never imports code from another. It runs another skill's tool as a program, found through an environment variable naming it, else beside it (`../<skill>/tools/…`), else in the machine's clone (`/home/sprite/skills/<skill>/…`); see `screencast-cut/tools/lib/zones.mjs`. Shared file formats (`brand/DESIGN.md`) are fine.
- A small helper two skills both need is copied into each, not shared.

## A skill

- `SKILL.md` in the [Agent Skills](https://agentskills.io/specification) format with the `metadata` keys the README lists (`title`, `summary`, `ask`, `placeholder`, `inputs`, each with a `-de` variant), and a `README.md` for humans: what it does, what it needs, how to run it. A row in the README's table of agents.
- Paths in a SKILL.md are `<skill>/…`; everything a skill writes goes to the caller's working directory, never into the skill's folder.
- Tools are made for agents: each step prints what it did and what to do next; an error is one sentence that says what to do. When something is missing (ffmpeg, a key), say so; never install it from a tool.
- Node 20+ and ffmpeg; no npm packages unless a skill cannot do without them.
- Models through OpenRouter only: `OPENROUTER_API_KEY`, else the Sprites gateway's connection (the README's "Models"). The gateway takes requests of up to about 7 MB: sound as MP3 at 48 kbit/s in pieces of five minutes.

## Decisions belong to the agent, mechanics to the tools

Tools do what can be measured (sync, cuts between words, levels, sizes, what the apps cover). What needs judgement (which part of a screen to show, where to zoom, what to keep, the hook) the agent decides from what the tool gives it to look at (frames, contact sheets, words); a tool's heuristic is a suggestion it can ask for, never a silent default.

## Videos

- In rragent: a HyperFrames preview first, the render only after the person's yes. Change the inputs and build again; never edit a built `index.html` by hand.
- A page plays only about 75 media elements (Chrome): one element per source for the whole cut (a voice track, a webcam track), not one per piece.
- Sprites have little memory: never decode a whole recording at once to cut many pieces from it; one ffmpeg per piece, joined afterwards.
- Names the speech model mishears (product and account names like "storrito_com") are corrected in the words, keeping their times.

## In the chat (rragent)

Short messages in the person's language, one question per hiccup block with buttons for the likely answers, the button that moves on `:class "primary"`. Several picks from one list are checkboxes with one button. Several questions that must all be answered before the agent can go on, none depending on another's answer, are one block: a group of radio buttons per question (own `:name`, every `:value` saying what it answers, at most four groups) and one button whose `:send` holds `{checked}`. One question after the other only when it depends on the answer before or on work the person should see first. Every SKILL.md says this in its "UI in the chat", since the agent reads only that file. A button only where a click makes the agent act at once: an answer it goes on with, a choice it carries out, a page it opens. None that only leads to another question ("Change something", "Another style" without naming one): the person types what to change, and a line under the buttons says so. A button that opens an artifact ends its text with " ↗". Never a token, a working path or a raw error in the chat.
