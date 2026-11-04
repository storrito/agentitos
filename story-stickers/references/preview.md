# The HyperFrames preview of a Story with stickers

The person sees the Story in a HyperFrames preview with Storrito's real stickers. The project is made first, in rragent with the `project` tool (`{"action": "create", "name": "<name>", "kind": "hyperframes"}`); its files go into `artifacts/<name>/composition/`. The preview is never rendered: it only shows.

No `<insta-story>` in the preview, neither in the scene nor in `index.html`: the stickers render on their own (each its own canvas), and `<insta-story>` paints a black 1080×1920 box in its shadow DOM that `background:transparent` does not remove, so everything under it disappears. `<insta-story>` belongs only in the HTML Storrito gets (`story-htmls`, step 2). Never read or grep `insta-components.js`: the table in SKILL.md and Storrito's reference say everything a sticker takes.

Write `compositions/story-stickers.html` into the project (`artifacts/<name>/composition/`), with the lines of `stickers/<name>/layer.html` inside:

```html
<template>
  <style>
    #story-stickers { position: absolute; inset: 0; pointer-events: none; }
  </style>
  <div id="story-stickers" data-composition-id="story-stickers" data-width="1080" data-height="1920" data-layout-allow-overlap>
    <!-- the lines of stickers/<name>/layer.html -->
  </div>
  <script>
    (function () {
      if (!window.customElements.get("insta-story") && !document.querySelector("script[data-story-stickers]")) {
        var s = document.createElement("script");
        s.src = "https://c1.storrito.com/js/insta-components.js";
        s.setAttribute("data-story-stickers", "");
        document.head.appendChild(s);
      }
      window.__timelines["story-stickers"] = gsap.timeline({ paused: true });
    })();
  </script>
</template>
```

and an `index.html` with what goes under the stickers, the scene mounted over it as the root's first child, marked `data-preview-only` (`<duration>`: a picture 5, a video its length from `ffprobe -v error -show_entries format=duration -of csv=p=0 <video>`):

```html
<!doctype html>
<html>
  <head><meta charset="utf-8"><script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
  <script src="https://c1.storrito.com/js/insta-components.js"></script>
  <style>html, body { margin: 0; width: 1080px; height: 1920px; background: #000; overflow: hidden; }</style></head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="<duration>" data-width="1080" data-height="1920">
      <div id="story-stickers" data-preview-only data-composition-id="story-stickers" data-composition-src="compositions/story-stickers.html" data-start="0" data-duration="<duration>" data-track-index="99" data-track-kind="graphics" data-width="1080" data-height="1920" style="z-index:1000"></div>
      <!-- a picture: the elements inside its <insta-story> (step 2), without the <insta-story> and without the lines of layer.html, each with class="clip" data-start="0" data-duration="<duration>" and a z-index, the picture copied in as picture.jpg -->
      <!-- a video the person brings: -->
      <video id="story-video" class="clip" data-start="0" data-duration="<duration>" data-has-audio="true" src="video.mp4" style="position:absolute;left:0;top:0;width:1080px;height:1920px;object-fit:cover;z-index:1"></video>
    </div>
    <script>window.__timelines = window.__timelines || {}; window.__timelines["main"] = gsap.timeline({ paused: true });</script>
  </body>
</html>
```

The components' `<script>` in the head: the scene loads them itself only when they are missing, too late for a snapshot every few runs, which then shows no stickers. A snapshot shows the elements marked `data-preview-only`: never take the attribute out.

Several Stories: these two files per Story in `artifacts/<name>/composition/<NN>-<slug>/` (the paths in them stay relative to that folder, the snapshot runs there), a `<title>` naming the Story, and no `composition/index.html`.

`data-has-audio="true"` when the video has sound, else `muted`. A film you are making is its own project: mount the scene into it at the start, the components' `<script>` in its head, so that you design around the stickers. After a change of `layer.html`, copy its lines into the scene again. rragent's `render` leaves elements marked `data-preview-only` out of a film's video; the HyperFrames CLI or Studio does not: there take the host out before the render.
