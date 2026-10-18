// The iPhone build checked on GitHub's Mac (ios.yml), on iOS simulators of a small, a usual and a big iPhone:
//  1. the app itself (a simulator build of the same project) installs, starts and stays up; a photo of its first screen
//     (the real catalog from Google Drive, the real status bar and home indicator);
//  2. every screen of the three themes in the simulator's own Safari — the same WebKit as the app's page — driven
//     over Safari's WebDriver, with the same small fake of the native side as scripts/preview.py
//     (a few liked and recent tracks and sample "lyrics" lines that only describe the screen, no real song text).
// Writes <out>/result.json, result.md and the PNGs.
//
//   node scripts/ios-check.mjs <out> <App.app of a Debug-iphonesimulator build>
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [OUT = 'check-ios', APP] = process.argv.slice(2);
const BUNDLE = 'com.tornoment.personafy';
const WWW = join(dirname(fileURLToPath(import.meta.url)), '..', 'www');
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();
const results = [];
function note(line) {
  const l = `[+${Math.round((Date.now() - T0) / 1000)}s] ${line}`;
  console.log(l);
  appendFileSync(`${OUT}/steps.txt`, l + '\n');
}
function check(name, pass, info) {
  results.push({ name, pass: !!pass, info: info === undefined ? null : info });
  note((pass ? 'PASS  ' : 'FAIL  ') + name + (info === undefined ? '' : '  ' + JSON.stringify(info)));
}
function sim(...args) {
  try {
    return execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000 });
  } catch (e) {
    return String((e && e.stdout) || '') + String((e && e.stderr) || '') + ' [exit ' + (e && e.status) + ']';
  }
}

/* ---------- the simulators: the smallest, a usual and the biggest iPhone this Xcode has ---------- */
function pickDevices() {
  const list = JSON.parse(sim('list', 'devices', 'available', '-j')).devices;
  const all = [];
  for (const [runtime, devs] of Object.entries(list)) {
    if (!/iOS/.test(runtime)) continue;
    const ver = (runtime.match(/iOS-(\d+)-(\d+)/) || []).slice(1).map(Number);
    devs.filter((d) => /^iPhone/.test(d.name)).forEach((d) => all.push({ ...d, ver: ver[0] * 100 + (ver[1] || 0) }));
  }
  const newest = Math.max(...all.map((d) => d.ver));
  const pool = all.filter((d) => d.ver === newest);
  const find = (re) => pool.find((d) => re.test(d.name));
  const picked = [find(/^iPhone SE/), find(/^iPhone \d+$/) || find(/^iPhone \d+ Pro$/), find(/Pro Max$/) || find(/Plus$/)].filter(Boolean);
  return [...new Map(picked.map((d) => [d.udid, d])).values()];
}

/* ---------- the page server for Safari: www, with the fake native side put first into index.html ---------- */
const cat = JSON.parse(readFileSync(join(WWW, 'data', 'catalog.json'), 'utf8'));
const state = {
  liked: { 'p5-17': 3, 'p5-1': 2, 'p3r-1': 1, 'p5r-3': 4, 'p3r-12': 6, 'p5-48': 5 },
  recent: ['p5-17', 'p3r-1', 'p5r-3', 'p5-48', 'p5-1', 'p3r-12'],
  plays: { 'p5-17': 12, 'p3r-1': 7, 'p5-1': 4 },
  queue: cat.albums[0].tracks.slice(), cur: 16, base: cat.albums[0].tracks.slice(),
  t: 83, shuffle: false, lyricsOn: false, level: true, repeat: false
};
const LRC = [[66, '♪'], [70, 'Здесь будет текст песни'], [74, 'Строки идут вместе с музыкой'], [79, 'Текущая строка — крупно'],
  [83, 'Нажмите на строку — перемотка'], [88, 'Текст можно листать пальцем'], [92, 'Через пять секунд он сам'],
  [97, 'догонит песню'], [101, 'Тексты берутся с lrclib.net']]
  .map(([s, l]) => '[' + String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0') + '.00] ' + l).join('\n');
