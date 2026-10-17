'use strict';
/* Personafy for Android — the few things the phone does differently from the iPhone. Does nothing elsewhere.
   - Android's web view shows no player for the page's Media Session, so navigator.mediaSession is replaced by
     a stand-in that hands the track, the play/pause state and the position to the app's own notification
     (android/…/PlaybackService.java): lock screen, notification shade, headphones and Bluetooth buttons.
     The service also keeps the app alive while music plays with the screen off.
   - A long press is the track menu already (app.js); Android's own long-press "context menu" would open it twice.
   - The back button/gesture asks app.js (window.personafyBack) to close or step back; MainActivity.java. */
(function () {
  const cap = window.Capacitor;
  if (!cap || typeof cap.getPlatform !== 'function' || cap.getPlatform() !== 'android') return;
  const doc = document;

  /* The interface needs Chrome 104+ in the system web view (separate rotate/translate, aspect-ratio, flex gap…).
     A phone without Google Play updates may still have a web view from 2018–2019 that draws every screen broken,
     so it says what to update instead. Kept to the plainest styles, which that old web view draws right. */
  const webview = +((navigator.userAgent.match(/Chrome\/(\d+)/) || [])[1] || 0);
  if (webview && webview < 104) {
    const box = doc.createElement('div');
    box.setAttribute('style', 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483647;background:#0b0b0b;color:#ffffff;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px;text-align:center;font:16px/1.45 sans-serif');
    box.innerHTML = '<p style="margin:0 0 14px;font-size:22px;font-weight:bold">Нужно обновить WebView</p>' +
      '<p style="margin:0 0 14px">Personafy рисует свои экраны через системный компонент «Android System WebView». ' +
      'На этом телефоне он слишком старый (версия ' + webview + '), и плеер будет выглядеть с ошибками.</p>' +
      '<p style="margin:0 0 26px">Обновите «Android System WebView» в Play Маркете и откройте Personafy снова.</p>' +
      '<a href="https://play.google.com/store/apps/details?id=com.google.android.webview" style="display:block;background:#ffffff;color:#0b0b0b;padding:12px 22px;font-weight:bold;text-decoration:none">Открыть в Play Маркете</a>' +
      '<button type="button" style="margin-top:22px;background:none;border:0;color:#9a9a9a;font-size:14px;text-decoration:underline">Всё равно открыть плеер</button>';
    box.querySelector('button').addEventListener('click', () => box.parentNode.removeChild(box));
    doc.body.appendChild(box);
  }

  window.addEventListener('contextmenu', (e) => {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  const MEDIA = cap.Plugins && cap.Plugins.PersonafyMedia;
  if (!MEDIA) {
    console.warn('Personafy: the media plugin is missing');
    return;
  }

  /* ---------- the stand-in Media Session ---------- */
  window.MediaMetadata = function MediaMetadata(o) {
    o = o || {};
    this.title = String(o.title || '');
    this.artist = String(o.artist || '');
    this.album = String(o.album || '');
    this.artwork = Array.isArray(o.artwork) ? o.artwork.slice() : [];
  };
  const handlers = Object.create(null);
  let meta = null;
  let stateWord = 'none';
  const session = {
    get metadata() { return meta; },
    set metadata(m) { meta = m || null; schedule(true); },
    get playbackState() { return stateWord; },
    set playbackState(s) { stateWord = String(s || 'none'); schedule(true); },
    setActionHandler(name, fn) { handlers[name] = typeof fn === 'function' ? fn : null; },
    setPositionState() { schedule(true); },
    setMicrophoneActive() {},
    setCameraActive() {}
  };
  try {
    Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true });
  } catch (e) {
    console.warn('Personafy: could not replace mediaSession', e);
    return;
  }

  MEDIA.addListener('action', (d) => {
    const fn = d && handlers[d.action];
    if (!fn) return;
    try {
      fn({ action: d.action, seekTime: typeof d.seekTime === 'number' ? d.seekTime : undefined });
    } catch (e) {
      console.error(e);
    }
  });

  /* the cover goes to the notification as a small JPEG (same-origin pictures only: the app's own and Drive's cached ones) */
  function jpeg(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const k = Math.min(1, 512 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
          const c = doc.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * k));
          c.height = Math.max(1, Math.round(img.naturalHeight * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.86).split(',')[1] || '');
        } catch (e) {
          resolve('');
        }
      };
      img.onerror = () => resolve('');
      img.src = src;
    });
  }

  /* "playing" for the notification: the sound is on, or the next track is on its way (between two tracks the
     player is paused for a moment; the notification must not drop the app out of the foreground then) */
  function isPlaying() {
    const b = doc.body;
    if (!b) return false;
    return !b.classList.contains('paused') || b.classList.contains('buffering');
  }

  let sentArt = null;
  let lastSig = '';
  let timer = null;
  let forced = false;
  let busy = false;
  function schedule(force) {
    if (force) forced = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      push();
    }, 60);
  }
  async function push() {
    if (busy) {
      schedule(false);
      return;
    }
    busy = true;
    try {
      const a = doc.getElementById('audio');
      const m = meta || {};
      const playing = isPlaying();
      const art = m.artwork && m.artwork[0] && m.artwork[0].src ? String(m.artwork[0].src) : '';
      const sig = [m.title, m.artist, m.album, art, playing].join('\u0001');
      if (!forced && sig === lastSig) return;
      forced = false;
      lastSig = sig;
      const msg = {
        title: m.title || '',
        artist: m.artist || '',
        album: m.album || '',
        playing,
        position: a && isFinite(a.currentTime) ? a.currentTime : 0,
        duration: a && isFinite(a.duration) ? a.duration : 0
      };
      if (art !== sentArt) {
        msg.art = art ? await jpeg(art) : '';
        sentArt = art;
      }
      if (!msg.title) return;
      await MEDIA.update(msg);
    } catch (e) {
      console.warn('Personafy: media update failed', e);
    } finally {
      busy = false;
    }
  }

  function watch() {
    new MutationObserver(() => schedule(false)).observe(doc.body, { attributes: true, attributeFilter: ['class'] });
  }
  if (doc.body) watch();
  else doc.addEventListener('DOMContentLoaded', watch);
})();
