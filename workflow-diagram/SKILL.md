---
name: workflow-diagram
description: Shows a workflow (what starts it, what the person does, what happens by itself) as one page of a few cards that a person who is not technical reads at a glance, on a phone as on a wide screen, in one fixed look; before a workflow of an rragent bot goes live, when its job changed, or when the person asks to see how one works.
license: MIT
metadata:
  title: "A workflow at a glance"
  title-de: "Ein Ablauf auf einen Blick"
  summary: "How something of yours runs by itself, as one page: what starts it, what you do, what happens without you."
  summary-de: "Wie etwas bei dir von selbst abläuft, als eine Seite: was es auslöst, was du tust, was ohne dich passiert."
  ask: "Describe the workflow: what starts it, what you do yourself and what should happen by itself. I show it to you as one page."
  ask-de: "Beschreibe den Ablauf: was ihn auslöst, was du selbst tust und was von selbst passieren soll. Ich zeige ihn dir als eine Seite."
  placeholder: "What starts it, and what happens then?"
  placeholder-de: "Was löst es aus, und was passiert dann?"
  inputs: ""
---

# workflow-diagram

One tool: you write the workflow as `workflow.json`, `<skill>/tools/diagram.mjs` builds the page from it, `index.html`, which the person opens beside the chat. The look (colours, type, cards, icons, how it folds for a phone) is fixed in `<skill>/style/` and the same for every workflow: you decide the words, never the look, and you write no HTML. `<skill>` is the folder this file is in. Needs Node 20+. Full reference: [README.md](README.md).

## When

- You are a bot of rragent and agreed a job that a hook or a schedule will start: after the job is in your file, before the hook or the schedule exists. The page is what the person says yes to.
- The job changed so that the page no longer shows what happens: build it again and show it.
- The person asks to see how a workflow works, one that runs or one that is only an idea.

## 1. The cards: what the person notices

The page answers two questions of someone who did not build this: what do I do, and what happens then by itself.

- 3 to 5 cards, 6 at most. A card is something the person does or notices: a preview arrives, a Story goes online. What happens in between and they never see (a check every minute, a file read, an upload, an event remembered) is no card: it belongs to the card of the thing they notice next.
- `who` of a card: `you`, the person does it; `auto`, it happens by itself; `event`, something outside starts it that is neither (a guest leaves a review, a date comes, a customer writes). A workflow the person starts by hand begins with `you`.
- Their words. Their services by the names they use (Dropbox, Telegram, the account's name), in `**bold**`. None of ours: no hook, webhook, run, schedule, slot, trigger, API, no name of a tool or a skill. "I look every minute" is "shortly after".
- A card's `title`: what to do for `you` ("Reply “OK”"), what happens for the others ("Your Story goes live"). Its `text`: one or two sentences.
- What else can happen at a step (a change request, a review under four stars, nothing new) is that card's `note`, a question and a sentence: "Want something different? Write what should change, and you get a new preview." Never a loop, an arrow back or a decision of its own.
- Several ways it can start, or several places it goes to, are the `items` of one card, not cards of their own. Fixed times or days are its `chips`.
- `promise`, the line under the cards: what never happens without them ("Nothing goes online without your OK."); when no step is theirs, what they hear of it ("You get a message whenever a post went out."). Only what the job as written keeps; else none.
- `title` of the page: their thing in it ("How a soul.globe Story gets made"). `subtitle`: what is theirs to do, in a sentence ("You do two small things. Everything else happens by itself.").
- All of it in the person's language: `"lang": "de"` or `"en"` sets the fixed words; for another language see `--help`.

## 2. Build

Write `artifacts/<job>-workflow/workflow.json` (`node <skill>/tools/diagram.mjs --help` shows every key, `icons` the icons' names; `<skill>/examples/story-approval.json` is one to copy), then:

```bash
node <skill>/tools/diagram.mjs build artifacts/<job>-workflow/workflow.json
```

It writes `index.html` beside the JSON, or says in a sentence what does not fit (a text too long for its card, an icon it does not have). A line `check:` names a word the person may not know: rewrite it, unless it is their own. To change anything, edit `workflow.json` and build again; never `index.html`. The page lays itself out for the screen it is opened on, a phone included: nothing to do for that.

To see it yourself, `node <skill>/tools/diagram.mjs picture artifacts/<job>-workflow/workflow.json` takes a picture of the page as a phone shows it (`--width 1400`: a wide screen), which you read; needs Chrome. Only when you doubt a card, and never as what the person gets: they get the page.

## 3. Show it

One card (see "UI in the chat"): in a sentence what is theirs to do, and the button that opens the page beside the chat. Before a workflow goes live the card asks for their yes, and nothing is created before it. When they write what should be different: a change of how it works goes into the job in your file first, then into `workflow.json`; a change of words only into `workflow.json`; then build again, the page beside the chat reloads by itself, and say in a sentence what changed.

A workflow that is only an idea gets the same page without the button that starts it, and a sentence that none of it runs yet.

## A technical diagram

Only when the person asks for one (every step, the services as lanes, decisions, for their team): there is no tool for it. Write it as one page with an inline SVG, `technical.html`, beside `index.html`, in the colours of `<skill>/style/style.css`, and name both. The page of the cards stays the one they are asked about.

## UI in the chat

Write a ```hiccup block into your answer; it becomes part of the page. EDN hiccup, data only. Tags: `div span p ul ol li strong em b i s small h1–h4 a img audio video button table thead tbody tr th td figure figcaption code pre br hr blockquote label input`. Attributes: `class href src poster title alt controls preload loop muted width height colspan rowspan download style send open type name value checked disabled`. `:style` is a map; `:send "text"` on a button sends that text as the person's next message; `:open "artifacts/…"` shows that file beside the chat.

- The button that moves on gets `:class "primary"`. A button that opens a page ends its text with " ↗". No button that only leads to a question: what should be different, they type, and a line under the buttons says so.
- Never a token, an id the person does not need or a raw error in the chat.

Before a workflow goes live:

```hiccup
[:div
 [:p [:b "So läuft es ab"]]
 [:p "Du legst einen Ordner in Dropbox ab und antwortest auf die Vorschau mit OK. Alles andere passiert von selbst."]
 [:button {:open "artifacts/story-workflow/index.html"} "Ablauf ansehen ↗"]
 [:button {:send "So starten: richte den Ablauf ein, wie die Seite ihn zeigt" :class "primary"} "So starten"]
 [:p [:small "Oder schreib, was anders laufen soll."]]]
```
