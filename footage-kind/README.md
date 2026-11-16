# footage-kind

What the files a person brought are, before any skill is chosen: for every file a kind (a camera, a desktop's screen, a phone's screen, a finished video, sound alone, a still, text), which files are one recording, and the situations that makes (a talking head, two people in one picture, a screen with a webcam, footage without speech, …). The tool measures and suggests, with what speaks for each suggestion and a contact sheet of every video; the agent looks at the sheets and decides.

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
node tools/kind.mjs look kind/demo recordings/            # every file's kind, the recordings, the situations, a sheet per video
node tools/test.mjs                                       # the mechanics, on recordings made here with ffmpeg
```

Requirements: Node 20+ and ffmpeg (with ffprobe). No npm packages, no model, no key.

## Why

Every skill of this collection inspects its own input and expects the person, or the agent, to have picked it. Nothing says "this is a screen recording with the webcam recorded into it, no skill cuts that yet" before the wrong one runs. The situations and the skill that makes each today are in [`references/situations.md`](references/situations.md).

## What `look` measures

For each video, on up to six windows of five seconds spread over it (never the whole file decoded), on grey frames of 320×180 taken by nearest neighbour:

| measure | what it is | what it tells |
| --- | --- | --- |
| `frozen` | the share of frame pairs that are the same picture | a screen repeats most of its frames, a camera's picture none |
| `still` | the share of the frame's area (16×9 cells) that stands in nine of ten pairs | how much of the picture is at rest |
| `regions` | the parts that move in three of ten pairs or more: where, how large, how often | a webcam recorded into a corner, a person before a calm background, a call's tiles |
| `band` | a strip along an edge that stands while the rest moves | a caption band or a card: a laid-out video |
| `cuts` | hard cuts a minute | several shots in one file |
| `bars` | black bars at the edges | a picture of another shape inside |
| `map` | the cells, each the tenths of the pairs it moves in | where the picture lives, to read beside the sheet |

From the container (ffprobe): the size as shown, a varying frame rate, the camera a file names, HDR, the program that wrote it (one of our renders says so), the number of sound tracks. From the sound: its level, the share of the time it is there, and its pauses a minute.

Files with sound are laid onto each other by their loudness (up to a minute either way): the same sound is one recording, and each file gets its start on that recording's clock (`starts`). A file without sound cannot be matched; the same length as another file is named as a hint.

## What `look` writes

`<out>/footage.json` and `<out>/sheet-NN-<name>.jpg` per video (twelve frames, 4×3, or 6×2 for an upright video).

```json
{"files": [{"name": "talk.mp4", "kind": "desktop-screen", "sure": false,
            "evidence": ["0 % of its frames repeat the one before; 89 % of the picture's area stands",
                         "one part moves: bottom left (10 % of the frame, 72 % of the time)",
                         "its sound pauses 16.7 times a minute, as speech does"],
            "open": ["The part that always moves (bottom left): a webcam or a speaker's picture recorded into a screen or into slides?"],
            "inset": "bottom left", "recording": 1, "sheet": "sheet-01-talk.jpg",
            "facts": {"width": 1920, "height": 1080, "duration": 180.08, "fps": 25, "sounds": 1},
            "picture": {"frozen": 0, "still": 0.89, "regions": [{"where": "bottom left", "area": 0.1, "moves": 0.72}], "cuts": 0,
                        "map": ["0000000000000000", "0000000000000000", "0000000000000000", "0000000000000000", "3710000000000000",
                                "7940000000000000", "9953000000000000", "8930000000000000", "7910000000000000"]},
            "sound": {"level": -19, "silent": false, "busy": 0.66, "pauses": 16.7}}],
 "recordings": [{"n": 1, "files": ["talk.mp4"], "open": ["talk.mp4"],
                 "situations": [{"id": "B3", "why": "a screen with a part that always moves at its edge: a webcam recorded into it"},
                                {"id": "B6", "why": "or slides with the speaker's picture in a corner"},
                                {"id": "B1", "why": "a desktop's screen alone"}]}],
 "whole": []}
```

## How far the measurements go

Measured on 17 files of agentitos-lab's corpus (2026-11-16; none of them a device's original, all exported or converted). The rules were set on these same files, so this says that they fit them, not that they hold on others:

| file | what it is | `frozen` | `still` | what moves |
| --- | --- | --- | --- | --- |
| a desktop's recording, 2560×1600 | screen | 0.90 | 1.00 | nothing |
| a talk's slides, the speaker in a corner | screen with an inset | 0.00 | 0.89 | bottom left, 10 % of the frame |
| a webcam before a blurred background | camera | 0.13 | 0.77 | the centre, 15 % |
| a video call, two to three tiles | split picture | 0.14 | 0.65 | two separate parts |
| a studio interview, 1280×720 | camera | 0.00 | 0.43 | the centre, 33 % |
| a news conference, cut between cameras | camera | 0.00 | 0.28 | the centre, 40 % |
| footage, 3840×2160, 15 cuts a minute | camera | 0.10 | 0.00 | everything |
| a finished Story, a picture card and text over a blurred background | laid-out video | 0.00 | 0.27 | a strip of 22 % at the bottom stands |

With each of the corpus' 14 jobs given to `look` on its own, the labelled situation was among the ones it named for all 12 labelled jobs, and first (or named for all files together) for 10.

On three files kept apart from those (the lab's `holdout-v1`, from other sources: a man speaking to a camera, a video call with a shared screen, a talk mixed live between the stage camera and its slides), with the rules as first committed: the kind matched the label for 1 of 3, the labelled situation was named for 2 of 3 and first for none. The call was called a phone's screen without doubt, because a picture wider than 2:1 counted as a phone held sideways. That rule is gone, and a kind taken from the picture alone is never called sure any more. This was not checked again on files kept apart. Read every kind as a first guess that the sheet confirms or corrects.

What it does not tell, and the agent sees on the sheet: a webcam before a calm background from a screen; who is in a camera's picture and how many; burned-in text; speech from sung music (transcribe does). On four originals of one phone (upright, one room, the person speaking to it; 2026-11-16) the first version called all four finished: it did not know Android's tags for the maker and the model, and the calm wall over the head counted as a strip that never moves. With those tags read, and what a file says of itself put before anything measured, all four are a camera and P1 is named first. Still unmeasured for lack of files: other phones, wide and 4K shots, a screen recorder's varying frame rate, a phone's screen recording, an uncut session of rragent's recorder.

## Rules it keeps

- It suggests, with evidence; it never decides and never picks a skill. A kind it is not sure of is printed as "probably", with the question that settles it.
- It reads the files where they are and writes only into the folder it is given.
- Of a file's tags it passes on the camera's name, the program that wrote it and the time of recording, nothing else. A phone writes the place it filmed at into its files: that place is never read out, only that there is one (`located`).
