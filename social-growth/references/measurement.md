# Measurement

The loop only works if "what worked" is decided by the account's own numbers, read the same way every time.
Numbers marked *pilot* come from one faceless short-video account (~115 readable posts).

## The breakout line

- Platforms hand every new post a similar test audience, and most posts never leave it (pilot: ~60 % of posts
  stayed within a narrow band around the median). What matters is whether a post leaves that pool, so compare
  posts on **breakout rate**, not on mean reach: one viral post drags every average (pilot: the top 10 % of posts
  brought 49 % of all views, one post alone 21 %).
- **Breakout = views on the primary platform > 2 × the median of the account's readable posts.** Readable = at
  least 48 h old. The line moves with the account: as it grows, the bar rises.
- Primary platform = where most reach comes from (pilot: TikTok, 81 %). Platforms reward different posts (pilot:
  rank correlation TikTok vs. Instagram 0.31); compute a line per platform when both matter.

## When a number is readable

- Pilot: after ~24 h a post had a median 97 % of its views, after 48 h 98.5 %. Late bloomers were rare (2 of
  ~115), but real: one post stayed near the median for three days, then grew about fifty-fold.
- So: flag fresh breakouts from ~24 h, compare posts from 48 h, rank them against each other from ~5 days.
- Know when your numbers refresh: if the source updates once a day, an early-morning run sees the previous
  afternoon's posts without numbers.

## Rates worth reading

- Per 1,000 views: comments, shares, saves and **followers gained**. Pilot: 0.42 followers per 1,000 views.
  Breakouts had *lower* like rates than average posts (43 vs. 66 per 1,000): reach from strangers converts worse.
  Likes don't predict breakouts.
- Follower gain is per account and day, not per post: attribute it to days (that is why endings are tested by day).

## Experiments

- **One variable at a time.** Pilot: four changes landed on the same day (title format, opener, topic repeats,
  ending) and the breakout rate fell from 40 % to 17 %; nobody can say which change did it.
- **Day-level variables** (anything that should move followers, like the ending): every post of a day gets the
  same arm, odd and even dates alternate.
- **Post-level variables** (length, format): alternate per post in a pattern that is balanced over posting slots
  and over the day-level arms, e.g. a 4-day cycle short/main/short, main/short/main, main/short/main, short/main/short.
- **Sample size:** with a ~25 % base rate and ~30 posts per arm only differences of ~25 points are clearly visible.
  Call smaller gaps a tendency.
- Write each test down before it starts: variable, arms, metric, start, verdict date (`strategy.md` → tests).

## Where the numbers come from

Storrito does not deliver post metrics yet; until it does, the person brings them. Post metrics (views, likes,
comments, shares, saves) are in every platform's export. **Retention** (average watch time, share watched to the
end), **traffic source** (For You, search, profile, following) and **followers per video** usually only show in
TikTok Studio and Instagram Insights: ask weekly for screenshots of the three best and three weakest posts and
transcribe them into `work/growth/retention.json`.
