---
name: brand-kit
description: Build a brand kit (logo, colours, fonts, voice, audience, social profiles) from a company's website, agreed in the chat, saved as DESIGN.md with a brand board, for a consistent brand look.
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

`<skill>` is this file's folder. Run the tools as `node <skill>/tools/…` from your own working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

## Setup (once per machine)

```bash
cd <skill> && npm install
```

Needs Node 20+, Chrome (`CHROME`, or `google-chrome`/`chromium` on the PATH) and the network. Something missing: say so in one sentence, never install it yourself.

## The main use: a brand kit from a website, all in the chat

The person pastes their website. Read it, draft the kit, agree on it one thing at a time, then show the brand board. The kit is `brand/` in your working directory: `brand/DESIGN.md` and the files it names. It stays: whatever this agent makes later takes its look and voice from it. Every message: one or two sentences in the person's language and a hiccup block (see "UI in the chat"). Decide small things yourself and say what you decided.

Files: `work/site/` for what the site shows, `brand/` for the kit; the only artifact is the board `artifacts/brand-board.html`; pictures for the chat go to `uploads/brand/`.

### 1. The website

Say in one sentence that you are reading their website (half a minute). Then

```bash
node <skill>/tools/site.mjs <url> work/site
node <skill>/tools/kit.mjs draft work/site brand
```

`site.mjs` reads the start and about pages into `work/site/`: logo candidates, colours, fonts and where their files come from, social profiles, the site's own words (`words.txt`) and screenshots on desktop and phone (`home.png`, `mobile.png`; look at them). `draft` writes the first `brand/DESIGN.md`; what needs the person is marked "To agree with the person".

### 2. Agree, one thing per message

Each message: one question with your proposal and its picture (logos, swatches, fonts, voice), buttons for the likely answers, and "Take your suggestions for the rest" (then decide the rest yourself, say what you decided, and go to step 3). Write every answer into `brand/DESIGN.md` at once: tokens in the front matter, prose in the section of the same name, replacing its "To agree" line. Read `<skill>/references/design-md.md` before the first edit of `brand/DESIGN.md`: its sections, keys and tokens.

1. **The logo.** `node <skill>/tools/kit.mjs logos work/site` prints tiles of the candidates. Their pick: copy its file to `brand/` (`brand/logo.svg`, `.png` …) and set `logo.primary` to it. None fits or none was found: they attach theirs (best a PNG with a transparent ground, or an SVG). A logo that only works on light grounds may get a light version for dark ones, `logo.on-dark`; without one, stories show a one-coloured logo in white and any other on a white chip.
2. **The colours.** `node <skill>/tools/kit.mjs show brand` prints the colours as swatches; offer the site's other candidates (`look.ranked` in `work/site/site.json`) as swatches too. `primary` is the brand colour (covers, calls to action), `secondary` and `tertiary` the accents, `surface` the light ground, `on-surface` the text on it, `on-primary` the text on the brand colour. Hex values in quotes (`primary: "#E20000"`).
3. **The fonts.** `node <skill>/tools/kit.mjs fonts brand` makes a picture of them for the chat. A font from the site's own files is the brand's web font: say so, and offer the closest Google font beside it (`--try "Jost"`), since a Google font works everywhere. Their pick: `typography` names the family exactly as Google Fonts spells it, `fonts` says where it comes from (`Jost: google`).
4. **The voice.** From `work/site/words.txt`, propose how the brand speaks: three adjectives; for German du or Sie (and whether Du is capitalized); emoji or not; short or long sentences; a table "We say / We never say" of two to four rows, the "We say" side in the site's own words. Ask whether it sounds like them.
5. **The audience and the pictures.** Who the brand talks to and what they care about; what its pictures show and how (from the site's pictures and words). Two sentences each, in one message.
6. **Social.** The profiles the site links (front matter `social`), the brand's own hashtag if it has one, the calls to action it likes (the site's buttons are in `words.txt`). Then two or three do's and don'ts each, from what they told you.

### 3. The board

```bash
node <skill>/tools/kit.mjs check brand
node <skill>/tools/kit.mjs board brand --lang de
```

`check` lists what is wrong (✗: fix it) or still open (⚠). `board` puts the brand board beside the chat and a picture of it into `uploads/brand/`; `--lang` is `de` or `en`. Show the picture and ask whether the kit is right. A change: edit `brand/DESIGN.md`, `check`, `board` again.

### 4. Done

Say in two sentences where the kit is (`brand/DESIGN.md`) and what uses it: every story, reel or video this agent makes from now on, and any tool that reads DESIGN.md (HyperFrames takes it as its design spec). When `story-from-link` is beside this skill (`<skill>/../story-from-link/SKILL.md`), offer to make the first story from a link right away; if they want it, read that SKILL.md and follow it from its first step (`brand/` is already there).

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/brand-board.html"` shows the board. Links and pictures point at `https://…`, `artifacts/…` or `uploads/…`. An `input` is a checkbox or a radio button; `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block. No text fields: they type a name or a colour.

- One question per block: buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else (a colour as `#RRGGBB`, a font by its name).
- Several picks from one list: checkboxes and one button.
- Several questions that must all be answered before you can go on, none depending on another's answer: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`, or checkboxes), each with its own `:name`, at most four groups, one button whose `:send` holds `{checked}`; every `:value` says what it answers ("YouTube: public"), as they arrive in one line. An answer that leaves a group out: ask again for that group only. One question after the other only when it depends on the answer before, or on work the person should see first.
- Nothing ticked where the choice is the person's; the likely answer ticked where it is yours to propose.
- The button that moves on gets `:class "primary"`; alternative answers stay plain.
- A swatch is a `button` with `:style {:background "#E20000" :width "44px" :height "44px" :border-radius "50%"}`; tiles for a choice of logos as `kit.mjs logos` prints them. Text stays on the page's ground, never on a colour.
- Never a token, an id the person does not need or a raw error in the chat.

The voice:

```hiccup
[:div
 [:p "So klingt ihr, wie ich eure Website lese: " [:strong "frech, warm, direkt"] ". Ihr duzt und schreibt Du groß, kurze Sätze, wenige Emojis."]
 [:table
  [:thead [:tr [:th "Wir sagen"] [:th "Wir sagen nie"]]]
  [:tbody [:tr [:td "Mix Dir Dein Lieblingsmüsli"] [:td "Jetzt kaufen!"]]
          [:tr [:td "Frühstücken verbindet"] [:td "Sie / Ihnen"]]]]
 [:button {:class "primary" :send "Das sind wir"} "Das sind wir"] " "
 [:button {:send "Nimm deine Vorschläge für den Rest"} "Rest vorschlagen"]
 [:p [:small "Oder schreib, was an der Stimme nicht passt."]]]
```

## Rules

- Only what the site and the person say: no invented founding year, award or claim in the prose.
- The logo is the brand's own: never redraw, recolour or stretch it.
- A font from the site's own files is the brand's web font; whether its licence covers pictures is the brand's to know: when they are unsure, take the closest Google font.
- Change `brand/DESIGN.md` and run `check` and `board` again; never edit the board by hand.
