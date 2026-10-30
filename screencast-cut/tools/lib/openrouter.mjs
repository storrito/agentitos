// OpenRouter, wherever this machine reaches it: with OPENROUTER_API_KEY, else through the
// Sprites gateway's openrouter connection (an rragent agent on a Sprite has no key of its own:
// the gateway at http://sprite.internal adds it), else not at all.
//
//   route()                     → { base, headers, via } or null
//   chat(model, messages, opts) → { text, cost }       (chat completions)
//   kindOf(text)                → "filler" | "word"    (a hesitation sound or a word)

const GATEWAY = process.env.SPRITE_GATEWAY_URL || "http://sprite.internal";
let found;

export async function route() {
  if (found !== undefined) return found;
  if (process.env.OPENROUTER_API_KEY) {
    found = { base: (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, ""),
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, via: "OPENROUTER_API_KEY" };
    return found;
  }
  try {
    const res = await fetch(`${GATEWAY}/v1/gateway/list`, { signal: AbortSignal.timeout(5000) });
    const list = await res.json();
    const c = (list.connections || []).find((x) => x.provider === "openrouter");
    if (c) {
      const base = (c.gateway_base_url || `${GATEWAY}/v1/gateway/openrouter/${c.id}`).replace(/\/$/, "");
      found = { base: base.endsWith("/v1") ? base : `${base}/v1`, headers: {}, via: "the Sprites gateway" };
      return found;
    }
  } catch {}
  found = null;
  return found;
}

export async function need(what) {
  const r = await route();
  if (!r) throw new Error(`${what} needs OpenRouter: set OPENROUTER_API_KEY, or connect OpenRouter in the Sprites gateway`);
  return r;
}

// Asked again after 5, 10 and 20 s on a network error, a rate limit or a server's error: the
// Sprites gateway now and then drops out for some 20 s (seen 2026-10-23: 502s and refused
// connections), and three tries in a row would all fall into it.
async function post(what, endpoint, body, { timeout = 300e3, log = () => {} } = {}) {
  const r = await need(what);
  const tries = 4;
  for (let attempt = 1; ; attempt++) {
    let res, text, why;
    try {
      res = await fetch(`${r.base}${endpoint}`, {
        method: "POST",
        headers: { ...r.headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      try { text = await res.text(); } catch (e) { text = null; why = `the answer broke off (${e.message})`; }
      if (text != null) {
        if (res.ok) return JSON.parse(text);
        if (!(res.status === 429 || res.status >= 500)) throw Object.assign(new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`), { final: true });
        why = `OpenRouter ${res.status}`;
      }
    } catch (e) {
      if (e.final) throw e;
      why = e.message;
    }
    if (attempt >= tries) throw new Error(`${what}: ${why} (asked ${tries} times)`);
    const wait = 5 * 2 ** (attempt - 1);
    log(`  ${what}: ${why}, again in ${wait} s …`);
    await new Promise((ok) => setTimeout(ok, wait * 1000));
  }
}

// messages as OpenRouter takes them; `json` asks for a JSON object back
export async function chat(model, messages, { json = false, maxTokens = 4000, log } = {}) {
  const j = await post(model, "/chat/completions", {
    model, messages, max_tokens: maxTokens, temperature: 0,
    ...(json ? { response_format: { type: "json_object" } } : {}),
  }, { log });
  return { text: j.choices?.[0]?.message?.content ?? "", cost: j.usage?.cost ?? 0 };
}

// hesitation sounds in the languages people record in most
const FILLER = /^(ä+h+m*|ö+h*m+|e+h+m*|a+h+m+|u+h+m*|u+m+|e+r+m+|h+m+|m+h*m+|mhm)$/i;
export const kindOf = (text) => (FILLER.test(String(text).replace(/[^\p{L}]/gu, "")) ? "filler" : "word");
