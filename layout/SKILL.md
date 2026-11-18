---
name: layout
description: Says how a recording is placed in a frame (9:16, 4:5, 1:1, 16:9) and where captions and a hook can go, computed from where the faces or the part of a screen that matters are and from what the apps cover, as ranked, checked candidates with a picture of each to choose from; the step before a skill builds a video from a camera's or a screen's recording.
license: MIT
metadata:
  title: "Layout"
  title-de: "Layout"
  summary: "Where your recording sits in the frame and where the text goes, clear of the apps' buttons and of your face."
  summary-de: "Wo deine Aufnahme im Bild sitzt und wohin der Text kommt, frei von den Buttons der Apps und von deinem Gesicht."
  ask: "Upload a recording and tell me where the video goes (Reels, TikTok, Shorts, YouTube, …) and what text it gets (captions, a hook). I show you how it can be laid out."
  ask-de: "Lade eine Aufnahme hoch und sag mir, wo das Video hingeht (Reels, TikTok, Shorts, YouTube, …) und welchen Text es bekommt (Untertitel, ein Hook). Ich zeige dir, wie es sich anordnen lässt."
  placeholder: "Upload a recording"
  placeholder-de: "Aufnahme hochladen"
  inputs: "video, image"
---

# layout

`<skill>` is the folder of this file. Run `node <skill>/tools/place.mjs …` from your working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

Your folder: `placement/<name>/`, `<name>` one short slug of the job; one folder for each layout a video uses.

Needs Node 20+, agentitos' platform-zones skill beside this one, ffmpeg (for `grid`, and for a frame of the recording in `page`) and Chrome (for `page`). No model, no key, no cost. When something is missing, say so in one sentence; never install it.

It builds no video and decides nothing. It computes every way the picture and the text fit the frame, checks each and ranks them; you look at their pictures and choose.

## From a recording to a layout

### 1. Know the situation and what the video needs

The situation is footage-kind's name for the recording (a talking head upright or wide, two people in one picture, a desktop with a webcam, …), or your own look at one frame: is the subject a face, several faces, or a screen. A recording with neither (footage of a thing, a voice alone, text) has nothing to place here: its layouts are platform-zones' patterns.

