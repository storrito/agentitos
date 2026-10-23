// What each platform lays over a video, per frame, as data. A new platform or a new measurement is
// a change here and nowhere else.
//
// Every frame of a platform is measured on its canvas (`canvas`, in px) and holds:
//   margins  how far text, faces and the thing being shown stay from each edge: the safe box
//   covers   what the app draws over the video, each a box [x, y, w, h] with what it is; where an
//            entry gives none, the four margins are the covers
//   crops    where the app shows the video cut to another ratio, centred (Instagram's feed shows a
//            reel at 4:5, the profile grids at 3:4): what must be seen there stays inside
//   basis    how sure the numbers are: "official" (the platform publishes them for organic posts),
//            "ads" (the platform's numbers for ads, with a call-to-action button the organic post
//            does not have), "guides" (third-party guides that roughly agree), "estimate" (no
//            source gives numbers; read off the app's layout, rounded up)
//   sources  where the numbers come from; `CHECKED` the day they were last compared
//
// No platform but Pinterest publishes numbers for organic posts. The guides disagree by up to
// 200 px, and the apps change their layout without notice: the numbers here lean to the larger
// side of what the sources give, so what stays inside them stays clear on every phone they name.

export const CHECKED = "2026-10-23";

const V = [1080, 1920], P = [1080, 1350], S = [1080, 1080], L = [1920, 1080];

