# Topics: lanes and mechanisms

- A **lane** is a recurring topic family (e.g. "the biggest of its kind", "things that don't belong together").
  Lanes structure the plan and the series.
- A **mechanism** is the trick a viewer would recognise as "that again": something enormous next to a person for
  scale, two things combined that never belong together, an everyday object pushed to an absurd extreme. One
  mechanism can show up in several lanes.

**Pilot, measured:** the novelty of the mechanism predicted more than the lane. The 1st–3rd post of a mechanism
broke out 32 % of the time, the 4th and later 20 % (n = 59 / 56). Within one mechanism the first posts reached up
to six times the median; the later ones fell below it.

## Rules (pilot defaults — tune in `mechanisms.json` → `rules`)

1. Register every post's mechanism (`growth.py add-mechanism`, then the key in `posts.json`).
2. **Cap:** at most 3 posts per mechanism in 14 days (`cap`, `window_days`).
3. **Close** a mechanism after 4 readable posts without a breakout (`closed_after`). Pilot: five mechanisms ended
   at 0 breakouts in 4–8 posts each. A review may reopen one for a deliberate test (`"force": "open"` plus a `"note"`).
4. **Prefer new mechanisms**; an old one only within the cap.
5. A breakout's mechanism may come back within the cap **as a stand-alone post**. Pilot: follow-ups that opened
   with "Remember the …?" went 0/7, because feed viewers never saw the original.
6. Brand or franchise follow-ups without the same trick stalled at the median.

## Lanes

- Keep two or three main lanes by breakout rate over the last two weeks, and at least one post a day from the strongest.
- Test lanes get a weekly budget (pilot: at most three test posts a week, one a day). A lane with 0 breakouts in
  8+ posts is dropped; a test lane that breaks out gets three more tries.

## Picking the topic

- **Story over spectacle.** Accounts that grow sell a secret, a trick or a forbidden story; pure footage
  compilations stagnate (`platform-rules.md` → what grows).
- **A name everyone knows** in the first sentence (a famous organisation, person or brand). Pilot tendency: 33 %
  vs. 21 % breakouts (n = 48 / 67, not significant, the same direction in every period).
- **Footage before topic**, in two stages: metadata (length, channel, rights), then look at frames on a contact
  sheet. Titles lie: sources often show something other than what they claim, so check the picture.
- **Not the lever (pilot):** posting slot and weekday showed no effect.
