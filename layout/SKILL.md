---
name: layout
description: Says how a recording is placed in a frame (9:16, 4:5, 1:1, 16:9) and where captions and a hook can go, computed from where the faces or the part of a screen that matters are and from what the apps cover, as ranked, checked candidates with a picture of each to choose from; the step before a skill builds a video from a camera's or a screen's recording, and the place of material (a card, a quote, a screenshot) beside a speaker who stays in the picture.
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
- **A screen**: the part that matters at this moment as `--region`, and how tall a capital letter of its smallest text is, in px of the source, as `--min-text-height`. A webcam recorded as a file of its own: its face, read off a grid of that file, as a `--face` after a second `--source`. A webcam baked into the screen recording (a corner with the speaker, a talk's stage camera): its face, read off the screen's grid, as a `--face` after the screen's own `--source`, never the same file as a second source: the circle and the panel are then cut from the screen's picture, and a candidate whose screen shows the speaker too says that he shows twice.

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
| a screen with the webcam baked in | `--source 1920x1080 --region 500,40,1340,310 --min-text-height 20 --face 130,555,70,85` |
| captions your skill built already | `--caption-area <captions>/area.json`: they stand there or have no place (`–`), the picture is placed around them |
| a picture of one speaker, chosen by your tool | `--pick speaker [--cover scale,left,top]`: the candidates in the order an editor takes them (the picture you draw today first where it is at most 2× with eyes, nose and mouth inside the frame at every moment, whatever the face's size and though a nod cuts the hair, and the captions off the eyes and nose and on the mouth for at most two thirds of the clip; then the pictures across the frame's width at 1× or more with the face nearest the usual size, then narrower or shrunk ones; captions on the chin pass), each with `pick.why`; a note where the captions lie on the mouth for part of the clip (the seconds, the narrower picture by name) or only a narrower picture passes (where the head moves across most of the picture, a clip cut where it moves gets larger pictures) |

Every `--face`, `--face-at` and `--region` belongs to the `--source` before it. `--frame` is `9:16`, `4:5`, `1:1`, `16:9` or a size as `720x1280`: type and margins are in proportion to the frame.

It prints the candidates, the first the one it would take, and writes them to `placement/<name>/placement.json`. Each has a mark, its fit, where the face and each text land in the frame, its problems, and why it stands where it stands.

- `✓` passes. `!` passes with a soft problem (the picture enlarged over 1.5×, a face in the safe box's margin, text a feed's crop cuts). `–` leaves a need unmet: a text found no free place, or a screen's text is too small to read. `✗` fails: a face or text under what an app covers, text on a face, the picture enlarged over 2×.
- The fits: `full` (the picture covers the frame as it is), `zoom` (larger, moved), `inset` (the whole picture smaller over a ground; an upright take in 16:9: in the middle, the sides ground, the captions over its bottom), `crop` (a wide picture cut around the face: filling the frame, or as a `4:5`, `1:1` or free `band` with ground above and below; `closer`: from a source with pixels to spare, as 4K into 1080, cut tighter, the face brought towards a quarter of the frame's height without enlarging the source past 1.5×), `panel` (an upright picture at one side of a wide frame, the text beside it), `stacked` and `side-by-side` (two people, each in one half; stacked, the captions stand on the seam), `screen-zoom` (the region at the smallest size at which its text reads), `screen-fit` (as large as its room allows, where that is less), `screen-whole`, `screen-stacked` (the screen in the upper half, the webcam's picture as a panel under it, the face towards 18 % of the frame's height, the captions on the seam: what published Shorts do most where a screen and a face show together).
- Read the `note:` lines. They say what the candidates cannot: a face that moves far, a crop that no scale allows, a region that cannot be read at any size the frame leaves it. For a face that moves, the lines under them name the moment that decides the placement and what changes without it (another candidate first, or the same one at another scale or place).
- **Several people and no `--speaker`:** the candidates that show everyone stand first, the crops on one person behind them whatever they cost. Who speaks is yours to say, part by part; published podcast clips cut to whoever speaks more often than they show both. Two who stand or walk close together (a note says so) are shown in one picture: stacked stands behind, it would split one shot in two.
- **A `note:` under a candidate** says that its caption area is narrower than a long word at that type: captions will set such a word smaller for its moment.
- **A face over a third of the frame tall with the chin below two thirds of its height** is a take filmed too close: only the wall above the head is free, and the text goes there. That is the answer for this take, not a good layout. Tell the person that more distance to the camera gives what published videos show: a face a quarter of the frame tall, the captions on the chest.
- No candidate with `✓` or `!`: the needs do not fit this picture. A screen whose text does not read (`–` screen text) needs a narrower region: the note says how wide one reads, give the part that matters at this moment and place again (less text does not help). Otherwise ask for less (no hook, or `hook:card`), name the platform, or take a layout that gives the text its own area; never take a `✗`.

### 4. Look, and choose

```bash
node <skill>/tools/place.mjs page placement/<name> --still <video|image> [--at <s>] [--candidate 1,2,3]
```

A face that moves: look at every candidate at each moment you read its boxes at. `--still <video>` alone takes all those moments (or the `--at` you give, several allowed); pictures you took yourself go one `--at` each, in their order (`--still a.jpg --at 2.5 --still b.jpg --at 4.5`). Each moment's files carry it in their names (`candidate-1-at-2.5.png`).

The first three candidates (or the ones named), each as a page of one frame (`candidate-N.html`) and a picture of it (`candidate-N.png`) on that frame of the recording, and what platform-zones' layout check says of the page next to the solver's own verdict. Two files (two people, or a screen and its webcam): `--still` twice, in the order of the sources; the circle and the panel then show the webcam's own picture, cut as the candidate says. A webcam baked into the screen shows from the screen's still.

Open every picture. The order is a suggestion from measurements, the choice is yours:

- **Never a candidate the checker fails.** A line "They differ" means the page measured otherwise than the solver computed: find out why before you take it.
- **Text on the ground.** Where the picture stands smaller than the frame, the same picture is also listed with its hook and captions in the bands above and below it (`, text on the ground`), and a `ground` line says what lies behind such a text: the pages lay a blurred copy of the picture there, and a face of the picture shows in it as a large blur. Take the band where its line says no face, or hand the builder a calm ground of its own (a colour) with the candidate.
- **What no measurement here knows.** Whether the picture behind a text is calm: the solver sees boxes, no pixels, and a caption on a patterned shirt or a hook on a bright window passes every check. Whether you read the face's box right: the dashed box on the picture is the face as you gave it (a face that moves: its box at that picture's moment; the thin dotted box around it is the hull of all its moments, which the placement holds and which is meant to be larger), and when the dashed box does not sit on the face from hairline to chin and cheek to cheek, read it again and place again. How wide the video's own words are: the pages show placeholder words (caption lines of three words, a hook of two short lines), and a block is taken as wide as its area.
- **Candidates less than a point apart** (`cost` in the reasons) are not told apart by anything measured: the weights come from one judged case and guesses. Choose between them by the pictures.
- **Where two fit, read `<skill>/references/situations.md` before choosing.** It says which layout is for which situation and which part of a video, what 240 published Shorts do (usual, never proven to work), what our own footage showed (the two 16:9 layouts of an upright take pass every check and look weak as videos), and which numbers nobody tested.
- A layout is for one part of a video. A hook that stays three seconds needs its room for three seconds: place the part with the hook and the part after it separately, and take the same picture placement for both where one candidate serves both.

### 5. Hand over

To the skill that builds the video, from the chosen candidate in `placement.json` (`candidates[N-1]`), all in px of the frame:

- `scale`, `left`, `top`: the source is drawn `scale` times its size with its top left corner at `left`, `top`. `window`: the part of the frame the sharp picture fills; outside it lies ground (the pages use a blurred, darker copy of the picture that covers the frame).
- `parts` (stacked, side by side, screen-stacked): the same for each part, with the `source` it shows (a screen's webcam is source 2, also where it is baked into the screen), clipped to its `window`.
- `circle`: the webcam's circle (`box`, in px of the frame), and `crop`, the square it shows, in px of the picture `of` names: `webcam` (the webcam's file) or `screen` (the screen recording, where the webcam is baked into it).
- `text`: the `box` of the hook with its `font` in px (`style` `text`: two lines of big type with no card; `card`: a card of two lines; `big`: two big lines beside the picture in 16:9), and of the captions.

To captions:

```bash
node <skill>/tools/place.mjs captions placement/<name> --candidate N
```

It prints the options for captions' `build` and `project` that set the captions into the candidate's caption area (`--y`: the area's bottom, where the lowest line ends; `--max-width`, `--font-size`, `--lines`, and `--x`, `--align` for a column at one side). The area is as tall as the tallest block of captions' styles at that type; a style that pads more needs `--set caption.padEm=…` in `place`, and a card of captions' own (`box`) `--set caption.padEm=0.8`. captions answers "Placed where asked: …" when it took them. When it answers nothing of the kind, its version does not know them and the captions stand on the safe box's bottom whatever is there: say so, never move the picture to make room.

## A clip whose picture is placed already

A skill that framed a clip itself (clips' `frame.mjs`) knows every face of every shot over time and asks where the text goes over all of them at once, with no picture of its own to place (best-takes on its own places each video with `place` first, then asks `text` over the whole cut):

```bash
node <skill>/tools/place.mjs text placement/<name> --frame 9:16 --shots shots.json --text caption [--text hook] [--platform reels,tiktok]
```

`shots.json`: `{"shots": [{"start": 0, "end": 4.2, "weight": 3.9, "faces": [{"who": "guest", "track": [{"t": 0, "box": [x, y, w, h], "feat": [x, y, w, h]}, …]}], "room": {"free": 0}}, …], "hook": {"start": 0, "end": 3, "calm": false}}`, boxes in px of the frame as the picture stands, ten moments a second or so; `between` on a moment whose `feat` is an estimate between two stills (their times: a lower lip there is said as such, a mouth that opens there is not seen); `room` how far the shot's picture may be raised without a ground (`null`: not at all, a shot shown whole); `calm: false` where the picture behind the hook may be busy (a card then takes a text's place). It answers one place for the captions of the whole clip, how far each shot is to be raised so that its chins clear them (over a ground under the apps' bottom; by `--raise head` (only while the whole head stays in the picture), `mouth` (the default: as head, and past the head's top for a mouth) or `full` (until the chin is clear), each shot with how far the frame cuts its head), never on a face's mouth (from `feat`, the eyes, nose and mouth, where given, else the head's proportions: smaller type first, then the shot raised past the head's top as far as the eyes allow; on the lower lip or the chin said as not avoidable), the returns of one close-up at one height, the hook's place over its seconds (it ends at a cut where the next shot leaves it none; where the captions' best place would leave it no place clear of the faces, the captions take their next place that does, said; where none does, it goes where it lies on no eyes, nose or mouth, never on the captions, and a `✗` says what it lies on), and per shot the seconds on each part (nose or eyes, hair or forehead, mouth, lower lip, chin: each only where the text overlaps it, the eyes from their top with the brows, which is the top of `feat`, else 15 % down the head's box; captions on the hair or forehead weigh half of the eyes and more than a mouth, said in a `note:`, a hook there is mild), a `✗` sentence only where something can still be done, into `text.json`. `--set caption.line=<em> --set caption.padEm=<em>` give the area of the style that will set the captions. `--caption-y`, `--font-size` and `--lift <shot>:<px>` fix one choice; the rest is placed around it. The calling skill's documents say how its agent looks at the result.

Large type instead of captions (kinetic type: phrase after phrase set big across the safe box's width, as kinetic-lyrics sets it): `--text area --area-top <px>`, alone, with `--area-top` where the calling skill sets its type without faces. It answers one area for the clip from the safe box's bottom up (`--area-bottom` for another bottom), never taller than that and never smaller than `area.least` of the height (15 %), its top below every face's mouth line: the area may lie on a chin, a neck or a body, never on the eyes, the nose or the mouth with the lower lip. The area goes lower or a shot is raised by `--raise` as for the captions, whichever costs less (a px lower for the whole clip 0.9 of a px raised for the shot's seconds, `area.smaller`) (past the head's top for the mouth unless `head`), what is left is a `✗` with its seconds. `--top <px>` fixes the area's top. A moment's `"eye"` (the y of the middle of the eyes' own box, as clips gives it) is what the list says of the eyes at their highest; without it the list names the top of the brows. Where the picture grows after it is raised (a push-in over the clip), give each moment its `"zoom"` (1.03: 3 % larger there): a lift of L px then moves that moment's faces L × zoom, and every lift in `text.json` is in px of the picture before it grows.

## Material beside the speaker (for another skill)

A card, a quote, a screenshot or a clip that shows for a few seconds while the person who talks stays in the picture (b-roll's frame "beside"). A card is made, not filmed: it gets a field and lays itself out into it. It always answers with candidates (also when none passes: their problems say why); it exits only on input it cannot read, in one sentence.

```bash
node <skill>/tools/place.mjs beside placement/<name> --frame 9:16 --source 1280x720 --face 555,150,180,195 --material-min 600x340 --text caption --platform reels --before 1.875,-669.4,285,0,285,1080,1350
```

- `--face` (or `--face-at` for a face that moves) is read off `grid` as in step 2; a box that reaches past the source's edge is taken to that edge and a `note:` says so (one wholly outside is an error). A caller without a box passes `--face assumed`: the usual framing of a talking head (a fifth of the frame tall, in the middle, a third down, as the footage covers the frame); every candidate then says the box was assumed, and the face's size and place are guesses.
- `--material-min WxH`: the smallest field the material reads in, px of the frame. `--material-ratio 16:9` where it prefers a shape (the field is then the largest box of that shape); `--material WxH` for a picture or clip of fixed size: the largest box of its shape, at most 1.5× its own pixels, `material.scale` given, and the arrangement that shows it largest first.
- `--platform`: the same list the video is built for (b-roll's `reels`, `reels,tiktok`); the fields follow those apps' zones. None: the frame's usual apps together.
- The captions' band, as captions builds it: `--caption-area <folder>/area.json` (what `captions build` wrote, or its six values `left,width,top,bottom,size,lines`), or `--caption-style hormozi --text caption:2` (measured by captions' own build). Neither: the layout skill's own band (the tallest of captions' styles at 77 px). `captions.band` says which. The area is the line boxes; a shadow or outline below them reaches a few px further, into the 24 px gap.
- The face: `--set beside.face=0.22` asks for another target than the usual (0.12 to 0.5). The usual is 18 % of the frame's height in the panel and in the 16:9 column alike: the face below a screen in published Shorts; nothing in 16:9 was measured, and with one base a caller's three figures hold in every arrangement. `beside.faceUpTo` is how far the footage may be enlarged for it (default the soft limit, 1.5×). A larger wish that holds only while the footage stays sharp: `beside.wish` with `beside.wishUpTo`. Never past 2×. Where the panel holds less, or the footage stays sharp only for less, the face gets the most it can and a note says what was asked and what was given (`speaker.target`). A panel's picture covers the frame's width also with the face a little over its aim, up to 34 % of the frame's height (`beside.coverUpTo`, 0: `weights.subject.to`, the third quartile of faces in published talking heads); a larger face (a close-up of 40 %) comes to its aim, the picture narrower than the panel with ground beside it (the reason says so). b-roll's settings: `--set beside.faceUpTo=2 --set beside.wish=0.22 --set weights.enlarge.softFrom=1.25` (the wish under 1.25×, else 18 % up to 2×, soft past 1.25×, in every arrangement).
- 16:9: `--set beside.side=left` (or `right`) fixes the column's side; `--set beside.captions=stay` leaves the captions where they stand without the material (across the frame's foot, over the column), the material ending above them.
- `--before`: the speaker's placement just before, as `place` handed it over (`scale,left,top`, and its `window` after them where it did not fill the frame); without it the footage covering the frame is assumed.
- The candidates: 9:16, 4:5, 1:1 `beside-above` (the material above, the speaker as a panel below, the captions on the seam: what published Shorts do most with a screen and a face, usual, not shown to work; 4:5 and 1:1 unmeasured), then `beside-pip` (a circle in a corner). 16:9 `beside-column` (the speaker as a column on a third of the width, on the side from which they look at the material), `beside-above`, `beside-pip`: nothing in 16:9 was measured. A panel never shrinks the face under 12 % of the frame's height to make room (a figure from picture-in-picture frames, unmeasured as a floor): a material that needs more height gets the circle first, and a note says up to which field the panel holds; footage whose face cannot be made that large stays smaller, marked `!`. There is always a candidate with `shape: "rect"`.
- `page placement/<name> --still <speaker's video|image> --still <the material as a picture>` and `captions placement/<name> --candidate N` work as for `place`. Look at the pictures before handing over.

