# What a skill is measured by

agentitos turns raw material into videos for social media, short ones first and somewhat longer ones such as a short YouTube video, and brings them out on the platforms. [AGENTS.md](../AGENTS.md) holds the collection's rules. This page is the bar: what a new skill, or a change to one, has to show before it goes in, and how it shows it. A pull request answers the table at the end.

## 1. It takes the material as it comes

Material comes from anywhere: a webcam, a screen recording, a phone's back or selfie camera held upright or across, a studio recording, sound alone (a phone's voice memo, a podcast), a video call, pictures (a phone's photos, screenshots, free pictures from the web), pages and posts, slides, a video found on YouTube, and what a model made (a voice, music, a picture).

- A skill's README names which of these it takes and was tried on. For one it does not take, the tool says in one sentence what to bring instead; it never guesses.
- Tried means on files as a device or a service writes them, not only on files ffmpeg wrote: a phone's HEVC with a rotation and a frame rate that varies, Chrome's WebM whose sound has gaps in its time stamps, a 4K picture, a file without sound, a long one.

## 2. It builds on the others, and the others can build on it

One job is done in one place, so that an improvement there reaches every skill that uses it: the words of a recording are transcribe's, captions are captions', what the apps cover is platform-zones', a frame's layout is layout's, a brand's look is brand-kit's, a post's texts are video-descriptions', publishing is publish-video's (the table in AGENTS.md).

- A new skill calls what exists, as a program (AGENTS.md, "Vertical slices"), and reads and writes the files the others do (`words.json`, `brand/DESIGN.md`, `descriptions.json`).
- Where what exists falls short for the new skill, it is improved where it lives, in a pull request of its own, with the tests of every skill that calls it green. Never a second version inside the new skill.
- What the new skill does that another will need (it measures something, finds something, converts something) is a tool of its own with a command and a JSON it writes, and gets a row in AGENTS.md's table. A skill whose tools only its own flow can use is finished for itself alone.
- Every part earns its place. What is added (a style, an option, a mode) is held against what is there: a copy or a weaker variant is improved or taken out, not kept beside the new one.

## 3. It works with the bots' model

People use the skills through rragent, whose bots run on Claude Opus 5.5 unless the person chooses another model. The agent that writes a skill may be a stronger one: that it finds the SKILL.md clear is no measure.

- Every skill has at least one case in the lab ([testing.md](testing.md)) that Opus 5.5 passes with the SKILL.md as its definition and a model playing the person: from the first message to the finished file.
- A flow with a question has a case for the person who says no or wants a change, not only for the one who agrees.
- A run in the lab is Claude Code, not rragent. Before a skill counts as done for bots, a bot runs it once on a Sprite, where a test Sprite is free.
- What the agent did in a run is read, not only whether it passed. A step it repeated, a file it opened to find a value, a thing it built itself because a tool lacked it: each is a defect of the tool or of the text, and is fixed there.

## 4. It runs on a bot's machine

A bot's Sprite has 8 cores and 8 GB of memory and no GPU; the agent, Chrome and the renderer run on it at the same time as the skill's tools.

- Each tool's time and peak memory are measured on a machine of that size, on the longest material the skill takes. The skill says that limit and refuses longer material with a sentence.
- A step that can outlast the shell's time limit goes on where it stopped when it is called again.
- Larger machines are for building and measuring a skill, never what it needs to run.

## 5. The person is waiting

Someone sits in front of the chat until the video is there. What a wait costs them depends on its length, on whether they were told it, and on whether they are needed again in the middle of it.

Four waits are measured in every lab case from the chat's times (on a bot, agent-timeline gives them):

| wait | from | to | starting value |
| --- | --- | --- | --- |
| the first answer | the person's message with the material | the agent's first message | 30 s |
| the first thing to judge | the same | the first preview, proposal or sheet they are asked about | 5 min for material of up to 5 min, 1 min more for every further 10 min of material |
| a change | their wish | the changed preview | 2 min |
| the file | their yes | the finished video | 1.5 times the video's length, plus 1 min |

The starting values are a proposal, not a measurement on a bot's machine. They come from fourteen runs in the lab (2026-11-16 to 18, a laptop, Opus 5.5): 2 to 12 minutes for a whole case on clips of under a minute, 20 minutes for a launch film's storyboard, and one case of two 17 s Stories that passed once in 8 minutes with 49 tool calls and once in 60 minutes with 114 (why was not looked into). best-takes tells the person 1.5 times the cut's length for a render. As skills measure their waits on a bot's machine, the values here are replaced by what was measured and judged acceptable.

What holds whatever the numbers are:

- Before a step of over a minute the agent says about how long it takes. The tool prints that estimate from the material's length before it starts, and prints how far it is while it runs.
- Everything the person has to answer is asked before a long step, never after it: nobody is needed twice for one video.
- Nothing is computed twice. A change redoes only what it touches; the words, the analysis and the pieces already cut stay.
- A preview is as quick as it can be made. Full quality is the render's.
- A wait is mostly the agent's own steps, each a call of the model, not the tools' work. What the agent does for every clip, frame or file is one call of a tool that does them all, and what it would have to look up, the tool prints.
- A skill over a value says so in its README with the measurement and what the time buys. The agent then tells the person the time before it starts, with the quicker way where there is one.

A skill's README has "How long it takes": the four waits, the number of tool calls and the cents for models, measured with Opus 5.5 on a machine of a bot's size, for typical material and for the longest it takes.

## 6. Models

- No model where a tool can measure it (AGENTS.md, "Decisions belong to the agent, mechanics to the tools").
- Where a model is needed, one that OpenRouter offers (AGENTS.md, "A skill"). The README says what a run costs in cents.
- On the machine itself only a small model: one that runs on the CPU within the waits of section 5 and the memory of section 4, with weights of a few hundred MB at most, checked by their SHA-256, under a licence that allows commercial use. Following a subject from frame to frame is a job for one (auto-reframe's tracker); writing, judging and transcribing are not. A tool never fetches weights on its own: it says what is missing, as for ffmpeg.
- Another provider's account or key only when OpenRouter has nothing for the job and Storrito agreed.

## 7. Videos

A video is a HyperFrames composition: a preview first, the render after the person's yes, through rragent's `render` tool (AGENTS.md, "Videos"). A skill's steps name that tool, never a renderer's own command: which renderer a machine has is the machine's matter.

## 8. Out to the platforms, and to other services

- A finished video goes out through publish-video (Storrito: Reels, TikTok, Shorts, Facebook, LinkedIn, Pinterest, Snapchat, Threads, X, long-form YouTube) with video-descriptions' texts; a Story through story-from-link or story-stickers. A skill that makes something to post ends by offering that hand-over. Another platform or another kind of post is added there, not inside a skill that makes videos.
- Other services (a file from or to Google Drive or Dropbox, a sheet, a mail, a message) go through Composio, which a bot reaches from rragent's REPL: `(composio/search "<what to do>" ["<service>"])`, `(composio/schemas [...])`, `(composio/execute "<TOOL>" {...})`. Where the connection is missing, `(composio/connections ["<service>"])` answers a sign-in link for the person, good for ten minutes. A skill never asks for a key or a password in the chat and has no sign-in flow of its own.
- Nothing goes out without the person's yes to exactly what goes where and when.

## 9. Somebody else looked

- A pass says nothing about whether the result is good to look at or to listen to. The agent that built the skill looks at frames of the finished video from start to end and at the measured sound, and says in the pull request what it saw.
- Before the pull request is ready, an agent on another model than the author's reads the skill against this page and one run's results. What it found, and what was done about it, is in the pull request.

## 10. The skill's owner is asked where a person is the better instrument

Whoever asked for the skill (its owner) works on it too. A few minutes of theirs at the right moment save hours of building toward the wrong thing, or of measuring what a person sees at a glance. Their time is the scarcest thing in building a skill, so it is asked for where it decides most:

| when | what they are asked | why a person |
| --- | --- | --- |
| before anything is built | what a good result is: three to five published examples of what the skill should make, and what they like in each | the target is taste, and a skill built toward the wrong one is wrong throughout |
| at the first rough result | which of a few variants goes on (a look, a motion, a pace of cuts, a voice, a music bed, a hook, the wording of the chat) | taste again; a comparison takes them seconds and no measure agrees with them reliably |
| while the tests are made | the right answer for a handful of files where the answer is a judgement: the better take, the moment that stands alone, the crop that holds the subject | their answers become the tests' truth |
| when a measure is in doubt | whether what the tool flags is what they see or hear (a cut that jumps, lips out of step, a subject lost, a voice that sounds processed) | they notice in one viewing what would take a rig to measure |
| when the skill works | one run as a user would have it, in rragent's chat: are the questions the right ones and few enough, were the waits bearable, would they post the result | the only test of the flow as it feels; their verdict on the waits sets section 5's values |
| at any time | what is theirs to decide: what to build and what to leave out, money (a paid service, a dearer model), an account or a sign-in, material of theirs or their recordings, anything that is published or cannot be undone, a part of another skill removed, the merge | authority, not perception |

Not asked: what a tool can measure, what this page or AGENTS.md answers, how to implement something, a small flaw, and anything that is cheap to change later. The agent decides those and says what it chose.

How they are asked:

- One page with the variants side by side on the same material, each with a letter, the agent's own pick and its reason in a sentence. The answer is a letter or a sentence, and takes them two minutes.
- Comparisons, not grades, and without saying which variant is the new one.
- The agent goes on with its own pick meanwhile wherever that can be undone. It waits only where the answer decides what gets built, or where the step cannot be taken back.
- Every answer is kept so that it is never asked twice: the chosen example as a reference in the skill, the labelled files in the lab's corpus, the owner's words with their date in [lessons.md](lessons.md).
- Where several answers show a pattern a tool could measure, the tool is written and held against those answers. A measure for something a person perceives counts only once it has agreed with the owner on a handful of pairs.

## What the pull request says

| | shown by |
| --- | --- |
| 1 | the README's list of material taken and tried, with the files from the lab's corpus |
| 2 | which skills' tools it calls; which of its own tools others can call (their rows in AGENTS.md's table); what it changed in another skill, in which pull request |
| 3 | the lab's cases and their results (passed, turns, tool calls), a bot's run on a Sprite or the reason there was none |
| 4 | time and peak memory of each tool on the longest material, and on which machine |
| 5 | the README's "How long it takes"; for a wait over its value, why |
| 6 | every model, what for, the cents a run; for a local one its size, memory and licence |
| 8 | what goes out, through which skill, and where the person says yes |
| 9 | what the author saw in the result; what the reviewer found |
| 10 | what the owner was asked and what they answered; what was decided without them that they should know |

What went wrong on the way and would go wrong again for the next skill goes into [lessons.md](lessons.md).
