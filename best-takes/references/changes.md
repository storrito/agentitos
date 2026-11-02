# best-takes: typical change wishes

What to do when the person asks for a change to the cut. After each: build again with the same `--out`, run `check`, and ask again.

| They say | You do |
| --- | --- |
| "Put back the sentence about …" | find its words in the brief, add or widen a keep |
| "Take the first attempt of …" | swap the two ranges in `cut.json` |
| "Shorter" / "at most 30 s" | `build … --target 30`, drop the weakest parts first, keep the opening and the end |
| "Start with …" | move that keep to the top |
| "The pauses are too short / too long" | `--pause 1.5` (only pauses over 1.5 s are touched), or `"pauses": "keep"` on that keep (its pauses play as they are) |
| "Tighter" / "faster, like a reel" | `--pauses tight`: every pause over 0.4 s goes (with `--pause 0.7` only those over 0.7 s), whatever the picture shows (a talking head; not for a demo whose waits show something) |
| "More movement" / "zoom in at the cuts" | `--punch on`: at every jump cut the picture goes closer or back out, closer on a key word; `--punch off` takes it out |
| "A hook at the start" | `--hook "Three words that promise"` (6 words or fewer, one `*word*` stands out): a card at the top until the first sentence ends; `--hook ""` takes it out |
| "It looks as if no time passed" / "the wait is gone" | add the last word of the sentence that announces the wait to `"waits"` |
| "That wait / that silence is too long" | it is a pause whose picture moves a little: look at it in `check`; drop it from its keep by ending the keep before it and starting the next after it |
| "That part is too quiet / loud" | `"gain": 3` / `"gain": -3` on its keep |
| "Vertical" / "square" | `--aspect 9:16` / `--aspect 1:1` (with `--fit contain` the whole picture stays, with bars) |
| a word in the subtitles is wrong | `"fixes": {"57": "Pentax"}` |
| "Captions in the picture" / "another caption style" | `takes.mjs captions takes/<name> --style hormozi` (see "Captions in the picture" in SKILL.md) |
