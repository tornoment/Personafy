"""Screenshots of the iPhone build in a phone-sized Chromium, for checking the layout without a phone.

    cd mobile && npm run build:web && python3 scripts/preview.py [out_dir] [themes] [screens]

Saves <theme>-<screen>.png (iPhone 390x844 points at 2x; with PREVIEW_PLATFORM=android an Android phone,
412x915 with Android's status and gesture bars, and the page in its Android mode). The native side (files, Google Drive, LRCLIB,
weather) is replaced by a small fake: a few liked and recent tracks, a played-tracks counter, and sample
"lyrics" lines that only explain how the lyrics screen works (no real song text).
The status bar and home-indicator areas are left empty, as tall as on an iPhone 14/15.
"""
import json
import os
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
WWW = HERE.parent / 'www'
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / 'preview'
THEMES = sys.argv[2].split(',') if len(sys.argv) > 2 else ['p5', 'p3r', 'mf']
SCREENS = sys.argv[3].split(',') if len(sys.argv) > 3 else [
    'home', 'search', 'album', 'menu', 'results', 'library', 'select', 'now', 'lyrics', 'queue', 'settings']

cat = json.loads((WWW / 'data' / 'catalog.json').read_text())

state = {
    'liked': {'p5-17': 3, 'p5-1': 2, 'p3r-1': 1, 'p5r-3': 4, 'p3r-12': 6, 'p5-48': 5},
    'recent': ['p5-17', 'p3r-1', 'p5r-3', 'p5-48', 'p5-1', 'p3r-12'],
    'plays': {'p5-17': 12, 'p3r-1': 7, 'p5-1': 4},
    'queue': list(cat['albums'][0]['tracks']), 'cur': 16, 'base': list(cat['albums'][0]['tracks']),
    't': 83, 'shuffle': False, 'lyricsOn': False, 'level': True, 'repeat': False
}
ANDROID = os.environ.get('PREVIEW_PLATFORM') == 'android'
# PREVIEW_ALBUM=<index> PREVIEW_CUR=<n>: play another album's track, e.g. to try long names
if os.environ.get('PREVIEW_ALBUM'):
    _q = list(cat['albums'][int(os.environ['PREVIEW_ALBUM'])]['tracks'])
    state.update(queue=_q, base=_q, cur=int(os.environ.get('PREVIEW_CUR', '0')))

# sample lines only — they describe the screen, they are not the song's words
LRC = '\n'.join('[%02d:%02d.00] %s' % (s // 60, s % 60, line) for s, line in [
    (66, '♪'), (70, 'Здесь будет текст песни'), (74, 'Строки идут вместе с музыкой'), (79, 'Текущая строка — крупно'),
    (83, 'Нажмите на строку — перемотка'), (88, 'Текст можно листать пальцем'), (92, 'Через пять секунд он сам'),
    (97, 'догонит песню'), (101, 'Тексты берутся с lrclib.net')])

