# Testing a skill

Three places, cheapest first. [standards.md](standards.md) says what each has to show.

## 1. The tools alone

`<skill>/tools/test*.mjs`, with no model, no key and no network; GitHub runs them on every push (AGENTS.md, "A skill"). A fault that a tool is meant to find is tested on a file that has exactly that fault built in (the lab's `inject.mjs` builds such files).

## 2. The lab: a skill from the first message to the file

Storrito's sessions share `agentitos-lab`, a local repository without a remote, beside this repo's main checkout (`git worktree list` names that checkout first). Its media lie under `corpus/media/`, outside git. It holds two things:

- **The corpus**: raw material to try skills on, shared because finding, cutting and preparing material costs more than anything else in building a skill. Every file has an entry that says where it comes from, whether it may be shown outside, and what is true of it (what kind of recording, how many speakers, which language).
- **The rig**: runs a skill with Claude Code on Opus 5.5 as the agent and a small model as the person, and writes down what was said, every tool call, how long it took and what it cost. The agent may run only the programs the rig's `run.mjs` lists.

Read the lab's `README.md` and `corpus/README.md` before you look for material anywhere else. Then:

- Take from the corpus what fits (`node corpus/find.mjs` lists it by kind, length and language). Where your skill needs material that is not there (another kind of source, a longer file, a picture, music), you add it, as a new set, by the corpus README's "Adding material". Nobody fills the corpus in advance: what is needed is known to the agent whose skill needs it.
- For a test on this machine, material is taken wherever it serves the test, a video from YouTube too: its licence is no condition. What may be shown outside is marked in its entry, and only that leaves the machine.
- The corpus is not only video: sound, pictures, texts and lists of pages belong in it as much, and what was prepared from a file at some cost (its words, its cuts) lies beside it for the next session.
- Nothing from the corpus goes into this repository unless its entry says it may be shown, and never a recording of a person who did not agree. A picture in a skill's `references/` is drawn, or made from material that may be shown.
- A phone writes the place of a recording into its file (AGENTS.md, "Videos"): the corpus keeps such originals apart from the copies without tags, and only the copies go to a model.
- A new skill adds its cases to the lab, and names them in its pull request.
- A case runs on the Claude subscription all sessions share: run each case once, and again only after a change to what it touches.

Without the lab (a contributor from outside, a session in the cloud): say so in the pull request, test with material of your own that you may show, and leave the cases to a session that has it.

What a pass in the lab does not say: how the page looks, whether buttons work, whether Storrito takes the post (none of these exist there), and whether the result is good to look at.

## 3. A Sprite: the machine a bot has

A skill has to run where the bots run: 8 cores, 8 GB of memory. The lab's `sprites.md` says which test Sprites are in the pool and how large each is, how one is taken and given back, how files get onto one and back, and how a composition is rendered there with hfrender.

- Where a test Sprite is free, a skill's tools are tried on one before its pull request is ready, with their time and peak memory, and the whole run as a bot (standards.md, section 3) renders there.
- The larger test Sprites (16 cores, 32 GB) are there to be used in full while a skill is built: many variants rendered at once, a measurement over the whole corpus. What is measured for standards.md's sections 4 and 5 is measured on a Sprite of a bot's size.
- Renders and other heavy work run on a Sprite, not on the machine the sessions share. While you work, check from the built composition; render once for a pull request, at the end.
- A test Sprite's ffmpeg, fonts and HyperFrames are not always a bot's, which come with rragent's image: loudness, emoji and snapshots are checked against the bot's.
- A test Sprite is taken from the pool the way `sprites.md` says: a hold is marked on the Sprite itself, for every session to see. Give it back when you are done, with nothing of yours left on it. Never start anything on a Sprite that another holds or that is not in the pool.
- The pool can shrink at any time: keep nothing on a Sprite that you need again.
