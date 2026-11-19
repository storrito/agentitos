# captions: the styles, and which fits which video

`node <skill>/tools/captions.mjs styles` lists them; `<skill>/references/styles.jpg` shows each on the same frame.

| style | what the person sees | words at once | the word being said | key words |
| --- | --- | --- | --- | --- |
| `hormozi` Hormozi | big capitals, white with a black outline | 1–3 | turns yellow and grows | green |
| `outline` Outline | heavy sentence case, white with a thick black outline | 1–3 | nothing | yellow |
| `impact` Impact | tall narrow capitals with a dark edge | 2–3 | nothing | the whole caption that holds one stands in lime |
| `single` One word | one big heavy word, punching in; a word too short to be read comes with the one beside it ("für die") | 1 | it is the only one | yellow |
| `bold` Bold words | bold sentence case, white, soft shadow, nothing behind | 2–3 | nothing | yellow |
| `karaoke` Karaoke pill | bold sentence case, white | 3–4 | sits on a violet pill | yellow |
| `fill` Karaoke fill | bold sentence case on two lines, waiting words dim | 4–5 | lights up yellow, stays white once said | stay yellow |
| `wipe` Wipe | capitals, each word wiped in as it is said | up to 4 | wiped in, then dims | gold |
| `label` Label | each line on a white box of its own, waiting words grey | 4–5 | turns black | blue |
| `editorial` Editorial | quiet sans, sentence case, soft shadow | 3–5 | nothing | in a larger serif italic, cream |
| `subtitle` Plain subtitles | whole phrases, white with a thin dark edge, no box | up to 8, two lines | nothing | yellow |
| `clean` Clean subtitles | whole phrases on a soft dark box | up to 9, two lines | nothing | yellow |

## Which fits

What published Shorts carry: 198 with captions, found by search and classed by look on 2026-11-17 (the kind of video as a model read it from the frames; 24 of another kind are only in "all"). Each look is counted under the style that makes it.

| style | all | talking head | podcast or interview clip | screen with a face | narrated, nobody in the picture |
| --- | --- | --- | --- | --- | --- |
| `bold` | 49 | 7 | 21 | 3 | 12 |
| `clean` | 44 | 10 | 5 | 13 | 9 |
| `subtitle` | 28 | 9 | 5 | 0 | 9 |
| `impact` | 19 | 2 | 15 | 0 | 0 |
| `label` | 12 | 5 | 3 | 0 | 4 |
| `outline` | 11 | 1 | 2 | 4 | 3 |
| `hormozi` | 10 | 3 | 4 | 0 | 3 |
| `editorial` | 10 | 6 | 2 | 0 | 0 |
| `karaoke` | 8 | 2 | 0 | 3 | 2 |
| `fill` | 6 | 1 | 0 | 4 | 1 |
| `wipe` | 1 | 0 | 1 | 0 | 0 |

`single` is counted inside the others: 17 of the 198 show one word at a time.

So, when you say which styles fit (never as a recommendation of one):

- **Podcast or interview clip:** `bold` and `impact` are what such clips carry; `hormozi` when it should be loud.
- **Talking head:** `clean`, `subtitle` and `bold` for calm ones, `editorial` for advice and essays, `label` for the look of the apps' own text, `hormozi` or `single` for a hook.
- **Screen with a face (tutorial, demo):** `clean` first; `fill`, `karaoke` and `outline` stand on a busy screen. `bold`, `subtitle` and `editorial` have nothing behind the words and get lost on a bright screen.
- **Narrated, nobody in the picture (maps, stock footage, slides):** `bold`, `clean`, `subtitle`, `outline`.
- Seven in ten of the 198 have no emphasis at all, one in ten a word that follows the voice (`hormozi`, `karaoke`, `fill`, `label`, `wipe`), one in twelve coloured key words: a style that lights up every word is a choice for energy, not the rule.
- `--follow` lights the word being said in the styles that do not (`clean`, `label`, `bold`, `subtitle`, `editorial`, `outline`, `impact`): the words wait at half their colour (`label`: its grey), the one being said takes the key colour (the brand's where it reads), said words stand in the text's colour. Made for narrated explainers (2026-11-19): `label --follow` on a light ground, `clean --follow` on a dark or busy one.
- `--edge` gives a style's box an edge of the other lightness: on a near-white ground `label`'s white boxes vanish (the words read, the box does not), with `--edge` each line's box has a dark ring and a soft shadow; `clean`'s dark box gets a light ring for a dark ground. For a narrated explainer on a light ground: `label --follow --edge`.
- 122 are in sentence case, 45 in capitals, 23 all lowercase: only `hormozi`, `impact` and `wipe` set capitals.

## Near each other

No two styles are the same look; these are the nearest, when the person hesitates between them:

- `hormozi` and `outline`: the same heavy outlined type. `hormozi` shouts in capitals and lights up the word being said; `outline` is in sentence case and nothing moves but the caption coming in.
- `karaoke` and `fill`: both follow the voice word by word. `karaoke` puts a pill behind the word being said; `fill` lets the line fill from dim to bright.
- `clean` and `subtitle`: both whole phrases. `clean` stands on a soft dark box, `subtitle` has a thin dark edge and nothing behind it.
- `outline` and `single`: both heavy. `outline` shows two or three words, `single` one.

## A brand kit

`--brand brand/DESIGN.md` gives the captions the brand's display font (`impact` keeps its own narrow one, `editorial` its serif italic for the key words) and puts the brand's primary colour where the style shows a colour:

- the word being said: `hormozi`, `karaoke`, `wipe`, `clean` (as ever; `wipe` and `clean` show none), and `fill`, where the key words take it too;
- the key words: `bold`, `outline`, `single`, `editorial`, `subtitle`, `label`; in `impact` the captions that stand in colour.

A primary that would not be read as a key word (a dark blue on a picture, a yellow on `label`'s white boxes; in `fill` the word being said then keeps the style's colour too) is left out and the tool says so in a line: tell the person their colour was too dark (or too light) for this style and name a style that carries it (`karaoke` sets any colour as a pill behind white words, `label` takes dark colours).

## Cards

A card (`box`) is a dark box with a border in the style's key colour, its words as the style sets them; in `label` it is white like the lines' boxes, with the blue border.
