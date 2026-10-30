# video-descriptions

The texts that go with a video on every platform it is posted to: captions, titles, descriptions, tags, alt texts, hashtags and mentions. Each within the platform's limits **as the platform counts them** (X weighs a link as 23 and an emoji as 2, YouTube counts its description in bytes, Instagram and TikTok in UTF-16), its rules for hashtags and mentions, and what it shows before "more". All in one style that fits the video, chosen by the agent and said why; all on one overview page where the person checks them.

> Agents: start with [`SKILL.md`](SKILL.md). It is written for [rragent](https://github.com/storrito/rragent); the overview is an artifact beside the chat.

```bash
node tools/descriptions.mjs read uploads/clip.mp4 descriptions/clip   # video.json, words.txt, frames.jpg
node tools/descriptions.mjs platforms [platform…]                     # the rules, per platform
node tools/descriptions.mjs styles                                    # the styles and which videos they fit
# the agent writes descriptions/clip/descriptions.json
node tools/descriptions.mjs check descriptions/clip                   # every limit, the fold, hashtags, mentions
node tools/descriptions.mjs overview descriptions/clip                # artifacts/descriptions-clip.html
```

Requirements: Node 20+, ffmpeg. For the words OpenRouter (ElevenLabs Scribe v2, about 0.5 ¢ a minute): `OPENROUTER_API_KEY`, or on a Sprite the gateway's `openrouter` connection (`tools/lib/openrouter.mjs`); or the words of another tool with `--words` (rragent's transcribe tool, [captions](../captions/), [best-takes](../best-takes/)). No npm packages, no other model: the agent writes the texts itself.

## How it works

