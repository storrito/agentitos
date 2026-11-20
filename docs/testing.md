# Testing a skill

Three places, cheapest first. [standards.md](standards.md) says what each has to show.

## 1. The tools alone

`<skill>/tools/test*.mjs`, with no model, no key and no network; GitHub runs them on every push (AGENTS.md, "A skill"). They cover what a tool measures. A fault that a tool is meant to find is tested with a file that has exactly that fault built in, so that the right answer is known.

## 2. The lab: a skill from the first message to the file

Storrito's sessions share a private repository, `agentitos-lab`, beside this repo's main checkout (`git worktree list` names that checkout first; `AGENTITOS_LAB` when the lab lies elsewhere). It holds two things:

- **The corpus**: raw material to try skills on, shared because finding, cutting and preparing material costs more than anything else in building a skill. Every file has an entry that says where it comes from, under which licence, whether it may be shown outside, and what is true of it (what kind of recording, how many speakers, which language).
- **The rig**: runs a skill with Claude Code on Opus 5.5 as the agent and a small model as the person, and writes down what was said, every tool call, how long it took and what it cost.

Read the lab's `README.md` and `corpus/README.md` before you look for material anywhere else. Then:

- Take from the corpus what fits. Where your skill needs material that is not there (another kind of source, a longer file, a picture, music), you add it, as a new set by the corpus's rule for adding. A set that others use is never changed.
- The corpus is not only video: sound, pictures, texts and lists of pages belong in it as much, and what was prepared from a file at some cost (its words, its cuts) lies beside it for the next session.
- Nothing from the corpus goes into this repository unless its entry says it may be shown, and never a recording of a person who did not agree. A picture in a skill's `references/` is drawn, or made from material that may be shown.
- A phone writes the place of a recording into its file (AGENTS.md, "Videos"): the corpus keeps such originals apart from the copies without tags, and only the copies go to a model.
- A new skill adds its cases to the lab, and names them in its pull request.

Without the lab (a contributor from outside, a session in the cloud): say so in the pull request, test with material of your own that you may show, and leave the cases to a session that has it.

What a pass in the lab does not say: how the page looks, whether buttons work, whether Storrito takes the post (none of these exist there), and whether the result is good to look at.

## 3. A Sprite: the machine a bot has

A skill has to run where the bots run: 8 cores, 8 GB of memory. The lab's `sprites.md` says which test Sprites there are, how files get onto one, and how a composition is rendered there quickly.

- Where a test Sprite is free, a skill is tried on one before its pull request is ready: its tools with their time and peak memory, and a bot's run of the flow.
- The larger test Sprites (16 cores, 32 GB) are there to be used in full while a skill is built: many variants rendered at once, a measurement over the whole corpus. What is measured for standards.md's sections 4 and 5 is measured on a machine of a bot's size.
- A Sprite is taken only after the sessions that are running have agreed who holds which. Ask them before the first command on one, use only what you were given, say which you hold, and say when you are done. Never start anything on a Sprite another session holds.
