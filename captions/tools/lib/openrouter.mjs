// OpenRouter as this machine reaches it: with OPENROUTER_API_KEY, else through the Sprites
// gateway's OpenRouter connection. An rragent agent on a Sprite often has no key of its own: the
// gateway at http://sprite.internal lists the connections the organisation set up and adds the
// key to every request through one (SPRITE_GATEWAY_URL for another gateway).
//
//   openrouter() → { base, headers, gateway } or null   (base: …/api/v1, no slash at the end)
//   need(what)   → the same, or a throw that says how to get one
//
// The gateway takes a request of up to about 7 MB (measured 2026-10-23: 6 MB answered, 8 MB
// "413 request body too large"); OpenRouter itself about 50 MB.

export const GATEWAY_MAX = 7e6;

const GATEWAY = process.env.SPRITE_GATEWAY_URL || "http://sprite.internal";
let found;

export async function openrouter() {
  if (found !== undefined) return found;
  if (process.env.OPENROUTER_API_KEY) {
    found = { base: (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, ""),
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, gateway: false };
    return found;
  }
  try {
    const res = await fetch(`${GATEWAY}/v1/gateway/list`, { signal: AbortSignal.timeout(5000) });
    const c = ((await res.json()).connections || []).find((x) => x.provider === "openrouter");
    if (c) {
      const base = (c.gateway_base_url || `${GATEWAY}/v1/gateway/openrouter/${c.id}`).replace(/\/$/, "");
      found = { base: base.endsWith("/v1") ? base : `${base}/v1`, headers: {}, gateway: true };
      return found;
    }
  } catch {}
  found = null;
  return found;
}

export async function need(what) {
  const r = await openrouter();
  if (!r) throw new Error(`${what} needs OpenRouter: OPENROUTER_API_KEY in the environment, or on a Sprite the gateway's OpenRouter connection`);
  return r;
}
