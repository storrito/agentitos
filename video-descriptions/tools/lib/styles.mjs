// The styles a video's texts can be written in: how each sounds, what it does, which videos it
// fits and what it avoids. The agent picks one from the video, the brand's voice and the
// audience, and says why; the person may name another. One style for all platforms: the
// platform changes the register (LinkedIn and a YouTube title lean to the clear end of it), not
// the voice.

export const STYLES = [
  {
    id: "professional", name: "Professional", nameDe: "Professionell",
    sounds: "clear, competent, calm; full sentences, concrete numbers and results",
    does: ["the benefit or the result in the first line", "facts and numbers from the video only", "at most one emoji, often none", "a soft call to action (\"More in the link\", \"Which do you use?\")"],
    fits: ["B2B, software, product demos and screencasts", "announcements, results, case studies", "experts explaining their field", "a brand whose voice is formal or uses Sie"],
    avoids: ["slang, exclamation marks in a row, hype words (\"insane\", \"game-changer\")"],
    hook: { en: "Scheduling 30 stories took us 4 minutes. Here is how.", de: "30 Stories in 4 Minuten eingeplant. So geht's." },
  },
  {
    id: "friendly", name: "Friendly", nameDe: "Locker & nahbar",
    sounds: "warm, casual, like a message to a friend; du, short sentences, a question back",
    does: ["talks to one person (you, du)", "two or three emoji where a voice would smile", "ends with a real question the viewer can answer in a word"],
    fits: ["behind the scenes, everyday moments, the team", "community posts, small businesses, creators talking to camera", "a brand that says du and writes like it talks"],
    avoids: ["corporate words, passive voice, more than three emoji"],
    hook: { en: "Okay, this is how our Mondays actually look ☕", de: "Okay, so sehen unsere Montage wirklich aus ☕" },
  },
  {
    id: "funny", name: "Funny", nameDe: "Witzig",
    sounds: "playful, self-ironic, a punchline; wordplay, understatement, the joke the video already makes",
    does: ["the hook is the punchline or sets it up", "an emoji as the rim shot (😅 🙃 💀), not as decoration", "short: a joke explained is no joke", "the joke comes from the video, never at someone's expense"],
    fits: ["bloopers, fails, pets, trends and memes", "a situation everybody knows (\"when the client says…\")", "a video with music or a sound that is already funny", "a brand that jokes in its own words"],
    avoids: ["jokes about people, groups or tragedies; irony on LinkedIn that reads as a complaint"],
    hook: { en: "Me: one quick edit. Also me, 3 hours later:", de: "Ich: nur kurz was schneiden. Auch ich, 3 Stunden später:" },
  },
  {
    id: "glamorous", name: "Glamorous", nameDe: "Glamourös",
    sounds: "luxurious, sensory, elegant; few words with weight, light and texture, a touch of French or Italian ease",
    does: ["short evocative lines, line breaks as pauses", "the senses: shine, silk, golden hour, the first sip", "✨ 🤍 🥂 sparingly, never more than two", "no price, no urgency unless the brand wants it"],
    fits: ["fashion, beauty, jewellery, perfume", "luxury travel, hotels, fine dining, weddings, events", "slow, beautifully lit footage with music"],
    avoids: ["discount words (\"cheap\", \"deal\"), caps, slang, crowded hashtags"],
    hook: { en: "Golden hour, but make it couture ✨", de: "Goldene Stunde, nur eleganter ✨" },
  },
  {
    id: "inspirational", name: "Inspirational", nameDe: "Inspirierend",
    sounds: "uplifting, aspirational, honest; a struggle and a way through, the viewer as the hero",
    does: ["the hook names the goal or the change (before → after)", "one clear thought, no list of platitudes", "ends with an invitation (\"Save this for the day you need it\")"],
    fits: ["fitness, health, transformations", "founder and personal stories, milestones", "nature, sport, achievements"],
    avoids: ["empty quotes, \"hustle\" pressure, promises of results the video does not show"],
    hook: { en: "A year ago I couldn't run 5 km. Today: the marathon.", de: "Vor einem Jahr schaffte ich keine 5 km. Heute: Marathon." },
  },
  {
    id: "educational", name: "Educational", nameDe: "Lehrreich",
    sounds: "helpful and precise; the value first, steps in order, words people search for",
    does: ["a hook that promises what one learns (\"3 ways to…\", \"Why … happens\")", "numbered steps or short lines, the keyword of the topic in the first sentence", "\"Save this for later\" fits here"],
    fits: ["tutorials, tips, how-tos, explainers, screencasts", "recipes, DIY, software features", "a video that shows steps"],
    avoids: ["steps the video does not show, jargon without a word of explanation"],
    hook: { en: "3 settings that make your Reels look sharper:", de: "3 Einstellungen, mit denen deine Reels schärfer aussehen:" },
  },
  {
    id: "hype", name: "Bold & energetic", nameDe: "Laut & energiegeladen",
    sounds: "punchy, fast, confident; short sentences, verbs first, one word in capitals at most",
    does: ["the news in three words (\"It's here.\")", "urgency only when it is real (a date, a drop, a limited run)", "🔥 ⚡ 🚀 at most two", "a direct call to action"],
    fits: ["launches, drops, sales, countdowns", "sport, music, events, trailers", "fast cuts with beat-synced music"],
    avoids: ["fake scarcity, ALL CAPS sentences, a pile of exclamation marks"],
    hook: { en: "It's here. And it's fast.", de: "Es ist da. Und es ist schnell." },
  },
  {
    id: "storytelling", name: "Storytelling", nameDe: "Erzählend",
    sounds: "personal and narrative; first person, a moment of tension, a turn, a lesson",
    does: ["opens in the middle of the story (\"The moment the camera died…\")", "short paragraphs, the turn before the fold", "ends with what it meant, or a question about the viewer's own story"],
    fits: ["vlogs, journeys, a day in the life", "customer stories and case studies", "behind the scenes of something that went wrong or right"],
    avoids: ["a summary instead of a story, invented details"],
    hook: { en: "We almost cancelled this shoot. Then the rain stopped.", de: "Fast hätten wir den Dreh abgesagt. Dann hörte der Regen auf." },
  },
  {
    id: "minimal", name: "Minimal", nameDe: "Minimalistisch",
    sounds: "quiet, one line, the picture speaks; lowercase is fine where the brand writes so",
    does: ["one line, sometimes a single word or an emoji", "few hashtags, all precise", "on YouTube and Pinterest still a clear title with the keyword: search needs words"],
    fits: ["art, design, photography, architecture", "music, ASMR, aesthetic loops", "a brand with a reduced voice"],
    avoids: ["explaining what is plainly seen, call-to-action phrases"],
    hook: { en: "quiet mornings.", de: "leise morgen." },
  },
];

export const styleById = (id) => STYLES.find((s) => s.id === id);
