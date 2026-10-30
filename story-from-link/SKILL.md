---
name: story-from-link
description: Turn a link (a blog post, a product, an event, any page) into an Instagram Story of a few frames in the brand's own look, with a link sticker back to the page; agree on it with the person in the chat, then schedule it through Storrito or save it as a draft. Use for story sequences from articles, product launches, offers, events and announcements. A picture or a video the person brings, with a link or another sticker, is agentitos' story-stickers, not this.
license: MIT
metadata:
  title: "Story from a link"
  title-de: "Story aus einem Link"
  summary: "A story from a link: a few frames in your brand's look, with a link sticker, scheduled on your Instagram."
  summary-de: "Eine Story aus einem Link: ein paar Frames im Look deiner Marke, mit Link-Sticker, auf deinem Instagram eingeplant."
  ask: "Paste a link: a blog post, a product, an event. I make an Instagram Story of a few frames in your brand's look, with a link sticker back to the page, and schedule it once you like it."
  ask-de: "Füge einen Link ein: einen Blogartikel, ein Produkt, ein Event. Ich mache daraus eine Instagram-Story aus ein paar Frames im Look deiner Marke, mit Link-Sticker zur Seite, und plane sie ein, sobald sie dir gefällt."
  placeholder: "Paste a link"
  placeholder-de: "Link einfügen"
  inputs: "image"
---

# story-from-link

`<skill>` below is the folder this file is in. Run the tools as `node <skill>/tools/…` from your own working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

## Setup (once per machine)

```bash
cd <skill> && npm install
cd <skill>/../brand-kit && npm install     # the brand kit's tools
```

It needs Node 20+, agentitos' `platform-zones` skill beside this one (where Instagram covers a story), agentitos' `brand-kit` skill beside it too (the brand kit: `<kit>` below is `<skill>/../brand-kit/tools/kit.mjs`, on a Sprite else `/home/sprite/skills/brand-kit/tools/kit.mjs`) and Chrome (`CHROME`, or `google-chrome`/`chromium` on the PATH), and the network: the page, Google Fonts, Storrito. When something is missing, say so in one sentence instead of installing it yourself.

## The main use: a story from a link, all in the chat

The person pastes a link. You read the page, settle the brand once, write the story, show its frames, agree on the account and the time, and only then schedule it. Each step ends with a question in the chat; the answer starts the next. Keep every message short: one or two sentences and a hiccup block (see "UI in the chat"). Speak the person's language. Decide small things yourself and say what you decided.

Your files: `work/<name>/` for this story (`<name>` a short slug of the page), `brand/` for the brand kit, which stays for every later story. The only artifact is the preview `artifacts/story-<name>.html`; pictures for the chat go to `uploads/`.

### 1. The page

Say in one sentence that you are reading the page. Then

```bash
node <skill>/tools/page.mjs <url> work/<name>
```

prints what the page is (an article, a product, an event), its facts (price, date, place), its pictures and its look, and writes `work/<name>/text.txt`, the main text. Read the text (of a long one, what you need) and look at the pictures you might use: avoid pictures with text or other brands' logos in them; a picture over a whole frame needs 1080 px of width or more.

### 2. The brand, once

- `brand/DESIGN.md` exists (an earlier story, or the brand-kit skill made it): take it. Say nothing about it, unless this is the first story.
- Else, when the page is the person's own site, `node <kit> draft work/<name> brand` (brand-kit drafts from the look `page.mjs` read). When it is not (a press article about them, a partner's event page), ask for their website once, read it with `page.mjs <their url> work/site` and draft from `work/site`. The story needs only the look: the sections brand-kit marks "To agree" (voice, audience) can wait for its own skill; do not ask them here.
- `node <kit> show brand` prints a hiccup block with the logo, the colours and the font. Show it with "Looks right" (`:class "primary"`) and ask once whether this is their brand; they type what to change.
- A change: edit the front matter of `brand/DESIGN.md` (`colors`, `typography`, `logo`), then `node <kit> check brand` (its ⚠ about sections "to agree" do not matter for a story). Another logo: the candidates are in `work/<name>/logos/` (show them as tiles); one they attach, copy it to `brand/logo.png` and set `logo.primary: logo.png`. A font: one of Google Fonts by its name with `fonts: {<family>: google}`.

