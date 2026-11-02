# kinetic-lyrics: building from a word-timed transcript

`tools/build.mjs` takes any word-timed transcript directly, with presets:

- `lyric`: music, big gestures, 16:9
- `podcast`
- `social`: 9:16, hook card, CTA

```bash
node <skill>/tools/build.mjs transcript.json --audio voice.wav --preset lyric|podcast|social [--world …] --out <project>
```

`--platform reels,tiktok` keeps the type clear of what those apps lay over the video (agentitos' platform-zones, which must be beside this skill; without `--platform`: the usual platforms of the frame).

Check any built project with `node <skill>/tools/qa.mjs <project>`.
