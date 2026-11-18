---
name: story-from-link
description: Turn a web page (article, product, event) into a few-frame Instagram Story in the brand's look with a link sticker, scheduled via Storrito; a photo or video the person brings is story-stickers.
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

`<skill>` is this file's folder. Run the tools as `node <skill>/tools/…` from your own working directory; every path you pass is yours. Never change the files in `<skill>`. Full reference: [README.md](README.md).

## Setup (once per machine)

```bash
cd <skill> && npm install
cd <skill>/../brand-kit && npm install     # the brand kit's tools
```

Needs Node 20+, agentitos' `platform-zones` and `brand-kit` skills beside this one (`<kit>` below is `<skill>/../brand-kit/tools/kit.mjs`, on a Sprite else `/home/sprite/skills/brand-kit/tools/kit.mjs`), agentitos' `story-stickers` beside it too (which stickers an account has: `<stickers>` below is `<skill>/../story-stickers`, on a Sprite else `/home/sprite/skills/story-stickers`), Chrome (`CHROME`, or `google-chrome`/`chromium` on the PATH) and the network (the page, Google Fonts, Storrito). Something missing: say so in one sentence, never install it yourself.

## The main use: a story from a link, all in the chat

The person pastes a link. Read the page, settle the brand once, write the story, show its frames, agree on account and time, and only then schedule. Each step ends with a question in the chat; the answer starts the next. Every message: one or two sentences in the person's language and a hiccup block (see "UI in the chat"). Decide small things yourself and say what you decided.

Files: `work/<name>/` for this story (`<name>` a short slug of the page), `brand/` for the brand kit (it stays for later stories). The only artifact is the preview `artifacts/story-<name>.html`; pictures for the chat go to `uploads/`.

### 1. The page

Say in one sentence that you are reading the page, then run `node <skill>/tools/page.mjs <url> work/<name>`. It prints the kind of page (article, product, event), its facts (price, date, place), its pictures and its look, and writes the main text to `work/<name>/text.txt`. Look at the pictures you might use: avoid ones with text or other brands' logos in them; a picture over a whole frame needs 1080 px of width or more.

### 2. The brand, once

- `brand/DESIGN.md` exists: take it; mention it only on the first story.
- Else, when the page is the person's own site: `node <kit> draft work/<name> brand`. When it is not (a press article about them, a partner's event page): ask once for their website, read it with `page.mjs <their url> work/site` and draft from `work/site`. The story needs only the look: do not ask the sections brand-kit marks "To agree" (voice, audience) here.
- `node <kit> show brand` prints a hiccup block with the logo, colours and font. Show it with "Looks right" (`:class "primary"`) and ask once whether this is their brand; they type what to change.
- A change: edit the front matter of `brand/DESIGN.md` (`colors`, `typography`, `logo`), then `node <kit> check brand` (its ⚠ about sections "to agree" do not matter here). Another logo: the candidates are in `work/<name>/logos/` (show them as tiles); one they attach: copy it to `brand/logo.png` and set `logo.primary: logo.png`. A font: a Google Font by name, with `fonts: {<family>: google}`.

### 3. The story

Read `<skill>/references/story-json.md` (the fields of every frame kind and sticker, with their designs and colours), then write `work/<name>/story.json`:

- **3 to 7 frames, one idea each.** Frame 1 is the hook: a promise, a surprise or a question in under 40 characters, not the page's title as it stands. The last frame is the call to action with the link sticker.
- **10 to 25 words per frame** (a frame shows for 5 seconds); short words, nothing twice.
- **Facts from the page only**: prices, dates and numbers exactly as written there; never an invented quote, rating or number.
- In the page's language, unless the person wants another.
- The page's pictures, or ones the person attaches. In rragent the `image` tool can make a picture a frame needs; then give that frame `"aiImage": true`, so that Instagram labels the story as made with AI.
- A poll or question sticker in the middle gets taps, which get the story shown to more people. At most one interactive sticker per frame. Before the stickers go into `story.json`, the link sticker too, read `<stickers>/references/accounts.md` and do what it says: Instagram does not offer every sticker to every account, and Storrito refuses a story with one the account lacks (its `insta-emoji-slider` is `slider` here).

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

A sticker's look (`design`, `color`) is yours to choose, not a question before the frames: name it in half a sentence with the frames and offer two or three other designs as buttons ("The link sticker in black"); a click changes `story.json` and builds again.

### 4. The frames

