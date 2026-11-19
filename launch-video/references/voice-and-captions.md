# The voice and its captions in a launch video

A launch film gets a voice only when the person asked for one or the storyline is narrated. `<skill>` is the launch-video skill's folder; `<name>` the film's slug.

## The script

Write the lines into `launch/<name>/script.json`:

```json
{"voice": "sarah", "lines": [{"id": "hook", "text": "…"}, …]}
```

One line per beat, in the person's language, the product's name as they write it.

## Choosing the voice

- `node <skill>/tools/launch.mjs voices` lists the speech models with their price and voices. Default: ElevenLabs v3, voice "sarah". Gemini TTS and others take `"instructions"` for the delivery.
- When the voice matters to them, `node <skill>/tools/launch.mjs sample launch/<name> --text "<the hook>" --voices a,b,c --out uploads/voices-<name>` lets them choose by ear: show an `[:audio]` each.

## Speaking it

```bash
node <skill>/tools/launch.mjs voice launch/<name> launch/<name>/script.json artifacts/<name>/composition
```

speaks every line into `assets/voice/<id>.mp3` and writes each word's time into `launch/<name>/voice.json`. The voice is the film's clock: each beat starts on the word that says it. A line said wrong: change its text and run it again; only that line is spoken again.

The voice's lines are `<audio>` elements in the root `index.html`, each with an `id`.

## A voice the person recorded

A narration the person read themselves, cut by agentitos' best-takes (its voice alone: `takes/<take>/voice.cut.m4a` with every kept word's time in `takes/<take>/edit.json`), is the film's voice instead of a script spoken by a model: no `script.json`, no `voice`.

```bash
node <skill>/tools/launch.mjs narration launch/<name> takes/<take>/voice.cut.m4a takes/<take>/edit.json artifacts/<name>/composition
```

copies the voice into `assets/voice/narration.m4a` (without the file's tags) and writes it into `launch/<name>/voice.json` as one line with every word's time, so that `words`, `captions`, `music`, `level` and `check` take it as they take a spoken line. Place it at the film's start as the line it prints says; every beat starts on the word that says it. A new cut of the narration: `narration` again, then move the beats to the new times.

## Captions

When there is a voice (most watch muted):

```bash
node <skill>/tools/launch.mjs captions launch/<name> artifacts/<name>/composition --style <hormozi|bold|karaoke|wipe|clean|…> [--mark --product "<name>"]
```

puts the voice's words, timed where the root plays them, into `composition/captions/` by agentitos' captions skill, placed for the platforms. Mount the line it prints once, as the root's last child. After moving a line of the voice, run it again: the key words marked before stay marked while the words are the same; `--mark` marks anew.

Where the picture already carries the words being said (the hook's title, a model's name on screen, the call to action), the captions pause: `--pause <from>-<to>,…` in seconds of the film, read off `launch/<name>/words.json`, leaves out every word said in those stretches; the stretches are kept for the next run, `--pause none` takes them out.
