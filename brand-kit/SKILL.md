---
name: brand-kit
description: Build a brand kit from a company's website, agreed with the person in the chat (logo, colours, fonts, voice, audience, social profiles), written as a DESIGN.md (Google's open format, which HyperFrames and other design tools read) with the logo and font files beside it, and shown as a brand board. Every story, reel or video an agent makes for the brand then takes its look and voice from it. Use when someone wants their brand set up, their brand guidelines written down, or a consistent look for their social media.
license: MIT
metadata:
  title: "Brand kit"
  title-de: "Brand-Kit"
  summary: "Your brand from your website: logo, colours, fonts and voice, agreed here and kept as a kit for every story."
  summary-de: "Deine Marke aus deiner Website: Logo, Farben, Schriften und Tonalität, hier abgestimmt und als Kit für jede Story gespeichert."
  ask: "Paste the address of your website. I read your logo, colours, fonts and the way you write, we agree on them here one by one, and you get your brand kit."
  ask-de: "Füge die Adresse deiner Website ein. Ich lese dein Logo, deine Farben, Schriften und deine Art zu schreiben, wir stimmen sie hier nacheinander ab, und du bekommst dein Brand-Kit."
  placeholder: "Paste your website's address"
  placeholder-de: "Adresse deiner Website einfügen"
  inputs: "image"
---

# brand-kit

`<skill>` below is the folder this file is in. Run the tools as `node <skill>/tools/…` from your own working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

## Setup (once per machine)

```bash
cd <skill> && npm install
```

It needs Node 20+ and Chrome (`CHROME`, or `google-chrome`/`chromium` on the PATH), and the network. When something is missing, say so in one sentence instead of installing it yourself.

## The main use: a brand kit from a website, all in the chat

The person pastes their website. You read it, draft the kit, agree on it with them one thing at a time, then show the brand board. The kit is the folder `brand/` of your working directory: `brand/DESIGN.md` and the files it names. It stays: whatever this agent makes later takes its look and voice from it. Keep every message short: one or two sentences and a hiccup block (see "UI in the chat"). Speak the person's language. Decide small things yourself and say what you decided.

Your files: `work/site/` for what the site shows; `brand/` for the kit; the board `artifacts/brand-board.html` is the only artifact; pictures for the chat go to `uploads/brand/`.

### 1. The website

Say in one sentence that you are reading their website (half a minute). Then

```bash
node <skill>/tools/site.mjs <url> work/site
node <skill>/tools/kit.mjs draft work/site brand
```

The first reads the start page and the about page: the logo candidates, the colours by where the site uses them, the fonts and where their files come from, the social profiles, the site's own words (`work/site/words.txt`) and how it looks on a desktop and a phone (`home.png`, `mobile.png`; look at them). The second writes the first `brand/DESIGN.md`; what needs the person is marked "To agree with the person".

### 2. Agree, one thing per message

Each message holds one question with your proposal, buttons for the likely answers, and "Take your suggestions for the rest" (they may want it quick: then decide the rest yourself, say what you decided, and go to step 3). Write every answer into `brand/DESIGN.md` at once: its front matter for the tokens, the section of the same name for the prose, replacing the "To agree" line.

1. **The logo.** `node <skill>/tools/kit.mjs logos work/site` prints tiles of the candidates. Their pick: copy its file to `brand/` (`brand/logo.svg`, `.png` …) and set `logo.primary` to it. None fits, or none was found: they attach theirs (best a PNG with a transparent ground, or an SVG). A logo that only works on light grounds may get a light version for dark ones, `logo.on-dark`; without one, the stories show a one-coloured logo in white and any other on a white chip.
2. **The colours.** `node <skill>/tools/kit.mjs show brand` prints the colours as swatches. The site's other candidates are in `work/site/site.json` (`look.ranked`): offer them as swatches too. `primary` is the brand colour (covers, calls to action), `secondary` and `tertiary` the accents, `surface` the light ground, `on-surface` the text on it, `on-primary` the text on the brand colour. Write hex values in quotes (`primary: "#E20000"`).
3. **The fonts.** `node <skill>/tools/kit.mjs fonts brand` makes a picture of them for the chat. A font from the site's own files is the brand's web font: say so, and offer the closest Google font beside it (`--try "Jost"`), since a Google font works everywhere. Their pick: `typography` names the family exactly as Google Fonts spells it, `fonts` says where it comes from (`Jost: google`).
4. **The voice.** Read `work/site/words.txt` and propose how the brand speaks: three adjectives; for German whether it says du or Sie (and whether Du is capitalized); emoji or not; short or long sentences; and a table "We say / We never say" of two to four rows, the "We say" side in the site's own words. Ask whether it sounds like them.
5. **The audience and the pictures.** Who the brand talks to and what they care about; what its pictures show and how (from the site's pictures and words). Two sentences each, in one message.
6. **Social.** The profiles the site links (in the front matter under `social`), the brand's own hashtag if it has one, and the calls to action it likes (the site's buttons are in `words.txt`). Then the do's and don'ts: two or three of each, from what they told you.