Say in one sentence that you are making the frames, then run `node <skill>/tools/story.mjs build work/<name>`. It renders every frame in Chrome with the brand's fonts and Storrito's own stickers (a few seconds), shows them side by side in the preview, and prints a line per frame with its picture for the chat (`uploads/story-<name>/<build>/NN.jpg`, a new folder per build) and what a viewer would notice: fix every ✗ in `story.json` and build again; fix a ⚠ unless you have a reason not to. Look at one or two pictures yourself for what no check sees (a face cut off, a picture that does not fit the words). Then show them in the chat as a row of pictures (see "UI in the chat"). A change: edit `story.json`, build again.

The build also uploads each frame's picture to Storrito (the machine's gateway, or `STORRITO_API_URL` and `STORRITO_CREDENTIAL`) and writes `work/<name>/frames.edn`: each frame's HTML for Storrito (its picture, its stickers where they sat), `[{:n 1 :kind "cover" :ai-generated false :html "<insta-story>…"} …]`. From here on everything is Storrito's procedures in your REPL (`eval`): start with `(def frames <content of frames.edn>)`; `frames` stays defined for the next calls.

### 5. Where and when

Ask everything with more than one answer in one block (see "UI in the chat"): the accounts as checkboxes, the time and Facebook as radio groups, one button.

- **The account.** `(storrito/list-social-accounts {})`: accounts whose `postTypes` have the procedure `schedule-instagram-story` take stories; `facebookDestinations` are their Facebook pages. A story goes only to the accounts that have its stickers (`<stickers>/references/accounts.md`). One account: take it. None, or one marked `disconnected`: `(storrito/create-connect-link {…})` makes a link (`[:a {:href …} "Connect Instagram"]`); ask them to say when they are done, before the rest.
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

- Storrito refuses what would make the post fail, saying what to change. Its `warnings` come with a post already scheduled: cancel it, fix `story.json`, build, schedule again with new UUIDs.
- A failure: run the same call again with the same `plan` (`recall` it after a REPL restart); what is done stays done. Not when Storrito refuses a sticker the account lacks: `<stickers>/references/accounts.md` says what to do.
- A **draft**: `(storrito/create-draft {:html … :draftUuid uuid :name "<name> 2/5" :folderName "Stories from links"})` per frame instead.

Then, once Storrito rendered it (usually within a minute), `(storrito/status-instagram-story {:storyPostUuid uuid})` per post (`status-draft` for drafts): its `previewUrl` must look like the frame. Tell the person in one or two sentences what is scheduled when and where; a failure: which frame and why, in one sentence. To take the story back: `cancel-instagram-story` per post (`delete-draft` for drafts); to change a scheduled story: cancel, change, build, schedule with new UUIDs.

### 7. The next link

The brand stays in `brand/`. Remember the account and the usual time (rragent: `remember`); for the next link ask only what changed.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/story-<name>.html"` shows the preview. Links and pictures point at `https://…`, `artifacts/…` or `uploads/…`. An `input` is a checkbox or a radio button; `{checked}` in a button's `:send` becomes the `:value`s ticked in the same block. No text fields: they type a time or a name.

- One question per block: buttons for the likely answers when a click is the whole answer, and a hint that they can type anything else.
- Several picks from one list (accounts): checkboxes and one button.
- Several questions that must all be answered before you can go on, none depending on another's answer: one block, a group per question (`[:input {:type "radio" :name "<question>" :value "<question>: <answer>"}]`, or checkboxes), each with its own `:name`, at most four groups, one button whose `:send` holds `{checked}`; every `:value` says what it answers ("YouTube: public"), as they arrive in one line. An answer that leaves a group out: ask again for that group only. One question after the other only when it depends on the answer before, or on work the person should see first.
- Nothing ticked where the choice is the person's; the likely answer ticked where it is yours to propose.
- The button that moves on gets `:class "primary"`; alternative answers stay plain. A button's text says what happens; its `:send` reads as the person's answer ("The story is good", "Post it tomorrow at 9:00").
- Never a token, an id the person does not need or a raw error in the chat.

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

- Pictures from the person's own site are theirs to use; for pictures of others, say once before scheduling that they need the right to use them.
- One link sticker per story, on the last frame. Stickers never lie under Instagram's bar or reply field, on text or on each other (the build's ✗ and ⚠).
- Change `story.json` or `brand/DESIGN.md` and build again; never edit the built frames by hand.
