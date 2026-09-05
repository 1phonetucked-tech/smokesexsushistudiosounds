// Resolves a SoundCloud track id to a playable MP3 and redirects the browser to it.
// Exists because api-v2.soundcloud.com sends no CORS headers, so the page can't do this itself.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const get = (url) => fetch(url, { headers: { 'User-Agent': UA } });

// SoundCloud rotates this every few weeks, so scrape it fresh and re-scrape on a 401/403.
let cached = { id: null, at: 0 };
async function clientId(force) {
  if (!force && cached.id && Date.now() - cached.at < 6 * 3600 * 1000) return cached.id;
  const html = await (await get('https://soundcloud.com/discover')).text();
  const scripts = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
  for (const src of scripts.reverse()) {
    const js = await (await get(src)).text();
    const hit = js.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/);
    if (hit) { cached = { id: hit[1], at: Date.now() }; return cached.id; }
  }
  throw new Error('could not scrape a client_id');
}

async function resolve(id, cid) {
  const r = await get(`https://api-v2.soundcloud.com/tracks/${id}?client_id=${cid}`);
  if (r.status === 401 || r.status === 403) return { stale: true };
  if (!r.ok) return { status: r.status };
  const track = await r.json();
  const prog = (track.media?.transcodings ?? []).find(t => t.format?.protocol === 'progressive');
  if (!prog) return { status: 415 };
  const m = await get(`${prog.url}?client_id=${cid}`);
  if (m.status === 401 || m.status === 403) return { stale: true };
  if (!m.ok) return { status: m.status };
  const { url } = await m.json();
  return url ? { url } : { status: 502 };
}

export default async function handler(req, res) {
  const id = String(req.query?.id ?? '').replace(/\D/g, '');
  if (!id) return res.status(400).json({ error: 'missing track id' });
  try {
    let out = await resolve(id, await clientId(false));
    if (out.stale) out = await resolve(id, await clientId(true));
    if (!out.url) return res.status(out.status ?? 502).json({ error: 'could not resolve stream' });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.redirect(302, out.url);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
