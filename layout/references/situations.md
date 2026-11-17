# Which layout fits which situation

The situations are footage-kind's (its `references/situations.md`: P1, G1, B2, …). For the eleven
that were laid out so far: the layouts that fit, the part of a video each is for, and what
`place` gives for it. A layout changes with what carries the moment, part by part, not once per
video: run `place` for each layout a video uses.

Every number here is marked. **measured**: seen on real footage or stills, with what it was seen
on. **computed**: the solver's own, on made-up faces; nobody looked at pictures of it.
**sketch**: drawn to scale in the catalogue of layouts (27 layouts, 2026-11-16) and never
tested. **from** a skill: that skill's own number.

What creators of published Shorts do (where they put the face, the captions, the hook, how often
which layout) is being measured on about 240 videos; **its figures are still to come and nothing
below rests on them.**

## What holds for all (sketch, except where platform-zones says it)

- What carries the moment gets the largest area.
- Faces in the safe box, the eyes a third down; never text on a face (platform-zones).
- The text stands where the picture is free, and the face's place decides that, not a fixed
  position: over the chest when the face sits high, above the head when it sits low (measured on
  P1's still, below).
- Captions end on the safe box's bottom; with two parts one above the other, on the seam
  (platform-zones).
- No empty band for long: a source that does not fill the frame gets a second area (text, a
  person, a magnified part). The blurred copy as ground is for short inserts.
- 16:9 uses the width: what stands one above the other in 9:16 stands side by side, the main thing
  on two thirds.

## One person speaks to the camera

| situation | layout | when | how | from `place` |
| --- | --- | --- | --- | --- |
| P1 upright | The person alone | every part in which someone only speaks | 9:16: the take fills the frame, captions where the picture is free. 16:9: the take as a tall panel on the left, the words beside it | 9:16 `full`, `zoom` or `inset`; 16:9 `panel` |
| P1 | Hook at the top | the first seconds, a reply to a comment, a part of a series | 9:16: a card of 3–8 words in the wide stretch, the face under it. 16:9: the hook as big lines beside the panel, captions small under it | `--text hook`: a card (9:16) or big lines (16:9) |
| P2 wide | Cropped close | from about 2.7K material | 9:16: a crop around the face, 31.6 % of the source's width. 16:9: the source as it is, one caption line at the bottom | `crop 9:16`; 16:9 `full` |
| P2 | Square plus text | 1080-line material and less, or when keywords stand beside the speaking | 9:16: a square across the frame, captions under it on calm ground. 16:9: the person on a third, the keyword on the free side | `crop 1:1`, `crop 4:5`, `crop band` |
| P4 speaker and material | Material on top, person below | the person speaks about the material for a while and stays visible | 9:16: material in the wide stretch, the person under it, captions on the seam. 16:9: material on two thirds, the person as a panel | not built: `stacked` holds two people, not a picture and a person |
| P4 | Material fills, person in a circle | the material carries many sentences | circle 22 % of the frame's width, left above the captions (9:16); 20 % of the height, top right (16:9) | a screen or picture as `--region` with the speaker as the webcam |
| P4 | Insert | proof of 2–5 seconds, the voice goes on | upright material fills; wide material as a band over a blurred copy in 9:16, hence short | `inset`, `crop band` |

- **P1 as sketched fails in 9:16** (measured: one still of an upright phone take, the face 47 % of
  the height, the chin at 77 %; platform-zones' check, usual platforms, 2026-11-16). The captions
  lay on the face, the chin under TikTok's and Facebook Reels' text, the cheek under Shorts'
  buttons. What passed: the picture zoomed in 7 % and moved up and to the left, the text above the
  head. Then one caption line fits, or the hook card (at 66 px), not both; both need the picture
  at about 82 %, two caption lines at 90 %. For Instagram Reels alone the take passed unchanged:
  name the platform when it is known.
- **In the video the margin was 8 px** (measured: four test videos of 7.7 s from the same take,
  2026-11-17; 36 stills checked, none failing). The top of the hair moved between y 448 and 470
  of the frame, the caption box above it ended at 440. A face read at one moment has no reserve:
  read it at several.
- **The two 16:9 layouts of an upright take passed every check and looked weak as videos**
  (measured: the same four videos, looked at by people). The big words beside the panel were
  restless, and after the hook the area beside the panel stood empty. Take them only when 16:9 is
  asked for, and say that an upright take suits it badly.
- **P2's sharpness** (measured: stills of one 1280×720 interview, judged by people, 2026-11-17).
  The close crop at 2.67× was too soft to publish, the 4:5 crop at 1.875× mildly soft but fine,
  the square at 1.5× crisp, with the person small (the face a quarter of the width). Nothing
  between 1.875× and 2.67× was judged: the solver's limit of 2× is a guess between them.
  "From about 2.7K" and "emphasis by zooming in 15–30 %" are sketch.
- A hook, the square and captions under it need about 1280 px, the safe box is 1190 px tall
  (measured, same still): the captions then stand over the chest.
- The person on a third in 16:9 took 2.02× on that still, as the person sat in the source's
  middle, and the keyword was readable only on a darkened ground (measured, same still). The
  solver knows neither: it has no third and sees no ground.

## Several people speak

| situation | layout | when | how | from `place` |
| --- | --- | --- | --- | --- |
| G1 two in one picture | Cut to the speaker | one person speaks for more than about two sentences | 9:16: a crop on the speaker's face, a name tag under the chin, a pan of 0.4 s when the speaker changes. 16:9: both stay | `--speaker N`: `crop` on that face; 16:9 `full` |
| G1 | Stacked | quick exchange, laughter, contradiction: both faces count | 9:16: each person in one half, captions on the seam. 16:9: two equal areas, worth it only when the two sit far apart | `stacked`; in 16:9 the picture stays whole |
| G2 one file per person | Cut | the usual; cut where the speaker changes, no shot under about 1.5 s | the speaker's camera, cropped as P2 | `place` on that file alone |
| G2 | Split | exchange and reactions | 9:16: two cameras one above the other, captions on the seam. 16:9: side by side | two `--source`: `stacked`, `side-by-side` |

"Two sentences", "1.5 s" are sketch; the pan of 0.4 s and the face at 32 % of the height are from
clips. Stacked and side by side were run only on drawn faces (computed): never on a recording of
two people. Name tags are not placed, and who speaks when is not an input.

## The screen is the subject

| situation | layout | when | how | from `place` |
| --- | --- | --- | --- | --- |
| B1 desktop alone | Zoom on the spot | the usual, once it is clear where something happens | the part that matters in the safe box, the rest of the screen running on under the apps' bars, never under the captions | `screen-zoom`, `screen-fit` |
| B1 | Whole screen | one or two seconds to find one's way: at the start, when the application changes | 9:16: the screen across the frame, nothing readable, hence short | `screen-whole` |
| B1 | Crop plus step text | a recording without a voice, or a guide in steps | 9:16: the crop at the top with a ring, the step under it. 16:9: the screen on two thirds, the step on the right | the crop: `screen-zoom`; the step text is not placed |
| B2 desktop and webcam | Screen with circle | the usual: the screen carries | circle 22 % of the width, left above the captions (9:16); 20 % of the height, top right (16:9) | `--region` with a `--face` or a second `--source` |
| B2 | Face large | first sentence, last sentence, a personal remark: one or two sentences | the webcam fills the frame, enlarged 1.25× at most | `place` on the webcam's file alone |
| B2 | Screen on top, face below | the person explains for a while and little happens on the screen | 9:16: the screen in the wide stretch, the face under it, captions on the seam | not built |
| B4 phone alone | Phone whole | the opening: it is the real app on a real phone | 9:16: the phone in the middle of the safe box, about half the width | `screen-whole` |
| B4 | Phone fills the frame | as soon as someone taps and reads | 9:16: the screen across the frame, its status bar under the apps' bars | `screen-zoom`, `screen-fit` |
| B5 phone and speaker | Phone whole, speaker beside | the person introduces | 9:16: the circle left above the captions, the phone beside it | `screen-whole` with a webcam |
| B5 | Phone fills, circle in a free corner | as soon as someone taps | the circle moves to another corner when the part that matters is there | `screen-zoom` with a webcam |

- The circle's sizes (22 % of the width in 9:16, 16 % of the short side in 4:5 and 1:1, 20 % in
  16:9), the least share of the screen (38 % of its width) and the 1.25× of "Face large" are from
  screencast-cut. The times and "about half the width" are sketch.
- What reads is a guess: a capital letter of the screen's smallest text 24 px tall in a frame
  1080 px wide (`--readable`). Nobody looked at a screen recording enlarged 1.5–2×; the limits
  come from a person's still.
- Every screen case is computed on a drawn surface: never run on a screen recording, and a phone's
  upright screen not at all.

## No picture of its own

O1 (a voice alone: the words as the picture, a cover with a waveform, a picture with captions)
and O2 (text or a link: a headline over a picture, the source as a card, a list) have nothing to
place: there is no face and no region. Their layouts are platform-zones' patterns
(`platform-zones/references/layouts.md`: kinetic type, podcast clip, news, post screenshot, list),
all sketch in 16:9.

## From 9:16 to 16:9 (sketch)

| in 9:16 | in 16:9 |
| --- | --- |
| two areas one above the other | side by side, two thirds to one third, the main thing on the left |
| circle left above the captions, 22 % of the width | circle top right in the safe box, 20 % of the height |
| hook card in the wide stretch | hook as big lines beside the person |
| captions in two lines, at most as wide as `centred` | one line at the bottom, or big words in the free area |
| a wide source as a crop, or shortly as a band | a wide source fills the frame |
| an upright source fills the frame | an upright source as a tall panel on a third, text beside it: weak as a video (measured, above) |

## Where the solver changes its mind (computed)

From `tools/sweep.mjs`: 16,128 made-up faces (15–55 % of the source's height, the eyes at 25–60 %
of it), the usual platforms of each frame, the weights of 2026-11-17. They say what the solver
does, not what looks good; a platform named or a weight changed moves them.

- **Upright into 9:16.** Unchanged while the hairline is no higher than 13 % of the height, the
  chin no lower than 75 %, the right cheek not past 82 % of the width: with a face up to 25 % of
  the height always. Captions stay below the chin while the chin is above about 68 % of the height
  (one line; 65 % for two), else they go above the head, which needs the hairline at 18 % (one
  line), 22 % (two), 24 % (the smallest hook card) or 33 % (hook and two lines). A zoom of
  1.02–1.46× where the face only just leaves the safe box. From a face 55 % tall (captions), 50 %
  (hook), 45 % (both) only a smaller picture passes.
- **Wide into 9:16.** From 1080 lines the crop that fills the frame (1.78×, soft) wins in 57 % of
  the cells, a band in 43 %. From 720 lines it is forbidden (2.67×): the 4:5 band, then the
  square, then the whole picture as a strip.
- **Upright into 16:9.** The panel in 81 % of the cells; a 16:9 crop (1.78×, a third of the take's
  height) only for a face of 15–20 %. Nobody judged that crop against the panel.
- **Wide into 16:9.** Unchanged in 88 % of the cells with captions, 80 % with a hook. Captions at
  the bottom on the middle while the chin is above about 77 % of the height (73 % for two lines),
  else in a column beside the face. A hook above the head from a hairline at 27 %, else beside.
- **Into 4:5 and 1:1.** An upright take fills the frame with one caption line up to a face of
  40–45 % of its height, with a hook and two lines up to 25–30 %; above that a band down the frame
  or the whole take smaller. A wide take fills it up to 50 % (one line) and 20–25 % (hook and two
  lines).
