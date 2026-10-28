// Storrito's API from a tool. On a sprite the organization's Storrito connector is reached through
// the sprite's gateway, which adds the credential itself (`GET http://sprite.internal/v1/gateway/list`
// names the connection: a custom API whose base is the organization's storrito.com host); elsewhere
// STORRITO_API_URL (https://<org>.storrito.com) and STORRITO_CREDENTIAL (<id>:<secret>) say where
// and as whom. Without either, `connect()` answers null and the agent calls the procedures itself.
// Copied from story-from-link: skills share no code.

const GATEWAY = (process.env.RRAGENT_GATEWAY || "http://sprite.internal").replace(/\/+$/, "");

async function gatewayList() {
  try {
    const res = await fetch(`${GATEWAY}/v1/gateway/list`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    return (await res.json()).connections || [];
  } catch { return []; }
}

const trim = (url) => String(url || "").replace(/\/+$/, "");

function root(base) {
  base = trim(base);
  return base.endsWith("/api/v1") ? { host: base.slice(0, -"/api/v1".length), prefix: "" } : { host: base, prefix: "/api/v1" };
}

export async function connect() {
  if (process.env.STORRITO_API_URL && process.env.STORRITO_CREDENTIAL) {
    const { host } = root(process.env.STORRITO_API_URL);
    return { host, via: "env", url: (name) => `${host}/api/v1/${name}`, headers: { authorization: `Bearer ${process.env.STORRITO_CREDENTIAL}` } };
  }
  for (const c of await gatewayList()) {
    const base = c.provider_info?.base_api_url;
    if (c.provider !== "custom_api" || !base) continue;
    let host;
    try { host = new URL(base).hostname; } catch { continue; }
    if (!host.endsWith("storrito.com")) continue;
    const r = root(base);
    const through = trim(c.gateway_base_url) || `${GATEWAY}/v1/gateway/${c.provider}/${c.id}`;
    return { host: r.host, via: "gateway", url: (name) => `${through}${r.prefix}/${name}`, headers: {} };
  }
  return null;
}

// one procedure: the answer as data, a failure as an Error with what the API said; a rate limit
// or a deploy behind the load balancer is tried again
export async function call(api, name, params, { timeout = 180000 } = {}) {
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    let res;
    try {
      res = await fetch(api.url(name), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...api.headers },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (e) {
      last = new Error(`${name}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    if (res.ok) return body;
    last = new Error(`${name}: HTTP ${res.status} ${typeof body === "string" ? body.slice(0, 500) : body.errorMessage || body.error || JSON.stringify(body).slice(0, 500)}`);
    last.status = res.status;
    if (![429, 502, 503, 504].includes(res.status)) throw last;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw last;
}
