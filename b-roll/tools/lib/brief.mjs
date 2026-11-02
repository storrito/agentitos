// brief.md: what the agent reads before it writes broll.json. The rules of good b-roll, the
// format, the material at hand, and every word, numbered, a line per sentence.

import { clock } from "./media.mjs";

// one line per sentence or after a pause, each word with its number: [0:12.4] [41]Die [42]erste …
export function wordsText(words) {
  const lines = [];
  let line = [], prev = null;
  const flush = () => { if (line.length) lines.push(line.join(" ")); line = []; };
  for (const w of words) {
    const gap = prev ? w.start - prev.end : w.start;
    if (!line.length || gap >= 0.6 || /[.!?…]["”']?$/.test(prev?.text || "")) {
      flush();
      line.push(`[${clock(w.start)}]`);
    }
    line.push(`[${w.i}]${w.text}`);
    prev = w;
  }
  flush();
  return lines.join("\n");
}

export function brief({ words, width, height, duration, material, brand }) {
  const list = material.length
    ? material.map((m) => `- \`${m.file}\`: ${m.what}`).join("\n")
    : "- nothing yet: the person brought no pictures or videos. Pages and posts you can take with `shot`; a number needs no material.";
  return `# Directing the b-roll

The person talks; b-roll shows what they talk about, at the moment they say it. You choose
the moments and what is shown, the tool places them on the words, frames them for the
platforms and checks them. Read all of this, then write \`broll.json\` next to this file.

The video: ${width}×${height}, ${clock(duration)}, ${words.length} words.${brand ? ` Brand kit: ${brand} (a number card takes its colours and font).` : ""}

## What good b-roll is

1. **The whole first.** Read all the words and know the point of the video before you pick a
   single moment: what a sentence is about depends on the ones around it.
2. **Show the point, not the word.** Ask of every sentence: what is it actually about? The
   noun in it is often not the thing. "What Anna wrote about it" is her post, not her face;
   "like Apple did with the iPhone" is the thing Apple did; "our new feature" is that feature
   on the screen, not the logo.
3. **What to show:**

   | the words | show |
   | --- | --- |
   | the person's own product, app or website | its page (\`shot\`), or their own screenshot or screen recording |
   | a number, a price, a result | a number card (\`"number"\`), or the number where it lives (the dashboard, the price on the page) |
   | a post, a review, "people say" | the post itself: \`shot\` of its link on X; another network's post as a screenshot the person brings |
   | an article, a study, a piece of news | its headline as the page shows it (\`shot\`) |
   | a place, a thing, a person the viewer knows | a photo or video the person brought |
   | a step ("then you click on …") | their screen recording of that step |
   | a feeling, a metaphor, a joke, a reaction | nothing: the face carries it |

4. **Fewer, right ones.** No b-roll is better than wrong b-roll. Never a picture only loosely
   linked to a keyword, never stock that merely fits the mood. A moment you cannot show
   accurately with what there is: leave it out, or name what the person could bring.
5. **The rhythm.** A beat runs 2–4 s, a number card 2–3 s, a page or a post as long as
   reading it takes (about a second for four words, up to 6 s); none under 1.2 s, at most one
   hold over 5 s. Denser in the first seconds (the hook), sparse after. A talking-head video
   gets b-roll over about 10–30 % of its length, a podcast clip less: the speaker carries it.
   Two beats less than 1.2 s apart are joined by the tool (a flash of the face between them
   looks like a mistake).
6. **On the word, never before it.** \`"at"\` is the number of the word that names the thing:
   the beat starts as it is said. \`"until"\` is the last word it belongs to; without one it
   runs to the end of the sentence, 2–4 s (or \`"seconds"\`).
7. **The frame.** \`"fill"\`: fills the frame, cut at its edges (photos and footage of about
   the frame's shape). \`"whole"\`: all of it, over a blurred copy of itself (another shape; a
   product or a person that must not be cut). \`"read"\`: all of it inside the area the apps
   leave free, over a blurred copy or the brand's colour (pages, posts, headlines, anything
   with text). Without \`"fit"\` the tool takes fill or whole by the shape, and read for what
   \`shot\` took.
8. **Never** the speaker's own face as b-roll; never a picture with someone else's watermark,
   burned-in subtitles or a stranger's name; nothing the person may not use. Someone else's
   post or article gets \`"credit": true\` (the source in small type at the bottom).

## broll.json

\`\`\`json
{
  "beats": [
    {"at": 12, "show": "uploads/shop.jpg", "why": "the shop she names"},
    {"at": 40, "until": 47, "show": "broll/post.png", "credit": true, "why": "the post he quotes"},
    {"at": 63, "number": "+300 %", "label": "reach in three weeks", "why": "the result"},
    {"at": 80, "show": "uploads/demo.mp4", "from": 4.5, "fit": "fill", "why": "the export, as she says it"}
  ]
}
\`\`\`

- \`at\`, \`until\`: word numbers below. \`seconds\` instead of \`until\` for a length of its own.
- \`show\`: a picture (PNG, JPEG, WebP, HEIC) or a video (played muted, from second \`from\`),
  a path from the working directory. Or \`number\` (short: "+300 %", "2,4 Mio.", "€ 19") with an
  optional \`label\` of a few words.
- \`fit\`: fill, whole or read. \`credit\`: true (the source \`shot\` noted) or a text ("Spiegel").
- \`why\`: what the sentence is about and why this shows it, in a few words; the person sees
  it in the chat.

## The material

${list}

## The words

${wordsText(words)}
`;
}
