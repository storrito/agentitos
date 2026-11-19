# kinetic-lyrics: the type and the faces

`short.mjs place <dir>` hands every face of every shot of the framed footage, ten times a second, to agentitos' layout (`place.mjs text --text area`) and builds the short again with what comes back. Read this before you change what it chose.

## What "clear of a face" means for this type

- **Never on the eyes, the nose or the mouth.** The type is large and moves (a lockup grows by 4 % while it shows, letters fly in and out), and a viewer watches the speaker's eyes and mouth while reading: type over them hides who is speaking. The mouth counts down to its mouth line, the bottom of the framing's eyes-nose-mouth box and 15 % of its height more, so that an open mouth and a head that tips between two stills are held.
- **On the chin, the neck, the shoulders and the body it may lie.** The type sits in the darkened lower part of the picture, which reaches over the chin of a close-up anyway; captions of published Shorts lie on the chest and the chin too.
- **The name tag above the type counts as type**: it lies inside the area that keeps off the mouths.
- **One place for the whole short.** The type keeps one top for every phrase; it never moves around a face from phrase to phrase. Where a shot needs more room, its picture goes up instead, once for the shot, by its lowest moment, and a close-up the camera comes back to stands at the same height each time.

## What the tool decides

- The order: the type a little lower first (smaller, never below 15 % of the frame's height for the type alone: the engine sets four lines at its smallest words in about 14 %), then the shot's picture raised over a dark ground at the bottom, which lies under the band the type sits in.
- How far a picture may go up, `--raise`: **`full`** (the default here) as far as the eyes stay below the apps' top bar. In this look the picture ends where the darkened band begins, a little above the middle of the frame, so a face high in the frame is what a close-up of that picture looks like; the frame cuts the top of the head. `mouth` keeps the eyes below 27 % of the height (where published Shorts have them at the highest), `head` never cuts a head.
- The footage's own motion is in the faces: the push-in of 6 % over the short and the punch of 2.5 % on each hero phrase.
- Where the faces leave the type where the footage alone sets it (a medium shot, footage without a face), nothing changes: the short is built as without `place`, byte for byte.

## What the list says, and what is left

- Per shot: raised or not (with how high the eyes then stand and how much more of the head the frame cuts), and what the type lies on with its seconds: no face; the chin or neck; `✗` the lower lip, the mouth, the nose or eyes.
- A `✗` is what neither a lower type nor a raise could clear, mostly a tight close-up whose head nods down (Dafoe on Hot Ones, 2026-11-19: the head moves by a sixth of the frame's height within one shot; the list said 0.6 s on the mouth and 1.7 s on the lower lip of 11 s, a model on the rendered frames found the type on the mouth for 0.5 s). What avoids it: another stretch of the episode without that shot, or a lower `--type-top` where the type is not at its smallest. Say it to the person when it is longer than a second or two.
- A shot raised far cuts the top of the head; the sheet shows it. If the person minds, `--raise mouth` or `--raise head` (the list then shows the seconds on the mouth that it costs).

## When to change it

- The person wants the type larger or higher: `--type-top <px>` (where the type starts; the name tag stands above it). A top above the faces' mouths is your decision and the list says what it then lies on.
- A raise that looks wrong on the sheet (the model's box of a face can be off on a profile): `--lift <second>:<px>` for that shot (0: as framed).
- Each choice is kept for the next `place`; `""` gives it back (`--type-top ""`).
