'use strict';
const { app, BrowserWindow, ipcMain, net, nativeTheme, shell, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { Readable } = require('stream');

const APP_NAME = 'Personafy';
const UA = 'Personafy/1.6 (personal music player)';
const DRIVE_BASE = process.env.PHANTOM_DRIVE_BASE || 'https://drive.usercontent.google.com';
const STREAM = (id) => DRIVE_BASE + '/download?id=' + encodeURIComponent(id) + '&export=download';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/* Google Drive refuses to hand its files to pages on other sites, so the window never talks to Drive itself:
   it asks for phantom://drive/<fileId> and the main process fetches the file and passes the bytes through. */
protocol.registerSchemesAsPrivileged([
  { scheme: 'phantom', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
]);

app.setName(APP_NAME);
/* the player was called Phantom Player before 1.5.0: its data (likes, queue, downloads, lyrics, covers, loudness)
   stays in the old folder, so the rename loses nothing */
app.setPath('userData', path.join(app.getPath('appData'), 'Phantom Player'));
app.commandLine.appendSwitch('enable-prefer-compositing-to-lcd-text');
if (process.platform === 'win32') app.setAppUserModelId('com.phantomplayer.app');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.exit(0);

let win = null;
const userDir = () => app.getPath('userData');
const offlineDir = () => path.join(userDir(), 'offline');
const lyricsDir = () => path.join(userDir(), 'lyrics');
const catalogCache = () => path.join(userDir(), 'catalog.json');
const metaFile = () => path.join(userDir(), 'trackmeta.json');
const coverDir = () => path.join(userDir(), 'covers');

function bundledCatalog() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'src', 'data', 'catalog.json'), 'utf8'));
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data));
  await fsp.rename(tmp, file);
}

function currentCatalog() {
  const cached = readJson(catalogCache(), null);
  if (cached && Array.isArray(cached.tracks) && cached.tracks.length) return withMeta(cached);
  return withMeta(bundledCatalog());
}

/* ---------- facts learned about Drive files: duration, artist, year (keyed by Drive file id) ---------- */
let META = null;
const meta = () => META || (META = readJson(metaFile(), {}) || {});
let metaT = null;
function saveMeta() {
  clearTimeout(metaT);
  metaT = setTimeout(() => { writeJson(metaFile(), meta()).catch(() => {}); }, 1000);
}
function withMeta(cat) {
  const m = meta();
  const firstOf = new Map();
  for (const t of cat.tracks || []) {
    const x = t.file ? m[t.file] : null;
    if (!x) continue;
    if (x.sec && !t.sec) t.sec = x.sec;
    if (t.auto && x.artist) t.artist = x.artist;
    if (!firstOf.has(t.album)) firstOf.set(t.album, x);
  }
  for (const a of cat.albums || []) {
    const x = firstOf.get(a.id);
    if (!a.auto || !x) continue;
    if (x.year && !a.year) a.year = x.year;
    if (x.albumArtist) a.artist = x.albumArtist;
  }
  return cat;
}

/* ---------- Google Drive folder listing (public "anyone with the link" folder) ---------- */

const ENTRY_RE = /<div class="flip-entry" id="entry-([^"]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g;
const unescapeHtml = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

async function listFolder(folderId) {
  const res = await net.fetch((process.env.PHANTOM_LIST_BASE || 'https://drive.google.com') + '/embeddedfolderview?id=' + encodeURIComponent(folderId), {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en' }
  });
  if (!res.ok) throw new Error('drive listing ' + res.status);
  const html = await res.text();
  const out = [];
  for (const m of html.matchAll(ENTRY_RE)) {
    out.push({ id: m[1], folder: m[2].includes('/folders/'), name: unescapeHtml(m[3]).trim() });
  }
  return out;
}

/* Drive sometimes answers with a "can't scan this file for viruses" page instead of the file.
   That page holds a form whose hidden fields lead to the real download. */
function confirmUrl(html) {
  const form = html.match(/<form[^>]*id="download-form"[^>]*>[\s\S]*?<\/form>/i) || html.match(/<form[^>]*action="[^"]*download[^"]*"[^>]*>[\s\S]*?<\/form>/i);
  if (!form) return null;
  const action = form[0].match(/action="([^"]+)"/i);
  if (!action) return null;
  const params = new URLSearchParams();
  for (const tag of form[0].match(/<input[^>]*>/gi) || []) {
    const n = tag.match(/name="([^"]*)"/i);
    const v = tag.match(/value="([^"]*)"/i);
    if (n && v) params.set(unescapeHtml(n[1]), unescapeHtml(v[1]));
  }
  const base = unescapeHtml(action[1]);
  const url = base + (base.includes('?') ? '&' : '?') + params.toString();
  const trusted = url.startsWith(DRIVE_BASE + '/') || /^https:\/\/([a-z0-9-]+\.)*google(usercontent)?\.com\//i.test(url);
  return trusted ? url : null;
}

