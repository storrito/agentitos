# brand-kit

Builds a **brand kit** from a company's website, agreed with the person in a chat: the logo, the colours, the fonts, the voice, the audience and the social profiles, written as a [DESIGN.md](https://github.com/google-labs-code/design.md) with the logo and font files beside it, and shown as a brand board. Agents that make stories, reels or videos for the brand take their look and voice from it.

> Agents: start with [`SKILL.md`](SKILL.md).

```bash
npm install
node tools/site.mjs https://www.example.com work/site   # logo candidates, colours, fonts, words, screenshots
node tools/kit.mjs draft work/site brand                 # the first brand/DESIGN.md
node tools/kit.mjs logos work/site                       # the logo candidates as tiles for a chat
node tools/kit.mjs fonts brand --try "Jost"              # a picture of the fonts, a Google font beside them
node tools/kit.mjs check brand                           # what is wrong or still open, with the format's linter
node tools/kit.mjs board brand --lang de                 # the brand board: artifacts/brand-board.html + a picture
```

Requirements: Node 20+, Chrome (`CHROME`, or `google-chrome` / `chromium` on the PATH), network access to the site and Google Fonts.

## How it works

- **`site.mjs`** opens the site in headless Chrome, accepts the cookie banner, and reads the start page and, when the menu has one, the about page:
  - the **logo candidates**, scored like [dembrandt](https://github.com/dembrandt/dembrandt) does it (in the header, linked home, named "logo", partner and payment rows left out); inline SVGs are kept as SVG files with their painted colours, `<use>` references resolved; besides the page's own candidates the biggest touch icon and the logo of the structured data;
  - the **colours**, weighted by where the site uses them: the logo's pixels, buttons, links, headings, large areas and gradients; colours that look alike (CIE76 under 12) are grouped. The brand colours are the chromatic ones that score highest; the ground is the most used light background, the ink the dark text colour with at least 7:1 on it. A brand without a colour of its own (black on white) gets its ink as primary;
  - the **fonts** by role: the display font is the one most large text is set in, the body font the one most running text is set in (small print, footers and cookie banners left out), the label font the buttons'. For each family it checks whether Google Fonts has it, else takes the site's own `@font-face` files;
  - the **words**: big type, lead paragraphs, buttons, the menu and the about page (`words.txt`), for the voice;
  - the **social profiles** the site links, and screenshots on a desktop and a phone.
- **`kit.mjs draft`** writes `DESIGN.md`: the tokens in the front matter, the prose sections with what the site shows, and the sections that need the person (Overview, Imagery, Voice and Tone, Audience, Do's and Don'ts) marked "To agree with the person", which `check` reports until they are written.
- **`kit.mjs check`** reads the kit as the frames of [story-from-link](../story-from-link/) do (colours, fonts and their sources, logo files, the contrast of the text colours) and runs the format's own linter, `@google/design.md lint` (Apache-2.0).
- **`kit.mjs board`** renders the brand board as a page beside the chat and as a picture: the logo on light, brand and dark grounds, every colour with its contrast, the type, three story frames in the brand's look, the voice, the audience, the imagery, the do's and don'ts, the social profiles.

## The kit

```
brand/DESIGN.md        the kit: tokens in the front matter, prose below
brand/logo.svg         the logo (and logo-white.svg … when there is one for dark grounds)
brand/fonts/*.woff2    the site's own font files, when a family is not on Google Fonts
```

The format is Google's [DESIGN.md](https://github.com/google-labs-code/design.md) (alpha). Its sections in their order, ours before the last: Overview, Colors, Typography, Shapes, Logo, Imagery, Voice and Tone, Audience, Social, Do's and Don'ts. On top of its tokens a kit uses four keys of its own, which the format allows (its linter passes them):

```yaml
logo: {primary: logo.svg, on-dark: logo-white.svg}
fonts:
  Jost: google
  Adobe Futura Std: [{file: fonts/adobe-futura-std-700.woff2, weight: 700}]
uppercase: [label-md]      # the typography tokens set in capitals
social: {instagram: mymuesli, tiktok: mymuesli, website: https://www.mymuesli.com}
```

Any agent of this collection that makes something in a brand's look reads `brand/DESIGN.md` of its working directory. [HyperFrames](https://hyperframes.heygen.com/) takes a `DESIGN.md` beside a composition as its design spec. The voice sections borrow their names from [BRAND.md](https://thebrand.md) and the "product marketing context" of [marketingskills](https://github.com/coreyhaines31/marketingskills).

## Limits

- A site behind a login or a bot wall cannot be read: the person attaches their logo and names their colours and fonts instead.
- Fonts from a site's own files are its web fonts; whether their licence covers pictures and videos is the brand's to know. A Google font always works.
- A kit lives in the working directory of the agent that made it; another agent on another machine has its own.
