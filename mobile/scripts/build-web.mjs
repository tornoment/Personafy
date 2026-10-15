// Builds mobile/www — the player's own interface (app/src) plus the phone pieces, one www for iPhone and Android:
//   phone-api.js — window.api done with Capacitor instead of Electron (Drive, files, lyrics, weather)
//   android.js   — Android only: notification/lock-screen player, long press (does nothing on the iPhone)
//   phone.css    — the narrow-screen layout of all three themes
// The desktop files are copied untouched; index.html only gets the viewport, a CSP for the app's
// own scheme (capacitor:// on the iPhone, https://localhost on Android) and the extra files.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mobile = join(here, '..');
const src = join(mobile, '..', 'app', 'src');
const out = join(mobile, 'www');
const pkg = JSON.parse(readFileSync(join(mobile, 'package.json'), 'utf8'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(src, out, { recursive: true });
copyFileSync(join(mobile, 'web', 'phone.css'), join(out, 'phone.css'));
writeFileSync(join(out, 'phone-api.js'), readFileSync(join(mobile, 'web', 'phone-api.js'), 'utf8').replace('__VERSION__', pkg.version));
copyFileSync(join(mobile, 'web', 'android.js'), join(out, 'android.js'));

let html = readFileSync(join(out, 'index.html'), 'utf8');
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; " +
  "img-src 'self' data: blob: capacitor:; media-src 'self' blob: capacitor:; connect-src 'self' capacitor:; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'";
const swaps = [
  [/<meta http-equiv="Content-Security-Policy" content="[^"]*">/, '<meta http-equiv="Content-Security-Policy" content="' + csp + '">'],
  ['<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n<meta name="format-detection" content="telephone=no">'],
  ['<html lang="ru">', '<html lang="ru" class="phone">'],
  ['<link rel="stylesheet" href="mf.css">', '<link rel="stylesheet" href="mf.css">\n<link rel="stylesheet" href="phone.css">'],
  ['<script src="app.js"></script>', '<script src="phone-api.js"></script>\n<script src="android.js"></script>\n<script src="app.js"></script>']
];
for (const [from, to] of swaps) {
  const next = html.replace(from, to);
  if (next === html) throw new Error('index.html changed: could not find ' + from);
  html = next;
}
writeFileSync(join(out, 'index.html'), html);
console.log('www ready (' + pkg.version + ')');