1. **`read`** probes the video (size, frame, length), transcribes it (`words.txt`: a line per sentence or pause, with its time, for chapters), makes a sheet of twelve frames with their times (one ffmpeg seeking to each moment, never decoding the whole video) and lists the platforms the video fits by its length and frame, and why not the others. It names the brand kit's handles (`brand/DESIGN.md`, `social`) and whether it has a voice to follow.
2. **The agent** looks at the frames and reads the words, picks the style (see below) and writes `descriptions.json`: per platform its own fields.
3. **`check`** counts each field as its platform does, cuts out what shows before "more", finds the hashtags, mentions and links, and checks them against the platform: ✗ for what the platform refuses or ignores (over a limit, a sixth hashtag on Instagram, `<` in a YouTube title, a 16:9 video as a Short, a follow-for-follow tag), ⚠ for what costs reach or reads badly (a first sentence that runs past "more", "more" cutting a hashtag in two, the long dash —, which reads as written by AI, engagement bait, #fyp, a link that is not clickable there, a mention of an account nobody confirmed, hashtags before the fold, chapters YouTube will not show). It exits 1 while there is a ✗.
4. **`overview`** writes a self-contained page (light and dark) with only what the person needs to agree: the style, every platform as a card with its texts as they will read, the part after the fold dimmed, a field's count only within a tenth of its limit. The check's verdicts, the remaining ⚠, the formats and the counts stay with the agent. It only shows: the texts are changed in `descriptions.json`, never on the page.

## descriptions.json

```json
{
  "title": "clip",
  "lang": "de",
  "style": "funny",
  "why": "Ein Blooper aus dem Studio: der Text macht den Witz, den das Video schon macht.",
  "x": {"premium": false},
  "known": {"instagram": ["mymuesli"], "x": ["mymuesli"]},
  "posts": {
    "instagram-reels": {"caption": "…"},
    "youtube": {"title": "…", "description": "…", "tags": ["…"]},
    "pinterest": {"title": "…", "description": "…", "alt": "…", "link": "https://…"}
  }
}
```

| key | |
| --- | --- |
| `style`, `why` | one of the styles, and one sentence why it fits this video (shown on the page) |
| `lang` | the texts' language; the page speaks German for `de`, else English |
| `x.premium` | X takes 25,000 instead of 280 (Basic, Premium and Premium+), and longer videos |
| `known` | handles that are right, per app (`instagram`, `tiktok`, `youtube`, `x`, `linkedin`, `facebook`, `threads`, `bluesky`, `pinterest`, `snapchat`) or as a plain list for all; the brand kit's `social` handles count too |
| `posts` | per platform id its fields (`descriptions.mjs platforms` names them); a post may have its own `style` |

## The platforms

Compared 2026-10-23; `tools/lib/platforms.mjs` holds them with every source. Hard limits come from the platforms' own API references and help centres; what shows before "more", the best number of hashtags and how long a title reads well come from third-party guides (no platform publishes them) and move with every app update.

| platform | id | fields: limit (how counted) | before "more" | hashtags | mentions | links | video |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Instagram Reels (every video post) | `instagram-reels` | caption 2,200 (UTF-16) | ~125 chars, 2 lines | **at most 5** (since Dec 2025), 3–5 | 20 | text only | 15 min (API), over 3 min not shown to non-followers |
| TikTok | `tiktok` | caption 2,200 (UTF-16, API; app 4,000) | ~80 chars | at most 5 (in-app since 2025), 3–5 | – | text only | 10 min |
| YouTube Shorts | `youtube-shorts` | title 100, description 5,000 **bytes**, tags 500 | title ~40–60 | over 60 → all ignored; 1–3 | – | not clickable | 3 min, 9:16 or 1:1 |
| YouTube | `youtube` | title 100, description 5,000 **bytes**, tags 500; chapters | title ~60–70, description ~150 | over 60 → all ignored; 1–3 | – | clickable | 15 min, 12 h verified |
| Facebook (every video a Reel) | `facebook` | text 63,206 (guides; none published) | ~125 chars | 1–3 | picked in the app | costs reach; pages: few link posts a month | – |
| LinkedIn | `linkedin` | text 3,000 | ~140 chars, 3 lines | 0–3 | picked in the app | clickable (reach cost observed) | 15 min (pages 10) |
| X | `x` | **280 weighted, 25,000 with Premium** | 280 (Premium) | 0–2 | 15-char names | 23 each, reach cost | 2:20, 4 h with Premium |
| Threads | `threads` | 500 (an emoji as its bytes) | – | **1 topic tag** | Instagram names | clickable, at most 5 | 5 min |
| Bluesky | `bluesky` | 300 graphemes after link shortening, 3,000 bytes; alt 2,000 | – | 0–2, 64 chars each | full handles | clickable | 10 min |
| Pinterest | `pinterest` | title 100, description 800, alt 500, link | title 40 in the feed | none (not searched) | – | link field | 4 s–5 min |
| Snapchat Spotlight | `snapchat-spotlight` | description 160 | – | 1–3 #topics | in the Snap | link field | 5 s–5 min, 9:16 only |

**X's count** is twitter-text v3 (`tools/lib/count.mjs`): NFC, every link 23 whatever its length (bare domains with a real ending too, so `storrito.com` and even `README.md`; the endings are twitter-text's list, `x-tlds.json`), every emoji with its skin tone and joiners 2, code points up to U+10FF and some punctuation 1, everything else 2 (CJK, `…`, `→`, `™`). It matches the npm package twitter-text 3.1.0 on 121 strings, except for emoji newer than that package's parser (2019), which the package counts by their code points; X's documentation says 2.

