# The stored cases

Each folder: `case.json` (what it guards, where its input came from, the steps), its inputs, `out/` (what the commands wrote and printed). Only boxes, sizes and seconds; the people are A, B, …. Run with `node tools/test-cases.mjs`, rewrite a meant change with `node tools/cases.mjs write`.

| case | input | guards |
| --- | --- | --- |
| beside-1080p-16x9-no-captions | made up | a fixed-size 1920x1080 screenshot beside a 1080p speaker in 16:9 without captions |
| beside-4k-1x1-captions | made up | 16:9 material beside a 4K speaker in 1:1 with a caption line |
| beside-720p-4x5-moving-face | made up | material beside a 720p speaker who moves (face track) in 4:5 with a caption line |
| beside-720p-9x16-captions-before | made up | material beside a 720p speaker in 9:16 with a caption line and the full-frame placement before (--before) |
| beside-error-hook | made up | beside asked for a hook: one sentence that says what it takes instead, exit 1 |
| beside-made-box-past-top-clamped | made up | the same box past the top for beside: it is cut back to the frame and said |
| place-1080p-1x1-one-face | made up | a 1080p source with one face right of the middle into 1:1 with one caption line |
| place-1080p-4x5-two-faces-speaker | made up | two faces in a 1080p source into 4:5 with the first named speaker |
| place-1080p-9x16-face-at-left-edge | made up | a face whose box touches the 1080p source's left edge into 9:16 with two caption lines |
| place-4k-16x9-two-faces | made up | a 4K source with two people into 16:9 with a caption line and a hook |
| place-4k-4x5-head-low | made up | a 4K source whose head sits low into 4:5 with a caption line |
| place-4k-9x16-two-lines | made up | a 4K source with one face into 9:16 with two caption lines on the clips platforms |
| place-720p-1x1-face-at-right-edge | made up | a face whose box touches a 720p source's right edge into 1:1 |
| place-720p-9x16-face-at-edge-all | made up | a 720p face near the left edge and the top into 9:16, every fit listed (--all) |
| place-720p-9x16-hook-card-softer | made up | the moving 720p face with the hook as a card and a weight changed by --set (softFrom 1.4) |
| place-720p-9x16-moving-face-hook | made up | a 720p source with a face that moves (three moments) into 9:16 with a caption line and a hook |
| place-made-error-box-past-top | made up | a face box that begins above the frame's top (a webcam read off a grid): place refuses it in one sentence |
| place-narrated-two-tracks | made up | two moving faces as narrated-short hands them over (a dozen moments each) from a 1080p source into 1080x1920 |
| place-portrait-16x9-hook | made up | an upright 1080x1920 source into 16:9 with a caption line and a hook |
| place-screen-panel-4x5-wide-screen-width | made up | a wide zoom of a 1080p screen with a 720p webcam into 4:5 under a label, the speaker's panel as wide as the screen (--screen-panel screen) |
| place-screen-panel-9x16-tight-no | made up | a tight zoom of a 1080p screen at 2× into 9:16 with --screen-panel: not offered, the panel would hold the face under 18 % of the frame's height, said in a note |
| place-screen-panel-9x16-whole | made up | a whole 1080p screen with a 720p webcam into 9:16 for Reels, the captions fixed at the safe box's bottom, the screen above and the speaker's panel across the frame (--screen-panel) with the face keep before (--before) |
| place-screen-region-no-face-16x9 | made up | a 1080p screen region without a face into 16:9 with a caption line |
| place-screen-region-webcam-9x16 | made up | a 1080p screen region with a 720p webcam file into 9:16 with a caption line |
| place-then-captions | made up | a place followed by captions --candidate 1: the options that set captions into the first candidate's area |
| text-eyes-begin-high | made up | a frame-filling head whose eyes begin high (features known): captions on hair or forehead said as such |
| text-eyes-begin-high-box-only | made up | the same head lower, known by its box: captions in the band where its eyes may begin |
| text-face-fills-frame-area | made up | a still face filling the frame under large type (--text area): the area below the mouth |
| text-face-fills-frame-bobbing | made up | a face filling the frame that bobs up and down: the lift holds its lowest moment |
| text-face-fills-frame-bobbing-box-area | made up | a bobbing frame-filling face known by its box, under large type |
| text-face-fills-frame-box-only | made up | a face filling the frame known only by its box: captions at the mouth limit |
| text-face-fills-frame-still | made up | a still face filling the frame (box 880x1300, features known): captions at the mouth limit |
| text-head-low | made up | a head low in the frame (its chin near the bottom): how far it is raised for the captions |
| text-head-low-box-only-area | made up | a head low in the frame known by its box, under large type |
| text-made-area-two-boxes | made up | large type over two people side by side known only by their boxes (no eyes, nose, mouth): the area below where their mouths may be |
| text-made-area-two-shots | made up | large type (kinetic-lyrics' area, top 957, raise full) over a close-up and a medium shot: one area, only the close-up raised |
| text-made-brief-face-dense | made up | a second face seen for 0.8 s at caption height in a dense track of a first: what the captions lie on, and for how long |
| text-made-error-hook-without-span | made up | --text hook on shots without a hook span is one sentence that says what is missing, exit 1 |
| text-made-fixed-caption-y-font | made up | a caller's fixed caption height and size (--caption-y, --font-size, as clips passes them): kept, and what lies on the face there said |
| text-made-hook-avoids-face | made up | a face in the middle of the frame where the hook as a text would stand: where the hook goes, its kind, and what it lies on, said |
| text-made-no-face-hook | made up | a clip without any face (a screen, a product): captions at the safe box's bottom and the hook, said as no face |
| text-made-sparse-1s | made up | a track with one sample a second (as a sparse face finder gives it): the caption place and the hook from the samples alone |
| text-made-sparse-2s-sinking | made up | a track with one sample every two seconds whose head sinks toward the bottom: where the one caption place goes from the samples alone |
| text-made-track-cut-off | made up | a track that ends at 4 s of a 10 s shot: the rest of the shot is not taken as a shot without a face |
| text-made-two-lines-close-up | made up | two caption lines over a close-up (the head half the height), raise full: where two lines find room and what they lie on |
| text-made-two-people-two-lines | made up | two people, one in each shot at a different height, with two caption lines and a hook: one caption place for both, each shot's lift |
| text-sparse-2s-close-up | public-domain footage | a tight close-up with one sample every two seconds: raise and captions |
| text-sparse-cutoff-upright | public-domain footage | an upright take whose track stops after 12 of 38 s: captions and hook |
| text-takes-rotated | public-domain footage | a take recorded rotated and turned upright: captions and the hook over its large head |
| text-takes-tight | public-domain footage | a tight close-up (the head about two thirds of the height): how far it is raised, where captions and the hook go |
| text-takes-wide | public-domain footage | a wide take: the person small in the frame, captions and the hook |
| text-two-faces-stacked | made up | two faces one above the other: captions between or below them |
| text-two-faces-stacked-box-area | made up | two stacked faces known by their boxes, under large type |