/* Drive now and then accepts a request and never answers it; without a deadline the track would load forever.
   The deadline covers only the wait for the answer to start, never the music that follows.
   `signal` stops the request for good, body included: a download merely left unread (reader.cancel()) keeps
   receiving, and a few of those fill the one connection to Drive until every later request hangs. */
const DRIVE_ANSWER_MS = 20000;
async function fetchAnswer(url, headers, signal) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(new Error('Google Диск не отвечает')), DRIVE_ANSWER_MS);
  if (signal) {
    if (signal.aborted) ac.abort(signal.reason);
    else signal.addEventListener('abort', () => ac.abort(signal.reason), { once: true });
  }
  try {
    return await net.fetch(url, { headers, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function driveFetch(fileId, extraHeaders, signal) {
  const headers = Object.assign({ 'User-Agent': BROWSER_UA }, extraHeaders || {});
  let res = await fetchAnswer(STREAM(fileId), headers, signal);
  const type = res.headers.get('content-type') || '';
  if (res.ok && /text\/html/i.test(type)) {
    const next = confirmUrl(await res.text());
    if (next) res = await fetchAnswer(next, headers, signal);
  }
  return res;
}

/* passes a Drive body on; when whoever reads it gives up (the player seeks or skips), the request itself is stopped */
function abortableBody(body, ac) {
  const reader = body.getReader();
  return new ReadableStream({
    async pull(c) {
      try {
        const { done, value } = await reader.read();
        if (done) c.close();
        else c.enqueue(value);
      } catch (e) {
        c.error(e);
      }
    },
    cancel() {
      ac.abort();
    }
  });
}

const FILE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/;
/* downloaded tracks are served through the same scheme as streamed ones, so the page can
   measure their loudness with Web Audio (it needs CORS-readable media) */
async function serveLocal(u, req) {
  const m = u.pathname.match(/^\/([A-Za-z0-9_-]{1,100})\/(\d{1,5})$/);
  if (!m) return new Response('not found', { status: 404 });
  const p = path.join(offlineDir(), m[1], m[2] + '.mp3');
  let size;
  try {
    size = (await fsp.stat(p)).size;
  } catch (e) {
    return new Response('not found', { status: 404 });
  }
  let start = 0;
  let end = size - 1;
  let status = 200;
  const r = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  if (r && (r[1] || r[2])) {
    if (r[1]) {
      start = +r[1];
      if (r[2]) end = Math.min(+r[2], size - 1);
    } else {
      start = Math.max(0, size - +r[2]);
    }
    if (start > end || start >= size) return new Response('', { status: 416, headers: { 'content-range': 'bytes */' + size, 'access-control-allow-origin': '*' } });
    status = 206;
  }
  const headers = { 'content-type': 'audio/mpeg', 'content-length': String(end - start + 1), 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' };
  if (status === 206) headers['content-range'] = 'bytes ' + start + '-' + end + '/' + size;
  return new Response(Readable.toWeb(fs.createReadStream(p, { start, end })), { status, headers });
}

async function handlePhantom(req) {
  let u;
  try {
    u = new URL(req.url);
  } catch (e) {
    return new Response('bad url', { status: 400 });
  }
  if (u.hostname === 'local') return serveLocal(u, req);
  const id = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
  if (!FILE_ID_RE.test(id) || (u.hostname !== 'drive' && u.hostname !== 'cover')) return new Response('not found', { status: 404 });
  if (u.hostname === 'cover') {
    try {
      const buf = await loadCover(id);
      return new Response(buf, { status: 200, headers: { 'content-type': coverType(buf), 'content-length': String(buf.length) } });
    } catch (e) {
      return new Response('cover error', { status: 502 });
    }
  }
  const extra = {};
  const range = req.headers.get('range');
  if (range) extra.Range = range;
  const ac = new AbortController();
  if (req.signal) req.signal.addEventListener('abort', () => ac.abort(), { once: true });
  let res;
  try {
    res = await driveFetch(id, extra, ac.signal);
  } catch (e) {
    /* never kept: once the network is back the same address must be fetched again */
    return new Response('network error', { status: 502, headers: { 'cache-control': 'no-store' } });
  }
  const type = res.headers.get('content-type') || '';
  if (!res.ok || /text\/html/i.test(type)) {
    ac.abort();
    return new Response('drive error ' + res.status, { status: res.ok ? 502 : res.status, headers: { 'cache-control': 'no-store' } });
  }
  const out = new Headers();
  for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
    const v = res.headers.get(k);
    if (v) out.set(k, v);
  }
  if (!out.has('accept-ranges')) out.set('accept-ranges', 'bytes');
  out.set('access-control-allow-origin', '*');
  return new Response(abortableBody(res.body, ac), { status: res.status, headers: out });
}

function parseName(name) {
  /* "1-05 Title" / "2.05 Title": disc and track, so the discs of one album don't share numbers (disc 2 → 205) */
  const d = name.match(/^\s*([1-9])[-.](\d{2})\s*[-.]?\s*(.*?)\.(mp3|m4a|flac|ogg|wav|opus)$/i);
  if (d) return { n: parseInt(d[1], 10) * 100 + parseInt(d[2], 10), title: d[3].trim() || name };
  const m = name.match(/^\s*(\d+)\s*[-.]?\s*(.*?)\.(mp3|m4a|flac|ogg|wav|opus)$/i);
  if (!m) return null;
  return { n: parseInt(m[1], 10), title: m[2].trim() || name };
}

/* an album's id comes from its folder name in Latin letters; a name with almost none of them (Cyrillic, Japanese)
   or a name already taken falls back to the Drive folder id, so two albums never share ids, likes or downloads */
function albumKey(folder, used) {
  const key = folder.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  if (key.replace(/[^a-z0-9]/g, '').length >= 2 && !used.has(key)) return key;
  return 'f-' + folder.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
}

async function refreshCatalog() {
  const base = currentCatalog();
  const bundled = bundledCatalog();
  const metaById = new Map(bundled.tracks.map((t) => [t.id, t]));
  base.tracks.forEach((t) => { if (!metaById.has(t.id)) metaById.set(t.id, t); });
  const albumMeta = new Map(bundled.albums.map((a) => [a.id, a]));
  const bundledAlbums = new Set(bundled.albums.map((a) => a.id));
  const bundledTracks = new Set(bundled.tracks.map((t) => t.id));
  base.albums.forEach((a) => { if (!albumMeta.has(a.id)) albumMeta.set(a.id, a); });

  const rootEntries = await listFolder(base.root);
  const folders = rootEntries.filter((e) => e.folder);
  if (!folders.length) throw new Error('empty root');

  const albums = [];
  const tracks = [];
  const listings = await Promise.all(folders.map((f) => listFolder(f.id)));
  const usedKeys = new Set();
  folders.forEach((f, fi) => {
    const key = albumKey(f, usedKeys);
    usedKeys.add(key);
    const files = listings[fi];
    const known = albumMeta.get(key);
    const coverEntry = files.find((x) => /^cover\.(jpe?g|png|webp)$/i.test(x.name));
    const album = Object.assign({}, known || {
      id: key, title: f.name, short: f.name, artist: 'ATLUS Sound Team', year: null, cover: null
    });
    album.auto = !bundledAlbums.has(key);
    album.folder = f.id;
    album.coverFile = coverEntry ? coverEntry.id : (known ? known.coverFile : null);
    album.tracks = [];
    const audio = files.filter((x) => !x.folder && parseName(x.name));
    audio.sort((a, b) => parseName(a.name).n - parseName(b.name).n);
    /* two files with the same number would share an id and a downloaded file: a repeat gets the next free number */
    const usedN = new Set();
    let maxN = audio.reduce((mx, x) => Math.max(mx, parseName(x.name).n), 0);
    for (const x of audio) {
      const p = parseName(x.name);
      if (usedN.has(p.n)) p.n = ++maxN;
      usedN.add(p.n);
      const id = key + '-' + p.n;
      const meta = metaById.get(id);
      tracks.push(Object.assign({}, meta || { id, album: key, n: p.n, title: p.title, artist: album.artist, sec: 0 }, { file: x.id, name: x.name, auto: !bundledTracks.has(id) }));
      album.tracks.push(id);
    }
    if (album.tracks.length) albums.push(album);
  });
  const order = bundled.albums.map((a) => a.id);
  albums.sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.title.localeCompare(b.title);
  });
  const fresh = withMeta({ root: base.root, albums, tracks, refreshedAt: Date.now() });
  await writeJson(catalogCache(), fresh);
  return fresh;
}

/* ---------- reading duration & tags of new tracks from the first kilobytes of the file ---------- */
const synchsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
function id3Text(b) {
  const enc = b[0];
  let body = b.subarray(1);
  let str;
  if (enc === 0) str = body.toString('latin1');
  else if (enc === 3) str = body.toString('utf8');
  else {
    let be = enc === 2;
    if (body[0] === 0xff && body[1] === 0xfe) body = body.subarray(2);
    else if (body[0] === 0xfe && body[1] === 0xff) { body = body.subarray(2); be = true; }
    body = Buffer.from(body.subarray(0, body.length - (body.length % 2)));
    if (be) body.swap16();
    str = body.toString('utf16le');
  }
  return str.split('\u0000')[0].trim();
}
function readId3(buf) {
  if (buf.length < 10 || buf.toString('latin1', 0, 3) !== 'ID3') return { size: 0, frames: {} };
  const ver = buf[3];
  const flags = buf[5];
  const size = synchsafe(buf, 6) + 10 + (flags & 0x10 ? 10 : 0);
  const frames = {};
  let o = 10;
  if (flags & 0x40 && buf.length > 14) o += ver === 4 ? synchsafe(buf, 10) : buf.readUInt32BE(10) + 4;
  while (o + 10 <= Math.min(buf.length, size)) {
    const id = buf.toString('latin1', o, o + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const len = ver === 4 ? synchsafe(buf, o + 4) : buf.readUInt32BE(o + 4);
    if (len <= 0 || o + 10 + len > buf.length) break;
    if (id[0] === 'T' && !frames[id]) frames[id] = id3Text(buf.subarray(o + 10, o + 10 + len));
    o += 10 + len;
  }
  return { size, frames };
}
const BITRATES = { 3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function mp3Seconds(buf, audioBytes) {
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) continue;
    const ver = (buf[i + 1] >> 3) & 3;
    const layer = (buf[i + 1] >> 1) & 3;
    const bri = buf[i + 2] >> 4;
    const sri = (buf[i + 2] >> 2) & 3;
    if (ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) continue;
    const sr = RATES[ver][sri];
    const kbps = (ver === 3 ? BITRATES[3] : BITRATES[2])[bri];
    const spf = ver === 3 ? 1152 : 576;
    const mono = ((buf[i + 3] >> 6) & 3) === 3;
    const x = i + 4 + (ver === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17));
    const tag = buf.toString('latin1', x, x + 4);
    if ((tag === 'Xing' || tag === 'Info') && buf.length >= x + 12 && (buf.readUInt32BE(x + 4) & 1)) return buf.readUInt32BE(x + 8) * spf / sr;
    const v = i + 36;
    if (buf.toString('latin1', v, v + 4) === 'VBRI' && buf.length >= v + 18) return buf.readUInt32BE(v + 14) * spf / sr;
    return audioBytes > 0 ? (audioBytes * 8) / (kbps * 1000) : null;
  }
  return null;
}
/* reads at most `want` bytes of a byte range, never the whole file */
async function readRange(fileId, start, want) {
  /* Drive may ignore the range and send the whole file: the request is stopped once enough has arrived */
  const ac = new AbortController();
  const res = await driveFetch(fileId, { Range: 'bytes=' + start + '-' + (start + want - 1) }, ac.signal);
  const type = res.headers.get('content-type') || '';
  if (!(res.status === 206 || res.status === 200) || /text\/html/i.test(type)) {
    ac.abort();
    throw new Error('drive ' + res.status);
  }
  const cr = res.headers.get('content-range') || '';
  const total = cr.includes('/') ? parseInt(cr.split('/')[1], 10) : (res.status === 200 ? parseInt(res.headers.get('content-length') || '0', 10) : 0);
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  while (got < want) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(Buffer.from(value));
    got += value.length;
  }
  ac.abort();
  return { buf: Buffer.concat(parts).subarray(0, want), total };
}
async function probeTrack(t) {
  const local = offlinePath(t);
  let head;
  let total;
  let tail = null;
  if (fs.existsSync(local)) {
    const fh = await fsp.open(local, 'r');
    try {
      total = (await fh.stat()).size;
      head = Buffer.alloc(Math.min(total, 65536));
      await fh.read(head, 0, head.length, 0);
      const { size } = readId3(head);
      if (size + 4096 > head.length) {
        tail = Buffer.alloc(8192);
        await fh.read(tail, 0, 8192, size);
      }
    } finally {
      await fh.close();
    }
  } else {
    const r = await readRange(t.file, 0, 65536);
    head = r.buf;
    total = r.total;
    const { size } = readId3(head);
    if (size + 4096 > head.length) tail = (await readRange(t.file, size, 8192)).buf;
  }
  const id3 = readId3(head);
  const audio = tail || head.subarray(id3.size);
  let sec = mp3Seconds(audio, total ? total - id3.size : 0);
  if (!sec && id3.frames.TLEN) sec = parseInt(id3.frames.TLEN, 10) / 1000;
  const f = id3.frames;
  const year = ((f.TDRC || f.TYER || '').match(/\d{4}/) || [])[0];
  return {
    sec: sec && isFinite(sec) ? Math.round(sec) : 0,
    artist: (f.TPE1 || '').slice(0, 200) || undefined,
    albumArtist: (f.TPE2 || '').slice(0, 200) || undefined,
    year: year ? parseInt(year, 10) : undefined
  };
}
let probeRun = null;
function probeMissing(cat) {
  if (probeRun) return probeRun;
  const m = meta();
  const todo = (cat.tracks || []).filter((t) => t.file && /\.mp3$/i.test(t.name || t.file + '.mp3') && !t.sec && !(m[t.file] && m[t.file].done));
  if (!todo.length) return null;
  let next = 0;
  const pending = [];
  const flush = () => { if (pending.length) send('catalog:meta', pending.splice(0)); };
  const worker = async () => {
    while (next < todo.length) {
      const t = todo[next++];
      try {
        const r = await probeTrack(t);
        m[t.file] = Object.assign({}, m[t.file], r, { done: 1 });
        saveMeta();
        pending.push({ id: t.id, sec: r.sec, artist: t.auto ? r.artist : undefined, album: t.album, year: r.year, albumArtist: r.albumArtist });
        if (pending.length >= 8) flush();
      } catch (e) { /* network trouble: try again next start */ }
    }
  };
  probeRun = Promise.all([worker(), worker(), worker()]).then(flush).finally(() => { probeRun = null; });
  return probeRun;
}