What `candidates[N-1]` holds, in px of the frame:

| key | what |
| --- | --- |
| `material.field` | the box the material lays itself out in (inside the safe box, clear of the captions) |
| `material.area` | the part of the frame that belongs to the material: its own ground (a card's colour) may fill it |
| `material.scale` | with `--material WxH`: the picture's scale in its field |
| `speaker.field`, `speaker.shape` | the speaker's box (`rect`, or `circle`: the disc inside that box) |
| `speaker.scale`, `left`, `top` | the footage itself: drawn `scale` frame px per footage px, its top left corner at `left`, `top` (frame px), clipped to `speaker.field` |
| `speaker.host` | the same as a transform (`scale`, `left`, `top`; scale first, origin top left) of the footage filling the frame (object-fit: cover, centred): how b-roll moves its host |
| `speaker.window` | the part of the field the picture covers; where it is smaller than the field (`speaker.ground` > 0), lay ground there |
| `speaker.card` | the part of `window` to show the picture in: with the captions on the seam, `window` cut at the top to the bottom of `captions.box` (no lower than the margin kept above the head), so that the captions stand on the panel's ground and not on the video; everywhere else (no captions, the circle, captions that stay or stand under the material) it equals `window` |
| `speaker.crop`, `face`, `faceHeight`, `facePct`, `target` | the footage's part the field shows (px of the footage; a circle's may reach past it: ground), the face as placed, and the target: `asked`, `aimed`, `given`, `enlargement`, `heldBy` |
| `captions` | `where` (`seam`, `below`, `under-material`, `stay`), `box`, `font`, `lines`, `align`, `band`; `captions` turns it into captions' options |
| `change` | `before` and `after` (`scale`, `left`, `top`, `window`, `face`; `round` for the circle), `face` (`dx`, `dy`, `zoom`), `says` |
| `notes`, `problems`, `hard`, `unmet`, `why`, `score` | as for `place`; `problems` are what a caller can act on |
| `crops` | where a feed or grid shows the frame cropped (the Instagram feed's 4:5 of an upright video, the profile grid's 3:4): `of`, `kind`, `what`, also as a sentence in `notes`. Not a problem: the video shows the frame whole, and the fields keep inside those crops wherever they keep their size there |