### 3. The board

```bash
node <skill>/tools/kit.mjs check brand
node <skill>/tools/kit.mjs board brand --lang de
```

`check` lists what is wrong (✗: fix it) or still open (⚠), with the DESIGN.md format's own linter. `board` puts the brand board beside the chat (logo on light, brand and dark grounds, the colours with their contrast, the type, three story frames in the brand's look, the voice) and a picture of it into `uploads/brand/`; `--lang` is `de` or `en`. Show the picture in the chat and ask whether the kit is right. A change: edit `brand/DESIGN.md`, `check`, `board` again.

### 4. Done

Say in two sentences where the kit is (`brand/DESIGN.md`) and what uses it: every story, reel or video this agent makes from now on, and any tool that reads DESIGN.md (HyperFrames takes it as its design spec). When the skill `story-from-link` is beside this one (`<skill>/../story-from-link/SKILL.md`), offer to make the first story from a link right away: when they want it, read that SKILL.md and follow it from its first step; `brand/` is already there.

## DESIGN.md

The front matter holds the tokens, the body the prose, in these sections and this order: Overview, Colors, Typography, Shapes, Logo, Imagery, Voice and Tone, Audience, Social, Do's and Don'ts. Beside the format's own keys (`version`, `name`, `description`, `colors`, `typography`, `rounded`) a kit has `logo` (`primary`, `on-dark`: files beside DESIGN.md), `fonts` (`<family>: google`, or a list of `{file, weight}`), `uppercase` (the typography tokens set in capitals) and `social` (`instagram: handle`, `website: url` …). Typography tokens: `headline-display` (big titles), `headline-lg`, `body-md` (text), `label-md` (labels and buttons), each with `fontFamily`, `fontWeight`, and when it matters `lineHeight` and `letterSpacing` (`-0.02em`).

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/brand-board.html"` shows the board. Links and pictures point at `https://…`, `artifacts/…` or `uploads/…`. An `input` is a checkbox or a radio button; `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block. There are no text fields: for a name or a colour they type.

- One question per block, buttons for the likely answers, and a hint that they can type anything else (a colour as `#RRGGBB`, a font by its name).
- The button that moves on gets `:class "primary"`; buttons that are alternative answers stay plain.
- A swatch is a `button` with `:style {:background "#E20000" :width "44px" :height "44px" :border-radius "50%"}`; tiles for a choice of logos as `kit.mjs logos` prints them. Text stays on the page's ground, never on a colour.
- Never put a token, an id the person does not need or a raw error into the chat.

The voice:

```hiccup
[:div
 [:p "So klingt ihr, wie ich eure Website lese: " [:strong "frech, warm, direkt"] ". Ihr duzt und schreibt Du groß, kurze Sätze, wenige Emojis."]
 [:table
  [:thead [:tr [:th "Wir sagen"] [:th "Wir sagen nie"]]]
  [:tbody [:tr [:td "Mix Dir Dein Lieblingsmüsli"] [:td "Jetzt kaufen!"]]
          [:tr [:td "Frühstücken verbindet"] [:td "Sie / Ihnen"]]]]
 [:button {:class "primary" :send "Das sind wir"} "Das sind wir"] " "
 [:button {:send "Die Stimme passt noch nicht"} "Etwas ändern"] " "
 [:button {:send "Nimm deine Vorschläge für den Rest"} "Rest vorschlagen"]]
```

## Rules

- Only what the site and the person say: no invented founding year, award or claim in the prose.
- The logo is the brand's own: never redraw, recolour or stretch it.
- A font from the site's own files is the brand's web font; whether its licence covers pictures is the brand's to know: when they are unsure, take the closest Google font.
- Change `brand/DESIGN.md` and run `check` and `board` again; never edit the board by hand.