export const PLATFORMS = [
  {
    id: "instagram-reels", name: "Instagram Reels", aliases: ["reels", "ig-reels", "instagram"],
    frames: {
      "9:16": {
        canvas: V, basis: "guides",
        margins: { top: 250, bottom: 420, left: 60, right: 200 },
        covers: [
          { what: "the Reels header and the camera", box: [0, 0, 1080, 200] },
          { what: "the username, follow, caption and audio", box: [0, 1500, 1080, 420] },
          { what: "like, comment, share, save and the audio's cover", box: [880, 1040, 200, 880] },
        ],
        crops: [{ where: "the Instagram feed", ratio: "4:5" }, { where: "the profile grid", ratio: "3:4" }],
        note: "Meta's numbers for Reels ads are larger (14 % top, 35 % bottom, 6 % sides): they make room for the ad's button.",
        sources: [
          "https://outfy.com/blog/instagram-safe-zone",
          "https://pod2reels.com/blog/instagram-reels-safe-zone-guide",
          "https://reelsafezone.com",
          "https://campaignswift.com/blog/instagram-safe-zone-sizes",
          "https://blog.adnabu.com/meta-ads/meta-safe-zones/",
        ],
      },
    },
  },
  {
    id: "instagram-story", name: "Instagram Story", aliases: ["story", "ig-story", "stories"],
    frames: {
      "9:16": {
        canvas: V, basis: "guides",
        margins: { top: 250, bottom: 300, left: 60, right: 60 },
        covers: [
          { what: "the progress bars, the profile and close", box: [0, 0, 1080, 220] },
          { what: "the reply field, like and send", box: [0, 1680, 1080, 240] },
        ],
        sources: [
          "https://help.zuuvi.com/en/articles/8907258-social-content-safe-zone-guide",
          "https://argil.ai/blog/instagram-story-dimensions",
          "https://videobgremover.com/blog/instagram-story-specs",
        ],
      },
    },
  },
  {
    id: "instagram-feed", name: "Instagram feed post", aliases: ["ig-feed", "instagram-post"],
    frames: {
      "4:5": {
        canvas: P, basis: "estimate",
        margins: { top: 54, bottom: 100, left: 54, right: 54 },
        covers: [
          { what: "the people tagged", box: [0, 1250, 120, 100] },
          { what: "sound on and off", box: [960, 1250, 120, 100] },
        ],
        crops: [{ where: "the profile grid", ratio: "3:4" }],
        sources: ["https://www.clipspeed.ai/blog/best-aspect-ratio-short-form-video.html"],
      },
      "1:1": {
        canvas: S, basis: "estimate",
        margins: { top: 54, bottom: 100, left: 54, right: 54 },
        covers: [
          { what: "the people tagged", box: [0, 980, 120, 100] },
          { what: "sound on and off", box: [960, 980, 120, 100] },
        ],
        crops: [{ where: "the profile grid", ratio: "3:4" }],
        sources: ["https://www.clipspeed.ai/blog/best-aspect-ratio-short-form-video.html"],
      },
    },
  },
  {
    id: "tiktok", name: "TikTok", aliases: ["tik-tok"],
    frames: {
      "9:16": {
        canvas: V, basis: "guides",
        margins: { top: 160, bottom: 480, left: 60, right: 180 },
        covers: [
          { what: "Following, For You, LIVE and search", box: [0, 0, 1080, 150] },
          { what: "the username, caption and sound", box: [0, 1440, 1080, 480] },
          { what: "the profile, like, comment, save, share and the sound's disc", box: [900, 700, 180, 1220] },
        ],
        crops: [{ where: "the profile grid", ratio: "3:4" }],
        note: "TikTok's own advice for ads is the top and bottom 10 % and the right 10 % at the least; its templates for ads are larger.",
        sources: [
          "https://www.revid.ai/tiktok-safe-zone",
          "https://imagevideofit.com/guides/tiktok-safe-zone",
          "https://novustools.com/social-safe-zone/guides/tiktok-safe-zone",
          "https://help.zuuvi.com/en/articles/8907258-social-content-safe-zone-guide",
          "https://www.relevantaudience.com/tiktok-ads/tiktok-video-size-ad-specs/",
        ],
      },
    },
  },
  {
    id: "youtube-shorts", name: "YouTube Shorts", aliases: ["shorts", "yt-shorts"],
    frames: {
      "9:16": {
        canvas: V, basis: "guides",
        margins: { top: 200, bottom: 400, left: 48, right: 192 },
        covers: [
          { what: "search, camera and the menu", box: [0, 0, 1080, 160] },
          { what: "the title, channel, subscribe, sound and the progress bar", box: [0, 1520, 1080, 400] },
          { what: "like, dislike, comment, share, remix and the sound", box: [888, 860, 192, 1060] },
        ],
        note: "Google's template for vertical video ads keeps 288 px top and 672 px bottom free, for the ad's button.",
        sources: [
          "https://www.revid.ai/youtube-shorts-safe-zone",
          "https://www.poster.ly/tools/youtube-shorts-safe-zone-checker",
          "https://imagevideofit.com/guides/youtube-shorts-safe-zone",
          "https://support.google.com/google-ads/answer/13547298?hl=en",
        ],
      },
    },
  },
  {
    id: "youtube", name: "YouTube video", aliases: ["yt", "youtube-video"],
    frames: {
      "16:9": {
        canvas: L, basis: "estimate",
        margins: { top: 108, bottom: 150, left: 96, right: 96 },
        covers: [
          { what: "the title and the buttons, while paused or touched", box: [0, 0, 1920, 100] },
          { what: "the progress bar and the controls, while paused or touched", box: [0, 940, 1920, 140] },
        ],
        note: "End screens cover large parts of the last 5–20 seconds when the video has them. The sides are the 5 % title-safe border of broadcast.",
        sources: [
          "https://support.google.com/youtube/answer/6375112",
          "https://postfa.st/blog/youtube-dimensions-video",
        ],
      },
    },
  },
  {
    id: "facebook-reels", name: "Facebook Reels", aliases: ["fb-reels"],
    frames: {
      "9:16": {
        canvas: V, basis: "guides",
        margins: { top: 250, bottom: 480, left: 60, right: 200 },
        covers: [
          { what: "the Reels header", box: [0, 0, 1080, 200] },
          { what: "the page, follow, caption and audio", box: [0, 1440, 1080, 480] },
          { what: "like, comment, share and more", box: [880, 1000, 200, 920] },
        ],
        note: "Facebook shows more of the caption than Instagram: its bottom is larger.",
        sources: [
          "https://adkit.so/tools/safe-zones/facebook",
          "https://www.socialync.io/tools/safe-zones/facebook-reels",
          "https://houseofmarketers.com/guide-to-safe-zones-tiktok-facebook-instagram-stories-reels/",
        ],
      },
    },
  },
  {
    id: "facebook-story", name: "Facebook Story", aliases: ["fb-story"],
    frames: {
      "9:16": {
        canvas: V, basis: "ads",
        margins: { top: 270, bottom: 384, left: 60, right: 60 },
        covers: [
          { what: "the progress bars, the page and close", box: [0, 0, 1080, 230] },
          { what: "the reply field and reactions", box: [0, 1620, 1080, 300] },
        ],
        note: "Meta's Facebook Stories guidance: 14 % top, 20 % bottom.",
        sources: ["https://blog.adnabu.com/meta-ads/meta-safe-zones/", "https://withblip.com/blog/how-to-use-meta-ad-safe-zones-without-cutting-off-your-creative/"],
      },
    },
  },
  {
    id: "facebook-feed", name: "Facebook feed post", aliases: ["fb-feed", "facebook"],
    frames: {
      "4:5": { canvas: P, basis: "estimate", margins: { top: 54, bottom: 110, left: 54, right: 54 }, sources: ["https://adkit.so/tools/safe-zones/facebook"] },
      "1:1": { canvas: S, basis: "estimate", margins: { top: 54, bottom: 110, left: 54, right: 54 }, sources: ["https://adkit.so/tools/safe-zones/facebook"] },
      "16:9": { canvas: L, basis: "estimate", margins: { top: 54, bottom: 110, left: 96, right: 96 }, sources: ["https://adkit.so/tools/safe-zones/facebook"] },
    },
  },
  {
    id: "snapchat-story", name: "Snapchat Story", aliases: ["snapchat", "snap"],
    frames: {
      "9:16": {
        canvas: V, basis: "guides",
        margins: { top: 150, bottom: 150, left: 48, right: 48 },
        sources: [
          "https://help.zuuvi.com/en/articles/8907258-social-content-safe-zone-guide",
          "https://brand-qa2.canadiantire.ca/en/ctr/design-system/omni-channel/motion/margins-and-safe-space.html",
          "https://strikesocial.com/blog/snapchat-ad-specs/",
        ],
      },
    },
  },
  {
    id: "snapchat-spotlight", name: "Snapchat Spotlight", aliases: ["spotlight"],
    frames: {
      "9:16": {
        canvas: V, basis: "estimate",
        margins: { top: 150, bottom: 400, left: 48, right: 180 },
        covers: [
          { what: "the header", box: [0, 0, 1080, 150] },
          { what: "the creator, caption and sound", box: [0, 1520, 1080, 400] },
          { what: "like, comment, share and more", box: [900, 1000, 180, 920] },
        ],
        note: "No source gives numbers for Spotlight; its layout is that of Reels.",
        sources: ["https://instasize.com/size-guides/snapchat/story"],
      },
    },
  },
  {
    id: "pinterest", name: "Pinterest video Pin", aliases: ["pin", "pinterest-video"],
    frames: {
      "9:16": {
        canvas: V, basis: "official",
        margins: { top: 270, bottom: 790, left: 65, right: 195 },
        note: "Pinterest's own numbers; it names no canvas, they fit 1080×1920, its recommended size.",
        sources: ["https://help.pinterest.com/en/article/review-pin-specs"],
      },
    },
  },
  {
    id: "linkedin", name: "LinkedIn video", aliases: ["linkedin-video"],
    frames: {
      "9:16": {
        canvas: V, basis: "estimate",
        margins: { top: 230, bottom: 420, left: 60, right: 180 },
        covers: [
          { what: "back and the menu", box: [0, 0, 1080, 180] },
          { what: "the author, follow and the post's text", box: [0, 1500, 1080, 420] },
          { what: "like, comment, repost and send", box: [900, 1000, 180, 920] },
        ],
        note: "Shown full screen only once tapped; in the feed a 9:16 video is shown at 4:5.",
        crops: [{ where: "the LinkedIn feed", ratio: "4:5" }],
        sources: ["https://www.tella.com/help/editing/social-safe-zones", "https://quso.ai/blog/linkedin-video-specs"],
      },
      "4:5": { canvas: P, basis: "estimate", margins: { top: 54, bottom: 120, left: 54, right: 54 }, sources: ["https://quso.ai/blog/linkedin-video-specs"] },
      "1:1": { canvas: S, basis: "estimate", margins: { top: 54, bottom: 120, left: 54, right: 54 }, sources: ["https://quso.ai/blog/linkedin-video-specs"] },
      "16:9": { canvas: L, basis: "estimate", margins: { top: 54, bottom: 120, left: 96, right: 96 }, sources: ["https://quso.ai/blog/linkedin-video-specs"] },
    },
  },
  {
    id: "x", name: "X (Twitter)", aliases: ["twitter"],
    frames: {
      "16:9": { canvas: L, basis: "estimate", margins: { top: 54, bottom: 110, left: 96, right: 96 }, note: "The player's controls run along the bottom while touched.", sources: ["https://socialk.it/it/sizes/x-video-size"] },
      "1:1": { canvas: S, basis: "estimate", margins: { top: 54, bottom: 110, left: 54, right: 54 }, sources: ["https://socialk.it/it/sizes/x-video-size"] },
      "9:16": {
        canvas: V, basis: "estimate",
        margins: { top: 200, bottom: 420, left: 60, right: 60 },
        note: "X shows a vertical video small in the timeline; full screen, the post's text and buttons lie over its bottom.",
        sources: ["https://www.clipspeed.ai/tools/social-media-video-dimensions.html"],
      },
    },
  },
];

// Where the person did not say where the video goes: the platforms a video of this frame most
// likely goes to, taken together, so what stays in the safe box stays clear on each of them.
// Pinterest's bottom (790 px) and the full-screen views of LinkedIn and X are left out: they would
// take a third of every vertical video for places it seldom goes; name them to have them.
export const DEFAULTS = {
  "9:16": ["instagram-reels", "instagram-story", "tiktok", "youtube-shorts", "facebook-reels"],
  "4:5": ["instagram-feed", "facebook-feed", "linkedin"],
  "1:1": ["instagram-feed", "facebook-feed", "linkedin", "x"],
  "16:9": ["youtube", "facebook-feed", "linkedin", "x"],
};

// A frame far from all of these (a 21:9 film, a 2:1 banner) gets the safe border of broadcast,
// with room at the bottom for a player's controls.
export const GENERIC = { basis: "estimate", margins: { top: 0.05, bottom: 0.1, left: 0.05, right: 0.05 }, note: "No platform's numbers for this frame: the broadcast title-safe border, more at the bottom for a player's controls." };