/* ---------- album covers from Drive are kept on disk, so they show up instantly next time ---------- */
const coverJobs = new Map();
function coverType(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
function loadCover(id) {
  if (coverJobs.has(id)) return coverJobs.get(id);
  const job = (async () => {
    const file = path.join(coverDir(), id);
    try {
      const buf = await fsp.readFile(file);
      if (coverType(buf)) return buf;
    } catch (e) { /* not cached yet */ }
    const res = await driveFetch(id);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || !coverType(buf) || buf.length > 12 * 1024 * 1024) throw new Error('cover ' + res.status);
    await fsp.mkdir(coverDir(), { recursive: true });
    await fsp.writeFile(file + '.tmp', buf);
    await fsp.rename(file + '.tmp', file);
    return buf;
  })();
  coverJobs.set(id, job);
  job.catch(() => {}).finally(() => { setTimeout(() => coverJobs.delete(id), 1000); });
  return job;
}
async function prefetchCovers(cat) {
  for (const a of cat.albums || []) {
    if (a.coverFile && FILE_ID_RE.test(a.coverFile)) {
      try { await loadCover(a.coverFile); } catch (e) { /* later */ }
    }
  }
}

/* ---------- offline downloads ---------- */

const offlinePath = (t) => path.join(offlineDir(), t.album, t.n + '.mp3');
/* a track sent by the window becomes part of file paths (downloads, lyrics): only plain ids may pass */
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const trackOk = (t) => !!t && SAFE_ID_RE.test(String(t.album)) && /^\d{1,5}$/.test(String(t.n)) &&
  SAFE_ID_RE.test(String(t.id)) && (!t.file || FILE_ID_RE.test(String(t.file)));
