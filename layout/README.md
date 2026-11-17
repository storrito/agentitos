# layout

How a recording goes into a frame (9:16, 4:5, 1:1, 16:9), and where captions and a hook can go: computed from where the faces are, or the part of a screen that matters, and from what the apps lay over the video. It tries every fit (the picture as it is, zoomed, smaller over a ground, cropped, cropped as a band, as a panel at one side, two people stacked, a screen between the text's bands with a webcam's circle), checks each against the zones, ranks them and says why. It builds no video and decides nothing: an agent gets the candidates and a picture of each to look at, and chooses.

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
node tools/place.mjs grid take.mp4 placement/demo/grid.jpg --at 3      # a frame with a labelled 10 % grid, to read the boxes off
node tools/place.mjs place placement/demo --frame 9:16 --source 1080x1920 --face 300,570,600,900 --text caption:2 --text hook
node tools/place.mjs page placement/demo --still take.mp4 --at 3       # the first three candidates as pages and pictures, checked by platform-zones
node tools/place.mjs captions placement/demo --candidate 1             # the options that set agentitos' captions into its caption area
node tools/test.mjs                                                    # 30 tests; --quick: the 25 that need no Chrome and no ffmpeg
node tools/sweep.mjs sweep/                                            # for people who change the weights: which fit wins where
```

Requirements: Node 20+, no npm packages. agentitos' [platform-zones](../platform-zones/) beside this skill (`PLATFORM_ZONES` naming its `tools/zones.mjs`, else beside it, else in the machine's clone): every zone comes from it, and its `layout` command is the checker. ffmpeg with ffprobe for `grid` and for a frame of the recording in `page`. Chrome for `page`, found as platform-zones finds it (`CHROME`, else on the PATH, else one puppeteer downloaded). No model, no key.

## Where it sits

No tool of this collection sees a face. Each skill that frames people (clips, best-takes, screencast-cut) has its own rule for where the picture goes, and the captions always end on the safe box's bottom, which in a close selfie is the speaker's chin. This skill is the step between knowing what a recording is and building a video from it:

1. [footage-kind](../footage-kind/) names the situation (a talking head, two people in one picture, a desktop with a webcam; it is on a branch of its own, draft pull request 58, and not needed to run this).
2. An agent reads the boxes of the faces, or of a screen's region, off `grid`'s picture.
3. `place` computes the candidates, `page` shows them and has platform-zones check them, the agent chooses, by [`references/situations.md`](references/situations.md) where two fit.
4. The numbers go to the skill that builds the video, and `captions` prints the options for [captions](../captions/).

**captions needs its placement options for that** (`--x`, `--y`, `--max-width`, `--align`, `--font-size`, `--lines`). They are on captions' branch `captions-place` (draft pull request 61), not on main yet. A captions without them ignores them and sets the captions on the safe box's bottom; it answers "Placed where asked: …" only when it took them.

## What goes in

Boxes are `x,y,w,h` in px of the source: the top left corner, then width and height. A face runs from the hairline to the chin and from cheek to cheek. Every `--face`, `--face-at`, `--face-track` and `--region` belongs to the `--source` before it.

| what | options | what the solver does with it |
| --- | --- | --- |
| one face | `--source 1080x1920 --face 300,570,600,900` | every fit that holds the face in the safe box and leaves the text room |
| several faces in one picture | `--face … --face … [--speaker N]` | the fits that hold them all; in a frame narrower than the picture also a crop on one person (on each, or only on the speaker) and, for two, `stacked` |
| two people as two files | `--source A --face … --source B --face …` | `stacked` in an upright frame, `side-by-side` in a wide one, both in 4:5 and 1:1; the smaller face is brought towards the larger |
| a face that moves | `--face-at 0:300,570,600,900 --face-at 2.5:…`, or `--face-track file.json` (`[{ "t": 0, "box": [x, y, w, h] }, …]`) | placed for the hull of its boxes, so that the placement and the text hold for the whole clip; its size in the ranking is its usual (median) box; the moment that decides the placement is named |
| a screen | `--region 700,300,480,300 --min-text-height 14 [--readable 24]` | the region in the safe box at the smallest scale at which its smallest text reads (a capital 24 px tall in a frame 1080 px wide, a guess), the screen running to the frame's edges between the text's bands |
| a screen and a webcam | a second `--source WxH --face …` (or a `--face` with the screen, which only says that a circle is wanted) | the webcam as a circle in a free corner of the safe box, sized as screencast-cut sizes it; smaller, or in another corner, where the region is |
| the text | `--text caption:2`, `--text hook` | captions of N lines (56 px type in upright frames, 50 px in 16:9, line height 1.32) and a hook: a card of two lines across the wide stretch in an upright frame (76 px, down to 64), two big lines in a wide one (112 px, down to 72) |
| the frame | `--frame 9:16` (or `4:5`, `1:1`, `16:9`, `1080x1920`), `--platform reels,tiktok` | the zones of those platforms; none named: the frame's usual ones together |

`--set key=value` changes one default for one run (`hookCard.minFont=76`, `free.below=0.1`, `facePad=0`; they are in `tools/lib/defaults.mjs`), `--all` lists every fit also where the unchanged picture passes.

## What comes out

`place` prints the candidates and writes `<folder>/placement.json` (`--json` prints the same):

```json
{"frame": "9:16", "size": [1080, 1920], "platforms": ["Instagram Reels", "Instagram Story", "TikTok", "YouTube Shorts", "Facebook Reels"], "fallback": true,
 "source": [1080, 1920], "faces": [[300, 570, 600, 900]], "needs": [{"role": "caption", "lines": 1}], "notes": [],
 "candidates": [{"fit": "zoom", "scale": 1.07, "left": -75.6, "top": -134.4, "zoom": 1.07, "enlargement": 1.07, "window": [0, 0, 1080, 1920],
                 "faceInFrame": [[245.4, 475.5, 642, 963]],
                 "text": [{"role": "caption", "where": "above-head", "on": "picture", "box": [192, 382.3, 696, 73.9], "lines": 1, "font": 56, "style": "cap", "align": "center"}],
                 "problems": [], "hard": 0, "soft": 0, "unmet": [], "ground": 0, "faceHeight": 963,
                 "terms": {"enlargement": 0, "ground": 0, "subject": -15, "people": 0, "soft": 0, "text": 0.15, "hook": 0}, "cost": -14.85, "score": 114.85,
                 "why": ["no hard problem", "every text need met: 1 caption line above-head", "the source's pixels are enlarged 1.07×, not over the 1.5× from where it shows",
                         "the face is 963 px tall (50 % of the frame's height)", "the picture fills the frame", "cost -14.85 (subject −15, text away +0.15)"]}],
 "defaults": {}, "asked": {"frame": "9:16", "platforms": []}}