**At the change** from the speaker full-frame to the panel and back: the panel is a crop of the same footage, never a second clip. Draw the footage at `change.after`'s scale, left and top, clipped to `change.after.window` (the speaker's field; a circle for `round`), from the material's first frame to its last; show it in `speaker.card` and lay ground in the field where the card leaves it uncovered, and the material's area around. Cut there and back (what b-roll does today), or animate: interpolate `scale`, `left`, `top` and `window` in a straight line from `before` to `after` (the face then moves straight, by `change.face`) and back at the end. The crop is chosen so that the face jumps as little as the arrangement lets it: in a panel that the picture covers it keeps its place across (it only moves down); in the 16:9 column, where the speaker filled the frame before at a scale that covers the column, the footage keeps that scale and the face its height (it only moves across). How long a move takes was not measured here; clips pans 0.4 s from one speaker to the other.

**From one built video** (b-roll's draft pull request 80, 2026-11-18: 9:16 and 16:9 built and looked at, 4:5 and 1:1 only computed; experience, not a measured rule): the captions' way from their usual place to the seam leads across the speaker's face, and moved in a straight line with the picture they crossed the eyes for about 0.2 s. That skill fades the captions out, sets them to their new place at the middle of the change and fades them in again; the speaker's picture moves in a straight line over 0.5 s, and the ground around the speaker is opaque from the start, its opening moving with the video.

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
