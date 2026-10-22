// The few words that should stand out in the captions, chosen by a model through OpenRouter:
// numbers with their units, product and brand names, the key word of a claim or a punchline, a
// call to action; about one word in eight, never two neighbours. Any language.

export const MARK_MODEL = "anthropic/claude-haiku-5.5";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["highlight"],
  properties: { highlight: { type: "array", items: { type: "integer" }, description: "the numbers of the words that stand out" } },
};

export async function mark(words, { model = MARK_MODEL, product } = {}) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");
  const numbered = words.map((w, i) => `[${i}]${w.text}`).join(" ");
  const prompt = `These are the words of a short video's captions, numbered. Choose the few words that should stand out in the captions, in a colour of their own: numbers with their units, names of products and brands${product ? ` (above all "${product}")` : ""}, the key word of a claim or of a punchline, a call to action. About one word in eight; never two neighbours; never fillers, articles or pronouns. Answer with their numbers.\n\n${numbered}`;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], response_format: { type: "json_schema", json_schema: { name: "highlight", strict: true, schema: SCHEMA } } }),
    signal: AbortSignal.timeout(120e3),
  });
  const j = await res.json();
  if (!res.ok || !j.choices?.[0]?.message?.content) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
  const picked = new Set(JSON.parse(j.choices[0].message.content.replace(/^```(json)?\s*|\s*```$/g, "")).highlight.filter((i) => i >= 0 && i < words.length));
  // never a word of two letters or less without a digit ("a", "to", "it": the model sometimes takes one)
  for (const i of [...picked]) if (!/\d/.test(words[i].text) && words[i].text.replace(/[^\p{L}]/gu, "").length <= 2) picked.delete(i);
  // never two neighbours: of two, the later goes
  for (const i of [...picked].sort((a, b) => a - b)) if (picked.has(i - 1)) picked.delete(i);
  return { highlight: [...picked].sort((a, b) => a - b), cost: j.usage?.cost ?? 0, model };
}
