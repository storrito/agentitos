# The script

About 90 to 100 words in the film's language, 35 to 46 s spoken; a small story may be 60 words. `short/<name>/script.json`, **one sentence a line**, the format of launch-video's `voice`:

```json
{"voice": "george", "lines": [
  {"id": "s1", "text": "This robot has no legs, no wheels and no arms, and it is about to fly."},
  {"id": "s2", "text": "Meet Astrobee, NASA's free-flying robot for the International Space Station."}
]}
```

Ids are lowercase letters, digits and dashes, each once. `node <skill>/../launch-video/tools/launch.mjs voices` lists the voices; the person's choice, once made, stays.

- **The hook, the first sentence.** A contradiction, a secret or something impossible that **the first picture proves** ("Nobody is steering this robot, and it is doing a backflip."). No number, no price, no superlative to open. The clip comes first, the sentence is written for it: never a sentence the picture does not show. A name everyone knows (NASA, a famous maker) belongs here when there is one.
- **A story, not a data sheet.** What should not work, a trick, a secret. The number comes second.
- **One idea a sentence**, short, as people speak. Numbers as they are said ("nine point eight seconds", "three hundred kilograms").
- **The comparison sentence.** When a size, a mass, a speed or a strength is the aha, the sentence with the number is followed by a sentence of its own with exactly one comparison, 2.5 s or longer spoken ("That's as heavy as a small car."). The comparison card stands on this sentence (beats.md). Compare within the same kind (a humanoid with a humanoid, an arm with an arm) or with what a person can do, with a clear gap: the smaller value at about 10 to 67 % of the larger. Closer looks flat; further apart is better said as a count ("as strong as forty people"), without a card. Every value has its source in `brief.md`.
- **The end.** The sentence before the last leads back to the hook, so the video loops. The last sentence asks for the share: "Send this to someone who …", with one concrete person that fits the story ("… who still thinks robots can't dance."). One sentence; no "like and follow", no question after it.
- No "Remember the …?" to open, no "In this video".

Check every claim against `brief.md` before the voice is made: a spoken line costs money, a wrong one more.