Before step 3 you know: the frame; the platforms the person named (none named: name none, the frame's usual ones stand in); whether the video has captions and a hook. Ask only for what the skill that called you has not settled.

- **Captions are one line** (`--text caption`): in published Shorts three of four caption blocks are one line of about three words. Two lines (`caption:2`) only when the person asks for longer lines.
- **A hook has two kinds.** A short text on the chest that shows for the first second or two, where the captions stand afterwards: what published Shorts do, and what `--text hook` tries first. A card across the top that stays (a reply to a comment, a part of a series): `--text hook:card`.

What published Shorts do is what is usual, not what is shown to work: in that study nothing set the videos that did well apart from the others.

### 2. Mark the faces, or the screen's region

```bash
node <skill>/tools/place.mjs grid <video|image> placement/<name>/grid.jpg [--at <s>]
```

One frame with a line every 10 %, each labelled with its px in the source. No tool of this collection sees a face: open the picture and read the boxes off it. A box is `x,y,w,h`: its top left corner, then its width and height, in px of the source.

- **A face** runs from the hairline to the chin and from cheek to cheek. Not the hair, the ears or the neck: the solver keeps its own margins around the box (above it a third of its height and a little more, for the skull or the hair), and a generous box leaves the text no place.
- **A bald head**, a cap or a headband: the box starts where the hairline would be, as far above the brows as the bottom of the nose is below them. **A profile**: from the front of the ear to the tip of the nose. Hair worn high (a bun, curls) reaches past the margin: look at the picture whether a text above the head lies on it.
- **A face that moves** (a nod, a lean, a walk): the grid at three to five moments spread over the clip, among them the highest and the lowest the head gets, each box as `--face-at <s>:x,y,w,h`. In a calm take of eight seconds the top of the head moved 22 px and came within 8 px of the caption above it: a face read at one moment has no reserve.
- **Several people**: one `--face` each. They count from 1 in the order you give them. Every `--face-at` of one source is one and the same face: two people who both move go into a file, one list of moments per person (`[[{"t": 0, "box": [x, y, w, h]}, …], […]]`), as `--face-track <file.json>`.
- **A screen**: the part that matters at this moment as `--region`, and how tall a capital letter of its smallest text is, in px of the source, as `--min-text-height`. A webcam recorded as a file of its own: its face, read off a grid of that file, as a `--face` after a second `--source`.

### 3. Place

```bash
node <skill>/tools/place.mjs place placement/<name> --frame 9:16 --source 1080x1920 --face 300,570,600,900 --text caption [--text hook] [--platform reels,tiktok]
```

| the recording | options |
| --- | --- |
| several people in one picture | `--face … --face …`; `--speaker 2` when only that person is to be cropped on |
| two people as two files | `--source 1280x720 --face … --source 1920x1080 --face …` |
| a face that moves | `--face-at 0:300,570,600,900 --face-at 2.5:300,640,600,900 …`, or `--face-track file.json` |
| a screen, with or without a webcam | `--source 1920x1080 --region 700,300,480,300 --min-text-height 14 [--source 1280x720 --face …]` |

Every `--face`, `--face-at` and `--region` belongs to the `--source` before it. `--frame` is `9:16`, `4:5`, `1:1`, `16:9` or a size as `720x1280`: type and margins are in proportion to the frame.

It prints the candidates, the first the one it would take, and writes them to `placement/<name>/placement.json`. Each has a mark, its fit, where the face and each text land in the frame, its problems, and why it stands where it stands.

- `✓` passes. `!` passes with a soft problem (the picture enlarged over 1.5×, a face in the safe box's margin, text a feed's crop cuts). `–` leaves a need unmet: a text found no free place, or a screen's text is too small to read. `✗` fails: a face or text under what an app covers, text on a face, the picture enlarged over 2×.
- The fits: `full` (the picture covers the frame as it is), `zoom` (larger, moved), `inset` (the whole picture smaller over a ground; an upright take in 16:9: in the middle, the sides ground, the captions over its bottom), `crop` (a wide picture cut around the face: filling the frame, or as a `4:5`, `1:1` or free `band` with ground above and below; `closer`: from a source with pixels to spare, as 4K into 1080, cut tighter, the face brought towards a quarter of the frame's height without enlarging the source past 1.5×), `panel` (an upright picture at one side of a wide frame, the text beside it), `stacked` and `side-by-side` (two people, each in one half; stacked, the captions stand on the seam), `screen-zoom` (the region at the smallest size at which its text reads), `screen-fit` (as large as its room allows, where that is less), `screen-whole`, `screen-stacked` (the screen in the upper half, the webcam's picture as a panel under it, the face towards 18 % of the frame's height, the captions on the seam: what published Shorts do most where a screen and a face show together).
- Read the `note:` lines. They say what the candidates cannot: a face that moves far, a crop that no scale allows, a region that cannot be read at any size the frame leaves it. For a face that moves, the lines under them name the moment that decides the placement: without that moment the first candidate would be another.
- **Several people and no `--speaker`:** the candidates that show everyone stand first, the crops on one person behind them whatever they cost. Who speaks is yours to say, part by part; published podcast clips cut to whoever speaks more often than they show both.
- **A `note:` under a candidate** says that its caption area is narrower than a long word at that type: captions will set such a word smaller for its moment.
- **A face over a third of the frame tall with the chin below two thirds of its height** is a take filmed too close: only the wall above the head is free, and the text goes there. That is the answer for this take, not a good layout. Tell the person that more distance to the camera gives what published videos show: a face a quarter of the frame tall, the captions on the chest.
- No candidate with `✓` or `!`: the needs do not fit this picture. Ask for less (no hook, or `hook:card`), name the platform, or take a layout that gives the text its own area; never take a `✗`.

### 4. Look, and choose

```bash
node <skill>/tools/place.mjs page placement/<name> --still <video|image> [--at <s>] [--candidate 1,2,3]
```

The first three candidates (or the ones named), each as a page of one frame (`candidate-N.html`) and a picture of it (`candidate-N.png`) on that frame of the recording, and what platform-zones' layout check says of the page next to the solver's own verdict. Two files (two people, or a screen and its webcam): `--still` twice, in the order of the sources; the circle and the panel then show the webcam's own picture, cut as the candidate says. A webcam baked into the screen shows from the screen's still.

Open every picture. The order is a suggestion from measurements, the choice is yours:

- **Never a candidate the checker fails.** A line "They differ" means the page measured otherwise than the solver computed: find out why before you take it.
- **Text on the ground.** Where the picture stands smaller than the frame, the same picture is also listed with its hook and captions in the bands above and below it (`, text on the ground`), and a `ground` line says what lies behind such a text: the pages lay a blurred copy of the picture there, and a face of the picture shows in it as a large blur. Take the band where its line says no face, or hand the builder a calm ground of its own (a colour) with the candidate.
- **What no measurement here knows.** Whether the picture behind a text is calm: the solver sees boxes, no pixels, and a caption on a patterned shirt or a hook on a bright window passes every check. Whether you read the face's box right: the dashed box on the picture is the face as you gave it, and when it does not sit on the face from hairline to chin and cheek to cheek, read it again and place again. How wide the video's own words are: the pages show placeholder words (caption lines of three words, a hook of two short lines), and a block is taken as wide as its area.
- **Candidates less than a point apart** (`cost` in the reasons) are not told apart by anything measured: the weights come from one judged case and guesses. Choose between them by the pictures.
- **Where two fit, read `<skill>/references/situations.md` before choosing.** It says which layout is for which situation and which part of a video, what 240 published Shorts do (usual, never proven to work), what our own footage showed (the two 16:9 layouts of an upright take pass every check and look weak as videos), and which numbers nobody tested.
- A layout is for one part of a video. A hook that stays three seconds needs its room for three seconds: place the part with the hook and the part after it separately, and take the same picture placement for both where one candidate serves both.

### 5. Hand over

To the skill that builds the video, from the chosen candidate in `placement.json` (`candidates[N-1]`), all in px of the frame:

- `scale`, `left`, `top`: the source is drawn `scale` times its size with its top left corner at `left`, `top`. `window`: the part of the frame the sharp picture fills; outside it lies ground (the pages use a blurred, darker copy of the picture that covers the frame).
- `parts` (stacked, side by side): the same for each half, with the `source` it shows, clipped to its `window`.
- `circle`: the webcam's circle (`box`, in px of the frame), and `crop`, the square of the webcam's picture it shows, in px of the webcam's picture.
- `text`: the `box` of the hook with its `font` in px (`style` `text`: two lines of big type with no card; `card`: a card of two lines; `big`: two big lines beside the picture in 16:9), and of the captions.

To captions:

```bash
node <skill>/tools/place.mjs captions placement/<name> --candidate N
```

It prints the options for captions' `build` and `project` that set the captions into the candidate's caption area (`--y`, `--max-width`, `--font-size`, `--lines`, and `--x`, `--align` for a column at one side). The area is as tall as the tallest block of captions' styles at that type; a style that pads more needs `--set caption.padEm=…` in `place`, and a card of captions' own (`box`) `--set caption.padEm=0.8`. captions answers "Placed where asked: …" when it took them. When it answers nothing of the kind, its version does not know them and the captions stand on the safe box's bottom whatever is there: say so, never move the picture to make room.

## UI in the chat

Short messages in the person's language. A ```hiccup block in your answer becomes part of the page. EDN hiccup, data only. `:send "text"` on a button sends that text as the person's next message; pictures point at `uploads/…`: copy a candidate's picture there first.

- One question per block, buttons for the likely answers when a click is the whole answer, and a line that they can type anything else. The button that moves on gets `:class "primary"`.
- A button only where a click makes you act at once: "Larger picture" (you take that layout and go on), never "Show me more".
- Never a candidate's number, a box, a scale, a path of `placement/` or a raw error in the chat: layouts by what they look like.

The person sees pictures, never numbers. Say in one sentence what you chose and why, in their words ("zoomed in a little, the subtitles above your head: at the bottom they would lie on your chin"), with the picture. Ask only when two candidates that pass look clearly different (a larger face with a smaller hook, or a smaller face with the hook at its size): show both pictures and let them choose.

```hiccup
[:div
 [:p "Two ways to fit your recording with the hook and the subtitles:"]
 [:img {:src "uploads/placement-intro-1.png" :style {:width "180px" :aspect-ratio "9 / 16" :border-radius "8px"}}] " "
 [:img {:src "uploads/placement-intro-2.png" :style {:width "180px" :aspect-ratio "9 / 16" :border-radius "8px"}}]
 [:button {:class "primary" :send "Take the first layout: the larger picture, the hook a little smaller"} "Larger picture"] " "
 [:button {:send "Take the second layout: the smaller picture, the hook at its full size"} "Larger hook"]
 [:p [:small "Or type what should be different."]]]
```