### 3. The story

Write `work/<name>/story.json`. A good story:

- has **3 to 7 frames, one idea each**. Frame 1 is the hook: a promise, a surprise or a question in under 40 characters, not the page's title as it stands. The last frame is the call to action with the link sticker;
- has **10 to 25 words per frame**: a frame shows for 5 seconds. Short words, nothing twice;
- takes **facts from the page only**: prices, dates and numbers exactly as written there; never invent a quote, a rating or a number;
- is in the page's language, unless the person wants another;
- uses the page's pictures (or ones the person attaches). In rragent the `image` tool can make a picture a frame needs; then give that frame `"aiImage": true`, so that Instagram labels the story as made with AI;
- may ask something in the middle: a poll or a question sticker gets taps, and taps get the story shown to more people. One interactive sticker per frame at most.

```json
{
  "link": "https://example.com/products/berry",
  "lang": "de",
  "frames": [
    {"kind": "cover", "title": "Weniger Zucker. *Volle Beeren.*", "image": "images/07.png"},
    {"kind": "product", "title": "Bio Berry Müsli", "price": "9,95 €", "badge": "–30 % Zucker", "image": "images/01.png", "theme": "light"},
    {"kind": "list", "title": "Was drin ist", "items": ["Erdbeeren", "Himbeeren", "Knuspriger Hafer"], "marks": "check"},
    {"kind": "stat", "value": "30 %", "title": "weniger Zucker", "stickers": [{"type": "poll", "question": "Schon probiert?", "options": ["Ja", "Noch nicht"], "color": "pink"}]},
    {"kind": "cta", "title": "Jetzt *probieren*", "image": "images/08.png", "stickers": [{"type": "link", "text": "Zum Müsli"}]}
  ]
}
```

| kind | fields | for |
| --- | --- | --- |
| `cover` | `title`, `image`, `kicker` (rarely: only what the title does not say and the viewer needs first, e.g. a date or "Part 2/5"; never "New", "Tip" or the brand) | the hook |
| `text` | `title`, `body`, `number` ("02") | one point |
| `list` | `title`, `items` (2–5), `marks: "check"` | steps, contents, reasons |
| `quote` | `quote`, `author`, `role`, `image` (a portrait) | a voice, a review |
| `stat` | `value` ("87 %"), `title` (what it means), `source` | a number |
| `image` | `image`, `title`, `body` | a picture that tells |
| `product` | `image` (a product shot, best without background), `title`, `price`, `badge` | a product |
| `event` | `date` (ISO with offset), `timeZone`, `title`, `body` ("18:00 · Place") | an event |
| `cta` | `title`, `body`, `image` (a small teaser), `stickers` with the link | the call to action |

Every frame may have `theme` (`brand`, `light`, `dark`, `photo`; left out, a cover with a picture is `photo`, the call to action `brand`, the rest take turns), `image` (relative to `work/<name>/`, or `uploads/…`), `focus` (the part of the picture to keep, `"center 30%"`), `align` (`top`, `center`, `bottom`), `logo` (shown on the cover and the call to action unless `false`) and `stickers`. `*Words in stars*` stand out in the accent colour.

