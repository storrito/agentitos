# social-growth

> **Draft (skeleton).** The structure, the measuring tool and the rules are in place; several rules are still
> under test on the pilot account (see Evidence).

A growth loop for short-video accounts (TikTok, Instagram Reels, YouTube Shorts): decide what to post from the
account's own numbers instead of gut feeling, make every post's first second and last second count, and change
one thing at a time. The agent plans, briefs, schedules through Storrito and measures; the videos come from a
production skill such as [kinetic-lyrics](../kinetic-lyrics/) or from the person.

## The loop

```
strategy ──► topics ──► brief ──► produce ──► schedule ──► measure ──► weekly review ─┐
  ▲  (the person's decisions)   (production skill)  (Storrito)  (growth.py)           │
  └──────────────────────────────── rules, mechanisms, tests ◄────────────────────────┘
```

1. **Strategy** with the person: accounts, audience, what they can make, cadence and look (their decisions), two
   or three starting lanes.
2. **Topics** by mechanism: the trick a viewer recognises as "that again". New mechanisms first; at most three
   posts per mechanism in 14 days; a mechanism with four readable posts and no breakout is closed.
3. **Brief** per post: the first frame proves the first sentence, a text hook from frame 0, no end card, a loop
   back to the hook, a size check when scale is the point, facts with sources.
4. **Measure** against the account's own breakout line (2 × the median of posts at least 48 h old).
5. **Review weekly**: change the topic rules, propose the person's decisions, one experiment at a time.

## Files

| path | what |
|---|---|
| `SKILL.md` | entry point for the agent |
| `scripts/growth.py` | `report`, `mechanisms`, `add-mechanism` — standard-library Python, no install |
| `references/measurement.md` | breakout line, when numbers are readable, rates, experiment design, where numbers come from |
| `references/topics-and-mechanisms.md` | lanes, the mechanism registry and its rules, picking topics |
| `references/hooks-and-retention.md` | first frame, text hook, endings, own graphics, length |
| `references/followers.md` | profile, series, formats, endings, captions, tagging |
| `references/safe-zones.md` | what TikTok / Reels / Shorts / Stories cover, and the text-safe layout |
| `references/covers.md` | cover rules for feed and profile grid |
| `references/platform-rules.md` | TikTok / Instagram ranking and originality rules, what grows — with sources |
| `templates/` | `strategy.md`, `brief.md`, `weekly-review.md`, `posts.json`, `mechanisms.json`, `retention.json` |
| `examples/` | synthetic `posts.json` + `mechanisms.json` to try the tool on |

Try it:

```bash
python3 social-growth/scripts/growth.py report social-growth/examples/posts.json --compare cut
python3 social-growth/scripts/growth.py mechanisms social-growth/examples/posts.json social-growth/examples/mechanisms.json
```

## Needs

- `python3` 3.9+.
- A Storrito connection for `list-social-accounts`, scheduling and status (the agent harness provides it).
- Numbers: Storrito does not deliver post metrics yet. Until it does, the person brings them as TikTok Studio /
  Instagram Insights exports or screenshots, transcribed into `work/growth/posts.json`.

## Evidence

From one pilot account: faceless short videos, ~120 measured posts. One account is not a law: every rule carries
its status, and absolute numbers are left out on purpose.

| rule | status | pilot |
|---|---|---|
| Compare posts on breakout rate (> 2 × median), not mean reach | measured | top 10 % of posts = 49 % of views; ~60 % stayed in a narrow band around the median |
| Judge after ~24 h, compare after 48 h | measured | median 97 % of views after ~24 h, 98.5 % after 48 h |
| New mechanisms beat repeated ones; cap 3 per 14 days | measured | 1st–3rd post 32 % breakouts, 4th+ 20 % (n = 59 / 56) |
| Close a mechanism after 4 readable posts without a breakout | measured (rule of thumb) | five mechanisms at 0 breakouts in 4–8 posts each |
| No "Remember the …?" openers, no forced follow-ups | measured | 0/7 each |
| Name anchor in the first sentence | tendency | 33 % vs. 21 % (n = 48 / 67) |
| Faster cutting doesn't help | measured | ≥ 3 clips / 10 s: median about 30 % lower |
| Slot and weekday don't matter | measured | no clear difference between three daily slots |
| Questions at the end bring few comments | tendency | 0.3–0.6 per 1,000 views across wordings; one weekly window saw 1.0 on question days |
| First frame proves the first sentence; text hook from frame 0 | observed in a 6 vs. 6 audit; package test running | verdict pending (≥ 15 posts per side) |
| No end card, loop ending | hypothesis, in the package test | the end card was 9–10 % / 16–20 % of the two cuts |
| Size check graphic | hypothesis, in the package test | — |
| Shorter cut on TikTok | hypothesis, A/B per post running | verdict pending (≥ 20 posts per arm) |
| Teaser vs. question ending for followers | tendency, A/B per day running | ~1.7× the follower gain on teaser days; verdict pending |
| "Send this to someone who …" ending | hypothesis | next A/B arm |
| Series label at the end of the TikTok title | tendency | label-first coincided with a drop (confounded) |
| Tagging footage owners and brands | measured: no effect | shares 1.02 vs. 0.98 per 1,000 views |

## Open (before this leaves draft)

- [ ] Verdicts of the running tests (endings, quality package, length) into Evidence and the references.
- [ ] Numbers from Storrito's API / MCP once they deliver post metrics; until then exports and screenshots.
- [ ] A second account through the loop for a few weeks, to tell account-specific rules from general ones.
- [ ] Companion production skill (`short-video-reel`: text hook, size check, loop ending, gates) — separate folder.

## License

[MIT](../LICENSE) © Storrito
