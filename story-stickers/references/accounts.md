# Which stickers an account has

Instagram does not offer every sticker to every account: the quiz is missing for many, and any other (a link, a poll, a mention, …) can be missing too. Storrito knows each account's stickers from Instagram and refuses a Story with one the account lacks, so a Story planned around it never goes out.

Before a sticker goes into a Story, ask Storrito in the REPL:

```clojure
(storrito/list-instagram-users {})
```

Each account's `unsupportedStickers` lists the `<insta-…>` elements Instagram does not offer it: `[]` means it has them all. Without the key Storrito does not know the account's stickers yet; go on, Storrito lets them through. An account is the same in `list-social-accounts`, where you offer the accounts: its `instagramUsername`.

The accounts that count are the ones the Story may go to: the only one connected, else the ones the person named. Several and none named yet: as "Some lack it" below, decided when the accounts are asked; should every one of them lack it, as "All of them lack it".

- **None of them lacks the sticker**: go on and say nothing about it.
- **All of them lack it**: leave it out. Say so in one sentence ("Instagram does not offer @soul.globe the quiz sticker.") and offer the nearest sticker the account has, as a button that puts it in at once, with "Without it" beside it and a line that they may type something else:

  | lacking | instead |
  | --- | --- |
  | `insta-quiz` | `insta-poll` with the same question and options, without a right answer |
  | `insta-poll` | `insta-emoji-slider` when it asks how much, else `insta-question` |
  | `insta-question` | `insta-poll` with two to four likely answers |
  | `insta-emoji-slider` | `insta-poll` |
  | `insta-countdown` | the date as text in the Story, no sticker |
  | `insta-mention`, `insta-hashtag`, `insta-location` | the @name, the #tag or the place as text in the Story |
  | `insta-link` | nothing replaces it (never "link in bio" text): say the Story then has no way to the page, and offer it without the link |

  The other sticker has another size: make sure it still fits where the first one was meant to go.
- **Some lack it**: keep it. When you ask for the accounts (publishing), offer only the ones that have it, with a small line naming the others and why ("@soul.globe has no quiz sticker"). A video goes out through publish-video, whose account block lists them all: leave the `instagram/<account>/story` targets of the accounts that lack it out of `--to`, and say why in that line. A second version without the sticker for those only when the person asks.

Should `schedule-instagram-story` still refuse ("Instagram does not offer the `<insta-quiz>` sticker to the account …"), the account lost the sticker since. That frame and every call after it in the same run were not scheduled; frames before it were, and would go out alone. Cancel the ones already scheduled (`cancel-instagram-story` with the remembered UUIDs), offer the nearest sticker as above, and schedule again with new UUIDs; never run the same plan again, it is refused again. A video: publish-video's output says which targets went out.
