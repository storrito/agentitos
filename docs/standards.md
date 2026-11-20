# What a skill is measured by

agentitos turns raw material into videos for social media, short ones first and somewhat longer ones such as a YouTube video of under a quarter of an hour, and brings them out on the platforms. [AGENTS.md](../AGENTS.md) holds the collection's rules. This page is the bar: what a new skill, or a change to what a skill does or asks, has to show before it goes in, and how it shows it. A pull request answers the table at the end.

## The bar: good enough for an ordinary clip, and quick

The skills serve clips for social media: a person waits for the result, and music usually lies under it. A skill is a quick 80 % solution, not a 100 % one (the owner, 2026-11-20). Every point below is read with that.

- Before building, the bar is written down as a short list of what must hold for an ordinary clip: never clearly worse than what came in, what can be measured right, an honest report, quick. When it holds, the skill is done.
- A rare case is named in the README's list of what the skill does not do, and left. It gets no rule of its own; where a tool meets something unusual, it does the safe minimum and says so.
- An added step never stops a build that ran without it: where its tool fails, its model does not answer or its program is missing, the build goes through as before, with one sentence.
- It is tried on ordinary material in the lengths in use (15 s, 60 s, 5 min, 15 min) and judged as it will be seen and heard, not on a collection of faults.

## 1. It takes the material as it comes

