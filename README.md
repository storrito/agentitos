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

## The brand kit

A brand's look and voice live in `brand/` of the working directory: a `DESIGN.md` in Google's open [DESIGN.md format](https://github.com/google-labs-code/design.md) (colours, typography and corner radii as tokens in its front matter, the brand's character, voice and audience as prose) with the logo and font files beside it, plus four keys of our own (`logo`, `fonts`, `uppercase`, `social`; see [brand-kit](brand-kit/README.md#the-kit)). [brand-kit](brand-kit/) makes a full one with the person; an agent that needs a look and finds none drafts one from the brand's website, as [story-from-link](story-from-link/) does; [thumbnail-and-intro](thumbnail-and-intro/) renders from the kit's tokens, logo and fonts. It is a file format, not a dependency: folders still never import from each other.

## Agents

| Agent | Description |
|-------|-------------|
| [auto-reframe](auto-reframe/) | A wide video → a 9:16 or square crop that follows one chosen subject, on the CPU alone: a box picked on the first frame, CSRT tracking, optional car re-detection, cut-aware smoothing and a diagnostic video to check the tracking before delivery. |
| [best-takes](best-takes/) | Raw talking-to-camera recordings → the best take of every part, without slips, repeats, "äh"s or talk about the recording, every take equally loud; shown as a HyperFrames preview and agreed in the chat, then rendered with subtitles. |
| [captions](captions/) | Word-timed captions burned into a video in one of several styles (Hormozi, karaoke pill, wipe, clean subtitles), key words marked by a model, placed for any frame from 16:9 to 9:16 and in the brand's colour and font; a HyperFrames sub-composition that other agents (best-takes, …) mount, plus an .srt. |
| [brand-kit](brand-kit/) | A company's website → its brand kit, agreed in the chat: logo, colours, fonts, voice, audience and social profiles as a [DESIGN.md](https://github.com/google-labs-code/design.md) with its files, and a brand board. |
| [kinetic-lyrics](kinetic-lyrics/) | Spoken audio, podcasts or talking-head clips → kinetic-typography video (lyric-video style) over an illustrated world of light that renders on the CPU, for 16:9, 9:16 and more. Includes highlight finding, speaker detection, ASR repair and automatic QA. |
| [story-from-link](story-from-link/) | A link (blog post, product, event) → an Instagram Story of a few frames in the brand's look, with a link sticker and Storrito's interactive stickers, checked and scheduled through Storrito. |
| [thumbnail-and-intro](thumbnail-and-intro/) | The video being made → a thumbnail and a matching silent 3–5 s intro with the same hook and imagery, in the brand kit's colours, fonts and logo: a deliberately chosen frame or screenshot, one oversized headline, one arrow, rendered with HyperFrames for 16:9 or 9:16. |

## Contributing

Issues and pull requests are welcome. A new agent gets its own top-level folder with a `SKILL.md` and a `README.md` that describe what it does, what it needs (API keys, CLI tools, …) and how to run it.

## License

[MIT](LICENSE) © Storrito
