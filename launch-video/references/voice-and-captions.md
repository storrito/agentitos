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

A narration the person read themselves is the film's voice instead of a script spoken by a model: no `script.json`, no `voice`. Cut by agentitos' best-takes, it is its voice alone, `takes/<take>/voice.cut.m4a` with every kept word's time in `takes/<take>/edit.json`. A recording taken as it came gets its words from agentitos' transcribe first (`node <skill>/../transcribe/tools/transcribe.mjs uploads/<file> --out launch/<name>/narration.words.json`).

```bash
node <skill>/tools/launch.mjs narration launch/<name> takes/<take>/voice.cut.m4a takes/<take>/edit.json artifacts/<name>/composition
node <skill>/tools/launch.mjs narration launch/<name> uploads/<file> launch/<name>/narration.words.json artifacts/<name>/composition
```

puts the voice into `assets/voice/narration.m4a` (without the file's tags) and writes it into `launch/<name>/voice.json` as one line with every word's time, so that `words`, `captions`, `music`, `level` and `check` take it as they take a spoken line. Place it at the film's start as the line it prints says; every beat starts on the word that says it. A new cut of the narration: `narration` again, then move the beats to the new times.

**Its sound.** Best-takes' cut keeps the sound best-takes gave it. A recording that is no cut gets its sound from agentitos' voice-sound first, the whole recording, as one channel at the platforms' loudness: about a tenth of its length, so a recording over a quarter of an hour runs in the background with a log (`nohup … > logs/<name>-narration.log 2>&1 &`, its end read every minute); the same recording again keeps what it made. Its line says what voice-sound did and what it left: pass on what it left in a sentence (a room, noise that changes, a knock that stays), and never say that was mended; a line about the neural denoiser failing is passed on as it says. A refusal (no voice found in it, a voice recorded far too quietly) is one sentence: pass it on in their words and ask for the recording they meant.

**Footage with its own sound** (a clip that is the proof: a recording, a demo with its sound) plays where the voice stops, never under it: `--gap <s>+<len>,…` (seconds of the voice, after the last word that ends by then, and the footage's length) prints the voice as several `<audio>` of the same file (`data-media-start`, `data-duration`) and each footage's `data-start` in the gap between them, a quarter second clear of the voice on both sides. The footage is a `<video data-has-audio="true">` (or a muted `<video>` and its `<audio>`); `words` and `captions` then show nothing while it plays, and `level` takes the music out under it, with no swell beside it. A still of the footage's first frame before it (annotated as the voice explains it) lets it start where the picture already is.

## Captions

When there is a voice (most watch muted):

```bash
node <skill>/tools/launch.mjs captions launch/<name> artifacts/<name>/composition --style <hormozi|bold|karaoke|wipe|clean|…> [--mark --product "<name>"]
```

puts the voice's words, timed where the root plays them, into `composition/captions/` by agentitos' captions skill, placed for the platforms. `--follow` lights the word being said in a style whose words otherwise stay as they are (in the brand's primary where it reads): for a narrated explainer on a light ground `--style label --follow --edge` (dark words on their own light boxes, waiting in grey, the word being said in the brand's colour; `--edge` rings each box, which without it vanishes on a near-white ground), on a dark or busy picture `--style clean --follow`. Mount the line it prints once, as the root's last child. After moving a line of the voice, run it again: the key words marked before stay marked while the words are the same; `--mark` marks anew.

Where the picture already carries the words being said (the hook's title, a model's name on screen, the call to action), the captions pause: `--pause <from>-<to>,…` in seconds of the film, read off `launch/<name>/words.json`, leaves out every word said in those stretches; the stretches are kept for the next run, `--pause none` takes them out.
