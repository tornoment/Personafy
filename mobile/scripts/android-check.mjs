// The Android build on a real Android (an emulator on GitHub, android.yml), checked like a person would:
// the signed .apk installs and starts; then (in the debug build, whose page can be driven over DevTools)
// music plays from Google Drive, the notification / lock-screen player follows it, headphone buttons work,
// the music goes on with the app in the background and with the screen off (into the next track too), the back
// button steps back, and every theme is photographed. Writes <out>/result.json, result.md, PNGs and logcat.txt.
//
//   node scripts/android-check.mjs <out> <release.apk> <debug.apk>
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, createWriteStream, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const [OUT = 'check', RELEASE, DEBUG] = process.argv.slice(2);
/* CHECK=themes: only the photos of the three themes (a separate emulator run: the default one, drawing through the
   host's software graphics, crashed on the P3R theme every time — an emulator fault, the page itself is fine) */
const ONLY_THEMES = process.env.CHECK === 'themes';
const WITH_THEMES = ONLY_THEMES || process.env.CHECK === 'all';
const PKG = 'com.tornoment.personafy';
const ACT = PKG + '/.MainActivity';
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function adb(...args) {
  try {
    return execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 120000 });
  } catch (e) {
    return String((e && e.stdout) || '') + String((e && e.stderr) || '');
  }
}
function shot(name) {
  try {
    const png = execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
    writeFileSync(`${OUT}/${name}.png`, png);
  } catch (e) {
    console.log('screenshot failed', name, e.message);
  }
}
const results = [];
const pageErrors = [];
const T0 = Date.now();
function note(line) {
  const l = `[${new Date().toISOString().slice(11, 19)} +${Math.round((Date.now() - T0) / 1000)}s] ${line}`;
  console.log(l);
  appendFileSync(`${OUT}/steps.txt`, l + '\n');
}
function check(name, pass, info) {
  results.push({ name, pass: !!pass, info: info === undefined ? null : info });
  note((pass ? 'PASS  ' : 'FAIL  ') + name + (info === undefined ? '' : '  ' + JSON.stringify(info)));
}
async function until(fn, ms, step = 1000) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    try {
      v = await fn();
      if (v) return v;
    } catch (e) { /* not yet */ }
    await sleep(step);
  }
  return v;
}
const pid = () => adb('shell', 'pidof', PKG).trim();
const focused = () => (adb('shell', 'dumpsys', 'window').match(/mCurrentFocus=.*$/m) || [''])[0];
/* the activity on top (more dependable on a busy emulator than the window focus) */
const resumed = () => (adb('shell', 'dumpsys', 'activity', 'activities').match(/topResumedActivity=.*$/m) || [''])[0];
/* the emulator's own apps sometimes hang ("Pixel Launcher isn't responding"); such a dialog would take the keys */
function clearDialogs() {
  for (let i = 0; i < 3; i++) {
    const f = focused();
    const m = f.match(/Not Responding: ([\w.]+)/) || f.match(/Application Error: ([\w.]+)/);
    if (!m) return;
    note('closing a system dialog: ' + f);
    adb('shell', 'am', 'force-stop', m[1]);
    adb('shell', 'input', 'keyevent', 'KEYCODE_ESCAPE');
  }
}
/* the app on screen and in focus (for the key tests) */
async function front() {
  clearDialogs();
  adb('shell', 'am', 'start', '-n', ACT);
  return until(() => { clearDialogs(); return resumed().includes(PKG + '/'); }, 20000);
}
function wake() {
  adb('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
  adb('shell', 'wm', 'dismiss-keyguard');
  adb('shell', 'input', 'keyevent', 'KEYCODE_MENU');
}

/* ---------- DevTools of the app's web view ---------- */
/* The page's DevTools. The app's window may be re-created once right after installing (Android re-applies
   the package's resources), and with it the web view: then the connection is made again to the new one. */
async function connectPage() {
  const p = await until(() => pid(), 30000);
  const sock = 'webview_devtools_remote_' + p;
  await until(() => adb('shell', 'cat', '/proc/net/unix').includes(sock), 30000);
  adb('forward', '--remove-all');
  adb('forward', 'tcp:9333', 'localabstract:' + sock);
  const page = await until(async () => {
    const list = await (await fetch('http://127.0.0.1:9333/json')).json();
    return list.find((x) => x.type === 'page' && /^https:\/\/localhost/.test(x.url));
  }, 30000);
  if (!page) throw new Error('no page in the web view');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const wait = new Map();
  let closed = false;
  ws.onclose = () => {
    closed = true;
    wait.forEach((fn) => fn({ error: 'closed' }));
    wait.clear();
  };
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      pageErrors.push(((d.exception && d.exception.description) || d.text || 'error').split('\n')[0].slice(0, 200));
    }
    if (m.id && wait.has(m.id)) {
      wait.get(m.id)(m);
      wait.delete(m.id);
    }
  };
  const send = (method, params, ms = 45000) => new Promise((res) => {
    if (closed) return res({ error: 'closed' });
    const i = ++id;
    wait.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (wait.has(i)) { wait.delete(i); res({ error: 'timeout' }); } }, ms);
  });
  await send('Runtime.enable', {});
  return { id: page.id, pid: p, send, close: () => ws.close() };
}
async function devtools() {
  let c = null;
  const connect = async () => {
    if (c) c.close();
    c = await connectPage();
    return c;
  };
  await connect();
  const run = async (method, params) => {
    let r = await c.send(method, params);
    if (r.error === 'timeout' || r.error === 'closed') {
      console.log('devtools: reconnecting (' + r.error + ')');
      await sleep(3000);
      await connect();
      r = await c.send(method, params);
    }
    return r;
  };
  const js = async (expression) => {
    const r = await run('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.error) throw new Error(JSON.stringify(r.error));
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  return { js, send: run, connect, close: () => c && c.close() };
}

/* is the app's sound actually going to the speaker (Android's own list of players)? */
function soundOut() {
  const p = pid();
  const lines = adb('shell', 'dumpsys', 'audio').split('\n').filter((l) => /AudioPlaybackConfiguration/.test(l) && new RegExp('u/pid:\\d+/' + p + '\\b').test(l));
  return { started: lines.some((l) => /state:started/.test(l)), players: lines.map((l) => (l.match(/state:\w+/) || [''])[0]) };
}
/* the page's Web Audio (volume levelling): the check wraps AudioContext before the page starts, to read its state */
const WRAP_AC = `(() => { const A = window.AudioContext; if (!A || A.__wrapped) return; window.__ctxs = []; const W = function (o) { const c = new A(o); window.__ctxs.push(c); return c; }; W.prototype = A.prototype; W.__wrapped = true; window.AudioContext = W; })();`;
const CTX = `(window.__ctxs || []).map((c) => c.state).join(',')`;

const AUDIO = `(() => { const a = document.getElementById('audio'); return { t: a.currentTime, d: a.duration, paused: a.paused, src: a.currentSrc || a.src, err: a.error && a.error.code, view: document.body.dataset.view, title: (navigator.mediaSession.metadata || {}).title || '' }; })()`;
const click = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`;

async function main() {
  adb('shell', 'settings', 'put', 'global', 'window_animation_scale', '0');
  adb('shell', 'settings', 'put', 'secure', 'anr_show_background', '0');
  adb('shell', 'settings', 'put', 'global', 'transition_animation_scale', '0');
  adb('shell', 'settings', 'put', 'system', 'screen_off_timeout', '1800000');
  wake();
  await sleep(20000); /* a freshly booted emulator is still busy for a while */
  clearDialogs();

  /* 1. the release .apk: what will be installed on the phone */
  if (RELEASE && !ONLY_THEMES) {
    const inst = adb('install', '-r', RELEASE);
    check('release .apk installs', /Success/.test(inst), inst.trim().split('\n').pop());
    await sleep(15000); /* the system's own work after an install, before the first start */
    note('release in front: ' + (await front()));
    await sleep(12000);
    clearDialogs();
    shot('00-release-start');
    const crashed = /FATAL EXCEPTION/.test(adb('logcat', '-d', '-b', 'crash'));
    const rp = pid();
    check('release .apk starts without crashing', /^\d+$/.test(rp) && !crashed, { pid: rp, top: resumed() });
    adb('uninstall', PKG);
  }
  if (!DEBUG) return;

  /* 2. the debug build: the same app, its page can be driven */
  const inst = adb('install', '-r', DEBUG);
  check('debug .apk installs', /Success/.test(inst));
  await sleep(15000);
  note('debug in front: ' + (await front()) + ' ' + focused());
  await sleep(5000);
  const D = await devtools();
  const ready = () => until(() => D.js(`document.querySelectorAll('[data-act]').length > 10 && !!document.querySelector('#nav .ph-tab')`), 60000);
  await ready();
  await D.send('Page.enable', {});
  await D.send('Page.addScriptToEvaluateOnNewDocument', { source: WRAP_AC });
  await D.js('setTimeout(() => location.reload(), 50), true');
  await sleep(3000);
  const loaded = await ready();
  check('player interface is up', loaded);
  const env = await D.js(`({ cls: document.documentElement.className, theme: document.documentElement.dataset.theme, back: typeof window.personafyBack, ms: typeof navigator.mediaSession.setActionHandler, platform: window.api && window.api.platform, st: getComputedStyle(document.documentElement).getPropertyValue('--st'), sat: getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top'), w: innerWidth, h: innerHeight, ua: navigator.userAgent })`);
  check('page knows it is on Android', env && /\bphone\b/.test(env.cls) && /\bandroid\b/.test(env.cls) && env.platform === 'android' && env.back === 'function', env);
  const cat = await until(() => D.js(`window.api.catalog().then((c) => c.tracks.length)`), 30000);
  check('catalog of tracks', cat > 50, { tracks: cat });
  await sleep(3000);
  shot('01-home-p5');

  /* 3. play an album's first track (from Google Drive) */
  await D.js(click('[data-nav=search]'));
  await sleep(1500);
  const opened = await D.js(click('[data-act=open-album]'));
  await sleep(1500);
  shot('02-album-p5');
  const tapped = await D.js(click('#view [data-act=play]'));
  const playing = await until(async () => { const a = await D.js(AUDIO); return a.t > 3 && !a.paused ? a : null; }, 120000, 2000);
  const a1 = await D.js(AUDIO);
  check('music plays from Google Drive', !!playing, Object.assign({ opened, tapped }, a1));
  check('track is served from the app\'s cache', /_capacitor_file_/.test(a1.src || ''), a1.src);
  const levelling = await D.js(`(() => { try { return JSON.parse(localStorage.getItem('phantom-player.v1') || '{}').level; } catch (e) { return null; } })()`);
  check('volume levelling (Web Audio) is running', levelling !== false && /running/.test(await D.js(CTX)), { level: levelling, contexts: await D.js(CTX) });
  check('sound goes out of the phone', soundOut().started, soundOut());
  if (a1.view !== 'now') await D.js(click('[data-act=go-now]'));
  await sleep(2500);
  shot('03-now-p5');

  if (!ONLY_THEMES) {
  /* 4. the player outside the app */
  await sleep(1500);
  const ms = adb('shell', 'dumpsys', 'media_session');
  const at = ms.indexOf(PKG + '/');
  const block = at >= 0 ? ms.slice(at, at + 3000) : '';
  check('media session is playing', /state=PlaybackState \{state=(3|PLAYING)/.test(block) || /state=3/.test(block), block.split('\n').filter((l) => /state=|description=|active=/.test(l)).map((l) => l.trim()).slice(0, 6));
  check('media session shows the track', a1.title && block.includes(a1.title), a1.title);
  const services = adb('shell', 'dumpsys', 'activity', 'services', PKG);
  check('playback service in the foreground', /isForeground=true/.test(services), (services.match(/isForeground=\w+.*$/m) || [''])[0]);
  const notes = adb('shell', 'dumpsys', 'notification', '--noredact');
  check('notification is posted', notes.includes('pkg=' + PKG) && /MediaStyle|android\.mediaSession/.test(notes));
  adb('shell', 'cmd', 'statusbar', 'expand-notifications');
  await sleep(2500);
  shot('04-notification');
  adb('shell', 'cmd', 'statusbar', 'collapse');
  await sleep(1000);

  /* 5. headphone / Bluetooth buttons go through the media session */
  adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PAUSE');
  const paused = await until(async () => (await D.js(AUDIO)).paused, 8000, 500);
  check('headphones: pause', paused);
  adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_PLAY');
  const replayed = await until(async () => !(await D.js(AUDIO)).paused, 8000, 500);
  check('headphones: play', replayed);
  const before = await D.js(AUDIO);
  adb('shell', 'input', 'keyevent', 'KEYCODE_MEDIA_NEXT');
  const nextOk = await until(async () => { const a = await D.js(AUDIO); return a.src !== before.src && a.t > 1 && !a.paused ? a : null; }, 90000, 1500);
  check('headphones: next track', !!nextOk, nextOk ? nextOk.title : (await D.js(AUDIO)));

  /* 6. seeking inside the cached file */
  await D.js(`(() => { const a = document.getElementById('audio'); a.currentTime = Math.min(90, a.duration - 20); })()`);
  await sleep(3000);
  const sk = await D.js(AUDIO);
  check('seek', sk.t > 60 && !sk.paused && !sk.err, sk);

  /* 7. background and screen off */
  adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
  const b0 = await D.js(AUDIO);
  await sleep(15000);
  const b1 = await D.js(AUDIO);
  const bgOut = soundOut();
  check('keeps playing in the background', !b1.paused && b1.t - b0.t > 10 && bgOut.started, { from: b0.t, to: b1.t, out: bgOut, ctx: await D.js(CTX) });
  adb('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  await sleep(3000);
  await D.js(`(() => { const a = document.getElementById('audio'); a.currentTime = Math.max(0, a.duration - 4); })()`);
  const s0 = await D.js(AUDIO);
  const nextOff = await until(async () => { const a = await D.js(AUDIO); return a.src !== s0.src && a.t > 5 && !a.paused ? a : null; }, 120000, 2000);
  check('screen off: the next track starts by itself', !!nextOff, nextOff ? { title: nextOff.title, t: nextOff.t } : await D.js(AUDIO));
  await sleep(20000);
  const s2 = await D.js(AUDIO);
  const offOut = soundOut();
  check('screen off: still playing 20 s later', !s2.paused && (!nextOff || s2.t > nextOff.t + 15) && offOut.started, { t: s2.t, out: offOut, ctx: await D.js(CTX) });
  shot('05-lock-screen');
  wake();
  await sleep(1500);

  /* 8. the back button: first what it does (app.js backStep), then the button itself */
  note('in front: ' + (await front()) + ' ' + resumed());
  await sleep(1500);
  await D.js(click('[data-nav=search]'));
  await sleep(1500);
  await D.js(click('[data-act=open-album]'));
  await sleep(1500);
  /* an open album closes first, then the search screen goes home */
  const albumBefore = await D.js(`!!document.querySelector('#view [data-act=close-album]')`);
  const b0s = await D.js('window.personafyBack()');
  await sleep(1500);
  const albumAfter = await D.js(`!!document.querySelector('#view [data-act=close-album]')`);
  const b0v = (await D.js(AUDIO)).view;
  const b1s = await D.js('window.personafyBack()');
  await sleep(1500);
  const b1v = (await D.js(AUDIO)).view;
  check('back logic: album → search → home', albumBefore && b0s === true && !albumAfter && b0v === 'search' && b1s === true && b1v === 'home', { albumBefore, b0s, albumAfter, b0v, b1s, b1v });
  await D.js(click('[data-act=settings-open]'));
  await sleep(1200);
  const b2o = await D.js(`document.getElementById('settings').classList.contains('open')`);
  const b2s = await D.js('window.personafyBack()');
  await sleep(1000);
  const b2c = !(await D.js(`document.getElementById('settings').classList.contains('open')`));
  const b3s = await D.js('window.personafyBack()');
  check('back logic: closes the settings, nothing left on home', b2o && b2s === true && b2c && b3s === false, { b2o, b2s, b2c, b3s });
  await sleep(1500);
  await D.js(click('[data-nav=search]'));
  await sleep(1500);
  clearDialogs();
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await sleep(1500);
  check('back: search → home', (await D.js(AUDIO)).view === 'home');
  if ((await D.js(AUDIO)).view !== 'home') {
    await D.js(click('[data-nav=home]'));
    await sleep(1500);
  }
  await D.js(click('[data-act=settings-open]'));
  await sleep(1200);
  const sOpen = await D.js(`document.getElementById('settings').classList.contains('open')`);
  clearDialogs();
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await sleep(1200);
  const sClosed = !(await D.js(`document.getElementById('settings').classList.contains('open')`));
  check('back: closes the settings', sOpen && sClosed, { opened: sOpen, closed: sClosed });
  const atHome = (await D.js(AUDIO)).view === 'home' && resumed().includes(PKG + '/');
  clearDialogs();
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await sleep(2500);
  const top = resumed();
  const still = await D.js(AUDIO);
  check('back on home: app goes to the background, music goes on', atHome && !top.includes(PKG) && !still.paused, { atHome, top, paused: still.paused });

  }
  if (!WITH_THEMES) {
    D.close();
    return;
  }

  /* 9. every theme */
  await front();
  await sleep(2500);
  /* P3R last: its water transition is what the emulator's software graphics could not survive */
  for (const th of ['p5', 'mf', 'p3r']) {
   try {
    note('theme ' + th);
    await D.js(click('[data-nav=home]'));
    await sleep(1200);
    await D.js(click('[data-act=settings-open]'));
    await sleep(1000);
    if (th === 'p5') shot('10-settings-p5');
    await D.js(click(`[data-act=set-theme][data-theme-id=${th}]`));
    await sleep(1500);
    if (th !== 'p5') shot(`10-settings-${th}`);
    await D.js(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
    await sleep(1200);
    shot(`11-home-${th}`);
    await D.js(click('[data-nav=library]'));
    await sleep(2000);
    shot(`13-library-${th}`);
    await D.js(click('[data-act=go-now]'));
    await sleep(2200);
    shot(`12-now-${th}`);
   } catch (e) {
    shot(`err-${th}`);
    check('theme tour: ' + th, false, String(e && e.message || e).slice(0, 300));
    clearDialogs();
    await front();
   }
  }
  const fin = await D.js(AUDIO);
  check('still playing after the theme tour', !fin.paused, fin);
  D.close();
}

const ALL = `${OUT}/logcat-all.txt`;
const logProc = spawn('adb', ['logcat', '-v', 'time'], { stdio: ['ignore', 'pipe', 'ignore'] });
logProc.stdout.pipe(createWriteStream(ALL));
try {
  await main();
} catch (e) {
  shot('err-main');
  check('check script ran to the end', false, String(e && e.stack || e));
}
await sleep(1500);
logProc.kill();
await sleep(500);
let log = '';
try {
  log = readFileSync(ALL, 'utf8');
  rmSync(ALL);
} catch (e) { /* none */ }
const mine = log.split('\n').filter((l) => /Capacitor|chromium|Personafy|AndroidRuntime|FATAL|WebView|personafy|lowmemorykiller|ANR in|Killing/i.test(l));
writeFileSync(`${OUT}/logcat.txt`, mine.join('\n'));
/* (Capacitor's own safe-area script runs once before the page exists: not the app's error) */
const jsErrors = mine.filter((l) => /Uncaught|TypeError|ReferenceError/.test(l) && !/Error injecting safe area CSS/.test(l));
check('no script errors on the page', pageErrors.length === 0 && jsErrors.length === 0, pageErrors.concat(jsErrors).slice(0, 8));
writeFileSync(`${OUT}/result.json`, JSON.stringify(results, null, 2));
const passed = results.filter((r) => r.pass).length;
writeFileSync(`${OUT}/result.md`, `# Проверка Android-сборки: ${passed} из ${results.length}\n\n` +
  results.map((r) => `- ${r.pass ? '✅' : '❌'} ${r.name}${r.info == null ? '' : ' — `' + JSON.stringify(r.info).slice(0, 300).replace(/`/g, "'") + '`'}`).join('\n') + '\n');
console.log(`${passed}/${results.length} passed`);
