# The kit's DESIGN.md

`brand/DESIGN.md` follows Google's open DESIGN.md format: the front matter holds the tokens, the body the prose.

## Body sections, in this order

Overview, Colors, Typography, Shapes, Logo, Imagery, Voice and Tone, Audience, Social, Do's and Don'ts. An answer of the person replaces the section's "To agree with the person" line.

## Front matter keys

The format's own keys: `version`, `name`, `description`, `colors`, `typography`, `rounded`. A kit adds:

- `logo`: `primary`, `on-dark`: files beside DESIGN.md.
- `fonts`: `<family>: google`, or a list of `{file, weight}`.
- `uppercase`: the typography tokens set in capitals.
- `social`: `instagram: handle`, `website: url` …

Colors: `primary` (the brand colour: covers, calls to action), `secondary` and `tertiary` (the accents), `surface` (the light ground), `on-surface` (the text on it), `on-primary` (the text on the brand colour). Hex values in quotes: `primary: "#E20000"`.

Typography tokens: `headline-display` (big titles), `headline-lg`, `body-md` (text), `label-md` (labels and buttons), each with `fontFamily`, `fontWeight`, and when it matters `lineHeight` and `letterSpacing` (`-0.02em`). `fontFamily` names the family exactly as Google Fonts spells it.
