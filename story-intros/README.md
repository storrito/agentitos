# story-intros

A content plan (a Google Sheet, a file or a list of topics) → a series of animated text Stories for Instagram, 1080×1920 and 16.60 s each: one of four word intros lands in the first sentence, four scenes with headline, body text and an illustration drawn for the topic follow, and Instagram's link sticker sits in a band at the bottom, laid over the video by Storrito. All Stories of a plan are previewed side by side; rendering and publishing only when the person asks.

> Agents: start with [`SKILL.md`](SKILL.md).

The intros come from a series an rragent bot made with an editor (Lydia's "Motion Studio", 11 Stories), which it packed up as a skill of its own; this is that skill, cut down to what a model cannot know:

| intro | what happens | length |
| --- | --- | --- |
| `stamp-orbit` | the words stamp in, curve letter by letter into a ring that turns once, land in the sentence | 3.20 s |
| `stack-fan` | a deck of word cards fans out and collapses into the sentence | 2.40–2.60 s |
| `slide-lock` | the words arrive in pairs from both sides and lock to the edges | 2.30–2.40 s |
| `echo-collapse` | one keyword drops in with three outlined echoes, the others join a stack | 3.20 s |

[`references/intros.md`](references/intros.md) says which fits which words, their limits and timing.

## The tool

```bash
node story-intros/tools/story.mjs new <config.json> artifacts/<project>
```

Writes one Story into an existing HyperFrames project, once: `composition/<name>/index.html` (the intro, four scenes with an empty `.topic-illustration` each, the sticker scene mounted `data-preview-only`), its `assets/` (the intro's script, Anton and its licence, the music when given) and `compositions/story-stickers.html`, and `stickers/<name>/layer.html` in the working directory, the layer publish-video takes. It refuses a folder that exists. The config: [`examples/creative-practice.json`](examples/creative-practice.json); errors say which key is wrong.

- `assets/orbit.js` and `assets/variants.js` are the approved intros; `variants.js` sets the words' start values with `gsap.set` instead of on the timeline, since HyperFrames' renderer (snapshot, render) kept only one of two sets at 0 on a word and showed slide and echo collapsed into one line, while the player showed them right. Each defines `window.buildSeriesIntro(rest, config)`, measures the words after the fonts load, starts the scenes' `rest` timeline at 1.60 s and returns `{timeline}`.
- GSAP 3.14.2 from jsDelivr and Storrito's components from `c1.storrito.com` load over the network; Arial falls back to the machine's sans-serif.
- The link sticker is scaled to 0.75 (story-stickers' smallest that is still easy to tap; the original series used 0.48) in a band y 1470–1620.

Requirements: Node 20+, the HyperFrames CLI, agentitos' story-stickers and platform-zones for their rules, and publish-video beside this skill to publish.

## Limits

- The tool writes a start: every Story needs its illustrations drawn and its text placed by the agent.
- 16.60 s and four scenes hold about 40–55 words besides the intro; `new` prints the count and warns above 55. Longer copy is cut in the plan, never by stretching the Story: versions of 50–60 s with the full text lost the intros' motion and read as slides.
- The intro sentence is 2–8 words in a Latin script; Anton has no other.
- Changing the sentence later means editing it in three places of the markup, or a new name and `new` again.

Fonts: Anton by Vernon Adams, SIL Open Font License ([`assets/fonts/OFL.txt`](assets/fonts/OFL.txt)).