Material comes from anywhere: a webcam, a screen recording, a phone's back or selfie camera held upright or across, a studio recording, sound alone (a phone's voice memo, a podcast), a video call, pictures (a phone's photos, screenshots, free pictures from the web), pages and posts, slides, a video found on YouTube, and what a model made (a voice, music, a picture).

- Whether material may be used in a video is the person's decision, not the skill's. A skill says where material came from, so that they can decide and credit, and never refuses or filters material for its licence.
- A skill's README names which of these it takes and was tried on. For one it does not take, the tool says in one sentence what to bring instead; it never guesses.
- Tried means on files as a device or a service writes them, not only on files ffmpeg wrote. Of these, those the skill takes: a phone's HEVC with a rotation and a frame rate that varies, Chrome's WebM whose sound has gaps in its time stamps, a 4K picture, a file without sound, a long one.

## 2. It builds on the others, and the others can build on it

One job is done in one place, so that an improvement there reaches every skill that uses it: the words of a recording are transcribe's, captions are captions', what the apps cover is platform-zones', a frame's layout is layout's, a brand's look is brand-kit's, a post's texts are video-descriptions', publishing is publish-video's (the table in AGENTS.md).

- A skill does one job, as captions makes captions. Where a video is posted is not the question of a skill that makes one.
- A new skill calls what exists, as a program (AGENTS.md, "Vertical slices"), and reads and writes the files the others do (`words.json`, `brand/DESIGN.md`, `descriptions.json`).
- Where what exists falls short for the new skill, it is improved where it lives, in a pull request of its own. Never a second version inside the new skill.
- A change to a tool that others call is replayed on its callers before it goes in: their tests green, and what they produce on their cases compared with before, each difference named and argued, none silent.
- What the new skill does that another will need (it measures something, finds something, converts something) is a tool of its own with a command and a JSON it writes, and gets a row in AGENTS.md's table: the need and the command, the detail stays in the skill's SKILL.md. A tool that only its own flow can call needs a reason in the pull request.
- Every part earns its place. What is added (a style, an option, a mode) is held against what is there: a copy or a weaker variant is improved or taken out, not kept beside the new one (a removal in another skill is the owner's, section 10).

## 3. It works with the bots' model

People use the skills through rragent, whose bots run on Claude Opus 5.5 unless the person chooses another model. The agent that writes a skill may be a stronger one: that it finds the SKILL.md clear is no measure.

- Every skill with a flow in the chat has at least one case in the lab ([testing.md](testing.md)) that Opus 5.5 passes with the SKILL.md as its definition and a model playing the person: from the first message to the finished file.
- A flow with a question has a case for the person who says no or wants a change, not only for the one who agrees.
- A run in the lab is Claude Code, not rragent. Before a skill counts as done for bots, it runs once in a bot's chat in rragent with the branch's skill on the machine: the owner's run of section 10, which the agent asks for and reads afterwards with agent-timeline. Without one, the pull request says so.
- What the agent did in a run is read, not only whether it passed. A step it repeated, a file it opened that the SKILL.md did not send it to, a thing it built itself because a tool lacked it: each is a defect of the tool or of the text, and is fixed there.

## 4. It runs on a bot's machine

A bot's Sprite has 8 cores and 8 GB of memory and no GPU; the agent, Chrome and the renderer run on it at the same time as the skill's tools.

- Each tool's time and peak memory are measured on a Sprite of that size, on the longest material the skill takes. The skill says that limit and refuses longer material with a sentence.
- rragent's shell ends a command after a few minutes (180 s on 2026-11-02): a longer step runs in the background with a log the agent reads, and goes on where it stopped when it is called again.
- rragent ends a render after 30 minutes (`RRAGENT_RENDER_TIMEOUT_MIN`): a skill that makes longer videos says how it stays under that.
- Larger machines are for building and measuring a skill, never what it needs to run.

## 5. The person is waiting

Someone sits in front of the chat until the video is there. What a wait costs them depends on its length, on whether they were told it, and on whether they are needed again in the middle of it.

Four waits are read from the times of a run's messages and tool calls (the lab writes them down; on a bot agent-timeline gives them). The time the agent waited for the person's answers does not count.

| wait | from | to | starting value |
| --- | --- | --- | --- |
| the first answer | the person's message with the material | the agent's first message | 30 s |
| the first thing to judge | the same | the first result made from their material that they are asked to judge (a preview, a sheet of frames, a list of moments, a storyboard) | 5 min for material of up to 5 min or without a length, 1 min more for every further 10 min |
| a change | their wish | the changed result | 2 min |
| the file | their yes | the finished video | 1.5 times the video's length, plus 1 min |

The owner agreed to these four waits as the measure on 2026-11-20. The starting values are a proposal, not a measurement on a bot's machine. What they rest on: fourteen runs in the lab (2026-11-16 to 18, a laptop, Opus 5.5) took 2 to 12 minutes for a whole case on clips of under a minute and 20 minutes for a launch film's storyboard, and one case of two 17 s Stories passed once in 8 minutes with 49 tool calls and once in 60 minutes with 114. A call of the model takes 2 to 7 s at 70,000 tokens of conversation (rragent's README). best-takes tells the person 1.5 times the cut's length for a render. The 2 minutes for a change and the minute for every 10 minutes of material are guesses no run has tested. Only the owner changes these values, from their verdict on a run in rragent (section 10); a skill's own measurements go into its README and its pull request.

What holds whatever the numbers are:

- Before a step of over a minute the agent says about how long it takes. The tool prints that estimate from the material's length before it starts, and prints how far it is while it runs.
- Every question whose answer does not depend on a result is asked before the first long step. Nothing is asked while a long step runs, and after it the person is asked only to judge what it made.
- Nothing is computed twice. A change redoes only what it touches; the words, the analysis and the pieces already cut stay.
- A wait is mostly the agent's own steps, each a call of the model, not the tools' work. What the agent does for every clip, frame or file is one call of a tool that does them all, and what it would have to look up, the tool prints.
- A skill over a value says so in its README with the measurement and what the time buys. The agent then tells the person the time before it starts, with the quicker way where there is one.

A skill's README has "How long it takes":

- each tool's time and peak memory on a Sprite of a bot's size, for material of 15 s, 60 s, 5 min and 15 min as far as the skill takes them, the time also as a share of the material's length; where no such Sprite could be had, the machine it was measured on instead;
- the four waits, the tool calls and the cents for models of a lab case on typical material, with the machine named;
- the waits of the owner's run in rragent, once there was one.

Each is measured once, and again only after a change to what it measures.

## 6. Models

- No model where a tool can measure it (AGENTS.md, "Decisions belong to the agent, mechanics to the tools").
- Where a model is needed, one that OpenRouter offers (AGENTS.md, "A skill"). The README says what a run costs in cents.
- On the machine itself only a small model: one that runs on the CPU within the waits of section 5 and the memory of section 4, with weights of a few hundred MB at most, checked by their SHA-256, under a licence that allows commercial use (the weights' and their training data's). Finding a kind of thing in a frame is a job for one (auto-reframe's optional car detector, 23 MB, whose commercial use is not cleared); following it from frame to frame needs none (auto-reframe's CSRT, clips' `lib/track.mjs`). Writing and judging need a larger model than a Sprite runs, and transcribing is transcribe's (section 2).
- No tool downloads weights during a run. On a bot's machine a local model comes with rragent's image, by the owner's decision (the voice denoiser of pull request #111): the tool finds it there, works without it, and says which of the two ran. Elsewhere a command of the skill fetches the weights by URL and SHA-256 into a folder the caller names, and a tool without them prints that command (auto-reframe's `fetch_models.py`).
- Another provider's account or key only when OpenRouter has nothing for the job and the owner agreed.

## 7. Videos

A video is a HyperFrames composition: a preview first, the render after the person's yes (AGENTS.md, "Videos"). A skill's steps render with rragent's `render` tool, never with `hyperframes render`. While you build a skill, render as the lab's `sprites.md` says.

## 8. Out to the platforms, and to other services

- A finished video goes out through publish-video (Storrito: Reels, TikTok, Shorts, Facebook, LinkedIn, Pinterest, Snapchat, Threads, X, long-form YouTube) with video-descriptions' texts. A Story from a picture goes out through story-from-link or story-stickers, a video Story through publish-video's `--stickers`. A skill that makes something to post ends by offering that hand-over. Another platform or another kind of post is added there, not inside a skill that makes videos.
- A share link anyone can open is fetched as a file (publish-video's `check` does so for Google Drive and Dropbox). What needs the person's account (their Drive or Dropbox folder, a sheet, a mail, a message) goes through Composio, which a bot reaches from rragent's REPL: `(composio/search "<what to do>" ["<service>"])`, `(composio/schemas [...])`, `(composio/execute "<TOOL>" {...})`. Where the connection is missing, `(composio/connections ["<service>"])` answers a sign-in link for the person, good for ten minutes. A skill never asks for a key or a password in the chat and has no sign-in flow of its own.
- Nothing goes out without the person's yes to what goes where and when: for this post, or once for a channel they set to post by itself (shorts-channel's "Schedule by yourself"), which they take back with a sentence.

## 9. Somebody else looked

- A pass says nothing about whether the result is good to look at or to listen to. The agent that built the skill looks at frames of the finished video from start to end and at the measured sound, and says in the pull request what it saw.
- Before the pull request is ready, an agent that did not write the skill reads it against this page and one run's results: on another model than the author's where one is at hand, else on the author's at a higher effort. What it found, and what was done about it, is in the pull request.
- One full round, then one check of its fixes. What an ordinary clip does not run into goes onto the README's list of what the skill does not do, not into a third round; a third round is for a fix that broke something.

## 10. The skill's owner is asked where a person is the better instrument

Whoever asked for the skill (its owner) works on it too. Their time is the scarcest thing in building a skill, so it is asked for where it decides most:

| when | what they are asked | why a person |
| --- | --- | --- |
| before anything is built | which of six to twelve published examples the agent found are what the skill should make, and what they like in each; and the flow as a sketch: the person's questions in order, what they see before the build, what needs their yes | the target and the flow are taste, and a skill built toward the wrong ones is wrong throughout |
| when material can only be recorded | a few minutes of recording by a shot list the agent wrote (a phone held across, a selfie take, a voice memo, rragent's recorder) | no public source gives a device's own file of known content |
| at the first rough result | which of a few variants goes on (a look, a motion, a pace of cuts, a voice, a music bed, a hook, the wording of the chat) | taste again; a comparison takes them seconds and no measure agrees with them reliably |
| while the tests are made | the right answer for a handful of files where the answer is a judgement: the better take, the moment that stands alone, the crop that holds the subject | their answers become the tests' truth |
| when a measure is in doubt | whether what the tool flags is what they see or hear (a cut that jumps, lips out of step, a subject lost, a voice that sounds processed) | they notice in one viewing what would take a rig to measure |
| when the skill works | one run as a user would have it, in a bot's chat in rragent: are the questions the right ones and few enough, were the waits bearable, would they post the result | the only test of the flow as it feels; their verdict on the waits sets section 5's values |
| at any time | every decision that cannot be taken back (a one-way door): what is published or sent outside, what is deleted, a name, a command or a file format that others will build on, a part of another skill removed, a change to what another skill gives its users (its default look, its questions), material of theirs or their recordings leaving the machine. Theirs as well: what to build and what to leave out, money (a paid service, a dearer model, a new Sprite), an account or a sign-in | authority, not perception |

Not asked: what a tool can measure, what this page or AGENTS.md answers, how to implement something, a small flaw, and anything that can be taken back (a two-way door). The agent decides those and says what it chose. Where it is unclear whether a step can be taken back, it counts as one that cannot.

A merge means the change can be deployed, so a pull request is judged as if it already ran on every bot's machine, not by whether git can revert it. What it would leave behind that a revert does not take back makes it a one-way door, as a schema change in a database or a new event in an event system is one: a file or a field that bots write into people's folders and later versions have to read, a command or an output that other skills and bots call, a skill's name, what a bot stores, schedules or posts. Such a pull request is merged on the owner's word; a new skill brings a name and commands, so its first merge is theirs. A pull request that leaves nothing of the kind the agent merges itself once it is ready: this page's table answered, the review's findings fixed, the tests green on the merged state.

How they are asked:

- One private page with the variants side by side on the same material, each with a letter. The answer is a letter or a sentence, and takes them two minutes. Material from elsewhere may be shown on such a page; it says that it is internal.
- Numbers are shown per kind of material, never as one average over all of it.
- Comparisons, not grades, and without saying which variant is the new one. The agent's own pick and its reason stand folded below the variants, for after the owner chose.
- The agent goes on with its own pick meanwhile wherever that can be undone. It waits only where the answer decides what gets built, or where the step cannot be taken back.
- What the agent decided between variants without the owner is written down, a line each with its reason, for the owner to overturn when they look at the result.
- Every answer is kept so that it is never asked twice: the chosen example as a reference in the skill, the labelled files in the lab's corpus, the owner's words with their date in the skill's README, and in [lessons.md](lessons.md) only where they hold for other skills.
- Where several answers show a pattern a tool could measure, the tool is written and held against those answers. A measure for something a person perceives counts only once it has agreed with the owner on a handful of pairs.

## What the pull request says

| | shown by |
| --- | --- |
| 1 | the README's list of material taken and tried, with the files from the lab's corpus |
| 2 | which skills' tools it calls; which of its own tools others can call (their rows in AGENTS.md's table); what it changed in another skill, in which pull request |
| 3 | the lab's cases and their results (passed, turns, tool calls); the owner's run in rragent, or that there was none |
| 4 | time and peak memory of each tool on the longest material, and on which machine |
| 5 | the README's "How long it takes"; for a wait over its value, why |
| 6 | every model, what for, the cents a run; for a local one its size, memory and licence |
| 8 | what goes out, through which skill, and where the person says yes |
| 9 | what the author saw in the result; what the reviewer found |
| 10 | what the owner was asked and what they answered; what was decided without them that they should know |

What went wrong on the way and would go wrong again for the next skill goes into [lessons.md](lessons.md).
