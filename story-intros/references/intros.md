# The four intros

`assets/orbit.js` (stamp-orbit) and `assets/variants.js` (the other three) are copies of the intros an editor approved in a real series; `story.mjs` copies the one a Story needs to its `assets/series-intro.js`. Never edit that file (the renderer differs from the player in small ways that only a snapshot shows) and never load both: each defines `window.buildSeriesIntro`.

## Which intro for which words

| intro | what happens | fits | length |
| --- | --- | --- | --- |
| `stamp-orbit` | the words stamp in left-aligned, curve letter by letter into a ring that turns once clockwise, then land in the sentence | cycles, routines, planning, conversations | 3.20 s |
| `stack-fan` | a stacked deck of word cards fans out, holds about a second fully spread, collapses into the sentence | grouped, framed or branching ideas, lists | 2.40 (four words) to 2.60 (seven) |
| `slide-lock` | the words arrive in pairs from both sides, then lock to the left (x 150) and right (x 930) edges | pairs, before/after, "this, not that" | 2.30 (three rows), 2.40 (four) |
| `echo-collapse` | one keyword drops in large with three outlined echoes, the other words join a left-aligned stack | one strong keyword, long nouns | 3.20 s |

- `introCopy` is one sentence of 2–8 words; the intro shows the words in Anton capitals, then cross-fades them into that sentence (Arial 31 px, original case and punctuation) at 110 px from the left, 850 px from the top, where the first scene goes on.
- Slide fits two words per row in 720 px: four long words look squeezed, take another intro. Fan spreads at most 850 px high. Echo needs `echoKey`: a word of the sentence in capitals without punctuation that occurs once.
- Do not shorten an intro to "be quicker": the fan's spread hold and the orbit's turn are what the viewer reads.

## Changing the words after `new`

The sentence sits in three places of `index.html`, same words in the same order: `.cap-word` (capitals, no punctuation), `.case-word` and `#series-landing .final-word` (as written), and `copy` in the `buildSeriesIntro` config. For Echo also the three `.et-ghost` and `echoKey`. Easier: a new name and `story.mjs new` again, the old folder deleted after the person's yes.

## Time

- The film is 16.60 s. The scenes (`#s1`…`#s4`) are on the `rest` timeline, which the intro starts at 1.60 s of the film: rest time = film time − 1.60. `data-start` of clips is film time; do not add 1.60 to it.
- Scenes change at 5.20, 9.20 and 13.80 s of the film: a default, move them per topic, each with a hold long enough to read.
- The intro replaces the entrance of `#s1 .headline`: it comes 0.18 s after a fan or slide ends, 0.25 s after an orbit or echo. The first body text comes in at 3.55 s.
- Animate an illustration on `rest`, deterministically (no `setTimeout`, no random without a seed): the player seeks forward and back.

## Looking at it

The player rounds to frames: look at 3.20 s for the landed sentence, 1.80 s for the formed ring, and during each hold. `window.__introReady` is true and `window.__introError` unset when the intro has built; `__ringMetrics` (orbit) or `__introMetrics` (the others) hold its measures. Only the echo outlines carry `data-layout-ignore`; never silence other layout errors.
