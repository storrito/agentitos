# What building the skills taught

The evidence behind the rules, and the lessons that are not rules yet. [AGENTS.md](../AGENTS.md) and [standards.md](standards.md) stay short because the reasons are here.

## Keeping this page

- An entry is something that went wrong, or that a person or a reviewer found, and that would go wrong again in another skill. What concerns one skill alone goes into that skill's README. Never general craft.
- An entry has what holds, the evidence (the date, the pull request or the run, what was measured or seen) and where it lives now: a rule, a tool, a test, or "open".
- The agent that builds or changes a skill adds its entries at the end, and after reading a bot's run of the skill. Two entries that say the same become one, with both pieces of evidence.
- An open entry that a second skill runs into becomes a rule in AGENTS.md or standards.md, or better a check in a tool or a test, in a pull request that says so. A rule nobody can find the reason for, or whose reason is gone, is taken out together with its entry.

## Tools

- **A long step goes on where it stopped.** 2026-11-02, a bot's screencast: `new` on three sources of six minutes ran into the shell's limit of 180 s and began again from nothing. Lives in: screencast-cut's `new` (#46), standards.md section 4.
- **Time is measured on the file as it plays, not as it decodes.** 2026-11-02, the same run: Chrome's Opus in WebM has gaps in its time stamps, a file of 380.1 s decoded to 376.3 s, the words and levels were on the decoded clock and the cuts landed inside words. Lives in: screencast-cut resamples with `aresample=async=1:first_pts=0` (#44). Open for any other tool that cuts a browser's recording by time.
- **What the agent builds itself is the tool's gap.** 2026-11-02, the same run: the bot joined two recordings, made tighter crops and invented word numbers for footage without speech, with packages it installed. Lives in: screencast-cut (#46), standards.md section 3.
- **The same case can take eight minutes or sixty.** 2026-11-16 and 18, the lab: story-intros' case of two Stories passed with 49 tool calls in 8.4 minutes and with 114 in 59.5. Why was not looked into. Lives in: standards.md section 5 (the waits are measured, and the tool calls with them). Open: the cause.

## The flow the person sees

- **A button that only leads to a question is a question asked twice.** 2026-10-28, a bot's run of publish-video: after a click on "Another style" it asked which style; it also ticked all 22 accounts and asked whether to fix two frames of overlapping subtitles in a finished video. Lives in: AGENTS.md, "In the chat".
- **A hook shows a result that works.** 2026-11-02: a screencast opened on what was missing in the product, and the person rejected it. Lives in: screencast-cut's hook rule (#46). Open for the other skills that write a hook.

## What to build

- **Looks and features are read off what is published, not off what tools advertise.** 2026-11-17, captions (#63): 198 published Shorts classed by the look of their captions; 147 carried a look the four styles could not make, and looks the caption tools advertise (neon glow, typewriter) hardly appeared. Eight styles were added from the count. Open.
- **Every part earns its place.** 2026-11-18, captions (#63): the twelve styles were compared on seven traits; none was a copy of another, three older ones were improved instead of kept as they were for their own sake. Lives in: standards.md section 2.

## Testing

- **The machine you built on is not the one it runs on.** 2026-11-17: a Sprite had no emoji font and a caption card's emoji rendered as an empty box; a laptop's ffmpeg 4.4 lacked an option a Sprite's ffmpeg 8 has, and the two give different loudness numbers. Lives in: testing.md section 3, the tests' pinned ffmpeg (#116).
- **Another model finds what the author's own checks pass.** 2026-11-18, captions (#63): a reviewer on another model found three defects before a commit and fifteen before the merge, among them a crash on a number as a word's text. Lives in: standards.md section 9.
- **A picture in a skill is not a person's recording.** 2026-11-17, captions: the picture of the styles first showed a crop of a test recording; it was made again on a drawn backdrop before it went into the repository. Lives in: testing.md section 2.