FAKE = r"""
(() => {
  const CAT = %(cat)s;
  const STATE = %(state)s;
  const THEME = %(theme)s;
  const LRC = %(lrc)s;
  localStorage.setItem('phantom-player.v1', JSON.stringify(Object.assign({}, STATE, { theme: THEME })));
  localStorage.setItem('personafy.swipe-hint', '1');
  const no = () => Promise.reject(new Error('nope'));
  const files = { 'catalog.json': JSON.stringify(CAT) };
  window.Capacitor = {
    convertFileSrc: (u) => u,
    getPlatform: () => %(platform)s,
    Plugins: {
      PersonafyMedia: { addListener: () => Promise.resolve({ remove() {} }), update: () => Promise.resolve(), stop: () => Promise.resolve() },
      Filesystem: {
        addListener: () => Promise.resolve({ remove() {} }),
        readFile: (o) => (files[o.path] && o.encoding ? Promise.resolve({ data: files[o.path] }) : no()),
        writeFile: () => Promise.resolve({}),
        readdir: (o) => (o.path === 'offline' ? Promise.resolve({ files: [{ name: 'p5', type: 'directory' }] })
          : o.path === 'offline/p5' ? Promise.resolve({ files: [{ name: '1.mp3', type: 'file', size: 8912345 }] })
          : Promise.resolve({ files: [] })),
        stat: no, deleteFile: no, getUri: (o) => Promise.resolve({ uri: 'missing/' + o.path }),
        downloadFile: () => new Promise((r, j) => setTimeout(() => j(new Error('offline')), 400)),
        rename: no, copy: no, mkdir: no
      },
      CapacitorHttp: {
        request: (o) => {
          if (o.url.includes('lrclib.net/api/search')) {
            return Promise.resolve({ status: 200, headers: {}, data: [{ id: 1, trackName: 'Last Surprise', artistName: 'Lyn', albumName: 'Persona 5 Original Soundtrack', duration: 234, syncedLyrics: LRC, plainLyrics: '' }] });
          }
          if (o.url.includes('open-meteo')) return Promise.resolve({ status: 200, headers: {}, data: { current: { weather_code: 61, is_day: 1, temperature_2m: 7.4 } } });
          if (o.url.includes('geojs')) return Promise.resolve({ status: 200, headers: {}, data: { latitude: '59.3', longitude: '18.1', city: '' } });
          return new Promise((r, j) => setTimeout(() => j(new Error('offline')), 300));
        }
      }
    }
  };
})();
"""


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve():
    srv = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=str(WWW)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    srv = serve()
    url = 'http://127.0.0.1:%d/index.html' % srv.server_address[1]
    ph = 'window.__phantom'
    with sync_playwright() as p:
        b = p.chromium.launch()
        for theme in THEMES:
            size = {'width': 412, 'height': 915} if ANDROID else {'width': 390, 'height': 844}
            ctx = b.new_context(viewport=size, device_scale_factor=2, is_mobile=True, has_touch=True)
            ctx.add_init_script(FAKE % {'cat': json.dumps(cat), 'state': json.dumps(state), 'theme': json.dumps(theme), 'lrc': json.dumps(LRC),
                                        'platform': json.dumps('android' if ANDROID else 'ios')})
            page = ctx.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.goto(url)
            page.wait_for_timeout(2600)
            # the phone's status bar and home indicator (Android: status bar and gesture bar)
            page.add_style_tag(content=':root{--sat:36px;--sab:24px}' if ANDROID else ':root{--sat:47px;--sab:34px}')
            for s in SCREENS:
                if s == 'home':
                    page.evaluate(ph + ".go('home')")
                elif s == 'search':
                    page.evaluate(ph + ".S.openAlbum=null;" + ph + ".S.query='';" + ph + ".go('search')")
                elif s in ('album', 'menu'):
                    if not page.query_selector('[data-row="p5-4"]'):
                        # leave for a moment, so the search screen is drawn afresh with the albums
                        page.evaluate(ph + ".S.openAlbum=null;" + ph + ".S.query='';" + ph + ".go('home')")
                        page.wait_for_timeout(900)
                        page.evaluate(ph + ".go('search')")
                        page.wait_for_timeout(900)
                        page.eval_on_selector('[data-act=open-album][data-id=p5]', 'e => e.click()')
                    if s == 'menu':
                        page.wait_for_timeout(900)
                        page.evaluate("document.querySelector('[data-row=\"p5-4\"]').scrollIntoView({block:'center'})")
                        page.wait_for_timeout(400)
                        page.eval_on_selector('[data-row="p5-4"] [data-act=track-menu]', 'e => e.click()')
                elif s == 'results':
                    page.evaluate(ph + ".S.openAlbum=null;" + ph + ".go('search')")
                    page.wait_for_timeout(900)
                    page.fill('#q', 'life')
                elif s in ('library', 'select'):
                    page.evaluate(ph + ".go('library')")
                    if s == 'select':
                        page.wait_for_timeout(900)
                        page.eval_on_selector('#lib-dl-btn', 'e => e.click()')
                        page.wait_for_timeout(500)
                        for tid in ('p5-17', 'p3r-1'):
                            page.eval_on_selector('[data-act=sel][data-id="%s"]' % tid, 'e => e.click()')
                        page.evaluate("(() => { const v = document.getElementById('view'); const p = document.getElementById('sel-panel'); v.scrollTop = Math.max(0, p.offsetTop + p.offsetParent.offsetTop - 120); })()")
                elif s in ('now', 'lyrics'):
                    page.evaluate(ph + ".go('now')")
                    page.wait_for_timeout(900)
                    on = page.evaluate(ph + '.S.lyricsOn')
                    if (s == 'lyrics') != on:
                        page.eval_on_selector('#np-lybtn', 'e => e.click()')
                elif s == 'queue':
                    page.evaluate(ph + ".go('now')")
                    page.wait_for_timeout(900)
                    page.evaluate(ph + '.openQueue()')
                elif s == 'settings':
                    page.evaluate(ph + '.openSettings()')
                page.mouse.move(2, 2)  # no hover left over from the last tap
                page.wait_for_timeout(1600)
                page.screenshot(path=str(OUT / ('%s-%s.png' % (theme, s))))
                if os.environ.get('PREVIEW_MEASURE') and s in ('now', 'lyrics'):
                    # does the screen still fit without scrolling, and where the controls row sits
                    print(theme, s, page.evaluate("""(() => {
                      const v = document.getElementById('view'), c = document.querySelector('.np-ctl'), n = document.getElementById('nav');
                      const r = c && c.getBoundingClientRect();
                      const box = sel => { const e = document.querySelector(sel); if (!e) return null; const q = e.getBoundingClientRect(); return [Math.round(q.top), Math.round(q.bottom)]; };
                      return {scroll: v.scrollHeight, client: v.clientHeight, ctlTop: r && Math.round(r.top), ctlBottom: r && Math.round(r.bottom), navTop: Math.round(n.getBoundingClientRect().top),
                        chain: (() => { const out = []; let e = document.querySelector('.np-band'); while (e && e.id !== 'stage') { const q = e.getBoundingClientRect(), cs = getComputedStyle(e); out.push((e.id || e.className.toString().split(' ').slice(0,2).join('.')) + ' ' + Math.round(q.top) + '-' + Math.round(q.bottom) + ' mh=' + cs.minHeight + ' pb=' + cs.paddingBottom + ' h=' + cs.height); e = e.parentElement; } return out; })(),
                        root: box('#view > *'), main: box('.np-main,.n3-main,.mfn-main'), band: box('.np-band'), pad: getComputedStyle(v).paddingBottom};
                    })()"""))
                if s in ('queue', 'settings', 'menu'):
                    page.keyboard.press('Escape')
                    page.wait_for_timeout(500)
            if errors:
                print(theme, 'errors:', *errors[:8], sep='\n  ')
            ctx.close()
        b.close()
    srv.shutdown()
    print('saved to', OUT)


if __name__ == '__main__':
    main()