**Bluesky** stores a link typed with `https://` as its host and 13 characters of its path (the app's `toShortUrl`), and counts that; a bare domain counts in full.

**Threads**: Meta's documentation counts an emoji "as the number of UTF-8 bytes"; the tool takes that literally (an emoji 4 or more), the strictest reading.

### Sources

- Instagram: [Graph API, IG User Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media) (2,200 characters, 20 @ tags), [Help Center: 5 hashtags](https://help.instagram.com/351460621611097), [Social Media Today, Dec 2025](https://www.socialmediatoday.com/news/instagram-implements-new-limits-on-hashtag-use/808309/), [recommendation guidelines](https://help.instagram.com/313829416281232), [mentions in stories](https://help.instagram.com/218520165235356), [Reels features](https://about.instagram.com/features/reels), [Buffer's character counting](https://developers.buffer.com/guides/character-limits.md), [Sendible](https://www.sendible.com/insights/instagram-character-limit) (fold)
- TikTok: [Content Posting API, Direct Post](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post) (2,200 UTF-16), [content sharing guidelines](https://developers.tiktok.com/doc/content-sharing-guidelines), [5-hashtag cap](https://www.socialmediatoday.com/news/tiktok-implements-five-hashtag-limit-per-post/757857/), [Community Guidelines, integrity](https://www.tiktok.com/community-guidelines/en/integrity-authenticity), [branded content policy](https://www.tiktok.com/legal/page/global/bc-policy/en), [media transfer guide](https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide)
- YouTube: [Data API, videos](https://developers.google.com/youtube/v3/docs/videos) (title 100, description 5,000 bytes, tags 500), [titles and descriptions](https://support.google.com/youtube/answer/57404), [tags](https://support.google.com/youtube/answer/146402), [hashtags](https://support.google.com/youtube/answer/6390658), [chapters](https://support.google.com/youtube/answer/9884579), [Shorts](https://support.google.com/youtube/answer/15424877), [mentions](https://support.google.com/youtube/answer/9637404), [handles](https://support.google.com/youtube/answer/11585688), [spam and misleading metadata](https://support.google.com/youtube/answer/2801973), [links in Shorts](https://tubefilter.com/2023/08/10/youtube-shorts-comments-spam/), [vidIQ](https://vidiq.com/blog/post/youtube-video-descriptions/) (fold)
- Facebook: [every video a Reel](https://about.fb.com/news/2025/06/making-it-easier-create-videos-facebook/), [hashtags](https://www.facebook.com/help/587836257914341), [usernames](https://www.facebook.com/help/105399436216001), [engagement bait](https://transparency.meta.com/features/approach-to-ranking/content-distribution-guidelines/engagement-bait), [link posts for pages](https://www.socialmediatoday.com/news/facebook-pages-get-charged-for-link-posts/), [typecount](https://typecount.com/blog/facebook-post-character-limit-2026) (length, fold)
- LinkedIn: [3,000 characters](https://www.linkedin.com/help/linkedin/answer/a528176), [mentions](https://www.linkedin.com/help/linkedin/answer/a525082), [video for members](https://www.linkedin.com/help/linkedin/answer/a548372) and [for pages](https://www.linkedin.com/help/linkedin/answer/a1311816), [feed changes, March 2026](https://news.linkedin.com/2026/ImprovingTheFeed), [community policies](https://www.linkedin.com/legal/professional-community-policies), [see-more cut-off](https://linkedinpreview.com/blog/linkedin-see-more-cutoff-2026)
- X: [counting characters](https://docs.x.com/fundamentals/counting-characters), [twitter-text v3 config](https://github.com/twitter/twitter-text/blob/master/config/v3.json), [Premium](https://help.x.com/en/using-x/x-premium), [videos](https://help.x.com/en/using-x/x-videos), [hashtags](https://help.x.com/en/using-x/how-to-use-hashtags), [usernames](https://help.x.com/en/managing-your-account/x-username-rules), [spam policy](https://help.x.com/en/rules-and-policies/authenticity)
- Threads: [posts](https://developers.facebook.com/docs/threads/posts), [text attachments](https://developers.facebook.com/docs/threads/create-posts/text-attachments)
- Bluesky: [post lexicon](https://github.com/bluesky-social/bsky/blob/main/lexicons/app/bsky/feed/post.json), [facets](https://github.com/bluesky-social/bsky/blob/main/lexicons/app/bsky/richtext/facet.json), [link shortening](https://github.com/bluesky-social/social-app/blob/main/src/lib/strings/url-helpers.ts), [app limits](https://github.com/bluesky-social/social-app/blob/main/src/lib/constants.ts)
- Pinterest: [API v5 spec](https://github.com/pinterest/api-description/blob/main/v5/openapi.yaml) (title 100, description 800, alt 500), [Pin specs](https://help.pinterest.com/en/article/review-pin-specs), [product specs](https://help.pinterest.com/en/business/article/pinterest-product-specs), [community guidelines](https://policy.pinterest.com/en/community-guidelines)
- Snapchat: [Public Profile API](https://developers.snap.com/marketing-api/Public-Profile-API/ProfileAssetManagement) (Spotlight description 160), [recommendation guidelines](https://values.snap.com/policy/content-guidelines-recommendation-eligibility/recommendation-eligibility/commercial-content), [Spotlight for creators](https://creators.snapchat.com/learn-shine-in-the-spotlight-how-to-submit-to-spotlight)

**Where the sources disagree, the stricter number is in the table:** Instagram's API page still says 30 hashtags, the Help Center 5; TikTok's app takes 4,000 characters, its API 2,200; YouTube's API counts the description in bytes, its help page in characters; X's video limit is 2:20 on its help page and 20 min through the API; Facebook publishes no length at all. A platform that changes a limit is a change in `tools/lib/platforms.mjs` with its source and `CHECKED`.

## The styles

`tools/lib/styles.mjs`: how each sounds, what it does, which videos it fits, what it avoids, and a hook in English and German.

| style | sounds | fits |
| --- | --- | --- |
| `professional` | clear, competent, numbers and results | B2B, software, demos, announcements |
| `friendly` | warm, casual, a question back | behind the scenes, community, creators |
| `funny` | playful, self-ironic, a punchline | bloopers, pets, trends, everyday situations |
| `glamorous` | luxurious, sensory, few words with weight | fashion, beauty, travel, fine dining, events |
| `inspirational` | uplifting, before → after | fitness, transformations, founder stories |
| `educational` | the value first, steps, search words | tutorials, tips, explainers, screencasts |
| `hype` | punchy, fast, a real urgency | launches, drops, sport, music, events |
| `storytelling` | first person, tension and a turn | vlogs, journeys, customer stories |
| `minimal` | one line, the picture speaks | art, design, music, aesthetic loops |

The agent picks one: what the person said, else the brand's voice (`brand/DESIGN.md`), the video (what it shows, its pace and sound) and its audience. One style for all platforms; the platform moves the register within it (LinkedIn and a YouTube title to the clear end, TikTok and Reels to the loose end).

## What it does not do

- **Post.** It writes the texts; publishing is the person's or another skill's (story-from-link schedules stories through Storrito).
- **The switches.** Paid partnership, AI labels, collaborators, location, the cover: those are set in the apps; the agent tells the person when the video needs one.

## To do: hashtags and mentions that are checked

Today the hashtags are the agent's choice from what the video is about, and `check` only checks their form (how many, which characters, spam tags like #follow4follow, empty ones like #fyp). Nothing confirms that a tag is used for this topic or brings reach. A mention is warned about until the brand kit or the person confirms it; nothing checks that the account exists. No single service researches hashtags on every platform (compared 2026-10-23); the plan:

- [ ] **`hashtags <dir>`: candidates checked against real posts.** The agent proposes 5–8 tags per platform; the tool fetches about 20 recent posts per tag and platform and reports how recent they are, their views and what their captions are about; the agent keeps the tags that are really used for this topic. Source: [Apify's social media hashtag research](https://apify.com/apify/social-media-hashtag-research) (Instagram, TikTok, YouTube, Facebook; posts with views, likes, comments and dates, no totals per tag; about $2–5 per 1,000 posts). It scrapes, which the platforms' terms forbid: decide before building. Official sources where they suffice: Instagram's [hashtag search](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag-search) (about 30 tags a week per account), TikTok's Creative Center (trending tags only), the YouTube Data API (search by hashtag, an API key), Bluesky's public search, [RiteKit](https://help.ritekit.com/en/article/hashtag-stats-endpoint-hashtag-color-attribute-and-use-of-the-exposure-and-retweetshour-pnzylj/) for X (posts and impressions per hour).
- [ ] **Mentions looked up.** Instagram, Facebook and LinkedIn through [bundle.social](https://info.bundle.social/llms.txt) (an Instagram business or creator account by its name, public Facebook Pages with the ID a mention needs, LinkedIn's people and companies to mention) or Meta's own business discovery; YouTube's `channels?forHandle=`; Bluesky's public `resolveHandle`. TikTok and X have no lookup without a paid or unofficial API: they stay "unverified".
- [ ] **The overview marks every hashtag and mention as verified or not**, so the person knows what to look at before posting.

Not useful for this: hashtag generators (Ayrshare's Hashtags API, Zylalabs) suggest tags without showing their numbers, which is what the agent does already; social-listening tools (Brandwatch, Talkwalker) are built for monitoring a brand, at a brand's price.