```

- `scale` is frame px per source px; `left`, `top` where the source's top left corner lies in the frame; `window` the part of the frame the sharp picture fills (the rest is ground). `stacked` and `side-by-side` carry `parts`, one such placement per half; a screen with a webcam a `circle` (its `box`, and the square of the webcam's picture it shows).
- `problems` are hard (`✗`: under what an app covers, out of the frame, text on a face or on text, a face cut by its picture's edge, the source enlarged over the forbidden limit, the circle on the region), soft (`!`: in the safe box's margin, cut by a feed's crop, enlarged over the soft limit, another person cut by a crop's edge) or unmet (`–`: a text without a free place, a screen's text too small).
- `tracks` (a face that moves): its usual box, its hull, how much larger the hull is, which moment gives the hull each edge, and `decides`: the moments without which the first candidate would be another.
- `notes` say what no candidate can.

`page` writes `candidate-N.html` and `candidate-N.png` for the first three candidates (or `--candidate 2`, `1,4`, `all`) and, with `--still`, `still.jpg`: one frame of the recording, without any of the file's tags. `grid` writes the one picture it is given a name for. Nothing is written into the skill.

## Two checks

The search judges thousands of placements, too many to open a page for each: `tools/lib/judge.mjs` applies the rules of platform-zones' layout check to the solver's own boxes, with the letters' place estimated from the font's metrics. `page` then has platform-zones itself measure the candidate's page in Chrome, by its letters, and prints both verdicts side by side. They agreed on every page of the tests (about a hundred) and on the sweep's winners (below). What only the solver judges, because the checker cannot know it: how far the source is enlarged, a face cut by its own picture's edge, a text need without a place, a screen's text too small, another person showing in a crop or a half, the circle on the region.

## The weights

A candidate with a hard problem ranks behind every one without, one that leaves a need unmet behind every one that meets them all. Among the rest the smaller cost wins, in points, from [`tools/weights.json`](tools/weights.json) (every term with a sentence of what it says); `--weights file.json` takes another file, `--set weights.enlarge.softFrom=1.4` changes one term.

| term | value | what it does | where it comes from |
| --- | --- | --- | --- |
| `enlarge.softFrom` | 1.5× | up to here enlarging the source costs nothing | judged: 1.5× looked crisp |
| `enlarge.forbiddenFrom` | 2× | over this a candidate fails | a guess between 1.875× (judged fine) and 2.67× (judged too soft) |
| `enlarge.costAtForbidden` | 3 points | the cost at the limit, rising in a straight line from `softFrom` | set so that the judged order comes out; from about 3.8 the crisp square would pass the mildly soft 4:5 crop, and nobody judged which of the two should lead |
| `subject.worth` | 0.3 a % | taken off for every per cent of the frame's height the face is tall | set so that the judged order comes out |
| `subject.enough` | 50 % | over this a larger face is worth no more | a guess, no case decides it |
| `ground.cost` | 0.1 a % | for every per cent of the frame the sharp picture does not fill | set so that the judged order comes out |
| `people.leftOut` | 3 points | for a person a crop on another leaves out, when no speaker is named | a guess, no case decides it |
| `soft.cost` | 0.5 | for a soft problem other than enlargement | a guess |
| `text.away`, `text.hookSmaller` | 0.05, 0.02 | for a text away from its usual place, a hook under its size | small on purpose: they only order holds of the same picture |

**They rest on one judged case and on guesses.** The case: a 1280×720 take of one person into 9:16 with two caption lines, stills looked at by people: the 4:5 crop at 1.875× first, the square at 1.5× second, the whole picture as a strip third (the person tiny), the crop that fills the frame at 2.67× too soft to publish. The layouts made by hand on one upright phone take keep their winners under them. There is no term for how much of the picture a crop cuts away. They are to be set from measurements of published videos; until then, candidates less than a point apart are not told apart by anything measured.

### The sweep

`node tools/sweep.mjs <folder> [--weights mine.json] [--no-check]` is for whoever changes the weights or the defaults. It runs the solver on 16,128 made-up faces (15–55 % of the source's height, the eyes at 25–60 % of it, up to 15 % of the width off the middle; an upright and a wide source into each of the four frames; one caption line, two, a hook, a hook and two lines), has platform-zones check every winner's boxes and 384 winners as pages, and writes `<folder>/sweep.json` (9 MB) and `<folder>/sweep.html`: one map per case and text need of which placement wins for which face, the thresholds in words, and, with `--weights`, how many winners the other weights change against the skill's own and from what to what. About 75 seconds on a machine with 20 cores, 5 without the checker; `--html` only rebuilds the page.

It says what the weights do, not what looks good. Moderate changes move little: with enlargement at 5 points at the limit instead of 3, no winner of the grid changed.

## How far it has been tested

- **Two takes laid out by hand** ([`tools/hand.json`](tools/hand.json): the numbers of 14 layouts, no picture). An upright phone take (2026-11-16): the solver finds the hand's zoom of 1.07 at the same place, the inset that holds the hook card at its size (0.82), and the panel in 16:9; where it goes further than the hand (two caption lines above the head in the zoom) the checker passes it. A wide 1280×720 take (2026-11-17): it proposes the hand's three crops at the same place. For the 21 cases of these takes the first candidate is written down with who stands behind it: 5 the hand's layout, 1 judged by people, 15 only the solver's.
- **`tools/test.mjs`**: 30 tests, 17 seconds with Chrome, under a second with `--quick` (25 tests, no Chrome, no ffmpeg). Every page the tests write gets the same findings from the solver and the checker.
- **The sweep** (2026-11-17): no winner with a hard problem or an unmet need; of 16,128 winners' boxes none fails the checker and 16,127 agree in every finding (the one: a feed's cut of 0.2 px that the checker's 2 px of slack ignores); 384 as pages in Chrome: all agree.
- **Drawn placeholders only** for several faces, a face that moves and a screen: the tests' pages show ovals and a drawn surface. None of those was ever run on real footage. Three or more people in parts are not built.
- **On real footage** only the two takes above, one person each, as stills; the upright one also as four short videos, built by hand from these numbers before this skill existed. Read off a grid by an agent, placed and built into a video by another skill: not yet done once.
- Named platforms (`--platform`) were tried by hand on the upright take only: for Instagram Reels alone it passes unchanged, as the hand had found, and with TikTok named as well it takes the zoom. Every test and the sweep run with the frames' usual platforms.

Beside screencast-cut's own layout for a screen with a webcam (its code run on the same case on 2026-11-17: a 1920×1080 screen, a region of 480×300 with 14 px text, 9:16, two caption lines): screencast-cut scales what matters as large as its room allows, up to 2× (1.48×, the text 20.7 px); this solver takes the smallest scale that reads (1.71×, 24 px) and says when that cannot be had. screencast-cut pads the region by 10 % and never shows less than 38 % of the screen's width; this takes the region as given. screencast-cut's circle always stands bottom left in 9:16, above a band of 216 px kept for captions whatever their lines (y 962–1200); this one stands above the lines asked for (y 1030–1268) and moves to another corner, or shrinks, when the region is there.

## What it cannot do

- **See.** The boxes are an agent's reading of a grid; a wrong box is a wrong layout, with every check passing. Whether the picture behind a text is calm, it never knows.
- **Measure words.** A caption block is taken as wide as its area, a hook as two lines of ten letters' widths (about twenty letters); the pages show placeholder words. The video's own words are checked where the video is built.
- **Follow a face.** A moving face gets one placement for the whole clip, by its hull; following it, or cutting the clip where it moves, is only suggested in a note. Moments that give the hull no edge are not tried as deciding.
- **Time.** It lays out one moment of a video. Which layout a part gets, how long a hook stays and what changes when it leaves are the agent's.
- **Name tags, step texts, a second picture** (material above a person, a screen above a face): not placed. `stacked` is two people.
- **The webcam's picture.** The circle on a page is drawn; its crop of the webcam is a number.
- **Other subjects than faces and screens.** A product, a hand, a thing shown: [auto-reframe](../auto-reframe/) follows one moving subject.

## The code

`tools/place.mjs` is the command line. `tools/lib/`: `solve.mjs` (the cases, the ranking and its reasons), `fits.mjs` (the fits of one picture), `parts.mjs` (two people in two halves), `screen.mjs` (a screen and a webcam's circle), `evaluate.mjs` (one placement judged and costed), `text.mjs` (where the text finds room), `judge.mjs` (the zones' rules on the solver's boxes, and the comparison with the checker), `page.mjs` (a candidate as a page), `zones.mjs` (platform-zones as a program), `defaults.mjs` (what is assumed, and the weights), `boxes.mjs` (the geometry), `sweep-page.mjs` (the sweep's page).
