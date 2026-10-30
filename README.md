# agentitos

Little agents for big stories. 🌮

**agentitos** is a collection of specialized LLM agents built around [Storrito](https://storrito.com/), the tool for planning and publishing Instagram Stories. Each agent lives in its own folder and bundles the skills, scripts and supporting files an LLM agent needs to handle one job end to end: media generation, video editing and other story workflows.

## Structure

```
agentitos/
├── <agent-name>/
│   ├── SKILL.md       # entry point for the agent: when to use it, step by step
│   ├── README.md      # full reference for humans
│   └── ...            # scripts, assets, examples – whatever the recipe needs
└── ...
```

Every agent folder is a **vertical slice**: an independent recipe with its own dependencies, scripts, examples and docs. Folders never import from each other, so you can copy a single one into your agent setup (e.g. Claude Code, or any skill-capable agent runtime), follow its `SKILL.md` / README and you're good to go.

## For harnesses

Each `SKILL.md` follows the [Agent Skills](https://agentskills.io/specification) format, so any skill-capable agent can load it. A harness that lets people pick a task up front (like [pchat](https://github.com/simplemono/pchat)) reads these optional `metadata` keys for its onboarding, each with an optional `-de` variant for German:

| Key | Use |
| --- | --- |
| `title` | the task's name in a picker |
| `summary` | one sentence under the title |
| `ask` | the first message: what the person should bring |
| `placeholder` | the composer's placeholder |
| `inputs` | what to attach, comma-separated: `video`, `audio`, `image` (empty: nothing) |

Paths in a `SKILL.md` are written as `<skill>/…`, relative to the skill's folder; outputs always go to the caller's working directory, never into the skill.

## Models: OpenRouter, with a key or through the Sprites gateway

Agents that call a model (a transcription, a vision model, a proposal) go through [OpenRouter](https://openrouter.ai): with `OPENROUTER_API_KEY` in the environment, or else, on a [Sprite](https://sprites.dev), through the gateway's OpenRouter connection, which adds the key itself (an [rragent](https://github.com/storrito/rragent) agent there often has none of its own). Each such agent finds it with its own small `openrouter.mjs`: the key first, else the `openrouter` connection that `http://sprite.internal/v1/gateway/list` names, else none. The gateway takes a request of up to about 7 MB, OpenRouter about 50 MB: sound goes through it as MP3 at 48 kbit/s in pieces of five minutes, and a request with a video says so when it is too large.

## The brand kit

A brand's look and voice live in `brand/` of the working directory: a `DESIGN.md` in Google's open [DESIGN.md format](https://github.com/google-labs-code/design.md) (colours, typography and corner radii as tokens in its front matter, the brand's character, voice and audience as prose) with the logo and font files beside it, plus four keys of our own (`logo`, `fonts`, `uppercase`, `social`; see [brand-kit](brand-kit/README.md#the-kit)). [brand-kit](brand-kit/) makes a full one with the person; an agent that needs a look and finds none drafts one from the brand's website with brand-kit's tools (`site.mjs`, `kit.mjs draft`), as [story-from-link](story-from-link/) does; [thumbnail-and-intro](thumbnail-and-intro/) renders from the kit's tokens, logo and fonts. It is a file format, not a dependency: folders still never import from each other.

## The platforms' zones

What Instagram, TikTok, YouTube and the other apps lay over a video (their buttons, names and captions) lives in one table: [platform-zones](platform-zones/). An agent that places anything in a frame for social media (text, captions, a face, a sticker, a shot of a screen) asks its tool for the safe box and the covered areas (`node <platform-zones>/tools/zones.mjs zones [platform…] --size WxH --json`), with the platforms the person named, or none to have the usual ones of the frame. It keeps no numbers of its own: a correction to the table reaches every agent. Like the brand kit, this is a tool to call, not a dependency: folders still never import from each other.

## Agents

| Agent | Description |
|-------|-------------|
| [agent-timeline](agent-timeline/) | What an rragent bot did in a span of time or during a screencast recording, from its own record: the person's messages, its tool calls with how long they took and what they answered, its answers, the spans it worked; for telling the person, and for a screencast cut's waits and results. |
| [auto-reframe](auto-reframe/) | A wide video → a 9:16 or square crop that follows one chosen subject, on the CPU alone: a box picked on the first frame, CSRT tracking, optional car re-detection, cut-aware smoothing and a diagnostic video to check the tracking before delivery. |
| [best-takes](best-takes/) | Raw talking-to-camera recordings → the best take of every part, without slips, repeats, "äh"s or talk about the recording, every take equally loud; shown as a HyperFrames preview and agreed in the chat, then rendered with subtitles. |
| [clips](clips/) | A long video (a YouTube link or an upload: podcast, interview, webinar, talk) → vertical shorts in the video's own look: the moments that stand alone, scored by a rubric (cold open, one idea, clean end, no outside reference, 20–59 s), cut and framed 9:16 on whoever speaks, pauses and "äh"s out, captions and a hook card; previews side by side in the chat, then rendered and scheduled through Storrito. |
| [captions](captions/) | Word-timed captions burned into a video in one of several styles (Hormozi, karaoke pill, wipe, clean subtitles), key words marked by a model, placed for any frame from 16:9 to 9:16 and in the brand's colour and font; a HyperFrames sub-composition that other agents (best-takes, …) mount, plus an .srt. |
| [brand-kit](brand-kit/) | A company's website → its brand kit, agreed in the chat: logo, colours, fonts, voice, audience and social profiles as a [DESIGN.md](https://github.com/google-labs-code/design.md) with its files, and a brand board. |
| [launch-video](launch-video/) | A product's website, a feature or a script → a launch or promo video for Reels, TikTok, Shorts, the feeds or YouTube, made with HyperFrames by its own current guides: three storylines to pick from, real screens, the brand kit's look, every word clear of the apps' buttons, voice, music and pictures through OpenRouter instead of a HeyGen account; a preview agreed in the chat, then rendered. |
| [kinetic-lyrics](kinetic-lyrics/) | Spoken audio, podcasts or talking-head clips → kinetic-typography video (lyric-video style) over an illustrated world of light that renders on the CPU, for 16:9, 9:16 and more. Includes highlight finding, speaker detection, ASR repair and automatic QA. |
| [platform-zones](platform-zones/) | Where Instagram, TikTok, YouTube, Facebook, Snapchat, Pinterest, LinkedIn and X lay their buttons and captions over a video, per frame (9:16, 4:5, 1:1, 16:9): the safe box for text and faces, what each app covers, where a feed shows it cropped; the usual platforms of a frame together when none is named. One researched table that the other agents ask. |
| [publish-video](publish-video/) | A finished video → checked whether it is ready (frame, size, codec, length, sound level, empty ends, text under the apps' buttons on a sheet of its frames), short-form 9:16 or long-form YouTube decided with the person, the accounts connected to Storrito picked, each platform's texts written with video-descriptions in an agreed style, then scheduled or posted now through Storrito. |
| [screencast-cut](screencast-cut/) | A screencast recorded from several sources at once (screen, webcam, phone, microphone; rragent's recorder) → one video: the sources on one clock, the shot where the action is and zoomed in on it, waits as timelapses, results held to be seen; a HyperFrames preview changed by the moment named, then rendered with captions. |
| [story-from-link](story-from-link/) | A link (blog post, product, event) → an Instagram Story of a few frames in the brand's look, with a link sticker and Storrito's interactive stickers, checked and scheduled through Storrito. |
| [story-stickers](story-stickers/) | Instagram's own stickers (link, poll, question, quiz, countdown, slider, mention, hashtag, location) on a video Story, without tools: written as Storrito's sticker elements placed by their centre, checked by Storrito (warnings and a picture of the Story), seen over the film in the HyperFrames preview, the video rendered without them; published through publish-video, where Storrito lays the real, tappable stickers over the video. |
| [thumbnail-and-intro](thumbnail-and-intro/) | The video being made → a thumbnail and a matching silent 3–5 s intro with the same hook and imagery, in the brand kit's colours, fonts and logo: a deliberately chosen frame or screenshot, one oversized headline, one arrow, rendered with HyperFrames for 16:9 or 9:16. |
| [video-descriptions](video-descriptions/) | A video → the texts for every platform it goes to (Instagram, TikTok, YouTube and Shorts, Facebook, LinkedIn, X, Threads, Bluesky, Pinterest, Snapchat): captions, titles, descriptions, tags, hashtags and mentions within each platform's limits as it counts them (X's weighted 280, YouTube's bytes), in one style chosen for the video, on one overview page to check them. |

## Contributing

Issues and pull requests are welcome. A new agent gets its own top-level folder with a `SKILL.md` and a `README.md` that describe what it does, what it needs (API keys, CLI tools, …) and how to run it. What another agent of this collection already does, it calls instead of doing again: captions through [captions](captions/), the brand's look from the [brand kit](#the-brand-kit), the space the apps cover through [platform-zones](#the-platforms-zones).

## License

[MIT](LICENSE) © Storrito
