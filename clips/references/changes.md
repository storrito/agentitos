# clips: changes the person asks for

`<k>` is the clip's number (`01`, `02`, …), `<takes>` the best-takes path that `clips.mjs prepare` printed. After a change, the clip's preview in `artifacts/clips/` shows the new version.

| They say | You do |
| --- | --- |
| "Start later / end earlier" | move the keep's ends in `work/<k>/takes/cut.json`, then `node <takes> build work/<k>/takes` |
| "The pauses are too tight" | `build … --pause 0.7` (still tight, only pauses over 0.7 s go) |
| "No zooming" | `build … --punch off` |
| "Another hook" / "no hook" | `build … --hook "…"` / `--hook ""` |
| "Another caption style" | `node <takes> captions work/<k>/takes --style …` |
| "The photo / the scene / the other person is cut off" | `node <skill>/tools/clips.mjs reframe work/<k> --whole <second>`, then build |
| "The wrong person is in the picture" | look at `work/<k>/framed.json` (the windows) and the clip; say what you saw. To frame again (the edit in `cut.json` starts over, the cut clip stays): `rm -r work/<k>/takes work/<k>/framed.mp4 work/<k>/clip.people.json`, then the same `prepare` |
| "Longer" | a new moment with more sentences: `prepare` with the wider range into a new folder |