const FAKE = `<script>(() => {
  window.__errs = [];
  addEventListener('error', (e) => __errs.push(String(e.message || e)));
  addEventListener('unhandledrejection', (e) => __errs.push('promise: ' + String(e.reason && (e.reason.message || e.reason))));
  const CAT = ${JSON.stringify(cat)}; const STATE = ${JSON.stringify(state)}; const LRC = ${JSON.stringify(LRC)};
  const THEME = new URLSearchParams(location.search).get('theme') || 'p5';
  localStorage.setItem('phantom-player.v1', JSON.stringify(Object.assign({}, STATE, { theme: THEME })));
  localStorage.setItem('personafy.swipe-hint', '1');
  const no = () => Promise.reject(new Error('nope'));
  const files = { 'catalog.json': JSON.stringify(CAT) };
  window.Capacitor = { convertFileSrc: (u) => u, getPlatform: () => 'ios', Plugins: {
    PersonafyMedia: { addListener: () => Promise.resolve({ remove() {} }), update: () => Promise.resolve(), stop: () => Promise.resolve() },
    Filesystem: { addListener: () => Promise.resolve({ remove() {} }),
      readFile: (o) => (files[o.path] && o.encoding ? Promise.resolve({ data: files[o.path] }) : no()), writeFile: () => Promise.resolve({}),
      readdir: (o) => (o.path === 'offline' ? Promise.resolve({ files: [{ name: 'p5', type: 'directory' }] }) : o.path === 'offline/p5' ? Promise.resolve({ files: [{ name: '1.mp3', type: 'file', size: 8912345 }] }) : Promise.resolve({ files: [] })),
      stat: no, deleteFile: no, getUri: (o) => Promise.resolve({ uri: 'missing/' + o.path }),
      downloadFile: () => new Promise((r, j) => setTimeout(() => j(new Error('offline')), 400)), rename: no, copy: no, mkdir: no },
    CapacitorHttp: { request: (o) => {
      if (/lrclib\\.net\\/api\\/(search|get)/.test(o.url)) return Promise.resolve({ status: 200, headers: {}, data: [{ id: 1, trackName: 'Last Surprise', artistName: 'Lyn', albumName: 'Persona 5 Original Soundtrack', duration: 234, syncedLyrics: LRC, plainLyrics: '' }] });
      if (o.url.includes('open-meteo')) return Promise.resolve({ status: 200, headers: {}, data: { current: { weather_code: 61, is_day: 1, temperature_2m: 7.4 } } });
      if (o.url.includes('geojs')) return Promise.resolve({ status: 200, headers: {}, data: { latitude: '59.3', longitude: '18.1', city: '' } });
      return new Promise((r, j) => setTimeout(() => j(new Error('offline')), 300)); } } } };
})();</script>`;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
function serve() {
  const srv = createServer((req, res) => {
    const p = join(WWW, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(WWW) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' });
    if (p.endsWith('index.html')) {
      /* the page's CSP would block the inline fake: the copy for Safari goes without it */
      const html = readFileSync(p, 'utf8').replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, '').replace(/<head[^>]*>/, (m) => m + FAKE);
      return res.end(html);
    }
    createReadStream(p).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

/* ---------- Safari's WebDriver ---------- */
const WD = 'http://127.0.0.1:4444';
async function wd(method, path, body) {
  const r = await fetch(WD + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.value && (j.value.message || j.value.error)) || 'webdriver ' + r.status);
  return j.value;
}
const js = (sid, script) => wd('POST', `/session/${sid}/execute/sync`, { script: 'return (' + script + ')', args: [] });
async function snap(sid, name) {
  const b64 = await wd('GET', `/session/${sid}/screenshot`);
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(b64, 'base64'));
}

const FIT = `(() => { const v = document.getElementById('view');
  const tabs = [...document.querySelectorAll('#nav .ph-tab')].map((t) => t.getBoundingClientRect()).filter((r) => r.height > 0);
  const navTop = tabs.length ? Math.round(Math.min(...tabs.map((r) => r.top))) : innerHeight;
  const play = document.querySelector('#view [data-act=toggle-play]'); const r = play && play.getBoundingClientRect();
  return { w: innerWidth, h: innerHeight, navTop, play: r ? [Math.round(r.top), Math.round(r.bottom)] : null, scroll: v.scrollHeight + '/' + v.clientHeight }; })()`;

async function safariScreens(dev, url) {
  let sid;
  try {
    const s = await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari', platformName: 'iOS', 'safari:useSimulator': true, 'safari:deviceUDID': dev.udid } } });
    sid = s.sessionId;
  } catch (e) {
    check(`${dev.name}: Safari WebDriver session`, false, String(e.message || e));
    return;
  }
  const tag = dev.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/-$/, '');
  const ph = 'window.__phantom';
  try {
    for (const theme of ['p5', 'p3r', 'mf']) {
      await wd('POST', `/session/${sid}/url`, { url: url + '?theme=' + theme });
      await sleep(3500);
      const up = await js(sid, `!!(window.__phantom && ${ph}.TR && ${ph}.TR.size > 0)`).catch(() => false);
      check(`${dev.name}: ${theme} interface is up`, up);
      if (!up) continue;
      const steps = {
        home: `${ph}.go('home')`,
        search: `${ph}.S.openAlbum=null; ${ph}.S.query=''; ${ph}.go('search')`,
        album: `(${ph}.S.openAlbum=null, ${ph}.go('search'), setTimeout(() => { const a = document.querySelector('[data-act=open-album][data-id=p5]'); if (a) a.click(); }, 900))`,
        library: `${ph}.go('library')`,
        now: `(${ph}.go('now'), setTimeout(() => { if (${ph}.S.lyricsOn) document.getElementById('np-lybtn').click(); }, 900))`,
        lyrics: `(${ph}.go('now'), setTimeout(() => { if (!${ph}.S.lyricsOn) document.getElementById('np-lybtn').click(); }, 900))`,
        queue: `(${ph}.go('now'), setTimeout(() => ${ph}.openQueue(), 900))`,
        settings: `(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), ${ph}.openSettings())`
      };
      for (const [s, script] of Object.entries(steps)) {
        await js(sid, script).catch((e) => note(`${theme}/${s}: ${e.message}`));
        await sleep(2600);
        await snap(sid, `${tag}-${theme}-${s}`).catch((e) => note('screenshot failed ' + e.message));
        if (s === 'now') note(`${dev.name} ${theme}/now ${JSON.stringify(await js(sid, FIT).catch(() => null))}`);
        if (s === 'queue') await js(sid, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`).catch(() => {});
      }
      const errs = await js(sid, 'window.__errs || []').catch(() => ['could not read the errors']);
      check(`${dev.name}: ${theme} without script errors`, !errs.length, errs.slice(0, 5));
    }
  } finally {
    await wd('DELETE', `/session/${sid}`).catch(() => {});
  }
}

async function appRun(dev) {
  const tag = dev.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/-$/, '');
  const inst = sim('install', dev.udid, APP);
  check(`${dev.name}: the app installs`, !/exit [1-9]/.test(inst), inst.trim().slice(0, 300) || 'ok');
  sim('privacy', dev.udid, 'grant', 'all', BUNDLE);
  const launch = sim('launch', dev.udid, BUNDLE);
  check(`${dev.name}: the app starts`, /:\s*\d+/.test(launch), launch.trim().slice(0, 200));
  await sleep(30000);
  sim('io', dev.udid, 'screenshot', `${OUT}/${tag}-app-start.png`);
  const alive = sim('spawn', dev.udid, 'launchctl', 'list');
  check(`${dev.name}: the app is still running after 30 s`, alive.includes('UIKitApplication:' + BUNDLE), null);
  const crashes = sim('spawn', dev.udid, 'log', 'show', '--last', '2m', '--style', 'compact', '--predicate', 'eventMessage CONTAINS[c] "crash" AND process == "App"');
  writeFileSync(`${OUT}/${tag}-log.txt`, crashes);
  sim('terminate', dev.udid, BUNDLE);
}

async function main() {
  if (process.env.SERVE_ONLY) {
    /* only the page server, for trying the fake in a desktop browser: prints the address and keeps serving */
    const srv = await serve();
    console.log(`http://127.0.0.1:${srv.address().port}/index.html`);
    return;
  }
  const devs = pickDevices();
  check('simulators found', devs.length > 0, devs.map((d) => d.name));
  const srv = await serve();
  const url = `http://127.0.0.1:${srv.address().port}/index.html`;
  const driver = spawn('safaridriver', ['-p', '4444'], { stdio: 'ignore' });
  await sleep(3000);
  for (const dev of devs) {
    note(`=== ${dev.name} (${dev.udid})`);
    sim('boot', dev.udid);
    sim('bootstatus', dev.udid, '-b');
    if (APP && existsSync(APP)) await appRun(dev);
    else check('the simulator build of the app exists', false, APP || 'not given');
    await safariScreens(dev, url);
    sim('shutdown', dev.udid);
  }
  driver.kill();
  srv.close();
  writeFileSync(`${OUT}/result.json`, JSON.stringify(results, null, 1));
  const fails = results.filter((r) => !r.pass);
  const md = [`# iPhone: ${results.length - fails.length} of ${results.length} checks passed`, '',
    ...results.map((r) => `- ${r.pass ? '✅' : '❌'} ${r.name}${r.pass || r.info == null ? '' : ' — `' + JSON.stringify(r.info).slice(0, 300) + '`'}`)].join('\n');
  writeFileSync(`${OUT}/result.md`, md + '\n');
  console.log(md);
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
