// OpenRouter as this machine reaches it: with OPENROUTER_API_KEY, else through the Sprites
// gateway's OpenRouter connection. An rragent agent on a Sprite often has no key of its own: the
// gateway at http://sprite.internal lists the connections the organisation set up and adds the
// key to every request through one (RRAGENT_GATEWAY, rragent's own, or SPRITE_GATEWAY_URL for
// another gateway). A fresh Sprite's gateway comes up a little after the machine: the list is
// asked three times, a second apart, before there is none.
//
//   need(what)                         → { base, headers, gateway }, or a throw that says how to get one
//   post(what, endpoint, body, opts)   → the answer's JSON
//   postAudio(what, endpoint, body)    → the answer's bytes (the speech endpoint answers with audio)
//   streamAudio(what, body)            → { bytes, text, cost }: chat completions streamed, the
//                                        audio of every chunk's delta.audio.data joined
//
// The gateway takes a request of up to about 7 MB (measured 2026-10-23); OpenRouter about 50 MB.

const GATEWAY = (process.env.RRAGENT_GATEWAY || process.env.SPRITE_GATEWAY_URL || "http://sprite.internal").replace(/\/$/, "");
let found;

async function openrouter() {
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

// Asked again after 5, 10 and 20 s on a network error, a rate limit or a server's error: the
// Sprites gateway now and then drops out for some 20 s, and three tries in a row would all fall
// into it. `read` turns a good answer into the result.
async function send(what, endpoint, body, read, { timeout = 300e3, log = () => {} } = {}) {
  const r = await need(what);
  const tries = 4;
  for (let attempt = 1; ; attempt++) {
    let why;
    try {
      const res = await fetch(`${r.base}${endpoint}`, {
        method: "POST",
        headers: { ...r.headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
      if (res.ok) return await read(res);
      const text = await res.text().catch(() => "");
      if (!(res.status === 429 || res.status >= 500)) throw Object.assign(new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`), { final: true });
      why = `OpenRouter ${res.status}`;
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

export const post = (what, endpoint, body, opts) => send(what, endpoint, body, async (res) => JSON.parse(await res.text()), opts);

export const postAudio = (what, endpoint, body, opts) => send(what, endpoint, body, async (res) => {
  const bytes = Buffer.from(await res.arrayBuffer());
  // an error can come back as JSON with a 200
  if (/json/.test(res.headers.get("content-type") || "")) throw Object.assign(new Error(`OpenRouter: ${bytes.toString("utf8").slice(0, 300)}`), { final: true });
  return { bytes, id: res.headers.get("x-generation-id") };
}, opts);

// Server-sent events: `data: {…}` lines, `data: [DONE]` at the end
export const streamAudio = (what, body, opts) => send(what, "/chat/completions", { ...body, stream: true }, async (res) => {
  const parts = [], text = [];
  let cost = 0, rest = "", error = null;
  const take = (line) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let j;
    try { j = JSON.parse(data); } catch { return; }
    if (j.error) error = j.error.message || JSON.stringify(j.error);
    const d = j.choices?.[0]?.delta || {};
    if (d.audio?.data) parts.push(Buffer.from(d.audio.data, "base64"));
    if (d.audio?.transcript) text.push(d.audio.transcript);
    if (d.content) text.push(d.content);
    if (j.usage?.cost) cost = j.usage.cost;
  };
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    rest += decoder.decode(chunk, { stream: true });
    const lines = rest.split("\n");
    rest = lines.pop();
    lines.forEach(take);
  }
  take(rest);
  if (error) throw Object.assign(new Error(`OpenRouter: ${error.slice(0, 300)}`), { final: true });
  return { bytes: Buffer.concat(parts), text: text.join(""), cost };
}, opts);
