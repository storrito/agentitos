# captions: as the captions step of another skill

A skill that has its own timed words (best-takes has the cut's words, timed in the cut) calls the tool without transcribing:

1. It writes a words file: `{"width", "height", "duration", "words": [{"text", "start", "end", "highlight"}]}`.
2. It runs `node <skill>/tools/captions.mjs mark <words.json>` on it if it wants key words.
3. Only when its video wants spoken phrases as cards of their own (a box, an emoji in front, numbers in colour): `node <skill>/tools/captions.mjs box <words.json> "📏 32 centimetres wide" …`, or the same `"box"` (a number from 1 or a name, the same on every word of the phrase, another for the next card; 0, false and "" are no box) on those words and `"icon"` on a phrase's first word, written by itself. Words without `box` are captions as before.
4. It runs `node <skill>/tools/captions.mjs build <words.json> <composition>/captions --style <style> [--platform <where it goes>]`.
5. It puts the clip the tool prints into its host composition.

The words must be timed in the video the captions go on, after every cut.
