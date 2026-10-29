# publish-video

A finished video → checked whether it is ready, published through [Storrito](https://storrito.com/) on the accounts the person picks, with each platform's texts from [video-descriptions](../video-descriptions/). Either **short-form** (9:16: Instagram Reels and Stories, TikTok, YouTube Shorts, Facebook, LinkedIn, Pinterest, Snapchat, Threads, X) or **long-form** on YouTube (16:9, up to 4 hours). Scheduled for a time, or posted now.

> Agents: start with [`SKILL.md`](SKILL.md). It is written for [rragent](https://github.com/storrito/rragent): the questions are asked in the chat, the texts agreed on video-descriptions' overview.

```bash
node tools/publish.mjs check uploads/clip.mp4 publish/clip          # measured, short or long, ✗ and ⚠, frames.jpg
node tools/publish.mjs check publish/clip --mode long                # when the video leaves the mode open
node tools/publish.mjs prepare publish/clip [--pad|--crop] [--loudness] [--start 0.8] [--end 41.2]
node tools/publish.mjs accounts publish/clip                         # the targets this video fits, and why not the others
node tools/publish.mjs accounts publish/clip --hiccup --lang de      # the same as the question for the chat
# the agent writes descriptions/clip/descriptions.json with video-descriptions; the person agrees
node tools/publish.mjs publish publish/clip --to instagram/storrito_com/reel,tiktok/storrito/post \
  --at 2026-10-29T18:00:00+01:00 --tiktok-privacy public
node tools/publish.mjs status publish/clip [--wait 300]              # scheduled, published (with the link) or failed
node tools/publish.mjs cancel publish/clip [--to <target>]           # takes scheduled posts back
```

Requirements: Node 20+, ffmpeg. agentitos' [video-descriptions](../video-descriptions/) beside this skill for the texts (`VIDEO_DESCRIPTIONS` may name its `tools/descriptions.mjs`), [platform-zones](../platform-zones/) for what the apps cover (`PLATFORM_ZONES`); both are run as programs, not imported. Storrito: on a [Sprite](https://sprites.dev) through the gateway's Storrito connection, elsewhere `STORRITO_API_URL` (`https://<org>.storrito.com`) and `STORRITO_CREDENTIAL` (`<id>:<secret>`). No npm packages.

## How it works

1. **`check`** takes the video from a path or a link (Google Drive and Dropbox share links are turned into downloads; a page on YouTube, Instagram or TikTok is refused) and measures it: frame, size, codec, fps, bitrate, container, length, the sound's loudness (EBU R128) and true peak, black picture and silence in the first and last three seconds. Each ffmpeg reads only what it needs: the sound alone, three seconds at each end, one frame per tile of the sheet.
   It suggests **short** or **long** from the frame and the length, and says when the video leaves it open (16:9 under 3 min, 9:16 over 3 min, square). It writes `job.json` and `uploads/publish-<name>/frames.jpg`: twelve frames, the first and the last among them; on a 9:16 video the areas Reels, TikTok, Shorts and Facebook Reels cover outlined in red and the safe box in green, from platform-zones (the person's platforms with `--platforms`).
2. **`prepare`** writes `video.mp4` where that is mechanical and checks it again. Short: H.264 1080×1920, at most 20 Mbit/s and 60 fps, AAC, `+faststart`; a video that is not 9:16 only with `--pad` (black bars) or, when it is nearly 9:16, `--crop`. Long: the picture is copied when YouTube takes its codec, else encoded as H.264. `--loudness` brings the sound to -14 LUFS, `--start` and `--end` cut its ends.
3. **`accounts`** reads Storrito's `list-social-accounts`: every post type that publishes a video becomes a target (`<platform>/<account>/<post type>`) with its procedure, duration limits, caption limit and options. Against the job it says which fit and why the others do not: disconnected, the other mode, too long or too short for that post type. `--hiccup --lang de` prints the question for the chat: grouped by platform, each account with its profile picture (copied into `uploads/publish-accounts/`, since the platforms' links to them expire) or its platform's icon (drawn into `uploads/publish-icons/`), the disconnected and too long ones greyed out with why, ticked only the targets of the last publish (`publish/targets.json`).
4. **`publish`** runs video-descriptions' `check` on the texts and refuses while it finds a ✗. It builds every target's parameters before it uploads anything, so that a missing text or choice stops all of them. Then it uploads the video once as a Storrito temp-blob, reused for 20 hours, and calls each target's procedure with a UUID kept in `plan.json`. A second run skips what is done. A target already scheduled with another video or other texts is refused until `cancel` took it back.
5. **`status`** asks each post's status procedure; with `--wait` until the posts that are due are out, with their links.

## What goes where

| target | procedure | texts (descriptions.json) | the person chooses |
| --- | --- | --- | --- |
| Instagram Reel | `schedule-instagram-reel` | `instagram-reels.caption` → `caption`; `shareToFeed` on (`--no-feed`) | – |
| TikTok (connected directly) | `schedule-tiktok-post` | `tiktok.caption` → `title` (TikTok's caption); the cover's moment (`--tiktok-cover`, the agent's pick) → `videoCoverTimestampMs` | `privacyLevel` (`--tiktok-privacy`), never a default |
| YouTube Short | `schedule-social-post` `SHORT` | `youtube-shorts.description` → `text`, `.title` → `name` and the `title` option | the `privacy` and `madeForKids` options (`--privacy`, `--made-for-kids no\|yes`), required |
| Facebook, LinkedIn, Pinterest, Snapchat, Threads, X, … | `schedule-social-post` | the platform's caption or text → `text`; `title`, `link` and alt text into the post type's options of that name | required options (`--option <target>:<key>=<value>`) |
| YouTube video (long) | `upload-youtube-video` | `youtube.title`, `.description` (chapters); the language from `lang` | `privacy`, `madeForKids` (`--made-for-kids no\|yes`), required; a thumbnail |

Every rendered procedure gets `<insta-story src="<temp-blob url>"></insta-story>`: Storrito renders it as the video, H.264 1080×1920 at most 30 Mbit/s, which is why short-form needs 9:16. Without `date` a post goes out as soon as it is rendered. `--ai-generated`, `--paid` and `--own-brand` set the disclosures where a procedure has them.

Not sent: YouTube's tags (the API takes none; they are added in YouTube Studio). Bluesky is not among the platforms Storrito names; should `list-social-accounts` list it, its texts are video-descriptions' `bluesky`.

## Files

```
publish/<name>/job.json     the video, the mode, what was measured and found, when
publish/<name>/source.*     a video from a link
publish/<name>/video.mp4    the video prepare wrote
publish/<name>/plan.json    the uploads and every post with its UUID, status and link
publish/targets.json        the targets of the last publish, ticked when the next video's accounts are asked
uploads/publish-<name>/frames.jpg   the sheet, for the chat
uploads/publish-accounts/   the accounts' pictures; uploads/publish-icons/ the platforms' icons
descriptions/<name>/        video-descriptions' folder: descriptions.json, the overview
```

## What it does not do

- **Edit the video.** It writes it again in the form Storrito or YouTube takes and cuts empty ends; reframing is [auto-reframe](../auto-reframe/)'s, captions [captions](../captions/)', a thumbnail [thumbnail-and-intro](../thumbnail-and-intro/)'s.
- **Facebook Stories.** A video goes out as an Instagram Story (up to 60 s, no text); the Story post types of other platforms are left out.

## To do

- [ ] **Both at once**: the long-form video on YouTube and one or more 9:16 moments of it as short-form, pointing to it ([clips](../clips/) finds and cuts such moments).
- [ ] **clips through this tool**: clips schedules its shorts with Storrito's procedures itself; its step 6 could call `publish` per clip.
- [ ] **Daily limits**: Storrito names a limit of posts per day and account (TikTok and YouTube 10, X 15, LinkedIn 18); the tool does not count what else is scheduled that day.