const downloading = new Map();

async function listDownloads() {
  const out = [];
  let albums = [];
  try {
    albums = await fsp.readdir(offlineDir());
  } catch (e) {
    return out;
  }
  for (const a of albums) {
    let files = [];
    try {
      files = await fsp.readdir(path.join(offlineDir(), a));
    } catch (e) {
      continue;
    }
    for (const f of files) {
      const m = f.match(/^(\d+)\.mp3$/);
      if (m) {
        const st = await fsp.stat(path.join(offlineDir(), a, f));
        out.push({ id: a + '-' + m[1], bytes: st.size });
      }
    }
  }
  return out;
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

async function downloadTrack(t) {
  if (downloading.has(t.id)) return downloading.get(t.id);
  const job = (async () => {
    const dest = offlinePath(t);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = dest + '.part';
    const res = await driveFetch(t.file);
    const type = res.headers.get('content-type') || '';
    if (!res.ok || type.includes('text/html')) throw new Error('Google Диск не отдал файл (' + res.status + ')');
    const total = parseInt(res.headers.get('content-length') || '0', 10);
    const out = fs.createWriteStream(tmp);
    const reader = res.body.getReader();
    let got = 0;
    let lastSent = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
        const now = Date.now();
        if (now - lastSent > 120) {
          lastSent = now;
          send('dl:progress', { id: t.id, pct: total ? Math.min(99, Math.round((got / total) * 100)) : 0 });
        }
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    if (got < 50 * 1024) {
      await fsp.rm(tmp, { force: true });
      throw new Error('файл слишком маленький');
    }
    await fsp.rename(tmp, dest);
    send('dl:progress', { id: t.id, pct: 100, done: true, bytes: got });
    return { id: t.id, bytes: got };
  })();
  downloading.set(t.id, job);
  try {
    return await job;
  } catch (e) {
    send('dl:progress', { id: t.id, error: String(e.message || e) });
    throw e;
  } finally {
    downloading.delete(t.id);
  }
}

let dlQueue = Promise.resolve();
function enqueueDownloads(list) {
  for (const t of list) {
    send('dl:progress', { id: t.id, pct: 0, queued: true });
    dlQueue = dlQueue.then(() => downloadTrack(t).catch(() => null));
  }
  return dlQueue;
}

/* ---------- lyrics (LRCLIB) ---------- */

/* v2: titles of the newly added albums carry edition suffixes ("(P4D ver.)", "-Reload-", "(… Remix) -Long Mix-")
   that are spelled differently in LRCLIB, so candidates are matched on the bare title, checked to really be
   Persona music, and the version is chosen by duration. Negative results remember what they were looked up with. */
const LYRICS_V = 2;
const norm = (s) => String(s || '').toLowerCase().replace(/['’‘`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const STOP = new Set(['ver', 'version', 'the', 'a', 'mix', 'edit']);

function coreTitle(s) {
  let x = String(s || '');
  x = x.replace(/\s*[([{【「『].*?[)\]}】」』]/g, ' ');
  x = x.replace(/\s*[~〜～].*?[~〜～]/g, ' ');
  x = x.replace(/\s+-(?=\S)(.*?\S)-(?=\s|$)/g, ' ');
  x = x.replace(/\s+[-–—]\s+.*$/, ' ');
  x = x.replace(/\s+(feat\.?|ft\.)\s.*$/i, ' ');
  x = x.replace(/["“”‘’']/g, '').replace(/\s+/g, ' ').trim();
  return x || String(s || '').trim();
}
function variantTokens(s) {
  const core = new Set(norm(coreTitle(s)).split(' '));
  return new Set(norm(s).split(' ').filter((w) => w && !core.has(w) && !STOP.has(w)));
}
const PERSONA_ALBUM = /persona|ペルソナ|reincarnation|dancing|p[345]d|atlus|アトラス|velvet|megami/i;
const PERSONA_ARTIST = /atlus|アトラス|meguro|目黒|hirata|平田|志穂子|kawamura|川村|takahashi|高橋|lotus ?juice|lyn|kitajoh|北條|kozuka|小塚|konishi|小西|tsuchiya|土屋|shihoko|azumi|yumi|persona|kugimiya|釘宮/i;

function scoreHit(x, t, ctx) {
  if (!x || !x.trackName) return null;
  const full = norm(x.trackName);
  if (norm(coreTitle(x.trackName)) !== ctx.core && full !== ctx.full) return null;
  let s = 10;
  const v = variantTokens(x.trackName);
  const union = new Set([...v, ...ctx.variant]);
  let inter = 0;
  ctx.variant.forEach((w) => { if (v.has(w)) inter++; });
  s += union.size ? (6 * inter) / union.size : 6;
  const dur = x.duration > 3 ? x.duration : 0;
  const dd = t.sec && dur ? Math.abs(dur - t.sec) : null;
  let plainOnly = !dur;
  if (dd !== null) {
    if (dd <= 2) s += 8;
    else if (dd <= 5) s += 5;
    else if (dd <= 12) { s += 1; plainOnly = true; }
    else { s -= 4; plainOnly = true; }
  }
  const albumOk = PERSONA_ALBUM.test(x.albumName || '');
  const artistOk = PERSONA_ARTIST.test(x.artistName || '');
  if (!albumOk && !artistOk && !(full === ctx.full && dd !== null && dd <= 2)) return null;
  if (albumOk) s += 3;
  if (artistOk) s += 3;
  const an = ' ' + norm(x.albumName) + ' ';
  s += Math.min(3, ctx.albumWords.filter((w) => an.includes(' ' + w + ' ')).length);
  if (x.syncedLyrics) s += 2;
  else if (x.plainLyrics) s += 1;
  return { x, s, plainOnly };
}

async function lrclib(pathname, params) {
  let res;
  try {
    res = await net.fetch((process.env.PHANTOM_LRCLIB_BASE || 'https://lrclib.net') + pathname + '?' + new URLSearchParams(params), { headers: { 'User-Agent': UA } });
  } catch (e) {
    throw new Error('offline');
  }
  if (res.status >= 500) throw new Error('lrclib ' + res.status);
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

function lyricsSig(t) {
  return [LYRICS_V, norm(t.title), norm(t.artist), t.sec > 0 ? 1 : 0].join('|');
}
const stripLrc = (s) => String(s || '').split(/\r?\n/).map((l) => l.replace(/^(\s*\[[^\]]*\])+/, '').trim()).join('\n').trim();

async function getLyrics(t) {
  const file = path.join(lyricsDir(), t.id + '.json');
  const cached = readJson(file, null);
  const sig = lyricsSig(t);
  if (cached) {
    if (cached.found && (!cached.sig || cached.sig === sig)) return cached;
    if (!cached.found && cached.sig === sig && Date.now() - cached.at < 3 * 24 * 3600 * 1000) return cached;
  }
  const core = coreTitle(t.title);
  if (!norm(core) || /^без названия$/i.test(core)) {
    const none = { found: false, at: Date.now(), sig };
    writeJson(file, none).catch(() => {});
    return none;
  }
  const ctx = {
    core: norm(core),
    full: norm(t.title),
    variant: variantTokens(t.title),
    albumWords: norm(t.albumTitle).split(' ').filter((w) => w.length > 2 && !/^(persona|original|soundtrack|the|and)$/.test(w))
  };
  const reqs = [];
  if (t.artist && t.sec) {
    reqs.push(lrclib('/api/get', { track_name: t.title, artist_name: t.artist, album_name: t.albumTitle || '', duration: String(Math.round(t.sec)) }).then((r) => (r ? [r] : [])));
  }
  const searches = [
    { track_name: t.title },
    { q: core + ' persona' },
    t.albumTitle ? { q: core + ' ' + t.albumTitle } : null,
    t.artist ? { q: core + ' ' + t.artist } : null,
    core !== t.title ? { track_name: core } : null
  ].filter(Boolean);
  const seenQ = new Set();
  searches.forEach((p) => {
    const k = JSON.stringify(p);
    if (seenQ.has(k)) return;
    seenQ.add(k);
    reqs.push(lrclib('/api/search', p));
  });
  const settled = await Promise.allSettled(reqs);
  let failed = 0;
  const pool = new Map();
  settled.forEach((r) => {
    if (r.status !== 'fulfilled') { failed++; return; }
    (Array.isArray(r.value) ? r.value : []).forEach((x) => { if (x && x.id != null && !pool.has(x.id)) pool.set(x.id, x); });
  });
  let best = null;
  pool.forEach((x) => {
    const h = scoreHit(x, t, ctx);
    if (h && (!best || h.s > best.s)) best = h;
  });
  if (!best && failed) {
    if (cached && cached.found) return cached;
    return { found: false, error: 'offline', at: Date.now() };
  }
  let result;
  if (best) {
    const x = best.x;
    let synced = x.syncedLyrics || null;
    let plain = x.plainLyrics || null;
    if (best.plainOnly && synced) {
      plain = plain || stripLrc(synced);
      synced = null;
    }
    result = { found: true, at: Date.now(), sig, instrumental: !!x.instrumental, synced, plain };
  } else {
    result = { found: false, at: Date.now(), sig };
  }
  try {
    await writeJson(file, result);
  } catch (e) {}
  return result;
}

/* ---------- weather for the P5 calendar icon ----------
   The town comes from the internet address (GeoJS, ipwho.is as a spare) and is kept for a day;
   the sky comes from Open-Meteo (free, no key) and is kept for 30 minutes. Failing either, the window
   simply shows the clock-based sun or moon. */
const GEO_BASE = process.env.PHANTOM_GEO_BASE || 'https://get.geojs.io';
const GEO_BASE2 = process.env.PHANTOM_GEO_BASE2 || 'https://ipwho.is';
const WX_BASE = process.env.PHANTOM_WEATHER_BASE || 'https://api.open-meteo.com';
const geoFile = () => path.join(userDir(), 'geo.json');
let geoMem = null;
let wxMem = null;
let wxBusy = null;
async function fetchJson(url) {
  const res = await net.fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
async function getGeo() {
  if (geoMem && Date.now() - geoMem.at < 24 * 3600e3) return geoMem;
  try {
    const j = JSON.parse(await fsp.readFile(geoFile(), 'utf8'));
    if (j && Date.now() - j.at < 24 * 3600e3 && isFinite(j.lat) && isFinite(j.lon)) return (geoMem = j);
  } catch (e) { /* no saved town yet */ }
  const tries = [
    async () => { const j = await fetchJson(GEO_BASE + '/v1/ip/geo.json'); return { lat: parseFloat(j.latitude), lon: parseFloat(j.longitude), city: j.city || '' }; },
    async () => { const j = await fetchJson(GEO_BASE2 + '/?fields=success,latitude,longitude,city'); if (j.success === false) throw new Error('ipwho'); return { lat: +j.latitude, lon: +j.longitude, city: j.city || '' }; }
  ];
  for (const t of tries) {
    try {
      const g = await t();
      if (isFinite(g.lat) && isFinite(g.lon)) {
        geoMem = { at: Date.now(), lat: g.lat, lon: g.lon, city: String(g.city).slice(0, 80) };
        fsp.writeFile(geoFile(), JSON.stringify(geoMem)).catch(() => {});
        return geoMem;
      }
    } catch (e) { /* try the spare */ }
  }
  throw new Error('no location');
}
async function getWeather() {
  if (wxMem && Date.now() < wxMem.until) return wxMem.data;
  if (wxBusy) return wxBusy;
  wxBusy = (async () => {
    try {
      const g = await getGeo();
      const j = await fetchJson(WX_BASE + '/v1/forecast?latitude=' + g.lat.toFixed(3) + '&longitude=' + g.lon.toFixed(3) + '&current=weather_code,is_day,temperature_2m');
      const c = j && j.current;
      if (!c || typeof c.weather_code !== 'number') throw new Error('no weather');
      const data = { code: c.weather_code, isDay: c.is_day === 1, temp: typeof c.temperature_2m === 'number' ? c.temperature_2m : null, city: g.city };
      wxMem = { until: Date.now() + 30 * 60e3, data };
      return data;
    } catch (e) {
      wxMem = { until: Date.now() + 5 * 60e3, data: null };
      return null;
    } finally {
      wxBusy = null;
    }
  })();
  return wxBusy;
}

/* ---------- window ---------- */

function createWindow() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: '#0b0b0b',
    /* no system title bar: the player draws its own window buttons in the theme's style */
    frame: false,
    title: APP_NAME,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  const sendState = () => { if (win && !win.isDestroyed()) win.webContents.send('win:state', { max: win.isMaximized(), full: win.isFullScreen() }); };
  ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'restore'].forEach((ev) => win.on(ev, sendState));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  ipcMain.handle('app:version', () => app.getVersion());
  /* window buttons drawn by the page */
  const ownWin = (e) => BrowserWindow.fromWebContents(e.sender);
  ipcMain.on('win:min', (e) => { const w = ownWin(e); if (w) w.minimize(); });
  ipcMain.on('win:max', (e) => {
    const w = ownWin(e);
    if (!w) return;
    if (w.isFullScreen()) w.setFullScreen(false);
    else if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.on('win:close', (e) => { const w = ownWin(e); if (w) w.close(); });
  ipcMain.handle('win:state', (e) => { const w = ownWin(e); return { max: !!(w && w.isMaximized()), full: !!(w && w.isFullScreen()) }; });
  ipcMain.handle('catalog:get', () => currentCatalog());
  /* the player learns exact durations while playing; keep them for next time */
  ipcMain.on('track:sec', (_e, p) => {
    if (!p || typeof p.file !== 'string' || !FILE_ID_RE.test(p.file)) return;
    const sec = Math.round(Number(p.sec));
    if (!(sec > 0 && sec < 36000)) return;
    const m = meta();
    if (m[p.file] && Math.abs((m[p.file].sec || 0) - sec) <= 1) return;
    m[p.file] = Object.assign({}, m[p.file], { sec });
    saveMeta();
  });
  ipcMain.handle('catalog:refresh', async () => {
    try {
      const catalog = await refreshCatalog();
      setTimeout(() => {
        probeMissing(catalog);
        prefetchCovers(catalog);
      }, 300);
      return { ok: true, catalog };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  });
  ipcMain.handle('media:url', async (_e, t) => {
    if (!trackOk(t)) return { url: null, offline: false };
    const p = offlinePath(t);
    try {
      await fsp.access(p);
      return { url: 'phantom://local/' + encodeURIComponent(t.album) + '/' + encodeURIComponent(String(t.n)), offline: true };
    } catch (e) {
      return { url: 'phantom://drive/' + encodeURIComponent(t.file), offline: false };
    }
  });
  protocol.handle('phantom', handlePhantom);
  ipcMain.handle('cover:url', (_e, fileId) => (fileId ? 'phantom://drive/' + encodeURIComponent(fileId) : null));
  ipcMain.handle('cover:data', async (_e, rel) => {
    const base = path.join(__dirname, 'src', 'covers');
    const p = path.normalize(path.join(__dirname, 'src', String(rel || '')));
    if (!p.startsWith(base + path.sep) || !/\.(jpe?g|png)$/i.test(p)) return null;
    try {
      const buf = await fsp.readFile(p);
      return 'data:image/' + (/\.png$/i.test(p) ? 'png' : 'jpeg') + ';base64,' + buf.toString('base64');
    } catch (e) {
      return null;
    }
  });
  ipcMain.handle('dl:list', () => listDownloads());
  ipcMain.handle('dl:start', (_e, list) => {
    enqueueDownloads((Array.isArray(list) ? list : []).filter(trackOk));
    return true;
  });
  ipcMain.handle('dl:remove', async (_e, list) => {
    let failed = 0;
    for (const t of Array.isArray(list) ? list : []) {
      if (!trackOk(t)) {
        failed++;
        continue;
      }
      try {
        await fsp.rm(offlinePath(t), { force: true });
      } catch (e) {
        failed++;
      }
    }
    return { list: await listDownloads(), failed };
  });
  ipcMain.handle('weather:get', () => getWeather());
  ipcMain.handle('lyrics:get', async (_e, t) => {
    if (!trackOk(t)) return { found: false, error: 'bad track' };
    try {
      return await getLyrics(t);
    } catch (e) {
      return { found: false, error: String(e.message || e) };
    }
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());
