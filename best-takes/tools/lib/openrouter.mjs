// OpenRouter as this machine reaches it: with OPENROUTER_API_KEY, else through the Sprites
// gateway's OpenRouter connection. An rragent agent on a Sprite often has no key of its own: the
// gateway at http://sprite.internal lists the connections the organisation set up and adds the
// key to every request through one (RRAGENT_GATEWAY, rragent's own, or SPRITE_GATEWAY_URL for
// another gateway). A fresh Sprite's gateway comes up a little after the machine: the list is
// asked three times, a second apart, before there is none.
//
//   openrouter() → { base, headers, gateway } or null   (base: the API's root, OpenRouter's
//                  …/api/v1 or the connection's …/v1, no slash at the end)
//   need(what)   → the same, or a throw that says how to get one
//
// The gateway takes a request of up to about 7 MB (measured 2026-10-23: 6 MB answered, 8 MB
// "413 request body too large"); OpenRouter itself about 50 MB.

export const GATEWAY_MAX = 7e6;

const GATEWAY = (process.env.RRAGENT_GATEWAY || process.env.SPRITE_GATEWAY_URL || "http://sprite.internal").replace(/\/$/, "");
let found;

export async function openrouter() {
  if (found !== undefined) return found;
  if (process.env.OPENROUTER_API_KEY) {
    found = { base: (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, ""),
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }, gateway: false };
    return found;
  }
  let why = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${GATEWAY}/v1/gateway/list`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const c = ((await res.json()).connections || []).find((x) => x.provider === "openrouter");
      if (!c) { why = "the gateway has no OpenRouter connection"; break; }
      const base = (c.gateway_base_url || `${GATEWAY}/v1/gateway/openrouter/${c.id}`).replace(/\/$/, "");
      found = { base: base.endsWith("/v1") ? base : `${base}/v1`, headers: {}, gateway: true };
      return found;
    } catch (e) {
      // no gateway on this machine at all: no need to wait for it
      why = `the gateway at ${GATEWAY} did not answer (${e.cause?.code || e.message})`;
      if (e.cause?.code === "ENOTFOUND") break;
      if (attempt < 3) await new Promise((ok) => setTimeout(ok, 1000));
    }
  }
  if (why) console.error(`OpenRouter: no OPENROUTER_API_KEY, and ${why}`);
  found = null;
  return found;
}

export async function need(what) {
  const r = await openrouter();
  if (!r) throw new Error(`${what} needs OpenRouter: OPENROUTER_API_KEY in the environment, or on a Sprite the gateway's OpenRouter connection`);
  return r;
}
