'use strict';
/* Personafy for iPhone and Android — the window.api the player's interface expects (see app/preload.js),
   done with Capacitor's native plugins instead of Electron's main process (the same code on both phones):
   - Google Drive is read natively (CapacitorHttp / Filesystem.downloadFile), so the page never meets CORS;
   - a track is fetched into the app's cache before it plays and served back from the app's own scheme,
     so Web Audio can measure it, seeking is instant, and the next track can be fetched ahead of time
     (with the screen locked there is no time to wait for the network between two tracks);
   - downloads for offline use, lyrics, covers, durations and the weather keep the same files as on Windows. */
(function () {
  const root = document.documentElement;
  const cap = window.Capacitor;
  const PLATFORM = cap && typeof cap.getPlatform === 'function' && cap.getPlatform() === 'android' ? 'android' : 'ios';
  root.classList.add('phone', PLATFORM);
  const PL = (cap && cap.Plugins) || {};
  const FS = PL.Filesystem;
  const HTTP = PL.CapacitorHttp;
  if (!FS || !HTTP) {
    console.warn('Personafy: native plugins are missing');
    return;
  }

  const VERSION = '__VERSION__';
  const UA = 'Personafy/' + VERSION + ' (' + (PLATFORM === 'android' ? 'Android' : 'iPhone') + '; personal music player)';
  const DATA = 'DATA';
  const CACHE = 'CACHE';
  const DRIVE_BASE = 'https://drive.usercontent.google.com';
  /* confirm=t skips Drive's "can't scan this file for viruses" page on long tracks */
  const DRIVE = (id) => DRIVE_BASE + '/download?id=' + encodeURIComponent(id) + '&export=download&confirm=t';
  const FILE_ID_RE = /^[A-Za-z0-9_-]{10,200}$/;
  const STREAM_KEEP = 60;
  const STREAM_BYTES = 600 * 1048576;

  /* ---------- small helpers ---------- */
  const listeners = { meta: new Set(), dl: new Set(), covers: new Set() };
  const emit = (kind, p) => listeners[kind].forEach((fn) => { try { fn(p); } catch (e) { console.error(e); } });
  const on = (kind, fn) => { listeners[kind].add(fn); return () => listeners[kind].delete(fn); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const webSrc = (uri) => cap.convertFileSrc(uri);

  async function readText(path, dir) {
    try {
      const r = await FS.readFile({ path, directory: dir || DATA, encoding: 'utf8' });
      return typeof r.data === 'string' ? r.data : null;
    } catch (e) {
      return null;
    }
  }
  async function readJson(path, fallback) {
    const t = await readText(path);
    if (t == null) return fallback;
    try {
      return JSON.parse(t);
    } catch (e) {
      return fallback;
    }
  }
  function writeJson(path, data) {
    return FS.writeFile({ path, directory: DATA, data: JSON.stringify(data), encoding: 'utf8', recursive: true });
  }
  async function stat(path, dir) {
    try {
      return await FS.stat({ path, directory: dir || DATA });
    } catch (e) {
      return null;
    }
  }
  async function remove(path, dir) {
    try {
      await FS.deleteFile({ path, directory: dir || DATA });
      return true;
    } catch (e) {
      return false;
    }
  }
  async function readdir(path, dir) {
    try {
      const r = await FS.readdir({ path, directory: dir || DATA });
      return (r.files || []).map((f) => (typeof f === 'string' ? { name: f, type: 'file', size: 0 } : f));
    } catch (e) {
      return [];
    }
  }
  function b64bytes(s) {
    const bin = atob(String(s || ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  /* the first bytes of a file on disk: is it really an mp3 / a picture, or Drive's error page? */
  async function head(path, dir, n) {
    try {
      const r = await FS.readFile({ path, directory: dir || DATA, offset: 0, length: n || 16 });
      return b64bytes(r.data);
    } catch (e) {
      return null;
    }
  }
  const isMp3 = (b) => !!b && b.length >= 3 && ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0));
  const isImage = (b) => !!b && b.length >= 12 && ((b[0] === 0xff && b[1] === 0xd8) || (b[0] === 0x89 && b[1] === 0x50) || latin1(b, 8, 12) === 'WEBP');

  function header(r, name) {
    const h = (r && r.headers) || {};
    const k = Object.keys(h).find((x) => x.toLowerCase() === name);
    return k ? String(h[k]) : '';
  }
  async function http(url, o) {
    o = o || {};
    const r = await HTTP.request({
      url,
      method: 'GET',
      headers: Object.assign({ 'User-Agent': UA }, o.headers || {}),
      responseType: o.type || 'text',
      connectTimeout: o.timeout || 15000,
      readTimeout: o.timeout || 20000
    });
    return r;
  }
  async function httpJson(url, o) {
    const r = await http(url, Object.assign({ type: 'json', headers: { Accept: 'application/json' } }, o || {}));
    let d = r.data;
    if (typeof d === 'string') {
      try {
        d = JSON.parse(d);
      } catch (e) {
        d = null;
      }
    }
    return { status: r.status, data: d };
  }

  /* ---------- downloads with progress (one native listener for all of them) ---------- */
  const progressFns = new Map();
  FS.addListener('progress', (p) => {
    if (!p || !p.url) return;
    const m = /[?&]id=([^&]+)/.exec(p.url);
    const fn = m && progressFns.get(decodeURIComponent(m[1]));
    if (fn) fn(p.bytes || 0, p.contentLength || 0);
  });
  async function fetchToFile(fileId, path, dir, onProgress) {
    if (onProgress) progressFns.set(fileId, onProgress);
    /* Android writes the download straight into the file and does not make its folder */
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (folder) await FS.mkdir({ path: folder, directory: dir, recursive: true }).catch(() => {});
    try {
      await FS.downloadFile({ url: DRIVE(fileId), path, directory: dir, recursive: true, progress: !!onProgress, headers: { 'User-Agent': UA } });
    } finally {
      progressFns.delete(fileId);
    }
  }

  /* ---------- catalog ---------- */
  let BUNDLED = null;
  async function bundledCatalog() {
    if (!BUNDLED) BUNDLED = await (await fetch('data/catalog.json')).json();
    return JSON.parse(JSON.stringify(BUNDLED));
  }
  let META = null;
  async function meta() {
    if (!META) META = (await readJson('trackmeta.json', {})) || {};
    return META;
  }
  let metaT = null;
  function saveMeta() {
    clearTimeout(metaT);
    metaT = setTimeout(() => { writeJson('trackmeta.json', META || {}).catch(() => {}); }, 1000);
  }
  async function withMeta(cat) {
    const m = await meta();
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
  async function currentCatalog() {
    const cached = await readJson('catalog.json', null);
    if (cached && Array.isArray(cached.tracks) && cached.tracks.length) return withMeta(cached);
    return withMeta(await bundledCatalog());
  }

  const ENTRY_RE = /<div class="flip-entry" id="entry-([^"]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g;
  const unescapeHtml = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  async function listFolder(folderId) {
    const r = await http('https://drive.google.com/embeddedfolderview?id=' + encodeURIComponent(folderId), { headers: { 'Accept-Language': 'en' } });
    if (r.status !== 200) throw new Error('drive listing ' + r.status);
    const html = String(r.data || '');
    const out = [];
    for (const m of html.matchAll(ENTRY_RE)) out.push({ id: m[1], folder: m[2].includes('/folders/'), name: unescapeHtml(m[3]).trim() });
    return out;
  }
  function parseName(name) {
    const m = name.match(/^\s*(\d+)\s*[-.]?\s*(.*?)\.(mp3|m4a|flac|ogg|wav|opus)$/i);
    if (!m) return null;
    return { n: parseInt(m[1], 10), title: m[2].trim() || name };
  }
  async function refreshCatalog() {
    const base = await currentCatalog();
    const bundled = await bundledCatalog();
    const metaById = new Map(bundled.tracks.map((t) => [t.id, t]));
    base.tracks.forEach((t) => { if (!metaById.has(t.id)) metaById.set(t.id, t); });
    const albumMeta = new Map(bundled.albums.map((a) => [a.id, a]));
    const bundledAlbums = new Set(bundled.albums.map((a) => a.id));
    const bundledTracks = new Set(bundled.tracks.map((t) => t.id));
    base.albums.forEach((a) => { if (!albumMeta.has(a.id)) albumMeta.set(a.id, a); });

    const folders = (await listFolder(base.root)).filter((e) => e.folder);
    if (!folders.length) throw new Error('empty root');
    const listings = await Promise.all(folders.map((f) => listFolder(f.id)));
    const albums = [];
    const tracks = [];
    folders.forEach((f, fi) => {
      const key = f.name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
      const files = listings[fi];
      const known = albumMeta.get(key);
      const coverEntry = files.find((x) => /^cover\.(jpe?g|png|webp)$/i.test(x.name));
      const album = Object.assign({}, known || { id: key, title: f.name, short: f.name, artist: 'ATLUS Sound Team', year: null, cover: null });
      album.auto = !bundledAlbums.has(key);
      album.folder = f.id;
      album.coverFile = coverEntry ? coverEntry.id : (known ? known.coverFile : null);
      /* the cover built into the app is that album's cover.jpg as it was; once a different file lies on Drive,
         the picture was changed there and Drive's one is shown */
      if (coverEntry && known && known.cover && known.coverFile && coverEntry.id !== known.coverFile) album.cover = null;
      album.tracks = [];
      const audio = files.filter((x) => !x.folder && parseName(x.name));
      audio.sort((a, b) => parseName(a.name).n - parseName(b.name).n);
      for (const x of audio) {
        const p = parseName(x.name);
        const id = key + '-' + p.n;
        const known2 = metaById.get(id);
        tracks.push(Object.assign({}, known2 || { id, album: key, n: p.n, title: p.title, artist: album.artist, sec: 0 }, { file: x.id, name: x.name, auto: !bundledTracks.has(id) }));
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
    const fresh = await withMeta({ root: base.root, albums, tracks, refreshedAt: Date.now() });
    await writeJson('catalog.json', fresh);
    return fresh;
  }

  /* ---------- duration & tags of new tracks, from the first kilobytes of the file ---------- */
  const latin1 = (b, s, e) => {
    let out = '';
    for (let i = s; i < Math.min(e, b.length); i++) out += String.fromCharCode(b[i]);
    return out;
  };
  const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  const synchsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
  function id3Text(b) {
    const enc = b[0];
    let body = b.subarray(1);
    let str;
    try {
      if (enc === 0) str = latin1(body, 0, body.length);
      else if (enc === 3) str = new TextDecoder('utf-8').decode(body);
      else {
        let be = enc === 2;
        if (body[0] === 0xff && body[1] === 0xfe) body = body.subarray(2);
        else if (body[0] === 0xfe && body[1] === 0xff) { body = body.subarray(2); be = true; }
        str = new TextDecoder(be ? 'utf-16be' : 'utf-16le').decode(body.subarray(0, body.length - (body.length % 2)));
      }
    } catch (e) {
      str = '';
    }
    return str.split('\u0000')[0].trim();
  }
  function readId3(buf) {
    if (buf.length < 10 || latin1(buf, 0, 3) !== 'ID3') return { size: 0, frames: {} };
    const ver = buf[3];
    const flags = buf[5];
    const size = synchsafe(buf, 6) + 10 + (flags & 0x10 ? 10 : 0);
    const frames = {};
    let o = 10;
    if (flags & 0x40 && buf.length > 14) o += ver === 4 ? synchsafe(buf, 10) : u32(buf, 10) + 4;
    while (o + 10 <= Math.min(buf.length, size)) {
      const id = latin1(buf, o, o + 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const len = ver === 4 ? synchsafe(buf, o + 4) : u32(buf, o + 4);
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
      const tag = latin1(buf, x, x + 4);
      if ((tag === 'Xing' || tag === 'Info') && buf.length >= x + 12 && (u32(buf, x + 4) & 1)) return u32(buf, x + 8) * spf / sr;
      const v = i + 36;
      if (latin1(buf, v, v + 4) === 'VBRI' && buf.length >= v + 18) return u32(buf, v + 14) * spf / sr;
      return audioBytes > 0 ? (audioBytes * 8) / (kbps * 1000) : null;
    }
    return null;
  }
  async function readRange(fileId, start, want) {
    const r = await http(DRIVE(fileId), { type: 'arraybuffer', headers: { Range: 'bytes=' + start + '-' + (start + want - 1) } });
    if (!(r.status === 206 || r.status === 200) || /text\/html/i.test(header(r, 'content-type'))) throw new Error('drive ' + r.status);
    const cr = header(r, 'content-range');
    const total = cr.includes('/') ? parseInt(cr.split('/')[1], 10) : (r.status === 200 ? parseInt(header(r, 'content-length') || '0', 10) : 0);
    return { buf: b64bytes(r.data).subarray(0, want), total };
  }
  async function probeTrack(t) {
    const r = await readRange(t.file, 0, 65536);
    const headBuf = r.buf;
    const id3 = readId3(headBuf);
    const tail = id3.size + 4096 > headBuf.length ? (await readRange(t.file, id3.size, 8192)).buf : null;
    const audioPart = tail || headBuf.subarray(id3.size);
    let sec = mp3Seconds(audioPart, r.total ? r.total - id3.size : 0);
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
  async function probeMissing(cat) {
    if (probeRun) return probeRun;
    const m = await meta();
    const todo = (cat.tracks || []).filter((t) => t.file && /\.mp3$/i.test(t.name || t.file + '.mp3') && !t.sec && !(m[t.file] && m[t.file].done));
    if (!todo.length) return null;
    let next = 0;
    const pending = [];
    const flush = () => { if (pending.length) emit('meta', pending.splice(0)); };
    const worker = async () => {
      while (next < todo.length) {
        const t = todo[next++];
        try {
          const r = await probeTrack(t);
          m[t.file] = Object.assign({}, m[t.file], r, { done: 1 });
          saveMeta();
          pending.push({ id: t.id, sec: r.sec, artist: t.auto ? r.artist : undefined, album: t.album, year: r.year, albumArtist: r.albumArtist });
          if (pending.length >= 8) flush();
        } catch (e) { /* network trouble: next start */ }
      }
    };
    probeRun = Promise.all([worker(), worker(), worker()]).then(flush).finally(() => { probeRun = null; });
    return probeRun;
  }

  /* ---------- album covers from Drive, kept on the phone ---------- */
  const coverSrcs = new Map();
  const coverJobs = new Map();
  async function loadCoverList() {
    for (const f of await readdir('covers')) {
      if (f.type !== 'directory' && FILE_ID_RE.test(f.name) && f.uri) coverSrcs.set(f.name, webSrc(f.uri));
    }
  }
  function fetchCover(id) {
    if (!FILE_ID_RE.test(id)) return Promise.resolve(null);
    if (coverSrcs.has(id)) return Promise.resolve(coverSrcs.get(id));
    if (coverJobs.has(id)) return coverJobs.get(id);
    const job = (async () => {
      const path = 'covers/' + id;
      await fetchToFile(id, path, DATA, null);
      if (!isImage(await head(path, DATA, 16))) {
        await remove(path);
        throw new Error('not a picture');
      }
      const u = await FS.getUri({ path, directory: DATA });
      const s = webSrc(u.uri);
      coverSrcs.set(id, s);
      return s;
    })();
    coverJobs.set(id, job);
    job.catch(() => {}).finally(() => { setTimeout(() => coverJobs.delete(id), 30000); });
    return job;
  }
  let coversT = null;
  async function prefetchCovers(cat) {
    let got = false;
    for (const a of cat.albums || []) {
      if (!a.cover && a.coverFile && !coverSrcs.has(a.coverFile)) {
        try {
          if (await fetchCover(a.coverFile)) got = true;
        } catch (e) { /* later */ }
      }
    }
    if (got) {
      clearTimeout(coversT);
      coversT = setTimeout(() => emit('covers', null), 200);
    }
  }

  /* ---------- the tracks: offline downloads and the playback cache ---------- */
  const offlinePath = (t) => 'offline/' + t.album + '/' + t.n + '.mp3';
  const streamPath = (t) => 'stream/' + t.file + '.mp3';
  const srcCache = new Map();
  async function fileSrc(path, dir) {
    const key = dir + ':' + path;
    if (srcCache.has(key)) return srcCache.get(key);
    const u = await FS.getUri({ path, directory: dir });
    const s = webSrc(u.uri);
    srcCache.set(key, s);
    return s;
  }
  async function haveTrackFile(path, dir) {
    const s = await stat(path, dir);
    return !!(s && s.size > 50 * 1024);
  }
  /* files known to be on the phone, with their address for the player: when one track ends with the screen
     locked, the next one starts without a single round trip to the native side */
  const ready = new Map();
  const offlineKnown = new Set();
  async function markReady(path, dir) {
    const s = await fileSrc(path, dir);
    ready.set(dir + ':' + path, s);
    return s;
  }
  function forget(path, dir) {
    ready.delete(dir + ':' + path);
    srcCache.delete(dir + ':' + path);
  }
  const streamJobs = new Map();
  function streamTrack(t) {
    const path = streamPath(t);
    if (ready.has(CACHE + ':' + path)) return Promise.resolve(path);
    if (streamJobs.has(t.file)) return streamJobs.get(t.file);
    const job = (async () => {
      if (await haveTrackFile(path, CACHE)) {
        await markReady(path, CACHE);
        return path;
      }
      const tmp = 'stream/' + t.file + '.part';
      await fetchToFile(t.file, tmp, CACHE, null);
      const s = await stat(tmp, CACHE);
      if (!s || s.size < 50 * 1024 || !isMp3(await head(tmp, CACHE, 4))) {
        await remove(tmp, CACHE);
        throw new Error('Google Диск не отдал файл');
      }
      await remove(path, CACHE); /* a broken leftover would block the move on Android */
      await FS.rename({ from: tmp, to: path, directory: CACHE, toDirectory: CACHE });
      await markReady(path, CACHE);
      trimStream();
      return path;
    })();
    streamJobs.set(t.file, job);
    job.catch(() => {}).finally(() => streamJobs.delete(t.file));
    return job;
  }
  let keepIds = new Set();
  let trimT = null;
  function trimStream() {
    clearTimeout(trimT);
    trimT = setTimeout(async () => {
      const files = (await readdir('stream', CACHE)).filter((f) => /\.mp3$/.test(f.name));
      files.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
      let bytes = 0;
      for (let i = 0; i < files.length; i++) {
        bytes += files[i].size || 0;
        const id = files[i].name.replace(/\.mp3$/, '');
        if ((i >= STREAM_KEEP || bytes > STREAM_BYTES) && !keepIds.has(id)) {
          forget('stream/' + files[i].name, CACHE);
          await remove('stream/' + files[i].name, CACHE);
        }
      }
      for (const f of await readdir('stream', CACHE)) if (/\.part$/.test(f.name) && !streamJobs.has(f.name.replace(/\.part$/, ''))) await remove('stream/' + f.name, CACHE);
    }, 1500);
  }

  async function mediaUrl(t) {
    const off = offlinePath(t);
    if (offlineKnown.has(t.id)) {
      const known = ready.get(DATA + ':' + off);
      if (known) return { url: known, offline: true };
      if (await haveTrackFile(off, DATA)) return { url: await markReady(off, DATA), offline: true };
      offlineKnown.delete(t.id);
    }
    if (!t.file || !FILE_ID_RE.test(t.file)) throw new Error('no file');
    keepIds = new Set([t.file].concat(Array.from(keepIds).slice(0, 2)));
    const path = await streamTrack(t);
    return { url: ready.get(CACHE + ':' + path) || await markReady(path, CACHE), offline: false };
  }
  /* the next track is fetched while this one plays */
  let prefetchT = null;
  function prefetch(t) {
    clearTimeout(prefetchT);
    if (!t || !t.file || !FILE_ID_RE.test(t.file)) return;
    keepIds.add(t.file);
    prefetchT = setTimeout(async () => {
      if (offlineKnown.has(t.id)) {
        if (!ready.has(DATA + ':' + offlinePath(t))) markReady(offlinePath(t), DATA).catch(() => {});
        return;
      }
      streamTrack(t).catch(() => {});
    }, 1500);
  }

  const downloading = new Map();
  async function downloadTrack(t) {
    if (downloading.has(t.id)) return downloading.get(t.id);
    const job = (async () => {
      const dest = offlinePath(t);
      const tmp = dest + '.part';
      const cached = streamPath(t);
      if (await haveTrackFile(cached, CACHE)) {
        await FS.mkdir({ path: 'offline/' + t.album, directory: DATA, recursive: true }).catch(() => {});
        await remove(dest);
        await FS.copy({ from: cached, directory: CACHE, to: dest, toDirectory: DATA });
      } else {
        let last = 0;
        await fetchToFile(t.file, tmp, DATA, (got, total) => {
          const now = Date.now();
          if (now - last < 150) return;
          last = now;
          emit('dl', { id: t.id, pct: total ? Math.min(99, Math.round((got / total) * 100)) : 0 });
        });
        const s = await stat(tmp, DATA);
        if (!s || s.size < 50 * 1024 || !isMp3(await head(tmp, DATA, 4))) {
          await remove(tmp);
          throw new Error('Google Диск не отдал файл');
        }
        await remove(dest);
        await FS.rename({ from: tmp, to: dest, directory: DATA, toDirectory: DATA });
      }
      const s2 = await stat(dest, DATA);
      const bytes = s2 ? s2.size : 0;
      offlineKnown.add(t.id);
      emit('dl', { id: t.id, pct: 100, done: true, bytes });
      return { id: t.id, bytes };
    })();
    downloading.set(t.id, job);
    try {
      return await job;
    } catch (e) {
      emit('dl', { id: t.id, error: String((e && e.message) || e) });
      throw e;
    } finally {
      downloading.delete(t.id);
    }
  }
  let dlQueue = Promise.resolve();
  function enqueueDownloads(list) {
    for (const t of list) {
      emit('dl', { id: t.id, pct: 0, queued: true });
      dlQueue = dlQueue.then(() => downloadTrack(t).catch(() => null));
    }
    return dlQueue;
  }
  async function listDownloads() {
    const out = [];
    for (const a of await readdir('offline')) {
      if (a.type !== 'directory') continue;
      for (const f of await readdir('offline/' + a.name)) {
        const m = f.name.match(/^(\d+)\.mp3$/);
        if (m && (f.size || 0) > 50 * 1024) {
          out.push({ id: a.name + '-' + m[1], bytes: f.size || 0 });
          offlineKnown.add(a.name + '-' + m[1]);
        }
      }
    }
    return out;
  }

  /* ---------- lyrics (LRCLIB), the same matching as on Windows ---------- */
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
    let r;
    try {
      r = await httpJson('https://lrclib.net' + pathname + '?' + new URLSearchParams(params), { timeout: 15000 });
    } catch (e) {
      throw new Error('offline');
    }
    if (r.status >= 500) throw new Error('lrclib ' + r.status);
    if (r.status < 200 || r.status >= 300) return null;
    return r.data;
  }
  const lyricsSig = (t) => [LYRICS_V, norm(t.title), norm(t.artist), t.sec > 0 ? 1 : 0].join('|');
  const stripLrc = (s) => String(s || '').split(/\r?\n/).map((l) => l.replace(/^(\s*\[[^\]]*\])+/, '').trim()).join('\n').trim();
  async function getLyrics(t) {
    const file = 'lyrics/' + t.id + '.json';
    const cached = await readJson(file, null);
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
      reqs.push(lrclib('/api/get', { track_name: t.title, artist_name: t.artist, album_name: t.albumTitle || '', duration: String(Math.round(t.sec)) }).then((r) => (r && !Array.isArray(r) && r.id != null ? [r] : [])));
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
    writeJson(file, result).catch(() => {});
    return result;
  }

  /* ---------- weather for the home screen (town by internet address, sky from Open-Meteo) ---------- */
  let geoMem = null;
  let wxMem = null;
  let wxBusy = null;
  async function getGeo() {
    if (geoMem && Date.now() - geoMem.at < 24 * 3600e3) return geoMem;
    const saved = await readJson('geo.json', null);
    if (saved && Date.now() - saved.at < 24 * 3600e3 && isFinite(saved.lat) && isFinite(saved.lon)) return (geoMem = saved);
    const tries = [
      async () => { const j = (await httpJson('https://get.geojs.io/v1/ip/geo.json', { timeout: 9000 })).data || {}; return { lat: parseFloat(j.latitude), lon: parseFloat(j.longitude), city: j.city || '' }; },
      async () => { const j = (await httpJson('https://ipwho.is/?fields=success,latitude,longitude,city', { timeout: 9000 })).data || {}; if (j.success === false) throw new Error('ipwho'); return { lat: +j.latitude, lon: +j.longitude, city: j.city || '' }; }
    ];
    for (const t of tries) {
      try {
        const g = await t();
        if (isFinite(g.lat) && isFinite(g.lon)) {
          geoMem = { at: Date.now(), lat: g.lat, lon: g.lon, city: String(g.city).slice(0, 80) };
          writeJson('geo.json', geoMem).catch(() => {});
          return geoMem;
        }
      } catch (e) { /* the spare */ }
    }
    throw new Error('no location');
  }
  function getWeather() {
    if (wxMem && Date.now() < wxMem.until) return Promise.resolve(wxMem.data);
    if (wxBusy) return wxBusy;
    wxBusy = (async () => {
      try {
        const g = await getGeo();
        const j = (await httpJson('https://api.open-meteo.com/v1/forecast?latitude=' + g.lat.toFixed(3) + '&longitude=' + g.lon.toFixed(3) + '&current=weather_code,is_day,temperature_2m', { timeout: 9000 })).data;
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

  /* ---------- the api ---------- */
  const coversReady = loadCoverList().catch(() => {});
  const clean = (t) => ({ id: t.id, album: t.album, n: t.n, title: t.title, artist: t.artist, sec: t.sec, file: t.file, albumTitle: t.albumTitle });
  window.api = {
    platform: PLATFORM,
    catalog: async () => {
      await coversReady;
      const cat = await currentCatalog();
      /* the first start has no covers of the newer albums yet: give Drive a moment before the first screen */
      const missing = (cat.albums || []).filter((a) => !a.cover && a.coverFile && !coverSrcs.has(a.coverFile));
      if (missing.length) await Promise.race([prefetchCovers(cat), sleep(2500)]);
      return cat;
    },
    refreshCatalog: async () => {
      try {
        const catalog = await refreshCatalog();
        setTimeout(() => {
          probeMissing(catalog);
          prefetchCovers(catalog);
        }, 300);
        return { ok: true, catalog };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    },
    mediaUrl: (t) => mediaUrl(clean(t)),
    prefetch: (t) => prefetch(t ? clean(t) : null),
    coverSrc: (fileId) => {
      const s = coverSrcs.get(fileId);
      if (!s && fileId) fetchCover(fileId).then(() => { clearTimeout(coversT); coversT = setTimeout(() => emit('covers', null), 200); }).catch(() => {});
      return s || null;
    },
    artwork: async (key) => {
      const k = String(key || '');
      if (k.startsWith('drive:')) {
        try {
          const s = await fetchCover(k.slice(6));
          return s ? new URL(s, location.href).href : null;
        } catch (e) {
          return null;
        }
      }
      return /^covers\/[\w.-]+\.(jpe?g|png)$/i.test(k) ? new URL(k, location.href).href : null;
    },
    downloads: () => listDownloads(),
    download: (list) => {
      enqueueDownloads(list.map(clean));
      return Promise.resolve(true);
    },
    removeDownloads: async (list) => {
      let failed = 0;
      for (const t of list) {
        const c = clean(t);
        forget(offlinePath(c), DATA);
        offlineKnown.delete(c.id);
        if (!(await remove(offlinePath(c))) && (await stat(offlinePath(c)))) failed++;
      }
      return { list: await listDownloads(), failed };
    },
    lyrics: async (t) => {
      try {
        return await getLyrics(clean(t));
      } catch (e) {
        return { found: false, error: String((e && e.message) || e) };
      }
    },
    version: () => Promise.resolve(VERSION),
    weather: () => getWeather(),
    reportDuration: async (file, sec) => {
      if (typeof file !== 'string' || !FILE_ID_RE.test(file)) return;
      sec = Math.round(Number(sec));
      if (!(sec > 0 && sec < 36000)) return;
      const m = await meta();
      if (m[file] && Math.abs((m[file].sec || 0) - sec) <= 1) return;
      m[file] = Object.assign({}, m[file], { sec });
      saveMeta();
    },
    onMeta: (fn) => on('meta', fn),
    onDownload: (fn) => on('dl', fn),
    onCovers: (fn) => on('covers', fn)
  };
  trimStream();
})();
