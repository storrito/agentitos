# Platform rules and what grows (researched October 2026)

Facts with their source and date; thin evidence is marked. Re-check anything older than six months.

## TikTok

- **Ranking signals** (TikTok newsroom, 2020, still the official description): likes, shares, comments, follows,
  watching to the end; caption, sound, hashtags; device and country weigh little. Follower count and past hits are
  not a direct factor. https://newsroom.tiktok.com/en-us/how-tiktok-recommends-videos-for-you
- **Originality** (Community Guidelines in force from 2025-09-13): "reused or unoriginal content posted without
  creative edits, such as clips that show someone else's watermark or logo" and "minimally edited content" are not
  eligible for the For You feed. Own voiceover, context and a rebuilt edit count as creative edits (secondary
  sources on the Creator Academy); **frames, borders and speed changes do not**.
  https://github.com/OpenTermsArchive/contrib-versions/blob/main/TikTok/Community%20Guidelines.md
- **Length** (correlation only): Socialinsider, July 2026, 6M brand videos: engagement 6.0 % at 15–30 s, 4.2 % at
  30–60 s, 4.8 % at 60–90 s, median views rising with length (https://www.socialinsider.io/blog/how-long-are-tiktok-videos/).
  Buffer, 1.1M videos: over 60 s +43 % reach (https://buffer.com/resources/longer-tiktoks-get-more-views-data/).
- **Frequency:** Buffer via Search Engine Journal, 2025-10-17, 11.4M posts compared within each account: 11+ posts a
  week → +34 % views per post vs. one a week; the median stays flat, the top 10 % rise. More posts = more chances;
  no evidence that frequent posting hurts.
  https://www.searchenginejournal.com/study-shows-2-5-weekly-tiktoks-deliver-biggest-view-increase/558641/
- **AI label:** TikTok says it doesn't reduce reach; a viewer-side "see less AI" control is being tested, so an
  indirect effect is possible (unproven). https://support.tiktok.com/en/using-tiktok/creating-videos/ai-generated-content
- **Folklore without an official source:** fixed test-pool sizes, "watch time is 40–50 % of the ranking",
  replay-rate targets, on-screen text read for search.

## Instagram

- **Signals** (Adam Mosseri, 2025-01-22): watch time, likes and sends (shares by DM); sends weigh a bit more for
  reaching non-followers. "Sends are worth 3–5 likes" is folklore.
- **Original content:** since 2024-04-30 accounts with more than 10 reposts of others' content in 30 days lose
  recommendations; since 2026-04-30 for photos and carousels too. Unique text, creative edits and voiceover count;
  removing a watermark, changing speed or adding a credit screenshot don't. The app shows eligibility under
  Account Status. https://www.engadget.com/instagrams-algorithm-overhaul-will-reward-original-content-and-penalize-aggregators-130018977.html ·
  https://techcrunch.com/2026/04/30/instagram-restricts-reach-of-content-aggregators-in-new-crackdown/
- **Hashtags: at most 5 per post** since 2025-12-18; Mosseri: they categorise, they don't add reach.
  https://www.techbuzz.ai/articles/instagram-caps-hashtags-at-five-to-combat-spam
- **Trial Reels** go to non-followers first; the publishing API can set them (`trial_params`), for accounts eligible
  for recommendations (reported follower minimums vary, 200–1,000).
  https://creators.instagram.com/blog/instagram-trial-reels · https://developers.facebook.com/docs/instagram-platform/content-publishing/
- Reels up to 3 minutes are recommended to non-followers (Instagram Creators blog, 2025-01-21).

## Other vertical platforms (researched October 2026)

Safe zones for all of them: `safe-zones.md`.

- **YouTube Shorts:** up to 3 minutes since 2024-10-15. A Short **over 1 minute with an active Content ID claim is
  blocked worldwide** (no strike; remove the claimed audio or dispute); Shorts up to 1 minute keep the old rules.
  With licensed music or footage, stay at or under 60 s.
  https://support.google.com/youtube/answer/15424877?hl=en
  The partner programme's "repetitious content" rule was renamed **"inauthentic content"** on 2025-07-15:
  mass-produced, repetitive videos earn nothing; reused or AI material is fine with commentary, narration or
  editing (YouTube calls it a minor update). https://www.plagiarismtoday.com/2025/07/08/youtube-targets-inauthentic-content/
  Since 2025-03-31 every start and replay counts as a Shorts view ("engaged views" separately), so don't compare
  view counts across that date. https://ppc.land/youtube-changes-how-shorts-views-are-counted-from-march-31/
- **Facebook:** since 2025-06 every new video is a Reel, any length and orientation; 9:16 still recommended.
  https://alternativeto.net/news/2025/6/facebook-merges-all-videos-into-reels--drops-format-limits-and-unifies-sharing
  Since 2025-07, accounts that repeatedly reuse other people's videos, photos or text without meaningful edits lose
  monetisation for a while and reach on *all* their posts; duplicate videos get less distribution; reactions and
  commentary with an own take are fine (secondary sources on Meta's announcement).
  https://www.lindseygamble.com/blog/facebook-will-limit-reach-and-monetization-of-unoriginal-content
- **Another app's watermark:** Instagram doesn't recommend Reels with another app's logo or watermark (2021; Mosseri
  later: your own logo is fine), and the other platforms' originality rules point the same way. Upload the clean
  file to every platform, never a download from another app.
  https://tubefilter.com/2021/02/10/instagram-reels-with-tiktok-watermark-less-discoverable/ ·
  https://www.socialmediatoday.com/news/instagram-clarifies-including-your-own-logo-on-a-reel-is-ok/730852/
- **Snapchat Spotlight:** vertical with sound, 5–60 s; original, no watermarks; payouts by invitation. Secondary,
  2026: a 100-hour view-time requirement, and fully AI-generated videos out of the payout pool (unconfirmed).
  https://techcrunch.com/2020/11/23/snapchat-launches-a-tiktok-like-feed-called-spotlight-kick-started-by-paying-creators ·
  https://www.shortsync.app/resources/snapchat-spotlight-monetization-2026
- **Pinterest video pins:** 4 s to 15 min, 9:16 recommended; the only official safe zone, with the largest bottom
  zone (790 px). https://help.pinterest.com/en/article/review-pin-specs
- **LinkedIn:** a vertical video feed since late 2024; no published length limit or safe zone for it; vendor
  advice is 9:16 and 30–90 s (thin).
- **X:** 140 s for standard accounts; vertical video plays full screen in the immersive viewer (one vendor source).
- **Cross-posting:** one master per post, then for each platform a clean upload, the platform's own caption and
  hashtag rules, and a layout inside that platform's safe zone.

## What grows for faceless short-video accounts (public accounts; secondary sources marked S)

- **Story beats spectacle:** pure footage compilations stagnate even with spectacular material; growing creators
  sell a secret, a trick or a forbidden story ("The illegal history of …").
- **Faceless accounts grow with a signature:** a fixed narrator (The B1M), an own visual look (Mustard, Zack D. Films,
  S), or a news brand (Interesting Engineering).
- **Arcs hold viewers:** "[PART 3/4/5]" shorts of a large creator held their views from part to part; rankings
  ("top 5 most …") create curiosity for the end.
- **Short titles with one emphasised word** ("The TOUGHEST job in …").
- **Comment mechanics:** quiz questions draw few comments; "tag a friend who would …" is a common growth prompt
  (thin evidence, S).
- Large accounts post noticeably less on Instagram than on TikTok (S).
