---
name: footage-kind
description: Says what the files a person brought are (a camera, a desktop's or a phone's screen, a finished video, sound, stills, text), which of them are one recording, and which situation that makes (talking head, podcast, screencast, footage, …), so that the right skill is chosen; the first step when someone brings material without naming what to make of it.
license: MIT
metadata:
  title: "What is this footage?"
  title-de: "Was ist das für Material?"
  summary: "Your files looked at: what each one is, which belong together, and what kind of video they make."
  summary-de: "Deine Dateien angesehen: was jede ist, welche zusammengehören und was für ein Video daraus wird."
  ask: "Bring the files you want a video made from: recordings, screen recordings, sound, pictures. I tell you what they are, which belong together and what can be made of them."
  ask-de: "Bring die Dateien mit, aus denen ein Video werden soll: Aufnahmen, Bildschirmaufnahmen, Ton, Bilder. Ich sage dir, was sie sind, welche zusammengehören und was sich daraus machen lässt."
  placeholder: "Your recordings"
  placeholder-de: "Deine Aufnahmen"
  inputs: "video, audio, image"
---

# footage-kind

`<skill>` is the folder of this file. Run `node <skill>/tools/kind.mjs …` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

Your folder: `kind/<name>/`, `<name>` one short slug of the job.

Needs Node 20+ and ffmpeg (with ffprobe). No model, no key. When ffmpeg is missing, say so in one sentence; never install it.

## From files to a situation

### 1. Measure

```bash
node <skill>/tools/kind.mjs look kind/<name> <file|folder>…
```

All the files of one job in one call: it finds the ones that are one recording by their sound. It prints, for every file, a kind (`camera`, `desktop-screen`, `phone-screen`, `finished`, `audio`, `still`, `text`; "probably" when it is not sure), what speaks for it, a `?` line for what only a look settles, and the sheet to look at; then, for every recording and for all files together, the situations they may be. The same is in `kind/<name>/footage.json`.

### 2. Look

Open every sheet it names (twelve frames spread over the video) and answer each `?` line from what you see. The kinds are suggestions from measurements; yours is the decision. It cannot see what a picture shows:

- A webcam before a calm or blurred background measures like a screen. When a file is "probably" a camera or a screen, the sheet tells at a glance.
- It has no eyes for faces: how many people are in a camera's picture, and whether they speak to it, you see on the sheet.
- It reads no text in the picture: burned-in captions, a logo or a watermark you see on the sheet.
- Speech and sung music both pause. When it matters (sound alone, or a video whose sound may be music), agentitos' transcribe says which, and how many speak.

### 3. Name it

Read `<skill>/references/situations.md` before naming a situation. Name one for every recording, and one for all files together when it fits (a speaker with material beside it, nothing but stills, nothing but text). A file whose kind you corrected changes its recording's situation: derive it again from the table, not from what `look` printed.

### 4. Say it and hand over

Tell the person what they brought, one sentence per recording in their words ("a recording of your screen with your webcam, three minutes, and four screenshots"), and what can be made of it with which skill (the table's last column). Where the table says "none yet", say that no skill makes that video yet and what the nearest one would make of it instead. Ask only when two readings remain after the look, and ask about the thing, never about an id ("Is the second file the same conversation from another camera?").

Then go on with that skill's SKILL.md. Pass it what you found, so that it does not ask again: which file is which, which belong together and each file's start (`starts`, in seconds on the recording's clock).

## UI in the chat

Short messages in the person's language. A ```hiccup block in your answer becomes part of the page. EDN hiccup, data only. `:send "text"` on a button sends that text as the person's next message.

- One question per block, buttons for the likely answers when a click is the whole answer, and a line that they can type anything else. The button that moves on gets `:class "primary"`.
- A button only where a click makes you act at once: "Cut the screencast" (you start), never "Tell me more".
- Never a situation's id, a path of `kind/`, a number from `footage.json` or a raw error in the chat: files by what they show.
