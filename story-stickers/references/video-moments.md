# A video's pixels under the sticker band

How to check that a video's band of stickers stays free at every moment: subtitles burned in, a face, a picture-in-picture, the product. Needed for every video the person brings (nobody planned it around the band), and for a film you made only when footage you do not know frame by frame runs under the band (a stock clip with people or text in it).

The band is the flexbox of `stickers/<name>/layer.html`: `left`, `top`, `right`, `bottom` in px of the 1080×1920 frame. Pictures you make to look at go to `uploads/`, never into the HyperFrames project.

```bash
# the moments: 2 a second, the ones that look alike left out, the band and the safe zone drawn, 30 to a sheet
ffmpeg -v error -y -i <video> -vf "fps=2,mpdecimate=hi=64*12:lo=64*5:frac=0.33,drawbox=x=<left>:y=<top>:w=<1080-left-right>:h=<1920-top-bottom>:color=red@0.9:t=8,drawbox=x=60:y=250:w=960:h=1370:color=yellow@0.8:t=3,scale=180:-1,tile=6x5" -vsync vfr uploads/<name>-moments-%d.jpg
# the occupancy map: everything that ever showed up, one picture (busy footage like water lights up everywhere: then trust the moments)
ffmpeg -v error -y -i <video> -vf "fps=5,scale=540:-1,format=gray,edgedetect=low=0.2:high=0.5,lagfun=decay=1,drawbox=x=<left/2>:y=<top/2>:w=<(1080-left-right)/2>:h=<(1920-top-bottom)/2>:color=white@1:t=2" -update 1 uploads/<name>-map.png
```

Start with the map: it shows in one picture where text and insets ever were (light); a band on dark is free. When it shows no clear free band (busy footage lights up everywhere, or the video is full), decide from the moments yourself: each tile is a moment that differs from the one before, so a subtitle that stands half a second is there. Choose the band that covers least of what matters (text, faces, the product) in all of them, and check it on every sheet: nothing that matters in the red band in any tile.

## When no band is free

Say so and offer what is possible:

- A film you made yourself comes first: offer to move its text and elements out of a band and render it again. It changes the film the person agreed to, so ask.
- Else the stickers smaller (`transform:scale(0.85)`, not below 0.75), fewer of them, the video made smaller with a free strip, or a sticker over something the person accepts.
