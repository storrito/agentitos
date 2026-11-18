# clips: where the text goes

`clips.mjs place work/<k>` hands every face of every shot, ten times a second, to agentitos' layout (`place.mjs text`) and takes what it gives back. Read this before you change what it chose.

## What the tool decides, and why

- **One place for the captions in the whole clip.** Captions that move at every cut make the eye hunt for them; in 240 published Shorts the captions keep one place within a video, their middle at 60–75 % of the frame's height, below the chin in 88 % of the frames with a face, one line of about three words in 77 %, the type 4 % of the frame's height (77 px in 1920). That is what is usual, not what is shown to work. The tool tries every height of the safe box at that type and at 90 % and 80 % of it, and takes the one that leaves the least on a face.
- **A shot whose chin would reach into the captions is raised.** Its window goes lower in the footage where the footage reaches further down, else the picture goes up over a band of its own blurred, darker copy at the bottom. That band lies under the apps' bars (the username, the caption, the sound), where nothing is read; the top of the head goes over the frame's top or under the apps' top bar, as an editor's close-up cuts it. A shot is raised once for its whole length, by its lowest moment: a picture that rose and sank with every nod would read as a shaky camera.
- **How far at most:** until the eyes would reach the safe box's top (under the apps' top bar), and never so far that the band at the bottom reaches into the safe box. A shot shown whole or as two panels is never raised.
- **The hook** goes where it clears every face over all of its seconds, beside the captions: a short text in two lines below the chin (where published Shorts put it, in the middle of the frame), else above the head, else a card at the top. When the first shot changes within its time to one that leaves it no place, it ends at that cut (from 1.2 s on).
- **best-takes' punch-ins** (12 % closer at a jump cut) grow from below where they used to, so that a chin that clears the captions still clears them closer in.

## What it proposes, and what is left

- A `✗` line per shot where the captions still lie on a face: how long, how deep into the face (up from the chin), why (how much higher it would have to stand than it may) and what would avoid it.
- A `note:` where a shot would keep its captions off a face with a place of its own, saving more than two seconds on the face. It is not taken: a change of place costs the reading the one place gives. Tell the person when it is a long shot and they care.
- **Tight close-ups** (a face a good half of the frame tall and more, the chin at 70–90 % of the height, as a talk show's guest close-ups are) have no room below the chin inside what the apps leave free. They are raised as far as the eyes allow; what remains lies on the neck and the chin's edge, seldom higher, for a second or two a shot. The channels' own editors put their captions on mouth and chin there in half of the frames. To avoid it fully: a cut to another shot, or that shot smaller over a ground (not built).

## When to change it

- The person says the face sits too high, or a shot's head is cut too much: `--lift <second>:<px>` with fewer px for that shot (0: as framed), and accept what the list then says lies on the face.
- The person wants the captions higher (the usual middle of the frame) or smaller: `--caption-y <px>` (where the lowest line ends) or `--font-size <px>`; the tool raises the shots around it. Never below the safe box's bottom: there the apps lay their own text.
- The person wants the hook as a card (a reply, a part of a series): `--hook card`.
- The boxes of the faces come from a model on stills, followed in the frames: on a profile or a turned head they can be off by a tenth of the face. A `✗` or a raise that looks wrong on the sheet: look at the frame, and change the lift by hand.