| sticker | fields |
| --- | --- |
| `link` | `text` (1–3 words: "Read more", "Zum Shop"), `url` (the story's `link` when left out), `design`: default gray black rainbow |
| `poll` | `question`, `options` (2–4), `color`: black pink lavender purple orange green blue |
| `question` | `question`, `color` (as poll, or white) |
| `quiz` | `question`, `options` (2–4), `correct-answer` (0-based) |
| `countdown` | `title`, `end-time` (UTC, `2026-11-01T17:00:00Z`), `color`: black white purple red orange yellow green blue |
| `slider` | `question`, `emoji` |
| `mention`, `hashtag`, `location` | `username`, `hashtag`, `location`; `design`: default gray rainbow (location also black, orange) |

The look of a sticker is yours to choose, not a question before the frames: `default` unless it sits on something very bright (then `black` or `gray`), `rainbow` only for playful content; a poll's or a question's colour the Instagram colour nearest the brand's primary colour. Name it in half a sentence with the frames and offer two or three other designs as buttons ("The link sticker in black"); a click changes `story.json`, builds and checks again.

### 4. The frames

Say in one sentence that you are making the frames. Then

```bash
node <skill>/tools/story.mjs build work/<name>
```

renders every frame in Chrome with the brand's fonts and Storrito's own stickers (a few seconds), prints a line per frame with its picture for the chat (`uploads/story-<name>/<build>/NN.jpg`, a new folder per build) and what a viewer would notice: fix every ✗ in `story.json` and build again; fix a ⚠ unless you have a reason not to. The preview beside the chat shows the frames side by side. Look at one or two of the pictures yourself for what no check sees (a face cut off, a picture that does not fit the words). Then show them in the chat as a row of pictures with "Looks good" and "Change something". A change: edit `story.json`, build again.

The build also uploads each frame's picture to Storrito (the machine's gateway, or `STORRITO_API_URL` and `STORRITO_CREDENTIAL`) and writes `work/<name>/frames.edn`: each frame's HTML for Storrito, its picture and its stickers where they sat, `[{:n 1 :kind "cover" :ai-generated false :html "<insta-story>…"} …]`. Everything from here on is Storrito's procedures in your REPL (`eval`): read `frames.edn` and start with `(def frames <its content>)`; `frames` stays defined for the next calls.

### 5. Check, then where and when

Check every frame with Storrito, as it will post it:

```clojure
(def checked (mapv #(storrito/check-instagram-story {:html (:html %)}) frames))
(mapv (fn [f c] [(:n f) (:warnings c) (:previewUrl c)]) frames checked)
```

A warning (a sticker outside the safe zone, on another one): fix it in `story.json`, build again, check again. The `previewUrl`s are what Instagram will show; they belong in the chat when the person asks how it will look.

Then ask what has more than one answer, all in one block (see "UI in the chat"): the accounts as checkboxes, the time and Facebook as radio groups, one button:

- **The account.** `(storrito/list-social-accounts {})`: the accounts whose `postTypes` have the procedure `schedule-instagram-story` take stories, `facebookDestinations` are their Facebook pages. One account: take it. Several: checkboxes and one button. None, or one marked `disconnected`: `(storrito/create-connect-link {…})` makes a link (`[:a {:href …} "Connect Instagram"]`); ask them to say when they are done, before the rest.
- **The time.** The likely ones ("Now", "Today 18:00", "Tomorrow 9:00"), none ticked; they may type another. Ask for the time zone only when you cannot tell (German speaks for Europe/Berlin).
- **Facebook**, only when the account has a Facebook page: whether the story goes there too.
- Instead of scheduling they may want a **draft**: it lands in Storrito's gallery, where they can change it in the editor and schedule it themselves.

### 6. Schedule

Only after their "yes". First give every frame and account its own UUID and remember them, so that a retry posts nothing twice (Storrito answers a known UUID with the post it has):

```clojure
(def plan (vec (for [account ["mymuesli"] f frames] {:account account :n (:n f) :uuid (str (random-uuid))})))
(remember {:story "<name>" :plan plan})
```

Then schedule them in the frames' order (Instagram shows them one after another), each with the same time:

```clojure
(def by-n (into {} (map (juxt :n identity)) frames))
(def facebook-page nil)                                  ; the facebookDestinationId when it goes to Facebook too
(mapv (fn [{:keys [account n uuid]}]
        (storrito/schedule-instagram-story
          (cond-> {:html (:html (by-n n)) :instagramUsername account :storyPostUuid uuid
                   :date "2026-10-22T16:00:00Z"}            ; leave :date out for now
            (:ai-generated (by-n n)) (assoc :aiGenerated true)
            facebook-page (assoc :shareToFacebook true :facebookDestinationId facebook-page))))
      plan)
```

