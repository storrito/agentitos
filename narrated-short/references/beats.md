# The beats

`short/<name>/beats.json` says which stretch of which source runs under which words of the voice. The times are the film's, from `clock`.

```json
{
  "title": "Astrobee: NASA's flying robot cube",
  "credit": "NASA Ames",
  "handle": "@thechannel",
  "footage": "footage/astrobee",
  "hook": {"text": "NO LEGS. IT FLIES.", "key": "FLIES."},
  "subject": "the yellow robot",
  "beats": [
    {"id": "h1", "from": 0, "to": 5.53, "source": "yt_AbCdEfGhIjK", "at": 7.0, "freeze": 1.2},
    {"id": "b2", "from": 5.53, "to": 10.71, "source": "yt_AbCdEfGhIjK", "at": 30.5},
    {"id": "b3", "from": 10.71, "to": 13.13, "source": "press_clip", "at": 19.5, "zoom": 1.4, "pan": 1}
  ],
  "keys": ["NASA's", "zero gravity"],
  "boxes": ["📏 one foot wide", "🛰️ Space Station"],
  "compare": {"at": 13.13, "for": 3.8, "title": "SIZE CHECK",
              "rows": [["Astrobee", 32, "32 cm · 1 ft"], ["Toaster", 28, "28 cm"]]}
}
```

- `credit`: the footage's owner, on screen the whole time (two owners: `"Boston Dynamics · NASA"`). `handle`: the account's @name, shown at the end; ask when you do not know it.
- `footage`: the folder of the footage skill; a beat's `source` is a stem of it (`sources.json`), or the path of a video file.

## A beat

- `from`, `to`: seconds of the film. Beats follow each other without a gap. Change between sentences, in the pause, or at a comma; never inside a word. The first starts at 0; the last ends with the last word and is stretched 0.7 s past it by itself, so its stretch of the source must last that long.
- `at`: the second of the source where the clip starts.
- `frame` (may be left out): `whole` (the default: the whole wide frame as a band over a blurred copy of itself), `fill` (a 9:16 crop from the middle, only when the subject stays in the middle), `native` (the source is vertical).
- `zoom`, `pan` (with `whole`): the band larger, and which part of its width stays: 0 the left, 0.5 the middle, 1 the right. A bigger subject, a logo in a corner gone: a logo top left → `"zoom": 1.4, "pan": 1`.
- `speed`: 0.5 to 1 slows the source down, to fill a beat from a shorter stretch.

## Choosing the stretches

- Look at a stretch before you use it: the footage skill's `strip footage/<name> <stem> <from> <to>` shows it two frames a second. Its `look` printed where the source's viewers looked twice.
- **No clip across a cut of the source.** `cuts` in `footage/<name>/sources.json` are the source's own cuts: the stretch `at … at + (to − from)` holds none (earlier, later, or `speed`). `build` asks with `?` when one lies inside.
- **The subject of the sentence is in the picture.** People talking: two seconds at most.
- **Never start on a fade**: `at` a second or more into a shot.

## The first beat

- Its first frame shows what the first sentence claims, large and unmistakable: the machine and its trick, not people in a studio.
- **Motion in the first frame** where there is any: mid-jump, mid-fall, sparks, water; not a subject standing still.
- Its band is 1.6 times larger by itself; a subject that already fills the width: `"zoom": 1`.
- `hook.text`: two to five words in capitals that open a question, on screen for the first 2.5 s; `hook.key`: the one word of them in colour. Take the moment the text stands on a clear picture as the cover when the video is published.
- **The freeze** (`"freeze": 1.2`, with agentitos' freeze-cutout beside this skill): at that second of the beat the picture stops for 0.7 s, the background turns black and white, the subject pops out with an outline, and the clip runs on at its old length. Give one whenever the first seconds hold a moment with the subject **big, sharp and whole**, nothing in front of it, 0.2 s or more into the beat and 1.1 s before its end; no such moment: no `freeze`. `subject` (beside `hook`) names what pops, as you would point at it. `"pop": "soft"` makes it shorter and smaller. `build` says `freezes at …` with the picture to look at, or why there is none and that the plain clip is used. The freeze at its largest is the cover.

## The key words

`keys` are words and short phrases **as the voice says them**; the captions show them in colour. Three to six a film: the numbers and names that carry the story ("one foot", "NASA"). `build` says when a key is not among the spoken words.

## The boxes

`boxes` are spoken phrases that stand as a card of their own in the captions while they are said: a box, an emoji in front, the numbers in colour. `"<emoji> <two to four words as the voice says them>"`: the number with its unit, the whole name ("📏 one foot wide", "🛰️ Space Station"). Two or three a film, on what the story turns on; a phrase is a box or a key, not both. A fact that is only in a box is not said at all: it belongs in the script. `build` says when a phrase is not said like that. Leave `boxes` out and the captions are the style's alone.

## The comparison card

For the comparison sentence of the script (script.md): `at` is the start of that sentence minus 0.15 s, `for` reaches to the start of the next sentence, 2.5 s or longer. `title`: `SIZE CHECK`, `WEIGHT CHECK`, `SPEED CHECK` or `POWER CHECK`. **Two rows**, `[label, value, what is shown]`: first the film's subject, then the comparison of the sentence; the bars are drawn from the values, so both in one unit; short labels. The captions pause under the card; put a shot under it that carries the comparison (the whole subject, moving).

## What `build` reports

- `✗ DARK` (a near-black clip), `✗ SHORT` (the stretch runs past the end of the source), `✗ DARK-OPEN` (the first beat starts on a dark frame): another stretch; the build ends with them.
- `! … stand still`: a still shot may be meant.
- `? … a cut of its own inside`: look at the stretch; a real cut means move it or slow it, fast motion can trip the detector.
- `black bars in the source cut away`: nothing to do.
- `freezes at … look at …`: look at that picture now (quality.md, point 2). `! … no freeze`: the plain clip is used; another `freeze` second, or none.
- `!` for the card, the hook text, a key or a box: what it says.

No tool judges the picture: whether the subject is in it, whether a foreign logo, a watermark or burnt-in text sits in the sharp band (cut it away with `zoom` and `pan`, else another stretch or source). That is yours, on the strips now and on the sheet later.
