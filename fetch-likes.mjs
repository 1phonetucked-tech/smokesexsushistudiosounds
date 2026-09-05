#!/usr/bin/env node
// Pulls every liked track from a public SoundCloud profile into likes.json.
// Usage: node fetch-likes.mjs https://soundcloud.com/your-handle

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const get = (url) => fetch(url, { headers: { 'User-Agent': UA } });

async function clientId() {
  const html = await (await get('https://soundcloud.com/discover')).text();
  const scripts = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1]);
  for (const src of scripts.reverse()) {
    const js = await (await get(src)).text();
    const hit = js.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/);
    if (hit) return hit[1];
  }
  throw new Error('could not scrape a client_id from soundcloud');
}

async function main() {
  const profile = (process.argv[2] || '').replace(/\/(likes|tracks|sets|reposts|comments)\/?$/, '').replace(/\/$/, '');
  if (!profile) { console.error('usage: node fetch-likes.mjs https://soundcloud.com/your-handle'); process.exit(1); }

  const cid = await clientId();
  console.error('client_id ok');

  const res = await get(`https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(profile)}&client_id=${cid}`);
  if (!res.ok) throw new Error(`resolve failed (${res.status}) — is ${profile} correct and public?`);
  const user = await res.json();
  console.error(`user: ${user.username} (id ${user.id}), ${user.likes_count ?? '?'} likes`);

  const tracks = [];
  let url = `https://api-v2.soundcloud.com/users/${user.id}/likes?client_id=${cid}&limit=200&offset=0&linked_partitioning=1`;
  while (url) {
    const page = await (await get(url)).json();
    for (const item of page.collection ?? []) {
      const t = item.track;
      if (!t || !t.permalink_url) continue;
      tracks.push({
        id: t.id,
        title: t.title,
        artist: t.user?.username ?? '',
        url: t.permalink_url,
        blocked: t.policy === 'BLOCK' || t.streamable === false,
      });
    }
    process.stderr.write(`\r${tracks.length} tracks…`);
    url = page.next_href ? `${page.next_href}&client_id=${cid}` : null;
  }
  console.error('');

  const playable = tracks.filter(t => !t.blocked).map(({ id, title, artist, url }) => ({ id, title, artist, url }));
  const out = new URL('./likes.json', import.meta.url).pathname;
  const fs = await import('node:fs');
  fs.writeFileSync(out, JSON.stringify(playable));
  console.error(`wrote ${playable.length} playable tracks (${tracks.length - playable.length} region/embed-blocked) -> ${out}`);
}

main().catch(e => { console.error('\n' + e.message); process.exit(1); });
