# captions: as the captions step of another skill

A skill that has its own timed words (best-takes has the cut's words, timed in the cut) calls the tool without transcribing:

1. It writes a words file: `{"width", "height", "duration", "words": [{"text", "start", "end", "highlight"}]}`.
2. It runs `node <skill>/tools/captions.mjs mark <words.json>` on it if it wants key words.
3. It runs `node <skill>/tools/captions.mjs build <words.json> <composition>/captions --style <style> [--platform <where it goes>]`.
4. It puts the clip the tool prints into its host composition.

The words must be timed in the video the captions go on, after every cut.