A failure: run the same call again with the same `plan` (`recall` it after a restart of the REPL); what is done stays done. A **draft**: `(storrito/create-draft {:html … :draftUuid uuid :name "<name> 2/5" :folderName "Stories from links"})` per frame instead.

Then `(storrito/status-instagram-story {:storyPostUuid uuid})` per post (`status-draft` for drafts) once Storrito rendered it, usually within a minute: its `previewUrl` must look like the frame. Tell the person in one or two sentences what is scheduled when and where; a failure: which frame and why, in one sentence. To take the story back: `cancel-instagram-story` per post (`delete-draft` for drafts); to change a scheduled story: cancel, change, build, check, schedule with new UUIDs.

### 7. The next link

The brand stays in `brand/`. Remember the account and the usual time (rragent: `remember`), and for the next link ask only what changed.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/story-<name>.html"` shows the preview. Links and pictures point at `https://…`, `artifacts/…` or `uploads/…`. An `input` is a checkbox or a radio button; `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block. There are no text fields: for a time or a name they type.

- One question per block, buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else. Several picks from one list (accounts, platforms, moments): checkboxes and one button. Several questions that must all be answered before you can go on, none depending on another's answer: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`, or checkboxes), each with its own `:name`, at most four groups, and one button whose `:send` holds `{checked}`; every `:value` says what it answers ("YouTube: public"), as they arrive in one line. An answer that leaves a group out is asked again for that group only. Ask one after the other only when a question depends on the answer before, or on work the person should see first. Nothing ticked where the choice is the person's; the likely answer ticked where it is yours to propose.
- The button that moves on gets `:class "primary"`; buttons that are alternative answers stay plain.
- A button's text says what happens; its `:send` reads as the person's answer ("The story is good", "Post it tomorrow at 9:00").
- Never put a token, an id the person does not need or a raw error into the chat.

The frames:

```hiccup
[:div
 [:div {:style {:display "grid" :grid-template-columns "repeat(auto-fill, minmax(96px, 1fr))" :gap "8px"}}
  [:img {:src "uploads/story-berry/mvhv2k1q/01.jpg" :style {:width "100%" :aspect-ratio "9 / 16" :border-radius "8px"}}]
  [:img {:src "uploads/story-berry/mvhv2k1q/02.jpg" :style {:width "100%" :aspect-ratio "9 / 16" :border-radius "8px"}}]
  [:img {:src "uploads/story-berry/mvhv2k1q/03.jpg" :style {:width "100%" :aspect-ratio "9 / 16" :border-radius "8px"}}]]
 [:p "Five frames, the link sticker on the last one. Good like this?"]
 [:button {:class "primary" :send "The story is good"} "Looks good"] " "
 [:button {:open "artifacts/story-berry.html"} "Show them large ↗"]
 [:p [:small "Or tell me what to change."]]]
```

The time:

```hiccup
[:div
 [:p "When should it go out on @mymuesli?"]
 [:button {:send "Post it now"} "Now"] " "
 [:button {:send "Post it today at 18:00"} "Today 18:00"] " "
 [:button {:send "Post it tomorrow at 9:00"} "Tomorrow 9:00"] " "
 [:button {:send "Save it as a draft in Storrito"} "As a draft"]
 [:p [:small "Or type another time."]]]
```

## Rules

- Only what the page says: no invented price, date, quote, rating or number.
- Pictures from the person's own site are theirs to use; for pictures of others, say once before scheduling that they need the right to use them.
- One link sticker per story is enough, on the last frame; stickers never lie under Instagram's bar or reply field, on text or on each other (the build checks every frame with platform-zones' layout check: ✗ under or on top, ⚠ in the safe zone's margin or closer than 40 px).
- Change `story.json` or `brand/DESIGN.md` and build again; never edit the built frames by hand.
