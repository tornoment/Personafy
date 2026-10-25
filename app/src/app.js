'use strict';
/* Personafy (formerly Phantom Player) — renderer. Vanilla JS; markup ported from the design mockup. */
(function () {
  const api = window.api;
  const doc = document;
  const $ = (s, r) => (r || doc).querySelector(s);
  const $$ = (s, r) => Array.from((r || doc).querySelectorAll(s));
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
  const sel = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* the phone builds (mobile/: iPhone and Android) mark the page as "phone": narrow layout, touch, files on the phone */
  const PHONE = doc.documentElement.classList.contains('phone');
  /* the iPhone's web view stops Web Audio when the app goes to the background, and with it the music routed through
     it — so there the sound never goes through the levelling graph (and the switch for it is not shown) */
  const IOS = PHONE && doc.documentElement.classList.contains('ios');
  const LEVEL_OK = !IOS;
  const ON_DEVICE = PHONE ? 'с телефона' : 'с компьютера';
  const EST_BYTES_PER_SEC = 40000;
  const STREAM = (id) => 'phantom://drive/' + encodeURIComponent(id);

  /* ---------- formatting ---------- */
  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  const fmtDur = (sec) => (sec > 0 ? fmt(sec) : '—:—');
  function fmtLong(sec) {
    const m = Math.round(sec / 60);
    if (m < 60) return m + ' мин';
    return Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин';
  }
  function plural(n, one, few, many) {
    const a = n % 10;
    const b = n % 100;
    if (a === 1 && b !== 11) return n + ' ' + one;
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return n + ' ' + few;
    return n + ' ' + many;
  }
  const tracksWord = (n) => plural(n, 'трек', 'трека', 'треков');
  function fmtMb(bytes) {
    const v = bytes / 1048576;
    return (v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace('.', ',')) + ' МБ';
  }
  const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-z0-9а-я]+/gi, ' ').trim();
  const pad2 = (n) => (n < 10 ? '0' + n : String(n));

  /* ---------- svg pieces ---------- */
  const HA = 'M565 400 C610 360 660 345 710 348 C785 355 822 420 818 490 C814 560 770 610 700 655 L145 1037 C210 950 280 860 325 795 C355 752 352 712 318 683 C282 652 263 600 266 540 C270 450 330 380 410 355 C480 335 535 360 565 400 Z';
  const HB = 'M548 447 C585 415 630 400 680 403 C740 408 768 455 762 510 C755 570 705 610 645 650 L255 940 C300 870 345 800 372 752 C388 722 378 698 352 678 C322 655 312 620 315 585 C320 505 370 440 440 418 C500 400 532 422 548 447 Z';
  const HC = 'M519 519 C545 480 595 452 645 452 C695 452 720 492 710 535 C700 582 650 618 598 650 L368 815 C385 780 405 745 422 708 C412 712 404 706 404 696 C404 686 398 678 388 670 C360 650 346 625 348 595 C350 540 392 492 440 468 C488 446 512 482 519 519 Z';

  function heartFull(size, o) {
    o = o || {};
    return '<svg viewBox="135 335 695 710" width="' + size + '" height="' + size + '" style="overflow:visible;display:block">' +
      (o.shadow ? '<path d="' + HA + '" transform="translate(30 40)" fill="#0b0b0b"></path>' : '') +
      '<path d="' + HA + '" fill="#f01414"' + (o.stroke ? ' stroke="#0b0b0b" style="stroke-width:' + o.stroke + ';stroke-linejoin:round"' : '') + '></path>' +
      '<path d="' + HB + '" fill="#0b0b0b"></path><path d="' + HC + '" fill="#10d6b4"></path></svg>';
  }
  function heartEmpty(size, o) {
    o = o || {};
    if (o.shadow) {
      return '<svg viewBox="135 335 695 710" width="' + size + '" height="' + size + '" style="overflow:visible;display:block">' +
        '<path d="' + HA + '" transform="translate(30 40)" fill="#0b0b0b"></path>' +
        '<path d="' + HA + '" fill="#ffffff" stroke="#0b0b0b" style="stroke-width:40;stroke-linejoin:round"></path></svg>';
    }
    return '<svg viewBox="135 335 695 710" width="' + size + '" height="' + size + '" style="overflow:visible;display:block">' +
      '<path d="' + HA + '" fill="none" stroke="#ffffff" style="stroke-width:45;stroke-linejoin:round"></path></svg>';
  }
  function heartMini(on) {
    return '<svg viewBox="0 0 48 48" width="36" height="36" aria-hidden="true"><g transform="translate(1 0) scale(0.0676) translate(-135 -335)">' +
      '<path d="' + HA + '" fill="' + (on ? '#f01414' : 'none') + '" stroke="' + (on ? 'none' : '#ffffff') + '" style="stroke-width:45;stroke-linejoin:round"></path>' +
      '<path d="' + HB + '" fill="' + (on ? '#0b0b0b' : 'none') + '"></path><path d="' + HC + '" fill="' + (on ? '#10d6b4' : 'none') + '"></path></g></svg>';
  }

  const NOTE_SHAPE = '<ellipse cx="26" cy="60" rx="16" ry="12" transform="rotate(-20 26 60)"></ellipse><rect x="37" y="12" width="7" height="48"></rect><path d="M40 12 C53 13 65 22 60 40 C57 31 50 26 42 26 Z"></path>';
  function noteSvg(w, h, sRed, sBlack) {
    return '<svg viewBox="0 0 70 80" width="' + w + '" height="' + h + '" style="overflow:visible;display:block">' +
      '<g fill="#d4141a" stroke="#d4141a" style="stroke-width:' + sRed + ';stroke-linejoin:round">' + NOTE_SHAPE + '</g>' +
      '<g fill="#0b0b0b" stroke="#0b0b0b" style="stroke-width:' + sBlack + ';stroke-linejoin:round">' + NOTE_SHAPE + '</g>' +
      '<g fill="#ffffff">' + NOTE_SHAPE + '</g>' +
      '<path d="M12 58 Q26 63 39 51 Q37 70 22 70 Q14 67 12 58 Z" fill="#0b0b0b"></path>' +
      '<polygon points="13,58.3 16,64 18.9,59.4 22,64.6 25.8,58.8 29,63.2 32.4,55.9 35,59.6 38,52" fill="#ffffff"></polygon>' +
      '<polygon points="18,68.6 20.5,65 23,69.4 26,65.4 29,68.8 32,64.6 34,66.6" fill="#ffffff"></polygon></svg>';
  }

  const EQ_DELAYS = ['-.2s', '-.55s', '-.1s', '-.7s'];
  function eqBars(n, color, w, h) {
    let s = '<span class="eqs" aria-hidden="true" style="display:flex;align-items:flex-end;gap:3px;height:' + h + 'px">';
    for (let i = 0; i < n; i++) {
      s += '<span class="eq" style="display:block;width:' + w + 'px;height:' + h + 'px;background:' + color + ';transform-origin:bottom;animation-delay:' + EQ_DELAYS[i] + '"></span>';
    }
    return s + '</span>';
  }

  const DL_ICON = (c, size) => '<svg viewBox="0 0 48 48" width="' + size + '" height="' + size + '" aria-hidden="true"><path d="M24 5 V28" stroke="' + c + '" style="stroke-width:7;stroke-linecap:round"></path><polygon points="11,21 24,36 37,21" fill="' + c + '"></polygon><path d="M6 32 V42 H42 V32" fill="none" stroke="' + c + '" style="stroke-width:5;stroke-linejoin:round;stroke-linecap:round"></path></svg>';
  const PLAY_ICON = (size) => '<svg viewBox="0 0 48 48" width="' + size + '" height="' + size + '" aria-hidden="true"><polygon points="9,4 44,23 10,44 16,24" fill="currentColor"></polygon></svg>';
  const SHUF_ICON = (size, c) => '<svg viewBox="0 0 48 48" width="' + size + '" height="' + size + '" aria-hidden="true"><path d="M5 14 H14 L30 34 H38" fill="none" stroke="' + c + '" style="stroke-width:5;stroke-linejoin:round;stroke-linecap:round"></path><path d="M5 34 H14 L30 14 H38" fill="none" stroke="' + c + '" style="stroke-width:5;stroke-linejoin:round;stroke-linecap:round"></path><polygon points="34,6 46,14 34,22" fill="' + c + '"></polygon><polygon points="34,26 46,34 34,42" fill="' + c + '"></polygon></svg>';

  /* cut-out letters */
  const LP = {
    W: 'background:#ffffff;color:#0b0b0b',
    K: 'background:#0b0b0b;color:#ffffff;border:3px solid #ffffff',
    R: 'background:#d4141a;color:#ffffff',
    RB: 'background:#d4141a;color:#ffffff;border:3px solid #ffffff',
    WR: 'background:#ffffff;color:#d4141a'
  };
  const LF = {
    d: "font-family:'Dela Gothic One',sans-serif;font-weight:400",
    p: "font-family:'Playfair Display',serif;font-weight:900",
    pi: "font-family:'Playfair Display',serif;font-weight:900;font-style:italic",
    m: "font-family:'Rubik Mono One',sans-serif;font-weight:400"
  };
  function letters(list, bob) {
    return list.map((l) => {
      if (l === ' ') return '<span style="display:inline-block;width:16px"></span>';
      const [ch, c, f, size, padding, rot, ml, delay] = l;
      return '<span class="' + (bob ? 'bob ltr' : '') + '" style="display:inline-block;' + LP[c] + ';' + LF[f] + ';font-size:' + size + 'px;line-height:1;padding:' + padding + ';transform:rotate(' + rot + 'deg);' + (ml ? 'margin-left:' + ml + 'px;' : '') + (bob ? 'animation-delay:' + delay + 's' : '') + '">' + ch + '</span>';
    }).join('');
  }
  const T_HOME = [['Г', 'W', 'd', 54, '4px 10px', -6, 0, 0], ['Л', 'K', 'pi', 62, '0 9px', 5, -3, -0.2], ['А', 'R', 'm', 44, '7px 9px', -3, -2, -0.4], ['В', 'W', 'p', 60, '0 8px', 7, -3, -0.6], ['Н', 'K', 'd', 50, '4px 9px', -5, -3, -0.8], ['А', 'WR', 'm', 42, '7px 9px', 4, -2, -1], ['Я', 'RB', 'pi', 58, '0 9px', -7, -3, -1.2]];
  const T_SEARCH = [['П', 'W', 'd', 54, '4px 10px', -6, 0, 0], ['О', 'RB', 'pi', 62, '0 9px', 5, -3, -0.25], ['И', 'K', 'm', 42, '7px 9px', -3, -2, -0.5], ['С', 'WR', 'p', 60, '0 8px', 7, -3, -0.75], ['К', 'K', 'd', 50, '4px 9px', -5, -3, -1]];
  const T_LIB = [['Б', 'W', 'd', 46, '4px 8px', -6, 0, 0], ['И', 'R', 'pi', 54, '0 8px', 5, -3, -0.15], ['Б', 'K', 'm', 36, '6px 8px', -3, -2, -0.3], ['Л', 'WR', 'p', 52, '0 7px', 7, -3, -0.45], ['И', 'K', 'd', 44, '3px 8px', -6, -3, -0.6], ['О', 'W', 'm', 36, '6px 8px', 4, -2, -0.75], ['Т', 'RB', 'pi', 52, '0 8px', -7, -3, -0.9], ['Е', 'W', 'd', 42, '4px 8px', 6, -3, -1.05], ['К', 'K', 'p', 50, '0 8px', -4, -3, -1.2], ['А', 'R', 'm', 38, '6px 8px', 8, -2, -1.35]];
  const T_TYH1 = [['T', 'W', 'd', 38, '4px 7px', -8, 0, 0], ['A', 'K', 'pi', 44, '0 7px', 5, -3, -0.12], ['K', 'R', 'm', 30, '6px 7px', -3, -2, -0.24], ['E', 'WR', 'p', 42, '0 6px', 7, -3, -0.36], ' ', ['Y', 'K', 'd', 36, '3px 7px', -6, 0, -0.48], ['O', 'W', 'm', 30, '6px 7px', 4, -2, -0.6], ['U', 'RB', 'pi', 44, '0 7px', -5, -3, -0.72], ['R', 'W', 'd', 38, '4px 7px', 6, -3, -0.84]];
  const T_TYH2 = [['H', 'WR', 'p', 52, '0 8px', -6, 0, -0.96], ['E', 'K', 'd', 44, '3px 8px', 5, -3, -1.08], ['A', 'W', 'm', 36, '7px 8px', -4, -2, -1.2], ['R', 'R', 'd', 46, '3px 8px', 7, -3, -1.32], ['T', 'K', 'pi', 52, '0 8px', -7, -3, -1.44]];
  const T_INSTR = [['ИН', 'W', 'd', 30, '4px 7px', -5, 0], ['СТРУ', 'K', 'pi', 34, '0 6px', 4, -3], ['МЕН', 'WR', 'm', 24, '6px 7px', -2, -2], ['ТАЛ', 'R', 'd', 30, '4px 7px', 6, -3]];
  const T_NOLY = [['НЕТ', 'W', 'd', 30, '4px 7px', -5, 0], ['ТЕК', 'K', 'pi', 34, '0 6px', 4, -3], ['СТА', 'R', 'd', 30, '4px 7px', 6, -3]];
  const T_NONET = [['НЕТ', 'W', 'd', 30, '4px 7px', -5, 0], ['СЕ', 'RB', 'pi', 34, '0 6px', 4, -3], ['ТИ', 'WR', 'm', 26, '6px 7px', -3, -2]];
  const T_SET = [['Н', 'W', 'd', 44, '4px 8px', -6, 0, 0], ['А', 'K', 'pi', 50, '0 7px', 5, -3, -0.15], ['С', 'W', 'm', 34, '6px 7px', -3, -2, -0.3], ['Т', 'R', 'p', 48, '0 7px', 7, -3, -0.45], ['Р', 'K', 'd', 40, '3px 7px', -5, -3, -0.6], ['О', 'WR', 'm', 34, '6px 7px', 4, -2, -0.75], ['Й', 'W', 'pi', 48, '0 7px', -7, -3, -0.9], ['К', 'K', 'd', 40, '4px 7px', 6, -3, -1.05], ['И', 'W', 'p', 46, '0 7px', -4, -3, -1.2]];

  /* time on the progress strip as cut-out stickers; styles go by position from the right,
     so the seconds digits keep their look when the minutes grow (9:59 → 10:00) */
  const TT_SIDES = [
    { bg: ['k', 'w', 'k', 'w', 'k'], f: ['fd', 'fp', 'fm', 'fd', 'fp'], rot: [5, -4, 6, -3, 4] },
    { bg: ['w', 'r', 'w', 'k', 'w'], f: ['fm', 'fd', 'fp', 'fd', 'fm'], rot: [-4, 5, -6, 3, -5] }
  ];
  function timeTiles(s, side) {
    if (isP3()) return '<span class="t3">' + esc(s) + '</span>';
    if (isMF()) return '<span class="tm">' + esc(s) + '</span>';
    const cfg = TT_SIDES[side];
    const chars = Array.from(s).reverse();
    let k = 0;
    return chars.map((ch) => {
      if (ch === ':') return '<span class="tt c"></span>';
      const i = k++ % 5;
      return '<span class="tt ' + cfg.bg[i] + ' ' + cfg.f[i] + '" style="rotate:' + cfg.rot[i] + 'deg">' + esc(ch) + '</span>';
    }).reverse().join('');
  }

  /* repeat-one: two looping arrows around a "1"; the colour comes from --rp (lit while the track repeats) */
  function repIcon(size, kind) {
    const top = 'M8 25 V19 Q8 13 14 13 H35';
    const bot = 'M40 23 V29 Q40 35 34 35 H13';
    const one = 'M20.5 21.5 L24.5 18.5 V29.5';
    if (kind === 'now5') {
      const blk = (d, w) => '<path d="' + d + '" fill="none" stroke="#0b0b0b" style="stroke-width:' + w + ';stroke-linejoin:round;stroke-linecap:round"></path>';
      const col = (d, w) => '<path d="' + d + '" fill="none" style="stroke:var(--rp);stroke-width:' + w + ';stroke-linejoin:round;stroke-linecap:round"></path>';
      const head = (pts) => '<polygon points="' + pts + '" stroke="#0b0b0b" style="fill:var(--rp);stroke-width:4;stroke-linejoin:round"></polygon>';
      return '<svg viewBox="0 0 48 48" width="' + size + '" height="' + size + '" style="overflow:visible;display:block">' +
        '<g transform="translate(2.5 3.5)">' + blk(top, 12) + blk(bot, 12) + blk(one, 11) +
        '<polygon points="32,4 46,13 32,22" fill="#0b0b0b" stroke="#0b0b0b" style="stroke-width:6;stroke-linejoin:round"></polygon><polygon points="16,26 2,35 16,44" fill="#0b0b0b" stroke="#0b0b0b" style="stroke-width:6;stroke-linejoin:round"></polygon></g>' +
        blk(top, 12) + col(top, 5) + blk(bot, 12) + col(bot, 5) + blk(one, 10) + col(one, 4) +
        head('32,4 46,13 32,22') + head('16,26 2,35 16,44') + '</svg>';
    }
    if (kind === 'mf') {
      const st = 'stroke:var(--rp);stroke-width:2.6;stroke-linejoin:miter;stroke-linecap:square';
      return '<svg viewBox="0 0 48 48" width="' + size + '" height="' + size + '" aria-hidden="true">' +
        '<path d="M8 25 V17 H38" fill="none" style="' + st + '"></path><path d="M40 23 V31 H10" fill="none" style="' + st + '"></path>' +
        '<polygon points="34,11 42,17 34,23" style="fill:var(--rp)"></polygon><polygon points="14,25 6,31 14,37" style="fill:var(--rp)"></polygon>' +
        '<path d="M21 22 L25 19.5 V29" fill="none" style="' + st + ';stroke-width:2.2"></path></svg>';
    }
    if (kind === 'p3') {
      const st = 'stroke:var(--rp);stroke-width:4.5;stroke-linejoin:round;stroke-linecap:round';
      return '<svg viewBox="0 0 48 48" width="' + size + '" height="' + size + '" aria-hidden="true">' +
        '<path d="' + top + '" fill="none" style="' + st + '"></path><path d="' + bot + '" fill="none" style="' + st + '"></path><path d="' + one + '" fill="none" style="' + st + ';stroke-width:4"></path>' +
        '<polygon points="34,6 44,13 34,20" style="fill:var(--rp)"></polygon><polygon points="14,28 4,35 14,42" style="fill:var(--rp)"></polygon></svg>';
    }
    const st = 'stroke:var(--rp);stroke-width:5;stroke-linejoin:round;stroke-linecap:round';
    return '<svg viewBox="0 0 48 48" width="' + size + '" height="' + size + '" aria-hidden="true">' +
      '<path d="M8 25 V19 Q8 13 14 13 H40" fill="none" style="' + st + '"></path><path d="M34 6 L41 13 L34 20" fill="none" style="' + st + '"></path>' +
      '<path d="M40 23 V29 Q40 35 34 35 H8" fill="none" style="' + st + '"></path><path d="M14 28 L7 35 L14 42" fill="none" style="' + st + '"></path>' +
      '<path d="' + one + '" fill="none" style="' + st + ';stroke-width:4"></path></svg>';
  }
  const repBtn = (cls, inner) => '<button class="hop ' + cls + '" type="button" data-act="repeat" aria-label="Повтор трека" title="Повтор трека" aria-pressed="' + S.repeat + '">' + inner + '</button>';

  /* "add to queue": three lines and a plus */
  const QADD_ICON = '<svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true" style="overflow:visible"><path class="qa-l" d="M6 12 H31 M6 22 H31 M6 32 H20" fill="none" style="stroke-width:5;stroke-linecap:round"></path><path class="qa-p" d="M34 25 V43 M25 34 H43" fill="none" style="stroke-width:5.5;stroke-linecap:round"></path></svg>';
  const CTX_ICONS = {
    next: '<svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true"><polygon points="8,8 30,24 8,40" fill="currentColor"></polygon><path d="M38 8 V40" stroke="currentColor" style="stroke-width:6;stroke-linecap:round"></path></svg>',
    end: '<svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true"><path d="M5 10 H31 M5 21 H31 M5 32 H19" fill="none" stroke="currentColor" style="stroke-width:5;stroke-linecap:round"></path><path d="M34 25 V43 M25 34 H43" fill="none" stroke="currentColor" style="stroke-width:5.5;stroke-linecap:round"></path></svg>'
  };

  /* closing button of the side panels: a white tag that says what it does, with the player's double arrow */
  const P5_CLOSE = (act, label) => '<button class="p5-x" type="button" data-act="' + act + '" aria-label="' + label + '"><span class="p5x-k" aria-hidden="true"></span><span class="p5x-w" aria-hidden="true"></span>' +
    '<span class="p5x-t" aria-hidden="true">ЗАКРЫТЬ</span><svg class="p5x-a" viewBox="0 0 48 48" width="26" height="26" aria-hidden="true"><polygon points="4,9 24,24 4,39 9,24" fill="#d4141a" stroke="#0b0b0b" style="stroke-width:3;stroke-linejoin:round"></polygon><polygon points="23,9 43,24 23,39 28,24" fill="#0b0b0b" stroke="#0b0b0b" style="stroke-width:3;stroke-linejoin:round"></polygon></svg></button>';
  const GEAR_D = 'M20.1 8.5 L20.5 1.8 L27.5 1.8 L27.9 8.5 L32.3 10.3 L37.2 5.8 L42.2 10.8 L37.7 15.7 L39.5 20.1 L46.2 20.5 L46.2 27.5 L39.5 27.9 L37.7 32.3 L42.2 37.2 L37.2 42.2 L32.3 37.7 L27.9 39.5 L27.5 46.2 L20.5 46.2 L20.1 39.5 L15.7 37.7 L10.8 42.2 L5.8 37.2 L10.3 32.3 L8.5 27.9 L1.8 27.5 L1.8 20.5 L8.5 20.1 L10.3 15.7 L5.8 10.8 L10.8 5.8 L15.7 10.3 Z M24 17.5 A6.5 6.5 0 1 0 24 30.5 A6.5 6.5 0 1 0 24 17.5 Z';
  /* the red shadow keeps its offset; each layer spins around its own hub */
  const GEAR_ICON = (size) => '<svg viewBox="0 0 48 48" width="' + size + '" height="' + size + '" aria-hidden="true" style="overflow:visible">' +
    '<g transform="translate(4 4)"><path class="g-rot" d="' + GEAR_D + '" fill="#d4141a" fill-rule="evenodd"></path></g>' +
    '<path class="g-rot" d="' + GEAR_D + '" fill="#ffffff" fill-rule="evenodd" stroke="#0b0b0b" style="stroke-width:2;stroke-linejoin:round"></path></svg>';

  /* ---------- catalog ---------- */
  let CAT = { albums: [], tracks: [] };
  const TR = new Map();
  const AL = new Map();
  function setCatalog(c) {
    const learned = new Map();
    TR.forEach((t) => { if (t.sec) learned.set(t.id, t.sec); });
    CAT = c;
    TR.clear();
    AL.clear();
    (c.albums || []).forEach((a) => AL.set(a.id, a));
    (c.tracks || []).forEach((t) => {
      if (!t.sec && learned.has(t.id)) t.sec = learned.get(t.id);
      TR.set(t.id, t);
    });
  }
  const albumOf = (t) => (t ? AL.get(t.album) || null : null);
  function coverUrl(albumId, small) {
    const a = AL.get(albumId);
    if (!a) return null;
    if (a.cover) return small ? a.cover.replace(/\.jpg$/i, '-s.jpg') : a.cover;
    if (a.coverFile) return api.coverSrc ? api.coverSrc(a.coverFile) : 'phantom://cover/' + encodeURIComponent(a.coverFile);
    return null;
  }
  function coverImg(albumId, small) {
    const u = coverUrl(albumId, small);
    return u ? '<img class="cov" src="' + esc(u) + '" alt="" draggable="false" decoding="async">' : '<span class="cov-fallback"></span>';
  }
  doc.addEventListener('error', (e) => {
    const el = e.target;
    if (el && el.tagName === 'IMG' && el.classList.contains('cov')) {
      const s = doc.createElement('span');
      s.className = 'cov-fallback';
      el.replaceWith(s);
    }
  }, true);

  /* ---------- persisted state ---------- */
  const STORE_KEY = 'phantom-player.v1';
  const stored = (() => {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch (e) {
      return {};
    }
  })();

  const S = {
    view: null,
    query: '',
    wasSearching: false,
    openAlbum: null,
    libSort: ['added', 'title', 'album'].includes(stored.libSort) ? stored.libSort : 'added',
    libIds: [],
    selecting: false,
    sel: new Set(),
    unsel: new Set(),
    liked: stored.liked && typeof stored.liked === 'object' ? stored.liked : {},
    recent: Array.isArray(stored.recent) ? stored.recent : [],
    plays: stored.plays && typeof stored.plays === 'object' ? stored.plays : {},
    downloads: new Map(),
    dl: new Map(),
    dlBatch: null,
    lyricsOn: !!stored.lyricsOn,
    lyrics: new Map(),
    lyActive: -2,
    qOpen: false,
    sOpen: false,
    lists: {},
    scrub: null,
    volume: typeof stored.volume === 'number' ? clamp(stored.volume, 0, 1) : 1,
    prevVol: typeof stored.prevVol === 'number' && stored.prevVol > 0 ? clamp(stored.prevVol, 0.05, 1) : 0.7,
    drag: null,
    repeat: !!stored.repeat,
    level: stored.level !== false,
    xfade: stored.xfade !== false,
    theme: ['p5', 'p3r', 'mf'].includes(stored.theme) ? stored.theme : 'p5'
  };
  const isP3 = () => S.theme === 'p3r';
  const isMF = () => S.theme === 'mf';
  const isP5 = () => S.theme === 'p5';
  let navLastTop = 0;
  doc.documentElement.dataset.theme = S.theme;
  const P = { queue: [], base: [], cur: -1, shuffle: !!stored.shuffle, errors: 0, counted: false, recentAdded: false, pendingSeek: null, offline: false, loadedId: null };
  /* two players take turns: while one ends, the next track is already loaded in the other and starts under it
     (smooth transitions, below). "audio" is always the one that plays the current track; the id "audio" moves with it */
  const audioA = $('#audio');
  const audioB = audioA.cloneNode(false);
  audioB.id = 'audio2';
  audioA.after(audioB);
  [audioA, audioB].forEach((el) => {
    el.crossOrigin = 'anonymous';
    el._fade = 1;
  });
  let audio = audioA;
  const otherAudio = () => (audio === audioA ? audioB : audioA);
  /* the player's events count only from the one playing the current track */
  const onAudio = (name, fn) => [audioA, audioB].forEach((el) => el.addEventListener(name, (e) => {
    if (e.target === audio) fn(e);
  }));
  const curId = () => P.queue[P.cur] || null;
  const curTrack = () => TR.get(curId()) || null;

  let saveT = null;
  function saveNow() {
    clearTimeout(saveT);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        liked: S.liked, recent: S.recent.slice(0, 40), plays: S.plays,
        queue: P.queue, base: P.base, cur: P.cur, shuffle: P.shuffle,
        t: P.pendingSeek != null ? P.pendingSeek : (audio.currentTime || 0),
        volume: S.volume, prevVol: S.prevVol, libSort: S.libSort, lyricsOn: S.lyricsOn, theme: S.theme, repeat: S.repeat, level: S.level, xfade: S.xfade
      }));
    } catch (e) { /* storage full or unavailable */ }
  }
  const save = () => { clearTimeout(saveT); saveT = setTimeout(saveNow, 400); };
  window.addEventListener('beforeunload', saveNow);

  /* ---------- toasts ---------- */
  function toast(msg, o) {
    o = o || {};
    const box = $('#toasts');
    let el = o.key ? box.querySelector('[data-key="' + o.key + '"]') : null;
    if (el) {
      el.textContent = msg;
      clearTimeout(el._t);
    } else {
      el = doc.createElement('div');
      el.className = 'toast' + (o.teal ? ' teal' : '');
      if (o.key) el.dataset.key = o.key;
      el.textContent = msg;
      box.appendChild(el);
      while (box.children.length > 3) box.firstElementChild.remove();
    }
    el._t = setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 320);
    }, o.ms || 3400);
  }

  /* ---------- playback ---------- */
  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  function playList(ids, index, opts) {
    ids = (ids || []).filter((id) => TR.has(id));
    if (!ids.length) return;
    index = clamp(index | 0, 0, ids.length - 1);
    if (opts && typeof opts.shuffle === 'boolean') {
      P.shuffle = opts.shuffle;
      doc.body.classList.toggle('shuf', P.shuffle);
    }
    P.base = ids.slice();
    if (P.shuffle) {
      const first = ids[index];
      P.queue = [first].concat(shuffled(ids.filter((_, i) => i !== index)));
      P.cur = 0;
    } else {
      P.queue = ids.slice();
      P.cur = index;
    }
    P.errors = 0;
    loadTrack(true, 0);
    save();
  }

  function toggleShuffle() {
    const id = curId();
    P.shuffle = !P.shuffle;
    if (P.shuffle) {
      P.queue = P.queue.slice(0, P.cur + 1).concat(shuffled(P.queue.slice(P.cur + 1)));
    } else if (P.base.length && P.base.indexOf(id) >= 0) {
      P.queue = P.base.slice();
      P.cur = P.queue.indexOf(id);
    }
    doc.body.classList.toggle('shuf', P.shuffle);
    $$('[data-act=shuffle]').forEach((b) => b.setAttribute('aria-pressed', String(P.shuffle)));
    toast(P.shuffle ? 'Случайный порядок включён' : 'Случайный порядок выключен', { key: 'shuf', ms: 1600 });
    onQueueChange();
    save();
  }

  /* repeat the current track: the audio element loops it seamlessly, so "ended" never fires */
  function setRepeat(on, quiet) {
    S.repeat = !!on;
    audio.loop = S.repeat;
    doc.body.classList.toggle('rep', S.repeat);
    $$('[data-act=repeat]').forEach((b) => b.setAttribute('aria-pressed', String(S.repeat)));
    if (!quiet) toast(S.repeat ? 'Повтор трека включён' : 'Повтор трека выключен', { key: 'rep', ms: 1600 });
    if (S.view === 'now') updateNowBits();
    save();
  }
  const toggleRepeat = () => setRepeat(!S.repeat);

  function next() {
    if (!P.queue.length) return;
    if (P.cur < P.queue.length - 1) {
      P.cur++;
    } else {
      if (P.shuffle && P.queue.length > 2) P.queue = shuffled(P.queue);
      P.cur = 0;
    }
    loadTrack(true, 0);
    save();
  }
  /* force: always the previous track (the phone's swipe), never "back to the start of this one" */
  function prev(force) {
    if (!P.queue.length) return;
    const pos = P.loadedId === curId() ? audio.currentTime || 0 : P.pendingSeek || 0;
    if ((force !== true && pos > 3) || P.queue.length === 1) {
      seek(0);
      return;
    }
    P.cur = P.cur > 0 ? P.cur - 1 : P.queue.length - 1;
    loadTrack(true, 0);
    save();
  }
  function jump(i) {
    if (i < 0 || i >= P.queue.length) return;
    P.cur = i;
    loadTrack(true, 0);
    save();
  }
  function togglePlay() {
    if (!curTrack()) {
      if (CAT.albums.length) playList(CAT.albums[0].tracks, 0);
      return;
    }
    /* after a failed or stalled load the element will not play again by itself: ask for the track anew */
    if (P.loadedId !== curId() || !audio.src || audio.error || P.stalled) {
      loadTrack(true, P.pendingSeek || (P.stalled ? currentPos() : 0));
      return;
    }
    if (audio.paused) audio.play().catch(playFail);
    else audio.pause();
  }
  function seek(sec) {
    const t = curTrack();
    const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (t ? t.sec : 0);
    sec = clamp(sec, 0, Math.max(0, (dur || 0) - 0.5));
    if (P.loadedId !== curId() || !audio.src || audio.readyState < 1) {
      P.pendingSeek = sec;
    } else {
      try {
        audio.currentTime = sec;
      } catch (e) { /* not seekable yet */ }
    }
    S.lyActive = -2;
    updateTimes();
  }
  function playFail(e) {
    if (e && e.name === 'AbortError') return;
    if (e && e.name === 'NotSupportedError') return; /* reported by the error event */
  }

  let loadSeq = 0;
  async function loadTrack(autoplay, startAt) {
    const t = curTrack();
    if (!t) return;
    const seq = ++loadSeq;
    /* the same track asked for again after it failed or stalled: the failed answer must not be reused */
    const again = P.loadedId === t.id && (!!audio.error || !!P.stalled || !!P.stallRetried);
    if (P.loadedId !== t.id) P.stallRetried = false;
    P.stalled = false;
    if (!again) {
      P.heard = 0;
      P.counted = false;
    }
    P.lastT = startAt > 0 ? startAt : 0;
    P.recentAdded = false;
    P.pendingSeek = startAt > 0 ? startAt : null;
    P.loadedId = t.id;
    S.lyActive = -2;
    xfCancel();
    audio.pause();
    onTrackChange();
    /* on the phone a track is fetched into the app before it plays: show "loading" meanwhile */
    if (autoplay) doc.body.classList.add('buffering');
    let url = STREAM(t.file);
    let offline = false;
    try {
      const r = await api.mediaUrl(t);
      if (r && r.url) {
        url = r.url;
        offline = !!r.offline;
      }
    } catch (e) { /* fall back to streaming */ }
    if (seq !== loadSeq) return;
    if (again && /^phantom:/.test(url)) url += (url.includes('?') ? '&' : '?') + 'retry=' + Date.now();
    P.offline = offline;
    if (!offline && !navigator.onLine) toast('Нет интернета, а этот трек не скачан. Скачать треки можно в «Библиотеке».');
    doc.body.classList.add('buffering');
    applyLevel(true);
    audio.src = url;
    if (autoplay) {
      watchStall();
      audio.play().catch(playFail);
    } else {
      doc.body.classList.remove('buffering');
    }
  }

  /* ---------- smooth transitions ----------
     With "smooth transitions" on, the next track is loaded into the other player half a minute before this one ends
     and started under its last moments, so the music never stops between tracks. Where a player's volume can be set
     (Windows, Android) the two overlap for a few seconds and cross-fade; the iPhone keeps every player at full volume,
     so there the next one simply starts the instant this one ends. Repeat-one, a queue's end and short tracks go
     the usual way ("ended" → next). In the background (screen off, app hidden) timers run late, so a fade could
     leave the new track silent: there it is the gapless start too. */
  const XF_SEC = 3;
  const xfFades = () => !IOS && !doc.hidden;
  const xfLead = () => (xfFades() ? XF_SEC : 0.12);
  const XF = { id: null, t: null, fading: null };
  function xfNextIndex() {
    if (!S.xfade || S.repeat || P.queue.length < 2 || P.cur >= P.queue.length - 1) return -1;
    return P.cur + 1;
  }
  function xfRelease(el) {
    el.pause();
    el.removeAttribute('src');
    try {
      el.load();
    } catch (e) { /* nothing loaded */ }
    delete el.dataset.tid;
    el._fade = 1;
    setElVol(el);
  }
  /* a track loaded by hand, a pause, the setting switched off: whatever was lined up or fading out stops */
  function xfCancel() {
    clearTimeout(XF.t);
    XF.t = null;
    XF.id = null;
    if (XF.fading) {
      clearInterval(XF.fading);
      XF.fading = null;
    }
    const o = otherAudio();
    if (o.getAttribute('src') || o.dataset.tid) xfRelease(o);
    audio._fade = 1;
    setElVol(audio);
  }
  async function xfPrepare(id) {
    XF.id = id;
    const t = TR.get(id);
    if (!t) return;
    let url = STREAM(t.file);
    try {
      const r = await api.mediaUrl(t);
      if (r && r.url) url = r.url;
    } catch (e) { /* stream it */ }
    if (XF.id !== id || XF.fading) return;
    const el = otherAudio();
    el.loop = false;
    el._fade = IOS ? 1 : 0;
    setElVol(el);
    el.dataset.tid = id;
    el.preload = 'auto';
    el.src = url;
    try {
      el.load();
    } catch (e) { /* loads on play */ }
  }
  function xfTick() {
    if (XF.fading || audio.paused || audio.seeking) return;
    const d = audio.duration;
    if (!isFinite(d) || d < 20) return;
    const ni = xfNextIndex();
    if (ni < 0) {
      if (XF.id) xfCancel();
      return;
    }
    const id = P.queue[ni];
    const left = d - audio.currentTime;
    if (left < 35 && XF.id !== id) xfPrepare(id);
    if (XF.id === id && !XF.t && left <= XF_SEC + 1.2) {
      XF.t = setTimeout(() => {
        XF.t = null;
        xfGo(ni, id);
      }, Math.max(0, (left - xfLead()) * 1000));
    }
  }
  function xfGo(ni, id) {
    const el = otherAudio();
    const old = audio;
    const left = old.duration - old.currentTime;
    /* anything not in place (not loaded in time, the queue changed, a seek back): the usual "ended" takes over */
    if (xfNextIndex() !== ni || P.queue[ni] !== id || el.dataset.tid !== id || el.readyState < 3 || old.paused || !(left <= xfLead() + 0.6)) return;
    const fades = xfFades();
    if (!fades) {
      el._fade = 1;
      setElVol(el);
    }
    old.id = 'audio2';
    el.id = 'audio';
    audio = el;
    audio.loop = S.repeat;
    XF.id = null;
    P.cur = ni;
    P.stallRetried = false;
    P.stalled = false;
    P.heard = 0;
    P.counted = false;
    P.lastT = 0;
    P.recentAdded = false;
    P.pendingSeek = null;
    P.loadedId = id;
    S.lyActive = -2;
    applyLevel(false, true);
    try {
      el.currentTime = 0;
    } catch (e) { /* at the start already */ }
    el.play().catch(playFail);
    onTrackChange();
    save();
    const t0 = performance.now();
    const ms = Math.max(60, left * 1000);
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      if (fades) {
        old._fade = Math.cos((k * Math.PI) / 2);
        el._fade = Math.sin((k * Math.PI) / 2);
        setElVol(old);
        setElVol(el);
      }
      if (k >= 1) {
        clearInterval(XF.fading);
        XF.fading = null;
        xfRelease(old);
        el._fade = 1;
        setElVol(el);
      }
    };
    XF.fading = setInterval(step, 50);
    step();
  }
  function setXfade(on) {
    S.xfade = !!on;
    save();
    if (!S.xfade) xfCancel();
    $('[data-act=xfade-toggle]').forEach((b) => {
      b.setAttribute('aria-checked', String(S.xfade));
      b.classList.toggle('is-on', S.xfade);
    });
    toast(S.xfade ? 'Треки сменяют друг друга плавно, без паузы' : 'Плавный переход выключен', { key: 'xf', ms: 1600 });
  }
  onAudio('seeking', () => {
    clearTimeout(XF.t);
    XF.t = null;
  });

  onAudio('loadedmetadata', () => {
    const t = curTrack();
    if (P.pendingSeek != null && isFinite(audio.duration)) {
      try {
        audio.currentTime = Math.min(P.pendingSeek, Math.max(0, audio.duration - 1));
      } catch (e) { /* ignore */ }
    }
    P.pendingSeek = null;
    if (t && isFinite(audio.duration) && audio.duration > 0) {
      const d = Math.round(audio.duration);
      if (d !== t.sec) {
        const was = t.sec;
        t.sec = d;
        $$('[data-row="' + sel(t.id) + '"] .row-d').forEach((el) => { el.textContent = fmtDur(d); });
        if (t.file && api.reportDuration && Math.abs((was || 0) - d) > 1) api.reportDuration(t.file, d);
        const L = !was ? S.lyrics.get(t.id) : null;
        if (L && L.kind === 'none') {
          S.lyrics.delete(t.id);
          if (S.lyricsOn) ensureLyrics(t);
        }
      }
    }
    updateTimes();
    updatePositionState();
  });
  onAudio('play', () => {
    ensureGraph();
    if (LV.ctx && LV.ctx.state !== 'running') LV.ctx.resume().catch(() => {});
    doc.body.classList.remove('paused');
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  });
  onAudio('playing', () => {
    doc.body.classList.remove('buffering');
    P.errors = 0;
    if (!P.recentAdded) {
      P.recentAdded = true;
      addRecent(curId());
    }
    prefetchNext();
  });
  /* the phone fetches the next track while this one plays, so the queue keeps going with the screen locked */
  function prefetchNext() {
    if (!api.prefetch || S.repeat || P.queue.length < 2) return;
    const id = P.cur < P.queue.length - 1 ? P.queue[P.cur + 1] : P.queue[0];
    const t = TR.get(id);
    if (t) api.prefetch(t);
  }
  onAudio('pause', () => {
    if (XF.fading) xfCancel();
    if (LV.saveT) writeLoud();
    doc.body.classList.add('paused');
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    saveNow();
  });
  onAudio('waiting', () => {
    doc.body.classList.add('buffering');
    watchStall();
  });

  /* a stream that stops arriving (Drive went quiet, the network dropped) would show "loading" forever:
     after a while the track is asked for again from the same spot, once; then the player stops and says why */
  const STALL_MS = 15000;
  let stallT = null;
  function watchStall() {
    clearTimeout(stallT);
    stallT = setTimeout(onStall, STALL_MS);
  }
  const stopStallWatch = () => { clearTimeout(stallT); stallT = null; };
  function onStall() {
    stallT = null;
    if (audio.paused || !doc.body.classList.contains('buffering')) return;
    if (!P.stallRetried) {
      P.stallRetried = true;
      loadTrack(true, currentPos());
      return;
    }
    P.stalled = true;
    audio.pause();
    doc.body.classList.remove('buffering');
    toast(navigator.onLine
      ? 'Трек не догружается — Google Диск не отвечает. Нажмите «Играть», чтобы попробовать ещё раз.'
      : 'Нет интернета — трек не догружается. Скачанные треки играют и без сети.', { key: 'stall' });
  }
  /* a pause needs no clearing: a paused player is left alone when the watch runs out */
  ['playing', 'error', 'ended'].forEach((n) => onAudio(n, stopStallWatch));
  onAudio('canplay', () => doc.body.classList.remove('buffering'));
  onAudio('seeked', () => {
    updateTimes();
    updatePositionState();
  });
  onAudio('ended', () => next());
  onAudio('error', () => {
    if (!audio.getAttribute('src')) return;
    const t = curTrack();
    doc.body.classList.remove('buffering');
    doc.body.classList.add('paused');
    /* the stall watch already stopped the player and said why: the late failure of that request changes nothing */
    if (P.stalled) return;
    P.errors++;
    const offlineNow = !navigator.onLine;
    if (offlineNow) {
      toast('Нет интернета — трек не загрузился');
      return;
    }
    toast('Не получилось загрузить «' + (t ? t.title : 'трек') + '». Google Диск мог временно ограничить доступ — попробуйте чуть позже.');
    if (P.errors < 3 && P.queue.length > 1) {
      const id = curId();
      setTimeout(() => {
        if (curId() === id && audio.error) next();
      }, 1800);
    }
  });

  let lastSave = 0;
  onAudio('timeupdate', () => {
    updateTimes();
    xfTick();
    const now = Date.now();
    if (now - lastSave > 5000) {
      lastSave = now;
      saveNow();
    }
    /* a play counts once the track has really been heard for a while: seeking to the end skips time, not plays it */
    const t = audio.currentTime;
    const step = t - (P.lastT || 0);
    if (step > 0 && step < 1.5 && !audio.seeking) P.heard = (P.heard || 0) + step;
    P.lastT = t;
    if (!P.counted && (P.heard || 0) >= Math.min(30, (audio.duration || 60) * 0.5)) {
      P.counted = true;
      const id = curId();
      if (id) {
        S.plays[id] = (S.plays[id] || 0) + 1;
        save();
      }
    }
  });

  function addRecent(id) {
    if (!id) return;
    S.recent = [id].concat(S.recent.filter((x) => x !== id)).slice(0, 40);
    save();
    if (S.view === 'home') renderHomeSections();
  }

  /* the slider is linear for the eye; the ear hears loudness roughly on a squared scale */
  /* each player's own volume also carries its share of a crossfade (_fade, 0…1) */
  const setElVol = (el) => {
    try {
      el.volume = clamp((LV.vol ? 1 : S.volume * S.volume) * (el._fade == null ? 1 : el._fade), 0, 1);
    } catch (e) { /* the iPhone's volume is read-only */ }
  };
  const applyVolume = () => {
    const v = S.volume * S.volume;
    if (LV.vol) LV.vol.gain.setTargetAtTime(v, LV.ctx.currentTime, 0.015);
    setElVol(audioA);
    setElVol(audioB);
  };

  /* ---------- loudness levelling ----------
     Albums are mastered at different levels. While a track plays, its loudness is measured from the
     decoded audio (K-weighted energy, the way ReplayGain / EBU R128 do it) and kept per track. A track
     that hasn't been measured yet borrows its album's level, so the jump between albums is evened out
     from the first second; a limiter keeps boosted quiet tracks from clipping. */
  const LOUD_KEY = 'phantom-player.loud.v1';
  const LOUD_TARGET = -14;
  const LOUD_TRUST = 120;
  const LV = { ctx: null, src: null, norm: null, vol: null, an: null, buf: null, failed: false, data: {}, saveT: null, db: 0 };
  try {
    const d = JSON.parse(localStorage.getItem(LOUD_KEY));
    if (d && typeof d === 'object') LV.data = d;
  } catch (e) { /* nothing stored yet */ }
  const lufs = (d) => -0.691 + 10 * Math.log10(d[0] / d[1]);
  function trackLoud(id, min) {
    const d = LV.data[id];
    return d && d[1] >= (min || LOUD_TRUST) ? lufs(d) : null;
  }
  function albumLoud(albumId) {
    const a = AL.get(albumId);
    if (!a) return null;
    let e = 0;
    let n = 0;
    a.tracks.forEach((id) => {
      const d = LV.data[id];
      if (d && d[1] >= LOUD_TRUST) {
        e += d[0] / d[1];
        n++;
      }
    });
    return n ? -0.691 + 10 * Math.log10(e / n) : null;
  }
  function typicalGain() {
    let sum = 0;
    let n = 0;
    Object.keys(LV.data).forEach((id) => {
      const L = trackLoud(id);
      if (L != null) {
        sum += clamp(LOUD_TARGET - L, -12, 6);
        n++;
      }
    });
    return n ? sum / n : 0;
  }
  function levelDb(t) {
    if (!S.level || !t) return 0;
    let L = trackLoud(t.id);
    if (L == null) L = albumLoud(t.album);
    if (L == null) L = trackLoud(t.id, 40);
    return L == null ? typicalGain() : clamp(LOUD_TARGET - L, -12, 6);
  }
  function applyLevel(immediate, fast) {
    if (!LV.norm) return;
    const db = levelDb(curTrack());
    LV.db = db;
    const g = Math.pow(10, db / 20);
    const now = LV.ctx.currentTime;
    LV.norm.gain.cancelScheduledValues(now);
    if (immediate) LV.norm.gain.setValueAtTime(g, now);
    else LV.norm.gain.setTargetAtTime(g, now, fast ? 0.12 : 1.2);
  }
  function writeLoud() {
    clearTimeout(LV.saveT);
    LV.saveT = null;
    try {
      localStorage.setItem(LOUD_KEY, JSON.stringify(LV.data));
    } catch (e) { /* storage full */ }
  }
  /* at most every few seconds while measuring, and whenever playback pauses or the app closes */
  function saveLoud() {
    if (!LV.saveT) LV.saveT = setTimeout(writeLoud, 5000);
  }
  window.addEventListener('beforeunload', writeLoud);
  function loudTick() {
    if (!LV.an || audio.paused || audio.seeking || P.loadedId !== curId()) return;
    const id = curId();
    const d = LV.data[id] || [0, 0];
    if (d[1] >= 3000) return;
    LV.an.getFloatTimeDomainData(LV.buf);
    let ms = 0;
    for (let k = 0; k < LV.buf.length; k++) ms += LV.buf[k] * LV.buf[k];
    ms /= LV.buf.length;
    if (!(ms > 1e-6)) return;
    if (-0.691 + 10 * Math.log10(ms) < -50) return;
    d[0] += ms;
    d[1]++;
    LV.data[id] = d;
    if (d[1] <= LOUD_TRUST * 2 && d[1] % 10 === 0) applyLevel(false);
    saveLoud();
  }
  function ensureGraph() {
    if (LV.ctx || LV.failed) return;
    /* on the phone the sound goes through Web Audio only while levelling is on (it is all the graph is for there) */
    if (PHONE && (!S.level || !LEVEL_OK)) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC({ latencyHint: 'playback' });
      /* both players feed the same chain (a crossfade overlaps them for a moment) */
      const src = ctx.createMediaElementSource(audioA);
      const src2 = ctx.createMediaElementSource(audioB);
      const norm = ctx.createGain();
      const vol = ctx.createGain();
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -1;
      lim.knee.value = 0;
      lim.ratio.value = 20;
      lim.attack.value = 0.002;
      lim.release.value = 0.12;
      src.connect(norm);
      src2.connect(norm);
      norm.connect(vol);
      vol.connect(lim);
      lim.connect(ctx.destination);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 38;
      hp.Q.value = 0.5;
      const hs = ctx.createBiquadFilter();
      hs.type = 'highshelf';
      hs.frequency.value = 1500;
      hs.gain.value = 4;
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      src.connect(hp);
      src2.connect(hp);
      hp.connect(hs);
      hs.connect(an);
      Object.assign(LV, { ctx, src, norm, vol, an, buf: new Float32Array(an.fftSize) });
      vol.gain.value = S.volume * S.volume;
      setElVol(audioA);
      setElVol(audioB);
      applyLevel(true);
      setInterval(loudTick, 100);
    } catch (e) {
      LV.failed = true;
    }
  }
  function setLevel(on) {
    S.level = !!on;
    save();
    applyLevel(false, true);
    $$('[data-act=level-toggle]').forEach((b) => {
      b.setAttribute('aria-checked', String(S.level));
      b.classList.toggle('is-on', S.level);
    });
    toast(S.level ? 'Громкость треков выравнивается' : 'Выравнивание громкости выключено', { key: 'lvl', ms: 1600 });
  }
  function setVolume(v, o) {
    o = o || {};
    v = clamp(Math.round(v * 100) / 100, 0, 1);
    if (v > 0) S.prevVol = v;
    S.volume = v;
    applyVolume();
    save();
    updateVolumeUI();
    if (!o.silent) toast(v > 0 ? 'ГРОМКОСТЬ ' + Math.round(v * 100) + '%' : 'ЗВУК ВЫКЛЮЧЕН', { key: 'vol', ms: 1200 });
  }
  function toggleMute() {
    if (S.volume > 0) {
      const keep = S.volume;
      setVolume(0);
      S.prevVol = keep;
      save();
    } else {
      setVolume(S.prevVol > 0 ? S.prevVol : 0.7);
    }
  }
  const volLevel = (v) => (v <= 0 ? 0 : v < 0.5 ? 1 : 2);
  function volIcon(v, big) {
    const lvl = volLevel(v);
    if (isMF()) {
      const s = big ? 40 : 30;
      const waves = lvl === 0 ? '<path d="M33 19 L42 29 M42 19 L33 29" fill="none" stroke="#d5274f" style="stroke-width:2.6;stroke-linecap:round"></path>'
        : '<path d="M32 18 Q36 24 32 30" fill="none" stroke="#f4efe6" style="stroke-width:2.4;stroke-linecap:round"></path>' + (lvl === 2 ? '<path d="M37 13 Q44 24 37 35" fill="none" stroke="#f4efe6" style="stroke-width:2.4;stroke-linecap:round"></path>' : '');
      return '<svg viewBox="0 0 48 48" width="' + s + '" height="' + s + '" aria-hidden="true" style="display:block"><polygon points="6,19 14,19 25,10 25,38 14,29 6,29" fill="none" stroke="#f4efe6" style="stroke-width:2.4;stroke-linejoin:miter"></polygon>' + waves + '</svg>';
    }
    const body = '<polygon points="4,18 14,18 26,8 26,40 14,30 4,30"></polygon>';
    const paths = lvl === 0 ? ['M33 18 L44 30', 'M44 18 L33 30'] : lvl === 1 ? ['M32 17 Q37 24 32 31'] : ['M32 17 Q37 24 32 31', 'M37 11 Q46 24 37 37'];
    const wc = lvl === 0 ? '#ff2b3a' : '#ffffff';
    if (big) {
      return '<svg viewBox="0 0 48 48" width="46" height="46" aria-hidden="true" style="overflow:visible;display:block">' +
        '<g transform="translate(2.5 3.5)" fill="#0b0b0b" stroke="#0b0b0b" style="stroke-width:5;stroke-linejoin:round">' + body + '</g>' +
        paths.map((d) => '<path d="' + d + '" transform="translate(2.5 3.5)" fill="none" stroke="#0b0b0b" style="stroke-width:9;stroke-linecap:round"></path>').join('') +
        '<g fill="#ffffff" stroke="#0b0b0b" style="stroke-width:4;stroke-linejoin:round">' + body + '</g>' +
        paths.map((d) => '<path d="' + d + '" fill="none" stroke="#0b0b0b" style="stroke-width:9;stroke-linecap:round"></path><path d="' + d + '" fill="none" stroke="' + wc + '" style="stroke-width:4.5;stroke-linecap:round"></path>').join('') +
        '</svg>';
    }
    return '<svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true" style="overflow:visible;filter:drop-shadow(2px 2px 0 #d4141a)">' +
      '<g fill="#ffffff" stroke="#0b0b0b" style="stroke-width:3;stroke-linejoin:round">' + body + '</g>' +
      paths.map((d) => '<path d="' + d + '" fill="none" stroke="' + wc + '" style="stroke-width:4.5;stroke-linecap:round"></path>').join('') + '</svg>';
  }
  function volHtml(big) {
    const v = S.volume;
    const pct = Math.round(v * 100);
    return '<div class="vol' + (big ? ' vol-big' : '') + '" style="--v:' + v + '">' +
      '<button type="button" class="hop vol-btn" data-act="mute" data-b="vol-ico" data-lvl="' + volLevel(v) + '" aria-label="' + (v > 0 ? 'Выключить звук' : 'Включить звук') + '">' + volIcon(v, big) + '</button>' +
      '<div class="vol-bar"><span class="v-sh" aria-hidden="true"></span><span class="v-ol" aria-hidden="true"></span><span class="v-in" aria-hidden="true"><span class="v-fill"></span></span><span class="v-knob" aria-hidden="true"></span>' +
      '<input type="range" class="range" data-b="vol-range" min="0" max="100" step="1" value="' + pct + '" aria-label="Громкость" aria-valuetext="' + pct + '%"></div></div>';
  }
  function updateVolumeUI() {
    const v = S.volume;
    const pct = Math.round(v * 100);
    const lvl = String(volLevel(v));
    $$('.vol').forEach((el) => el.style.setProperty('--v', String(v)));
    $$('[data-b=vol-range]').forEach((el) => {
      if (String(el.value) !== String(pct)) el.value = String(pct);
      el.setAttribute('aria-valuetext', pct + '%');
    });
    $$('[data-b=vol-ico]').forEach((el) => {
      if (el.dataset.lvl !== lvl) {
        el.dataset.lvl = lvl;
        el.innerHTML = volIcon(v, !!el.closest('.vol-big'));
      }
      el.setAttribute('aria-label', v > 0 ? 'Выключить звук' : 'Включить звук');
    });
  }

  /* media keys & Windows media overlay */
  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const h = (name, fn) => {
      try {
        ms.setActionHandler(name, fn);
      } catch (e) { /* unsupported action */ }
    };
    h('play', () => togglePlayIf(true));
    h('pause', () => togglePlayIf(false));
    h('previoustrack', prev);
    h('nexttrack', next);
    h('seekto', (d) => { if (d && typeof d.seekTime === 'number') seek(d.seekTime); });
    /* the iPhone's lock screen and Control Center show their two side buttons as "10 s back / forward" whatever
       the page offers: there those buttons switch to the previous / next track */
    if (IOS) {
      h('seekbackward', () => prev(true));
      h('seekforward', () => next());
    } else {
      h('seekbackward', () => seek((audio.currentTime || 0) - 10));
      h('seekforward', () => seek((audio.currentTime || 0) + 10));
    }
  }
  /* the iPhone's Now Playing does not always load a picture from the app's own address: it gets the picture itself */
  function jpegData(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const k = Math.min(1, 600 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
          const c = doc.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * k));
          c.height = Math.max(1, Math.round(img.naturalHeight * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.88));
        } catch (e) {
          resolve(src);
        }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    });
  }
  function togglePlayIf(wantPlay) {
    const playingNow = !audio.paused && P.loadedId === curId();
    if (wantPlay !== playingNow) togglePlay();
  }
  const artCache = new Map();
  async function artworkFor(a) {
    if (!a) return null;
    /* albums added on Drive later have their cover there (the phone can show it on the lock screen too) */
    const key = a.cover || (a.coverFile && PHONE ? 'drive:' + a.coverFile : null);
    if (key) {
      if (!artCache.has(key)) {
        let d = null;
        try {
          d = await api.artwork(key);
          if (d && IOS && !/^data:/.test(d)) d = await jpegData(d);
        } catch (e) {
          d = null;
        }
        artCache.set(key, d);
      }
      return artCache.get(key);
    }
    return null;
  }
  async function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const t = curTrack();
    if (!t) return;
    const a = albumOf(t);
    const art = await artworkFor(a);
    if (curTrack() !== t) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist,
        album: a ? a.title : '',
        artwork: art ? [{ src: art, sizes: '600x600', type: 'image/jpeg' }] : []
      });
    } catch (e) { /* ignore */ }
  }
  function updatePositionState() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    try {
      if (isFinite(audio.duration) && audio.duration > 0) {
        navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: 1, position: Math.min(audio.currentTime || 0, audio.duration) });
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------- live bindings ---------- */
  function currentPos() {
    if (S.scrub != null) return S.scrub;
    if (P.pendingSeek != null) return P.pendingSeek;
    if (P.loadedId !== curId()) return 0;
    return audio.currentTime || 0;
  }
  function currentDur() {
    const t = curTrack();
    if (P.loadedId === curId() && isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    return t ? t.sec || 0 : 0;
  }
  function updateTimes() {
    const dur = currentDur();
    const pos = currentPos();
    const pct = dur ? clamp((pos / dur) * 100, 0, 100).toFixed(2) + '%' : '0%';
    const e = fmt(pos);
    const tt = fmt(dur);
    $$('[data-b=fill]').forEach((el) => { el.style.width = pct; });
    $$('[data-b=thumb]').forEach((el) => { el.style.left = pct; });
    $$('[data-b=elapsed]').forEach((el) => { if (el.textContent !== e) el.textContent = e; });
    $$('[data-b=total]').forEach((el) => { if (el.textContent !== tt) el.textContent = tt; });
    $$('[data-b=elapsed-t]').forEach((el) => { if (el.dataset.v !== e) { el.dataset.v = e; el.innerHTML = timeTiles(e, 0); } });
    $$('[data-b=total-t]').forEach((el) => { if (el.dataset.v !== tt) { el.dataset.v = tt; el.innerHTML = timeTiles(tt, 1); } });
    $$('[data-b=range]').forEach((el) => {
      const mx = String(Math.max(1, Math.round(dur)));
      if (el.max !== mx) el.max = mx;
      if (S.scrub == null) el.value = String(Math.round(pos));
      el.setAttribute('aria-valuetext', e + ' из ' + tt);
    });
    updateLyricsActive(pos);
  }

  function onTrackChange() {
    const t = curTrack();
    doc.title = t ? t.title + ' — Personafy' : 'Personafy';
    $$('[data-cur-id]').forEach((el) => el.classList.toggle('is-cur', !!t && el.getAttribute('data-cur-id') === t.id));
    renderMini(false);
    if (S.view === 'now') updateNowTrack();
    if (S.qOpen) renderQueue();
    updateMediaSession();
    updateTimes();
    if (S.lyricsOn && t) ensureLyrics(t);
  }
  function onQueueChange() {
    if (S.view === 'now') updateNowBits();
    if (S.qOpen) renderQueue();
  }

  /* ---------- adding to the queue ---------- */
  function queueAdd(id, mode) {
    const t = TR.get(id);
    if (!t) return;
    if (!P.queue.length || !curTrack()) {
      P.queue = [id];
      P.base = [id];
      P.cur = 0;
      loadTrack(false, 0);
      save();
      toast('«' + t.title + '» в очереди', { key: 'qadd', teal: true, ms: 1800 });
      return;
    }
    if (id === curId()) {
      toast('Этот трек сейчас играет', { key: 'qadd', ms: 1600 });
      return;
    }
    /* a track sits in the queue once: adding it again moves it */
    for (let k = P.queue.length - 1; k >= 0; k--) {
      if (P.queue[k] === id) {
        P.queue.splice(k, 1);
        if (k < P.cur) P.cur--;
      }
    }
    if (mode === 'next') P.queue.splice(P.cur + 1, 0, id);
    else P.queue.push(id);
    /* keep the unshuffled order in step, so switching "random" off doesn't drop the track */
    const b = P.base.filter((x) => x !== id);
    if (mode === 'next') {
      const bi = b.indexOf(curId());
      b.splice(bi >= 0 ? bi + 1 : b.length, 0, id);
    } else b.push(id);
    P.base = b;
    save();
    onQueueChange();
    toast(mode === 'next' ? '«' + t.title + '» заиграет следующим' : '«' + t.title + '» — в конце очереди', { key: 'qadd', teal: true, ms: 1800 });
  }

  /* ---------- track menu: play next / to the end of the queue / on repeat ---------- */
  let ctx = null;
  function closeTrackMenu(refocus) {
    if (!ctx) return;
    const c = ctx;
    ctx = null;
    c.el.remove();
    if (c.opener) {
      c.opener.setAttribute('aria-expanded', 'false');
      if (refocus && doc.contains(c.opener)) c.opener.focus({ preventScroll: true });
    }
  }
  function openTrackMenu(id, listKey, i, at, opener, viaKeys) {
    closeTrackMenu();
    const t = TR.get(id);
    if (!t) return;
    const isCur = id === curId();
    const item = (k, label) => '<button type="button" class="ctx-it" role="menuitem" data-act="ctx" data-ctx="' + k + '">' + CTX_ICONS[k] + '<span>' + label + '</span></button>';
    const el = doc.createElement('div');
    el.id = 'ctx';
    el.className = 'ctx';
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', 'Действия с треком «' + t.title + '»');
    el.innerHTML = '<p class="ctx-h" aria-hidden="true"><span class="ctx-t">' + esc(t.title) + '</span><span class="ctx-s">' + esc(t.artist) + '</span></p>' +
      (isCur ? '<p class="ctx-note">Этот трек сейчас играет</p>' : item('next', 'Играть следующим') + item('end', 'В конец очереди'));
    doc.body.appendChild(el);
    const r = el.getBoundingClientRect();
    const W = window.innerWidth;
    const H = window.innerHeight;
    let x;
    let y;
    if (at) {
      x = at[0] + 4;
      y = at[1] + 4;
    } else {
      const o = opener.getBoundingClientRect();
      x = o.right - r.width;
      y = o.bottom + 8;
      if (y + r.height > H - 12) y = o.top - r.height - 8;
    }
    x = clamp(x, 10, W - r.width - 14);
    y = clamp(y, 40, H - r.height - 12);
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
    ctx = { el, id, listKey, i, opener: opener || null, top0: $('#view').scrollTop };
    if (opener) opener.setAttribute('aria-expanded', 'true');
    if (viaKeys) {
      const f = el.querySelector('.ctx-it');
      if (f) f.focus({ preventScroll: true });
    }
  }
  function runTrackMenu(k) {
    if (!ctx) return;
    const { id } = ctx;
    closeTrackMenu(true);
    if (k === 'next' || k === 'end') queueAdd(id, k);
  }

  /* ---------- likes ---------- */
  function likeLabel(on, t) {
    return (on ? 'Убрать из избранного' : 'В избранное') + (t ? ': ' + t.title : '');
  }
  function likeInner(kind, on, animate) {
    const pop = animate ? 'hpop-now' : 'hpop';
    if (isMF()) {
      const sz = kind === 'mini' ? 30 : kind === 'now' ? 46 : 30;
      return '<span class="' + (on ? pop : '') + '" aria-hidden="true" style="display:block">' + heartMF(sz, on) + '</span>';
    }
    if (isP3()) {
      const sz = kind === 'mini' ? 30 : kind === 'now' ? 48 : 32;
      return on ? '<span class="' + pop + '" aria-hidden="true" style="display:block">' + heartP3(sz, true) + '</span>' : '<span aria-hidden="true" style="display:block">' + heartP3(sz, false) + '</span>';
    }
    if (kind === 'mini') return heartMini(on);
    if (kind === 'now') {
      return '<span class="boil" aria-hidden="true" style="display:block;animation-delay:-.25s">' +
        (on ? '<span class="' + pop + '" style="display:block">' + heartFull(68, { shadow: true }) + '</span>' : heartEmpty(68, { shadow: true })) + '</span>';
    }
    return on ? '<span class="' + pop + '" aria-hidden="true" style="display:block">' + heartFull(44) + '</span>' : '<span aria-hidden="true" style="display:block">' + heartEmpty(44) + '</span>';
  }
  function likeBtn(id, kind) {
    const on = !!S.liked[id];
    const t = TR.get(id);
    const cls = kind === 'row' ? 'hop like-btn' : kind === 'mini' ? 'hop ibtn' : 'hop cbtn';
    return '<button type="button" class="' + cls + '" data-act="like" data-id="' + esc(id) + '" data-like-id="' + esc(id) + '" data-like-kind="' + kind + '" aria-pressed="' + on + '" aria-label="' + esc(likeLabel(on, t)) + '">' + likeInner(kind, on, false) + '</button>';
  }
  /* "Now playing"'s like button: in the playback row on the computer; on the phone on the cover's corner like a sticker,
     so the row is shuffle · prev · PLAY · next · repeat with play in the very middle */
  function nowLikeSlot(t, where) {
    if (where !== (PHONE ? 'art' : 'ctl')) return '';
    return '<div class="pop np-like-wrap" style="animation-delay:.46s" id="np-like-slot">' + (t ? likeBtn(t.id, 'now') : '') + '</div>';
  }
  function toggleLike(id) {
    if (!id || !TR.has(id)) return;
    const on = !S.liked[id];
    if (on) S.liked[id] = Date.now();
    else delete S.liked[id];
    save();
    const t = TR.get(id);
    $$('[data-like-id="' + sel(id) + '"]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', likeLabel(on, t));
      btn.innerHTML = likeInner(btn.dataset.likeKind, on, true);
    });
    $$('[data-row="' + sel(id) + '"]').forEach((w) => w.classList.toggle('mf-lk', on));
    if (S.view === 'library') {
      $$('[data-row="' + sel(id) + '"] .row').forEach((r) => r.classList.toggle('row-off', !on));
      renderLibStats();
    }
    const mst = $('#mf-stats');
    if (mst) mst.outerHTML = mfStatsHtml();
    if (id === curId()) updateNowBits();
    if (S.qOpen) renderQueue();
    if (on) toast('Добавлено в «Библиотеку»', { key: 'like', ms: 1500, teal: true });
  }

  /* ---------- decor ---------- */
  const dotsBg = '<div class="dots"></div>';
  const spark = (pos, size, color, delay) => '<div class="sparkbox" style="' + pos + ';width:' + size + 'px;height:' + size + 'px"><div class="spark" style="background:' + color + ';animation-delay:' + delay + 's"></div></div>';
  const shape = (cls, style) => '<div class="' + cls + '" style="position:absolute;' + style + '"></div>';
  const DECOR = {
    home: () => dotsBg +
      shape('drift', 'left:-6%;top:2%;width:78%;height:26%;background:#c3101a;clip-path:polygon(0% 40%, 100% 0%, 86% 34%, 96% 46%, 4% 100%, 14% 62%)') +
      shape('', 'right:-4%;top:38%;width:40%;height:30%;background:#5e070c;clip-path:polygon(40% 0%, 100% 10%, 100% 100%, 0% 70%, 52% 48%)') +
      spark('left:45%;top:3%', 84, '#ffc21a', 0) + spark('left:40%;top:46%', 48, '#ffffff', -1),
    search: () => dotsBg +
      shape('drift', 'left:-8%;top:1%;width:74%;height:24%;background:#c3101a;clip-path:polygon(0% 44%, 100% 0%, 84% 36%, 96% 48%, 6% 100%, 16% 64%)') +
      shape('', 'right:-6%;top:22%;width:46%;height:26%;background:#5e070c;clip-path:polygon(30% 0%, 100% 14%, 100% 100%, 0% 76%, 46% 50%)') +
      spark('right:4%;top:3%', 96, '#ffc21a', 0),
    library: () => dotsBg +
      shape('', 'right:-6%;top:-2%;width:54%;height:22%;background:#5e070c;clip-path:polygon(14% 0%, 100% 0%, 100% 80%, 30% 100%, 46% 54%, 0% 60%)') +
      spark('left:1%;top:3%', 70, '#ffc21a', 0),
    now: () => dotsBg +
      shape('drift', 'left:-8%;top:14%;width:70%;height:62%;background:#c3101a;clip-path:polygon(0% 38%, 92% 0%, 74% 26%, 100% 30%, 8% 100%, 30% 58%)') +
      shape('', 'right:-6%;top:-4%;width:58%;height:46%;background:#5e070c;clip-path:polygon(18% 0%, 100% 0%, 100% 70%, 40% 100%, 58% 52%, 0% 62%)') +
      shape('', 'left:30%;top:50%;width:64%;height:24%;background:#ffffff;clip-path:polygon(0% 94%, 100% 0%, 100% 5%, 1% 100%)') +
      shape('drift', 'right:-10%;bottom:-8%;width:60%;height:42%;background:#c3101a;clip-path:polygon(30% 22%, 100% 0%, 100% 100%, 0% 100%, 46% 60%);animation-delay:-4s') +
      spark('left:2%;top:10%', 92, '#ffc21a', 0) + spark('right:4%;top:18%', 130, '#ffc21a', -1.2) + spark('left:46%;top:5%', 44, '#ffffff', -0.6)
  };

  const decorHtml = (view) => isMF() ? mfDecor(view) : isP3() ? p3Decor(view) : '<div class="decor-sticky" aria-hidden="true"><div class="decor-in">' + DECOR[view]() + '</div></div>';

  /* ---------- the phone's bottom tabs: a picture per section, drawn in each theme's manner ---------- */
  const PH_TABS = [['home', 'Главная'], ['search', 'Поиск'], ['library', 'Библиотека']];
  /* P5: cut-paper stickers — white with a black edge and a shadow (red, or black on the red tag) */
  function p5TabIcon(v, cur) {
    const sh = cur ? '#0b0b0b' : '#d4141a';
    const two = (body, extra) => '<svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true" style="overflow:visible;display:block">' +
      '<g transform="translate(3 3.5)" fill="' + sh + '" stroke="' + sh + '" style="stroke-width:6;stroke-linejoin:round">' + body + '</g>' +
      '<g fill="#ffffff" stroke="#0b0b0b" style="stroke-width:3.5;stroke-linejoin:round">' + body + '</g>' + (extra || '') + '</svg>';
    if (v === 'home') {
      /* the chimney goes first, so the roof covers its foot */
      return two('<polygon points="31,16 31.5,6 38,5.5 38,20"></polygon><polygon points="4,23 24,5 44,21 38.5,22.5 39,43 9,42 10,23.5"></polygon>',
        '<polygon points="19,42 19.5,29 28.5,28 29,42" fill="#0b0b0b"></polygon>');
    }
    if (v === 'search') {
      return two('<path fill-rule="evenodd" d="M7 20 a14 14 0 1 0 28 0 a14 14 0 1 0 -28 0 Z M14 20 a7 7 0 1 1 14 0 a7 7 0 1 1 -14 0 Z"></path><polygon points="30,31 35,26 45,38 39,44"></polygon>');
    }
    return '<span style="display:block;width:34px;height:34px">' + heartFull(34, { stroke: 36, shadow: true }) + '</span>';
  }
  /* P3R: clean white strokes slanted like the game's menu words — a cyan offset shadow, or, on the chosen one,
     a navy rim so the picture reads over the pause menu's white-and-pink cursor wedge behind it */
  function p3TabIcon(v, cur) {
    const body = v === 'home' ? '<path d="M7 22 L24 7 L41 22"></path><path d="M12 19 V40 H36 V19"></path><path d="M20 40 V29 H28 V40"></path>'
      : v === 'search' ? '<circle cx="20" cy="20" r="12"></circle><path d="M29 29 L41 41"></path>'
        : '<path d="' + P3_HEART_D + '"></path>';
    const g = (extra, color, w) => '<g' + extra + ' fill="none" style="stroke:' + color + ';stroke-width:' + w + ';stroke-linejoin:round;stroke-linecap:round">' + body + '</g>';
    return '<svg viewBox="0 0 48 48" width="32" height="32" aria-hidden="true" style="overflow:visible;display:block">' +
      (cur ? g('', '#0a1450', 9.5) : g(' transform="translate(2.5 3)"', 'var(--p3-cyan)', 4.5)) + g('', '#ffffff', 4.5) + '</svg>';
  }
  /* Metaphor: fine serif-like lines with a paper diamond — a hall, a lens, an open book */
  function mfTabIcon(v) {
    const dia = (x, y, s) => '<rect x="' + (x - s / 2) + '" y="' + (y - s / 2) + '" width="' + s + '" height="' + s + '" transform="rotate(45 ' + x + ' ' + y + ')" style="fill:currentColor;stroke:none"></rect>';
    const body = v === 'home' ? '<path d="M9 21 L24 8 L39 21"></path><path d="M12 19 V41 H36 V19"></path><path d="M20 41 V32 Q24 26 28 32 V41"></path>' + dia(24, 3.5, 4.6)
      : v === 'search' ? '<circle cx="20" cy="20" r="11"></circle><path d="M28 28 L41 41" style="stroke-width:3.6"></path>' + dia(20, 20, 4.6)
        : '<path d="M24 13 C19 9 11 9 5 11 V37 C11 35 19 35 24 39 C29 35 37 35 43 37 V11 C37 9 29 9 24 13 Z"></path><path d="M24 13 V39"></path>' +
          '<path d="M10 17 C13 16 17 16 20 17 M10 23 C13 22 17 22 20 23 M28 17 C31 16 35 16 38 17 M28 23 C31 22 35 22 38 23" style="stroke-width:1.6"></path>';
    return '<svg viewBox="0 0 48 48" width="32" height="32" aria-hidden="true" style="overflow:visible;display:block"><g fill="none" style="stroke:currentColor;stroke-width:2.4;stroke-linejoin:miter;stroke-linecap:square">' + body + '</g></svg>';
  }
  function phoneNavHtml() {
    return PH_TABS.map(([v, label]) => {
      const cur = S.view === v;
      const attrs = ' data-nav="' + v + '" aria-label="' + label + '" title="' + label + '"' + (cur ? ' aria-current="page"' : '');
      if (isP3()) return '<button type="button" class="ph-tab p3n' + (cur ? ' is-cur' : '') + '"' + attrs + '>' + (cur ? P3_CUR : '') + '<span class="ph-in">' + p3TabIcon(v, cur) + '</span></button>';
      if (isMF()) return '<button type="button" class="ph-tab mfn-tab' + (cur ? ' is-cur' : '') + '"' + attrs + '>' + (cur ? '<span class="mf-br" aria-hidden="true"></span>' : '') + '<span class="ph-in">' + mfTabIcon(v) + '</span></button>';
      return '<button type="button" class="tab tab-nav ph-tab"' + attrs + '><span class="tg-in">' + p5TabIcon(v, cur) + '</span></button>';
    }).join('');
  }
  /* settings left the tab bar on the phone: a gear in the corner of the home screen opens them */
  function phoneGearHtml() {
    const attrs = ' data-act="settings-open" aria-label="Настройки" title="Настройки" aria-controls="settings" aria-expanded="' + !!S.sOpen + '"';
    if (isP3()) {
      return '<button type="button" class="ph-gear hop p3g"' + attrs + '><span class="p3-play" aria-hidden="true" style="width:42px;height:42px"><svg viewBox="0 0 48 48" width="25" height="25"><path class="g-rot" d="' + GEAR_D + '" fill="#0a1450" fill-rule="evenodd"></path></svg></span></button>';
    }
    if (isMF()) {
      return '<button type="button" class="ph-gear hop mfg"' + attrs + '><svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true" style="display:block;overflow:visible"><path class="g-rot" d="' + GEAR_D + '" fill="none" stroke="#f4efe6" style="stroke-width:1.8;stroke-linejoin:miter"></path>' +
        '<rect x="21" y="21" width="6" height="6" transform="rotate(45 24 24)" fill="#f4efe6"></rect></svg></button>';
    }
    return '<button type="button" class="ph-gear tab tab-nav tab-gear p5g"' + attrs + '><span class="tg-in">' + GEAR_ICON(28) + '</span></button>';
  }

  /* ---------- shared pieces ---------- */
  function navHtml() {
    if (PHONE) return phoneNavHtml();
    if (isP3()) return p3NavHtml();
    if (isMF()) return mfNavHtml();
    return [['home', 'ГЛАВНАЯ'], ['search', 'ПОИСК'], ['library', 'БИБЛИОТЕКА']].map(([v, l]) =>
      '<button type="button" class="tab tab-nav" data-nav="' + v + '"' + (S.view === v ? ' aria-current="page"' : '') + '>' + l + '</button>').join('') +
      '<button type="button" class="tab tab-nav tab-gear" data-act="settings-open" aria-label="Настройки" aria-controls="settings" aria-expanded="' + !!S.sOpen + '" title="Настройки"><span class="tg-in">' + GEAR_ICON(32) + '</span></button>';
  }
  function labelA(text, id, delay, extra) {
    if (isP3()) return p3Label(text, id, delay, extra);
    if (isMF()) return mfLabel(text, id, delay, extra);
    return '<div class="pop label-a" style="animation-delay:' + delay + 's;' + (extra || '') + '"><span aria-hidden="true"></span><h2 id="' + id + '">' + text + '</h2></div>';
  }
  function labelB(text, id, delay) {
    if (isP3()) return p3Label(text, id, delay);
    if (isMF()) return mfLabel(text, id, delay);
    return '<div class="pop label-b" style="animation-delay:' + delay + 's"><span aria-hidden="true"></span><h2 id="' + id + '">' + text + '</h2></div>';
  }
  function titleH1(srText, lettersList, rot, wrapStyle) {
    if (isP3()) return p3Title(srText);
    if (isMF()) return mfTitle(srText);
    return '<h1 class="slidel" style="margin:0;display:flex;align-items:center;animation-delay:.03s"><span class="sr">' + srText + '</span>' +
      '<span aria-hidden="true" style="display:flex;' + (wrapStyle || '') + 'align-items:center;transform:rotate(' + rot + 'deg)">' + letters(lettersList, true) + '</span></h1>';
  }
  function redBand(inner, style, label) {
    return '<section class="band-red" style="' + (style || '') + '"' + (label ? ' aria-label="' + esc(label) + '"' : '') + '><div class="bg" aria-hidden="true"></div><div class="bgdots" aria-hidden="true"></div><div class="bolt" aria-hidden="true"></div><div class="in">' + inner + '</div></section>';
  }

  /* =====================================================================
     PERSONA 3 RELOAD theme — markup for the parts whose structure differs.
     Look studied from the game's pause menu (falling into the sea, stacked
     italic cyan options, red/white triangle cursor) and its CONFIG screens.
     ===================================================================== */
  const P3_CUR = '<span class="p3c" aria-hidden="true"><i class="p3c-p"></i><i class="p3c-w"></i><i class="p3c-r"></i></span>';
  function p3Item(label, attrs, r, x, c, cur) {
    return '<button type="button" class="pm-it' + (cur ? ' is-cur' : '') + '" ' + attrs + ' style="--r:' + r + 'deg;--x:' + x + 'px;--c:' + c + '">' +
      '<span class="pm-in">' + (cur ? P3_CUR : '') + '<span class="pm-t">' + label + '</span>' +
      (cur ? '<span class="pm-rt" aria-hidden="true">' + label + '</span>' : '') + '</span></button>';
  }
  function p3NavHtml() {
    const it = (v, label, r, x, c) => p3Item(label, 'data-nav="' + v + '"' + (S.view === v ? ' aria-current="page"' : ''), r, x, c, S.view === v);
    return '<div class="pm">' +
      it('home', 'ГЛАВНАЯ', -9, 10, '#6ae6fb') +
      it('search', 'ПОИСК', -3, 40, '#0bc8ff') +
      it('library', 'БИБЛИОТЕКА', -6, 0, '#68fffc') +
      p3Item('НАСТРОЙКИ', 'data-act="settings-open" aria-controls="settings" aria-expanded="' + !!S.sOpen + '"', 5, 20, '#0ccbff', false) +
      '</div>';
  }
  const P3_PAGE = { 'Главная': '01', 'Поиск': '02', 'Библиотека': '03' };
  const P3_LY_WORD = new Map([[T_INSTR, 'ИНСТРУМЕНТАЛ'], [T_NOLY, 'НЕТ ТЕКСТА'], [T_NONET, 'НЕТ СЕТИ']]);
  function p3Title(sr) {
    const w = sr.toUpperCase();
    return '<h1 class="p3-title slidel" style="--len:' + w.length + ';animation-delay:.03s"><span class="sr">' + sr + '</span>' +
      '<span class="pt-w" aria-hidden="true"><span class="pt-band"></span><span class="pt-big">' + w + '</span></span>' +
      '<span class="pt-num" aria-hidden="true">' + (P3_PAGE[sr] || '00') + '</span></h1>';
  }
  /* the field HUD's date: day, weekday, time of day — and the moon (P3 counts the days to the full moon) */
  const P3_DOW = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
  const SYNODIC = 29.530588853;
  function moonAge(d) {
    const ref = Date.UTC(2000, 0, 6, 18, 14);
    const age = ((d.getTime() - ref) / 86400000) % SYNODIC;
    return age < 0 ? age + SYNODIC : age;
  }
  function moonSvg(age, r) {
    const k = (1 - Math.cos(2 * Math.PI * age / SYNODIC)) / 2;
    const waxing = age < SYNODIC / 2;
    const rx = (Math.abs(1 - 2 * k) * r).toFixed(2);
    const lit = 'M' + r + ' 0 A' + r + ' ' + r + ' 0 0 ' + (waxing ? 1 : 0) + ' ' + r + ' ' + 2 * r + ' A' + rx + ' ' + r + ' 0 0 ' + ((k > 0.5) === waxing ? 1 : 0) + ' ' + r + ' 0 Z';
    return '<svg viewBox="-2 -2 ' + (2 * r + 4) + ' ' + (2 * r + 4) + '" width="' + (2 * r + 4) + '" height="' + (2 * r + 4) + '" aria-hidden="true"><circle cx="' + r + '" cy="' + r + '" r="' + r + '" fill="#0a1450" stroke="#6af0f8" style="stroke-width:1.5"></circle>' +
      (k > 0.02 ? '<path d="' + lit + '" fill="#ffd43b"></path>' : '') + '</svg>';
  }
  function timeOfDay(h) {
    if (h === 0) return ['Тёмный час', 'dark'];
    if (h < 5) return ['Поздняя ночь', ''];
    if (h < 8) return ['Раннее утро', ''];
    if (h < 12) return ['Утро', ''];
    if (h < 13) return ['Обед', ''];
    if (h < 15) return ['День', ''];
    if (h < 18) return ['После уроков', ''];
    return ['Вечер', ''];
  }
  function p3DateHtml() {
    const d = new Date();
    const age = moonAge(d);
    const toFull = Math.round(((SYNODIC / 2 - age) % SYNODIC + SYNODIC) % SYNODIC);
    const dow = d.getDay();
    const tod = timeOfDay(d.getHours());
    const full = toFull === 0 || toFull >= 29;
    const label = d.getDate() + '/' + (d.getMonth() + 1);
    return '<div class="p3-date rise" id="p3-date" style="animation-delay:.2s" aria-label="' + esc(d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' }) + ', ' + tod[0].toLowerCase() + (full ? ', полнолуние' : ', до полнолуния ' + plural(toFull, 'день', 'дня', 'дней'))) + '">' +
      '<span class="pd-row" aria-hidden="true"><span class="pd-d">' + label + '</span><span class="pd-w' + (dow === 0 ? ' sun' : '') + '">' + P3_DOW[dow] + '</span><span class="pd-moon">' + moonSvg(age, 17) + '</span></span>' +
      '<span class="pd-row2" aria-hidden="true"><span class="pd-t' + (tod[1] ? ' ' + tod[1] : '') + '">' + tod[0] + '</span>' +
      '<span class="pd-m"><i>' + (full ? 'полнолуние' : 'до полнолуния') + '</i>' + (full ? '' : '<b>' + toFull + '</b>') + '</span></span></div>';
  }
  setInterval(() => {
    const el = $('#p3-date');
    if (el && isP3()) el.outerHTML = p3DateHtml().replace(' rise"', '"');
  }, 60000);

  /* P5's field calendar, laid out like the game's HUD: the month and a slash on one sticker, the big day on a second,
     the weekday cutting across it on a third, a white plate with the sky icon behind, and the time-of-day tag below.
     The stickers' black backing and white rim come from the SVG filters in index.html (they follow the glyphs). */
  const P5_WD = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  const P5_VOWELS = 'аеёиоуыэюя';
  function p5TimeOfDay(h) {
    if (h < 5) return 'Ночь';
    if (h < 8) return 'Раннее утро';
    if (h < 12) return 'Утро';
    if (h < 13) return 'Обед';
    if (h < 15) return 'День';
    if (h < 18) return 'После уроков';
    if (h < 22) return 'Вечер';
    return 'Ночь';
  }
  /* sky icons, dark grey on the white plate (gradient #skyg lives in index.html); each kind has a small loop of its own,
     made only of transform/opacity on plain elements so it runs on the compositor and never repaints the stickers */
  const SKY_SVG = (cls, inner) => '<svg class="' + cls + '" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">' + inner + '</svg>';
  const SKY_PARTS = {
    umbrella: '<path d="M4 30 C6 14 18 5 32 5 C46 5 58 14 60 30 C56 26.5 51 26.5 46.5 30 C42 26.5 36.5 26.5 32 30 C27.5 26.5 22 26.5 17.5 30 C13 26.5 8 26.5 4 30 Z" fill="url(#skyg)"></path>' +
      '<path d="M32 5 C26 9 22.5 18 22 28.6 C25.6 27.2 28.8 27.6 32 30 Z" fill="#ffffff" opacity=".9"></path><path d="M32 5 C38.5 10 41.5 18 42 28.6 C38.8 27.4 35.4 27.6 32 30 Z" fill="#5a5a5a"></path>' +
      '<path d="M32 29 V54 C32 59.5 39.5 59.5 39.5 54" fill="none" stroke="url(#skyg)" stroke-linecap="round" style="stroke-width:4"></path>',
    rays: '<g fill="url(#skyg)">' + [0, 45, 90, 135, 180, 225, 270, 315].map((a) => '<polygon points="32,2 36.5,13 27.5,13" transform="rotate(' + a + ' 32 32)"></polygon>').join('') + '</g>',
    core: '<circle cx="32" cy="32" r="14" fill="url(#skyg)"></circle>',
    moon: '<path d="M40 5 A27 27 0 1 0 60 42 A21 21 0 1 1 40 5 Z" fill="url(#skyg)"></path>',
    cloud: '<path d="M14 50 C5 50 3 38 11 35 C9 25 21 20 27 26 C30 15 47 14 50 26 C59 25 63 36 56 42 C61 48 56 53 50 50 Z" fill="url(#skyg)"></path><path d="M20 33 C21 28 26 27 29 30" fill="none" stroke="#7a7a7a" stroke-linecap="round" style="stroke-width:3"></path>',
    flake: '<g stroke="url(#skyg)" stroke-linecap="round" fill="none" style="stroke-width:5">' + [0, 60, 120].map((a) => '<g transform="rotate(' + a + ' 32 32)"><path d="M32 4 V60"></path><path d="M24 11 L32 18 L40 11 M24 53 L32 46 L40 53"></path></g>').join('') + '</g>'
  };
  const skyBits = (cls, spots) => spots.map(([x, y, d]) => '<i class="' + cls + '" style="left:' + x + 'px;top:' + y + 'px;animation-delay:' + d + 's"></i>').join('');
  function skyHtml(kind, mf) {
    const P = SKY_PARTS;
    const body = {
      rain: skyBits('sk-dp', [[2, 4, 0], [56, -4, -0.3], [62, 26, -0.6], [-2, 34, -0.45], [46, 40, -0.15]]) + SKY_SVG('sk-main', P.umbrella),
      sun: SKY_SVG('sk-rays', P.rays) + SKY_SVG('sk-core', P.core),
      moon: SKY_SVG('sk-main', P.moon) + skyBits('sk-st', [[50, 2, 0], [60, 24, -0.7], [44, 18, -1.2]]),
      cloud: SKY_SVG('sk-back', P.cloud) + SKY_SVG('sk-main', P.cloud),
      snow: SKY_SVG('sk-main', P.flake) + skyBits('sk-sf', [[0, 2, 0], [54, -4, -0.8], [60, 30, -1.6], [6, 40, -1.2], [30, -6, -0.4]])
    }[kind];
    if (mf) return '<span class="mf-sky sky-' + kind + '">' + body.replace(/url\(#skyg\)/g, 'url(#skyw)') + '</span>';
    return '<span class="p5c-sky sky-' + kind + '">' + body + '</span>';
  }
  const SKY_WORD = { rain: 'дождь', sun: 'ясно', moon: 'ясно', cloud: 'облачно', snow: 'снег' };
  let WX = null;
  function skyKind(h) {
    const c = WX && typeof WX.code === 'number' ? WX.code : null;
    const day = WX && typeof WX.isDay === 'boolean' ? WX.isDay : h >= 6 && h < 18;
    if (c === null || c <= 1) return day ? 'sun' : 'moon';
    if (c <= 3 || c === 45 || c === 48) return 'cloud';
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'snow';
    return 'rain';
  }
  function p5Weekday(wd) {
    const n = wd.length;
    const size = Math.min(50, Math.round(440 / n));
    return [...wd].map((ch, i) => {
      const lo = P5_VOWELS.includes(ch.toLowerCase());
      return '<i style="font-size:' + size + 'px;rotate:' + [-2, 3, -3, 2, 0][i % 5] + 'deg;translate:0 ' + (lo ? 0 : [0, -3, 2, -2, 1][i % 5]) + 'px">' + (lo ? ch.toLowerCase() : ch.toUpperCase()) + '</i>';
    }).join('');
  }
  function p5DateHtml() {
    const d = new Date();
    const h = d.getHours();
    const tod = p5TimeOfDay(h);
    const sky = skyKind(h);
    const label = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }) + ', ' + tod.toLowerCase() + (WX ? ', ' + SKY_WORD[sky] : '');
    const mo = String(d.getMonth() + 1);
    const dy = String(d.getDate());
    return '<div class="p5-date pop" id="p5-date" role="img" style="animation-delay:.18s" aria-label="' + esc(label) + '"><div class="p5c-z" aria-hidden="true">' +
      '<div class="p5c-md" style="--n:' + mo.length + '"><i class="p5c-bk"></i><b>' + mo + '</b><i class="p5c-sl"></i></div>' +
      '<div class="p5c-dw"><div class="p5c-plate">' + skyHtml(sky) + '</div>' +
      '<div class="p5c-d" style="--n:' + dy.length + '"><b>' + dy + '</b></div>' +
      '<div class="p5c-w"><b>' + p5Weekday(P5_WD[d.getDay()]) + '</b></div></div>' +
      '<div class="p5c-t"><b style="--fs:' + Math.min(50, Math.round(420 / tod.length)) + 'px">' + tod + '</b></div></div></div>';
  }
  function refreshP5Date() {
    const el = $('#p5-date');
    if (el && isP5()) el.outerHTML = p5DateHtml().replace(' pop"', '"');
    refreshMFDate();
  }
  setInterval(refreshP5Date, 60000);
  /* the weather behind the icon: the main process asks Open-Meteo for the town the internet address points to; without it the icon follows the clock */
  async function loadWeather() {
    try {
      const w = await window.api.weather();
      if (w && typeof w.code === 'number') {
        WX = w;
        refreshP5Date();
      }
    } catch (e) { /* offline: keep the clock-based icon */ }
  }
  loadWeather();
  setInterval(loadWeather, 15 * 60000);

  function p3Label(text, id, delay, extra) {
    return '<div class="rise p3-label" style="animation-delay:' + delay + 's;' + (extra || '') + '"><span class="pl-tab" aria-hidden="true"></span>' +
      '<h2 id="' + id + '">' + text + '</h2><span class="pl-line" aria-hidden="true"></span></div>';
  }

  /* the sea: light from the surface, drifting caustics, rising bubbles and a few glass shards */
  const P3_BUBBLES = [[5, 9, 14, 2], [12, 5, 10, 6], [21, 13, 17, 9], [29, 6, 11, 3], [36, 4, 8, 1], [45, 10, 13, 7], [53, 7, 12, 11], [61, 14, 19, 4], [69, 5, 9, 8], [76, 9, 15, 12], [84, 6, 10, 5], [92, 12, 16, 10]];
  const P3_SHARDS = [
    [4, 62, 16, 'polygon(0% 30%, 100% 0%, 64% 100%)', '#a8faff', 24, 0],
    [9, 80, 10, 'polygon(10% 0%, 100% 50%, 0% 100%)', '#ffffff', -18, 2],
    [15, 44, 8, 'polygon(0% 0%, 100% 40%, 30% 100%)', '#ff7ab8', 40, 4],
    [88, 24, 14, 'polygon(0% 60%, 70% 0%, 100% 100%)', '#7ff4ff', -30, 1],
    [94, 58, 9, 'polygon(0% 0%, 100% 20%, 50% 100%)', '#ffffff', 12, 3],
    [82, 70, 7, 'polygon(20% 0%, 100% 80%, 0% 100%)', '#ff4d6d', -50, 5]
  ];
  function p3Decor() {
    return '<div class="decor-sticky" aria-hidden="true"><div class="decor-in p3-sea">' +
      '<div class="sea-caus"><div class="sea-caus-in"></div></div>' +
      '<div class="sea-rays"><i style="left:8%"></i><i style="left:27%;animation-delay:-3s"></i><i style="left:52%;animation-delay:-6s"></i><i style="left:76%;animation-delay:-9s"></i></div>' +
      P3_SHARDS.map(([x, y, s, cp, c, r, dl]) => '<i class="shard" style="left:' + x + '%;top:' + y + '%;width:' + s + 'px;height:' + s + 'px;clip-path:' + cp + ';background:' + c + ';--sr:' + r + 'deg;animation-delay:-' + dl + 's"></i>').join('') +
      P3_BUBBLES.map(([x, sz, d, dl]) => '<i class="bub" style="left:' + x + '%;width:' + sz + 'px;height:' + sz + 'px;animation-duration:' + d + 's;animation-delay:-' + dl + 's"></i>').join('') +
      '</div></div>';
  }

  /* control icons: white chevrons with a red rim (the game's LB/RB arrows), a white "confirm" disc for play */
  const P3_ARROWS = '<polygon points="4,6 26,24 4,42"></polygon><polygon points="20,6 44,24 20,42"></polygon>';
  const P3_ARROW = (s, flip) => '<svg viewBox="0 0 48 48" width="' + s + '" height="' + s + '" aria-hidden="true" style="overflow:visible' + (flip ? ';transform:scaleX(-1)' : '') + '">' +
    '<g transform="translate(2.5 3)" fill="#08104a" stroke="#08104a" style="stroke-width:3;stroke-linejoin:round;opacity:.55">' + P3_ARROWS + '</g>' +
    '<g fill="#ffffff" stroke="#ff1e2d" style="stroke-width:2.2;stroke-linejoin:round">' + P3_ARROWS + '</g></svg>';
  const P3_PREV = (s) => P3_ARROW(s, true);
  /* skip buttons: the same white disc with a cyan shadow as play, navy double triangle inside */
  const P3_SKIPBTN = (s, prev) => '<span class="p3-play p3-skip" aria-hidden="true" style="width:' + s + 'px;height:' + s + 'px">' +
    '<svg viewBox="0 0 48 48" width="' + Math.round(s * 0.5) + '" height="' + Math.round(s * 0.5) + '"' + (prev ? ' style="transform:scaleX(-1)"' : '') + '><polygon points="5,10 24,24 5,38" fill="#0a1450"></polygon><polygon points="24,10 43,24 24,38" fill="#0a1450"></polygon></svg></span>';
  /* a clean, symmetric heart: white outline with a cyan offset when off, red when on */
  const P3_HEART_D = 'M24 41 L8.6 25.6 C4.2 21.2 4.3 13.8 8.8 9.8 C13.2 5.9 19.8 6.9 24 12.6 C28.2 6.9 34.8 5.9 39.2 9.8 C43.7 13.8 43.8 21.2 39.4 25.6 Z';
  const heartP3 = (s, on) => '<svg class="h3" viewBox="0 0 48 48" width="' + s + '" height="' + s + '" style="overflow:visible;display:block">' +
    '<path class="h3-sh" d="' + P3_HEART_D + '" transform="translate(3.5 3.5)" fill="' + (on ? '#29d3ff' : 'none') + '" stroke="#29d3ff" style="stroke-width:3.5;stroke-linejoin:round"></path>' +
    '<path class="h3-b" d="' + P3_HEART_D + '" fill="' + (on ? '#ff1e2d' : 'none') + '" stroke="#ffffff" style="stroke-width:3.5;stroke-linejoin:round"></path>' +
    (on ? '<path d="M13.5 15.5 C15.5 12.8 18.6 12.6 20.6 14.4" fill="none" stroke="#ffffff" style="stroke-width:3;stroke-linecap:round;opacity:.9"></path>' : '') + '</svg>';
  const P3_NEXT = (s) => P3_ARROW(s, false);
  const P3_PLAYBTN = (s) => '<span class="p3-play" aria-hidden="true" style="width:' + s + 'px;height:' + s + 'px">' +
    '<svg class="ico-pause" viewBox="0 0 48 48" width="' + Math.round(s * 0.5) + '" height="' + Math.round(s * 0.5) + '"><rect x="11" y="9" width="9" height="30" rx="1.5" transform="skewX(-8)" fill="#0a1450"></rect><rect x="29" y="9" width="9" height="30" rx="1.5" transform="skewX(-8)" fill="#0a1450"></rect></svg>' +
    '<svg class="ico-play" viewBox="0 0 48 48" width="' + Math.round(s * 0.52) + '" height="' + Math.round(s * 0.52) + '"><polygon points="15,7 42,24 15,41" fill="#0a1450"></polygon></svg></span>';
  const P3_SHUF = (s) => '<svg viewBox="0 0 48 48" width="' + s + '" height="' + s + '" aria-hidden="true"><path d="M6 14 H14 L32 34 H40" fill="none" style="stroke:var(--sh);stroke-width:4.5;stroke-linejoin:round;stroke-linecap:round"></path><path d="M6 34 H14 L32 14 H40" fill="none" style="stroke:var(--sh);stroke-width:4.5;stroke-linejoin:round;stroke-linecap:round"></path><polygon points="35,7 44,14 35,21" style="fill:var(--sh)"></polygon><polygon points="35,27 44,34 35,41" style="fill:var(--sh)"></polygon></svg>';

  function miniP3(t, first) {
    return '<div class="m3' + (first ? ' rise' : '') + '" style="animation-delay:.45s">' +
      '<div class="mini-prog m3-prog">' +
      '<div class="m3-track" aria-hidden="true"><div class="m3-fill" data-b="fill"></div></div>' +
      '<span class="m3-knob" data-b="thumb" aria-hidden="true"></span>' +
      '<span class="mp-time l" data-b="elapsed-t" aria-hidden="true"></span><span class="mp-time r" data-b="total-t" aria-hidden="true"></span>' +
      '<input type="range" class="range" data-b="range" min="0" max="1" step="1" value="0" aria-label="Позиция в треке"></div>' +
      '<div class="mini-bar m3-bar"><div class="mini-in">' +
      '<button type="button" class="mini-now" data-act="go-now" aria-label="Открыть экран «Сейчас играет»">' +
      '<span class="mini-art" aria-hidden="true">' + (t ? coverImg(t.album, true) : '<span class="cov-fallback"></span>') + '</span>' +
      '<span style="min-width:0;display:block"><span class="mini-t">' + esc(t ? t.title : 'Выберите трек') + '</span><span class="mini-a">' + esc(t ? t.artist : 'в «Поиске» или «Библиотеке»') + '</span></span></button>' +
      '<div class="mini-ctl">' +
      '<button class="hop ibtn" type="button" data-act="shuffle" aria-label="Случайный порядок" aria-pressed="' + P.shuffle + '">' + P3_SHUF(32) + '</button>' +
      '<button class="hop ibtn m3-skip" type="button" data-act="prev" aria-label="Предыдущий трек">' + P3_SKIPBTN(42, true) + '</button>' +
      '<button class="hop m3-playbtn" type="button" data-act="toggle-play" aria-label="Играть или пауза">' + P3_PLAYBTN(58) + '</button>' +
      '<button class="hop ibtn m3-skip" type="button" data-act="next" aria-label="Следующий трек">' + P3_SKIPBTN(42, false) + '</button>' +
      repBtn('ibtn', repIcon(32, 'p3')) +
      (t ? likeBtn(t.id, 'mini') : '') + '</div>' +
      '<div class="mini-vol">' + volHtml(false) + '</div>' +
      '</div></div></div>';
  }

  /* NOW PLAYING — composed like the pause menu: white side panel with a giant vertical word,
     the cover "falling" into the sea behind, the track as stacked menu options with the cursor on the title */
  function plaqueInnerP3() {
    const t = curTrack();
    const a = albumOf(t);
    const title = t ? t.title : 'Ничего не играет';
    return '<p class="n3-it" style="--r:-7deg;--x:26px;--c:#6ae6fb">' + esc(t ? t.artist : 'Выберите трек в «Поиске»') + '</p>' +
      '<h1 class="n3-title"><span class="n3-tin">' + P3_CUR + '<span class="n3-tt">' + esc(title) + '</span><span class="n3-rt" aria-hidden="true">' + esc(title) + '</span></span></h1>' +
      (a ? '<p class="n3-it" style="--r:-3deg;--x:10px;--c:#68fffc">' + esc(a.short || a.title) + '</p>' : '');
  }
  function coverBlockP3(anim) {
    const t = curTrack();
    return '<div class="n3-cover' + (anim ? ' drop' : '') + '"><span class="n3-cover-sh" aria-hidden="true"></span>' +
      '<div class="n3-cover-fr">' + (t ? coverImg(t.album, false) : '<span class="cov-fallback"></span>') + '</div></div>';
  }
  function lyricsBlockP3(anim) {
    const t = curTrack();
    const L = t ? S.lyrics.get(t.id) : null;
    return '<div class="n3-ly' + (anim ? ' ly-in' : '') + '"><section aria-label="Текст песни" class="ly-card n3-ly-card">' +
      '<div id="ly-body" style="position:absolute;inset:0">' + lyricsBody(L) + '</div>' +
      '<p class="ly-tag" id="ly-tag">' + lyricsTag(L) + '</p><p class="ly-src">тексты: lrclib.net</p></section></div>';
  }
  function viewNowP3() {
    const t = curTrack();
    const liked = !!(t && S.liked[t.id]);
    const lyBtn = '<button type="button" class="n3-act" id="np-lybtn" data-act="lyrics" aria-pressed="' + S.lyricsOn + '" style="--r:-5deg;--x:40px;--c:#29d3ff"><span>ТЕКСТ ПЕСНИ</span></button>';
    return '<div class="np n3">' +
      '<div class="n3-side slidel" aria-hidden="true"><span class="n3-side-num">00</span><span class="n3-side-t">ИГРАЕТ</span></div>' +
      '<main class="n3-main">' +
      '<div class="n3-left drop" style="animation-delay:.06s"><div id="np-art">' + (S.lyricsOn ? lyricsBlockP3(false) : coverBlockP3(false)) + '</div>' + nowLikeSlot(t, 'art') + '</div>' +
      '<div class="n3-right">' +
      '<div class="n3-tags pop" style="animation-delay:.15s"><span class="n3-pill">' + eqBars(4, '#0a1450', 3, 14) + '<span class="if-not-buffering">СЕЙЧАС ИГРАЕТ</span><span class="if-buffering blink">ЗАГРУЗКА…</span></span>' +
      '<span id="np-fav">' + (liked ? '<span class="pop" style="display:inline-block"><span class="np-fav" style="display:inline-block">В ИЗБРАННОМ</span></span>' : '') + '</span><span id="np-off"></span>' + nowLikeSlot(t, 'tags') + '</div>' +
      '<div class="n3-menu slide" id="np-plaque" style="animation-delay:.12s">' + plaqueInnerP3() + '</div>' +
      (PHONE ? '' : '<div class="n3-acts slide" style="animation-delay:.2s">' + lyBtn + '</div>') +
      '</div></main>' +
      // on the phone the lyrics button stands on the right, right above the queue (phone.css lines them up)
      '<div class="n3-help rise" style="animation-delay:.3s">' + (PHONE ? lyBtn : '') +
      '<button type="button" class="n3-next" data-act="queue-open" aria-expanded="false" aria-controls="queue" aria-label="Открыть очередь" style="--c:#68fffc">' +
      '<span class="n3-qw" aria-hidden="true">ОЧЕРЕДЬ</span><span class="n3-nt">Далее: <span id="np-next">' + esc(nextTitle()) + '</span></span></button>' +
      '<span class="n3-help-l"><i>Next</i></span></div>' +
      '<section class="np-band n3-band rise" aria-label="Управление воспроизведением" style="animation-delay:.24s"><div class="band-in n3-band-in">' +
      '<div class="n3-prog-row"><span class="n3-time" data-b="elapsed">0:00</span>' +
      '<div class="n3-prog"><div class="n3-prog-fr" aria-hidden="true"><div class="n3-prog-in"><div class="n3-prog-fill" data-b="fill"></div></div></div>' +
      '<span class="n3-prog-knob" data-b="thumb" aria-hidden="true"></span>' +
      '<input type="range" class="range" data-b="range" min="0" max="1" step="1" value="0" aria-label="Позиция в треке"></div>' +
      '<span class="n3-time r" data-b="total">0:00</span></div>' +
      '<div class="np-ctl-wrap"><div class="np-ctl n3-ctl">' +
      '<div class="pop" style="animation-delay:.33s"><button class="hop cbtn" type="button" data-act="shuffle" aria-label="Случайный порядок" aria-pressed="' + P.shuffle + '">' + P3_SHUF(46) + '</button></div>' +
      '<div class="pop" style="animation-delay:.36s"><button class="hop cbtn" type="button" data-act="prev" aria-label="Предыдущий трек">' + P3_SKIPBTN(62, true) + '</button></div>' +
      '<div class="pop" style="animation-delay:.39s"><button class="hop cbtn big" type="button" data-act="toggle-play" aria-label="Играть или пауза">' + P3_PLAYBTN(86) + '</button></div>' +
      '<div class="pop" style="animation-delay:.42s"><button class="hop cbtn" type="button" data-act="next" aria-label="Следующий трек">' + P3_SKIPBTN(62, false) + '</button></div>' +
      '<div class="pop" style="animation-delay:.44s">' + repBtn('cbtn', repIcon(46, 'p3')) + '</div>' +
      nowLikeSlot(t, 'ctl') +
      '</div><div class="np-vol"><div class="pop" style="animation-delay:.48s">' + volHtml(true) + '</div></div></div>' +
      '</div></section></div>';
  }

  /* QUEUE — a CONFIG-style list: cyan rows, the playing one is the white bar with a red edge */
  function renderQueueP3() {
    const el = $('#queue');
    const t = curTrack();
    const prevT = P.cur > 0 ? TR.get(P.queue[P.cur - 1]) : null;
    const up = P.queue.slice(P.cur + 1);
    const remaining = up.reduce((s, id) => s + ((TR.get(id) || {}).sec || 0), 0) + Math.max(0, currentDur() - currentPos());
    const meta = tracksWord(up.length) + ' впереди · ' + Math.round(remaining / 60) + ' мин';
    let rows = '';
    if (prevT) {
      rows += '<div class="q-row q3-prev" style="transition-delay:.04s"><button type="button" data-act="q-play" data-i="' + (P.cur - 1) + '" aria-label="Включить предыдущий: ' + esc(prevT.title) + '"><span class="q3-dot" aria-hidden="true"></span>' + esc(prevT.title) + '</button></div>';
    }
    rows += '<div class="q-row q3-cap" style="transition-delay:.08s"><span>Играет</span></div>';
    if (t) {
      rows += '<div class="q-row q3-cur" style="transition-delay:.12s">' +
        '<span class="q3-art" aria-hidden="true">' + coverImg(t.album, true) + '</span>' +
        '<span class="q3-txt">' + eqBars(3, '#ff1e2d', 4, 16) + '<span class="q3-t">' + esc(t.title) + '</span>' +
        '<span class="q3-s">' + esc(t.artist) + ' · <span data-b="elapsed">' + fmt(currentPos()) + '</span> / <span data-b="total">' + fmt(currentDur()) + '</span></span></span>' +
        (S.liked[t.id] ? '<span class="q3-heart" aria-hidden="true">' + heartP3(28, true) + '</span>' : '') + '</div>';
    }
    rows += '<div class="q-row q3-cap" style="transition-delay:.16s"><span>Далее</span></div>';
    const Q_MAX = 60;
    up.slice(0, Q_MAX).forEach((id, j) => {
      const i = P.cur + 1 + j;
      const q = TR.get(id);
      if (!q) return;
      rows += '<div class="q-row q-drow" style="transition-delay:' + (0.2 + Math.min(j, 12) * 0.04).toFixed(2) + 's">' +
        '<div class="q-item q3-item" data-qi="' + i + '">' +
        '<button type="button" class="q3-play" data-act="q-play" data-i="' + i + '" aria-label="Включить: ' + esc(q.title) + '">' +
        '<span class="q3-n">' + pad2(j + 1) + '</span><span class="q3-art" aria-hidden="true">' + coverImg(q.album, true) + '</span>' +
        '<span class="q3-txt"><span class="q3-t">' + esc(q.title) + '</span><span class="q3-s">' + esc(q.artist) + ' · ' + fmtDur(q.sec) + '</span></span>' +
        (S.liked[id] ? '<span class="q3-like" aria-hidden="true">' + heartP3(20, true) + '</span>' : '') + '</button>' +
        '<button class="grip" type="button" data-grip="' + i + '" aria-label="Переместить «' + esc(q.title) + '» в очереди: стрелки вверх и вниз"><span aria-hidden="true"></span><span aria-hidden="true"></span></button>' +
        '</div></div>';
    });
    if (up.length > Q_MAX) rows += '<p class="q-row q3-note">…и ещё ' + tracksWord(up.length - Q_MAX) + '</p>';
    if (!up.length) rows += '<p class="q-row q3-note">Это последний трек — дальше очередь начнётся сначала</p>';
    const scroll = el.querySelector('.q-body');
    const top = scroll ? scroll.scrollTop : 0;
    el.innerHTML =
      '<div class="q3-head">' +
      '<span class="q3-band" aria-hidden="true"></span><span class="q3-big" aria-hidden="true">ОЧЕРЕДЬ</span>' +
      '<h2 class="sr">Очередь</h2>' +
      '<p class="q3-src"><span class="pl-tab" aria-hidden="true"></span><span class="q3-src-t">' + esc(queueSourceLabel()) + '</span><span class="q3-meta">' + esc(meta) + '</span></p>' +
      '<button class="hop p3-x" type="button" data-act="queue-close" aria-label="Закрыть очередь">' + P3_SKIPBTN(42, false) + '</button>' +
      '</div>' +
      '<div class="q-body q3-body"><div class="q3-list">' + rows + '</div>' +
      '<div class="q3-help"><p>Нажмите на трек, чтобы включить его. Перетащите за полоски, чтобы поменять порядок.</p><span class="n3-help-l"><i>Guide</i></span></div></div>';
    const ns = el.querySelector('.q-body');
    if (ns) ns.scrollTop = top;
  }


  /* the theme picker — the first setting */
  const THEMES = [
    { id: 'p5', name: 'Persona 5', sub: 'Красно-чёрная, как бунтарская открытка' },
    { id: 'p3r', name: 'Persona 3 Reload', sub: 'Синяя и морская, как меню паузы' },
    { id: 'mf', name: 'Metaphor: ReFantazio', sub: 'Краска и антиква, веер меню паузы' }
  ];
  function themePreview(id) {
    if (id === 'p5') {
      return '<span class="tp tp5" aria-hidden="true"><i class="a"></i><i class="b"></i><i class="c"></i><b class="l1">P</b><b class="l2">5</b></span>';
    }
    if (id === 'mf') {
      return '<span class="tp tpm" aria-hidden="true"><i class="a"></i><i class="b"></i><i class="c"></i><b class="w">M</b></span>';
    }
    return '<span class="tp tp3" aria-hidden="true"><i class="a"></i><i class="b"></i><i class="c"></i><b class="w"></b><b class="t">P3R</b></span>';
  }
  function settingsP3Html() {
    return '<div class="s3-head">' +
      '<div class="s3-tabs" role="presentation"><span class="s3-tab is-on">Оформление</span></div>' +
      '<button class="hop p3-x" type="button" data-act="settings-close" aria-label="Закрыть настройки">' + P3_SKIPBTN(42, false) + '</button>' +
      '<h2 class="sr">Настройки</h2></div>' +
      '<div class="s-body s3-body"><div class="s3-in">' +
      '<p class="s3-cap s-row" style="transition-delay:.08s">Тема оформления</p>' +
      '<div class="s3-list" role="radiogroup" aria-label="Тема оформления">' +
      THEMES.map((th, i) => '<button type="button" role="radio" class="s3-row s-row' + (S.theme === th.id ? ' is-on' : '') + '" data-act="set-theme" data-theme-id="' + th.id + '" aria-checked="' + (S.theme === th.id) + '" style="transition-delay:' + (0.12 + i * 0.05).toFixed(2) + 's">' +
        themePreview(th.id) + '<span class="s3-row-t"><span class="s3-name">' + th.name + '</span><span class="s3-sub">' + th.sub + '</span></span>' +
        '<span class="s3-mark" aria-hidden="true"></span></button>').join('') +
      '</div>' +
      '<p class="s3-cap s-row" style="margin-top:26px;transition-delay:.2s">Звук</p>' +
      (LEVEL_OK ? '<button type="button" role="switch" class="s3-row s3-sw s-row' + (S.level ? ' is-on' : '') + '" data-act="level-toggle" aria-checked="' + S.level + '" style="transition-delay:.22s">' +
      '<span class="s3-row-t"><span class="s3-name">Выравнивать громкость</span><span class="s3-sub">Тихие и громкие альбомы звучат одинаково</span></span><span class="sw" aria-hidden="true"><i></i></span></button>' : '') +
      '<button type="button" role="switch" class="s3-row s3-sw s-row' + (S.xfade ? ' is-on' : '') + '" data-act="xfade-toggle" aria-checked="' + S.xfade + '" style="transition-delay:.24s">' +
      '<span class="s3-row-t"><span class="s3-name">Плавный переход</span><span class="s3-sub">Следующий трек начинается без паузы, под конец текущего</span></span><span class="sw" aria-hidden="true"><i></i></span></button>' +
      '<div style="flex:1"></div>' +
      '<div class="s3-help s-row" style="transition-delay:.24s"><p>Как будет выглядеть плеер?</p><span class="n3-help-l"><i>Guide</i></span>' +
      '<p class="n3-keys"><span class="k">Esc</span>Закрыть</p></div>' +
      '<p class="s3-ver s-row" style="transition-delay:.28s">PERSONAFY' + (appVersion ? ' · ВЕРСИЯ ' + esc(appVersion) : '') + '</p>' +
      '<span class="s3-band" aria-hidden="true"></span><span class="s3-big" aria-hidden="true">НАСТРОЙКИ</span></div></div>';
  }

  /* =====================================================================
     METAPHOR: REFANTAZIO theme — studied from the game's menus: the pause menu is a fan of
     high-contrast serif words (the chosen one black on a crimson brush stroke, with a little
     caption tag), list screens carry a huge serif heading cut by the screen edge, a small italic
     question, rows with diamond icons on thin rules and a paint stroke under the chosen row, and
     the field HUD shows month / big day / weekday / a time-of-day tag / the weather.
     Everything is drawn here: Playfair Display (OFL) and paint textures made from noise (tools/mf_textures.py).
     ===================================================================== */
  const MF_NAV = [['home', 'Главная', 'Недавнее и любимое'], ['search', 'Поиск', 'Альбомы и треки'], ['library', 'Библиотека', 'Любимые треки']];
  const MF_FAN = [[10, 46], [3, 0], [6, 22], [12, 70]];
  const MF_WIPE = { home: 'Главная', search: 'Поиск', library: 'Библиотека', now: 'Играет' };
  const MF_ASK = { 'Главная': 'Что послушаем сегодня?', 'Поиск': 'Какой альбом открыть?', 'Библиотека': 'Всё, что вам понравилось' };
  /* a word whose letters fall into place one after another; the first letter is a size up */
  function mfWord(label, d0) {
    return '<span class="mf-w" aria-hidden="true">' + [...label.toUpperCase()].map((ch, i) =>
      '<i' + (i === 0 ? ' class="b"' : '') + ' style="--d:' + (d0 + i * 0.024).toFixed(3) + 's">' + (ch === ' ' ? '&nbsp;' : esc(ch)) + '</i>').join('') + '</span>';
  }
  function mfItem(label, sub, attrs, k, cur) {
    const fan = MF_FAN[k];
    return '<button type="button" class="mf-it' + (cur ? ' is-cur' : '') + '" ' + attrs + ' style="--r:' + fan[0] + 'deg;--x:' + fan[1] + 'px">' +
      '<span class="mf-in">' + (cur ? '<span class="mf-br" aria-hidden="true"></span>' : '') + '<span class="sr">' + label + '</span>' + mfWord(label, 0.04 + k * 0.05) +
      (cur ? '<span class="mf-sub" aria-hidden="true">' + esc(sub.toUpperCase()) + '</span>' : '') + '</span></button>';
  }
  function mfNavHtml() {
    return '<div class="mfm">' + MF_NAV.map((n, k) => mfItem(n[1], n[2], 'data-nav="' + n[0] + '"' + (S.view === n[0] ? ' aria-current="page"' : ''), k, S.view === n[0])).join('') +
      mfItem('Настройки', 'Тема и звук', 'data-act="settings-open" aria-controls="settings" aria-expanded="' + !!S.sOpen + '"', 3, false) + '</div>';
  }
  function mfTitle(sr) {
    const w = sr.toUpperCase();
    return '<h1 class="mf-title" style="--len:' + w.length + '"><span class="sr">' + sr + '</span>' +
      '<span class="mt-big" aria-hidden="true">' + [...w].map((ch, i) => '<i style="--d:' + (0.02 + i * 0.03).toFixed(2) + 's">' + esc(ch) + '</i>').join('') + '</span>' +
      '<span class="mt-ask" aria-hidden="true">' + esc(MF_ASK[sr] || '') + '</span></h1>';
  }
  function mfLabel(text, id, delay, extra) {
    return '<div class="rise mf-label" style="animation-delay:' + delay + 's;' + (extra || '') + '"><i class="mf-dia" aria-hidden="true"></i>' +
      '<h2 id="' + id + '">' + text.charAt(0) + text.slice(1).toLowerCase() + '</h2><span class="ml-line" aria-hidden="true"></span></div>';
  }
  function mfDecor() {
    return '<div class="decor-sticky" aria-hidden="true"><div class="decor-in mf-bg">' +
      '<i class="mf-p1"></i><i class="mf-p2"></i><i class="mf-ring r1"></i><i class="mf-ring r2"></i><i class="mf-sp"></i><i class="mf-sc"></i><i class="mf-gr"></i><i class="mf-vig"></i></div></div>';
  }
  /* the field HUD: month, big day, weekday, a time-of-day tag, the weather — and the money/mag-like stats plate */
  function mfDateHtml() {
    const d = new Date();
    const h = d.getHours();
    const tod = p5TimeOfDay(h);
    const sky = skyKind(h);
    const temp = WX && typeof WX.temp === 'number' ? Math.round(WX.temp) : null;
    const label = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }) + ', ' + tod.toLowerCase() +
      (WX ? ', ' + SKY_WORD[sky] : '') + (temp != null ? ', ' + temp + ' °C' : '');
    return '<div class="mf-date" id="mf-date" role="img" aria-label="' + esc(label) + '">' +
      '<span class="md-row" aria-hidden="true"><span class="md-m">' + pad2(d.getMonth() + 1) + '</span><span class="md-d">' + pad2(d.getDate()) + '</span></span>' +
      '<span class="md-w" aria-hidden="true">' + P5_WD[d.getDay()] + '</span>' +
      '<span class="md-row2" aria-hidden="true"><span class="md-t">' + tod + '</span>' + skyHtml(sky, true) +
      (temp != null ? '<span class="md-tc">' + (temp > 0 ? '+' : temp < 0 ? '−' : '') + Math.abs(temp) + '°C</span>' : '') + '</span></div>';
  }
  function mfStatsHtml() {
    const n = CAT.tracks.length;
    const liked = likedIds().length;
    return '<div class="md-stats" id="mf-stats"><p class="ms-row"><span class="ms-k">Треков</span><span class="ms-v">' + n + '</span></p>' +
      '<p class="ms-row"><span class="ms-k">Любимых</span><span class="ms-v">' + liked + '</span></p></div>';
  }
  const mfHudHtml = () => '<div class="mf-hud rise" style="animation-delay:.2s">' + mfDateHtml() + mfStatsHtml() + '</div>';
  function refreshMFDate() {
    const el = $('#mf-date');
    if (el && isMF()) el.outerHTML = mfDateHtml();
  }

  /* icons: thin serif-like strokes, a paper diamond for play, a heart with a little diamond when liked */
  const MF_CHEV = (s, flip) => '<svg viewBox="0 0 48 48" width="' + s + '" height="' + s + '" aria-hidden="true"' + (flip ? ' style="transform:scaleX(-1)"' : '') + '>' +
    '<polygon points="6,9 23,24 6,39 10,24" fill="#f4efe6"></polygon><polygon points="22,9 39,24 22,39 26,24" fill="#f4efe6"></polygon></svg>';
  const MF_SKIP = (s, prev) => '<svg viewBox="0 0 48 48" width="' + s + '" height="' + s + '" aria-hidden="true"' + (prev ? ' style="transform:scaleX(-1)"' : '') + '>' +
    '<polygon points="5,9 21,24 5,39 9,24" fill="#f4efe6"></polygon><polygon points="20,9 36,24 20,39 24,24" fill="#f4efe6"></polygon><path d="M41.5 10 V38" stroke="#f4efe6" style="stroke-width:2.6"></path></svg>';
  const MF_PLAY = (s) => '<span class="mf-play" aria-hidden="true" style="width:' + s + 'px;height:' + s + 'px"><svg viewBox="0 0 64 64" width="' + s + '" height="' + s + '">' +
    '<circle cx="32" cy="32" r="30.5" fill="none" stroke="#f4efe6" style="stroke-width:1.3"></circle><circle class="mfp-ring" cx="32" cy="32" r="26" fill="none" stroke="#f4efe6" style="stroke-width:.9;stroke-dasharray:1.6 3.2"></circle>' +
    '<rect class="mfp-dia" x="17.5" y="17.5" width="29" height="29" transform="rotate(45 32 32)" fill="#f4efe6"></rect>' +
    '<polygon class="ico-play" points="28,23 41,32 28,41" fill="#0d1012"></polygon><g class="ico-pause" fill="#0d1012"><rect x="25.5" y="23.5" width="4.6" height="17"></rect><rect x="33.9" y="23.5" width="4.6" height="17"></rect></g></svg></span>';
  const MF_SHUF = (s) => '<svg viewBox="0 0 48 48" width="' + s + '" height="' + s + '" aria-hidden="true"><path d="M6 15 H13 L31 33 H39 M6 33 H13 L31 15 H39" fill="none" style="stroke:var(--sh);stroke-width:2.6;stroke-linejoin:miter"></path>' +
    '<polygon points="35,10 42,15 35,20" style="fill:var(--sh)"></polygon><polygon points="35,28 42,33 35,38" style="fill:var(--sh)"></polygon></svg>';
  const heartMF = (s, on) => '<svg class="hm" viewBox="0 0 48 48" width="' + s + '" height="' + s + '" style="overflow:visible;display:block">' +
    '<path d="' + P3_HEART_D + '" fill="' + (on ? '#d5274f' : 'none') + '" stroke="#f4efe6" style="stroke-width:' + (on ? 2.2 : 2.6) + ';stroke-linejoin:round"></path>' +
    (on ? '<path d="M24 15.5 L28.5 22 L24 28.5 L19.5 22 Z" fill="#f4efe6"></path>' : '') + '</svg>';
  const MF_CLOSE = (act, label) => '<button class="mf-x" type="button" data-act="' + act + '" aria-label="' + label + '"><span class="mfx-br" aria-hidden="true"></span><span class="mfx-t" aria-hidden="true">Закрыть</span>' + MF_CHEV(20) + '</button>';

  function miniMF(t, first) {
    return '<div class="m5f' + (first ? ' rise' : '') + '" style="animation-delay:.45s">' +
      '<div class="mini-prog mf-prog"><div class="mfp-track" aria-hidden="true"><div class="mfp-fill" data-b="fill"></div></div>' +
      '<span class="mfp-knob" data-b="thumb" aria-hidden="true"></span>' +
      '<span class="mp-time l" data-b="elapsed-t" aria-hidden="true"></span><span class="mp-time r" data-b="total-t" aria-hidden="true"></span>' +
      '<input type="range" class="range" data-b="range" min="0" max="1" step="1" value="0" aria-label="Позиция в треке"></div>' +
      '<div class="mini-bar mf-bar"><div class="mini-in">' +
      '<button type="button" class="mini-now" data-act="go-now" aria-label="Открыть экран «Сейчас играет»">' +
      '<span class="mini-art" aria-hidden="true">' + (t ? coverImg(t.album, true) : '<span class="cov-fallback"></span>') + '</span>' +
      '<span style="min-width:0;display:block"><span class="mini-t">' + esc(t ? t.title : 'Выберите трек') + '</span><span class="mini-a">' + esc(t ? t.artist : 'в «Поиске» или «Библиотеке»') + '</span></span></button>' +
      '<div class="mini-ctl">' +
      '<button class="hop ibtn" type="button" data-act="shuffle" aria-label="Случайный порядок" aria-pressed="' + P.shuffle + '">' + MF_SHUF(30) + '</button>' +
      '<button class="hop ibtn" type="button" data-act="prev" aria-label="Предыдущий трек">' + MF_SKIP(28, true) + '</button>' +
      '<button class="hop mf-playbtn" type="button" data-act="toggle-play" aria-label="Играть или пауза">' + MF_PLAY(62) + '</button>' +
      '<button class="hop ibtn" type="button" data-act="next" aria-label="Следующий трек">' + MF_SKIP(28, false) + '</button>' +
      repBtn('ibtn', repIcon(30, 'mf')) +
      (t ? likeBtn(t.id, 'mini') : '') + '</div>' +
      '<div class="mini-vol">' + volHtml(false) + '</div>' +
      '</div></div></div>';
  }

  /* NOW PLAYING — composed like the pause menu: the cover over a paint smear, the track as stacked
     serif lines with the title on the crimson stroke, a huge page number with its vertical caption */
  function plaqueInnerMF() {
    const t = curTrack();
    const a = albumOf(t);
    if (PHONE) {
      return '<h1 class="mfn-title"><span class="mfn-br" aria-hidden="true"></span><span class="mfn-tt">' + esc(t ? t.title : 'Ничего не играет') + '</span></h1>' +
        '<p class="mfn-sub"><span class="mfn-sa">' + esc(t ? t.artist : 'Выберите трек в «Поиске»') + '</span>' +
        (a ? '<i class="mf-dia" aria-hidden="true"></i><span class="mfn-sl">' + esc(a.short || a.title) + '</span>' : '') + '</p>';
    }
    return '<p class="mfn-it mfn-ar">' + esc(t ? t.artist : 'Выберите трек в «Поиске»') + '</p>' +
      '<h1 class="mfn-title"><span class="mfn-br" aria-hidden="true"></span><span class="mfn-tt">' + esc(t ? t.title : 'Ничего не играет') + '</span></h1>' +
      (a ? '<p class="mfn-it mfn-al"><i class="mf-dia" aria-hidden="true"></i>' + esc(a.short || a.title) + '</p>' : '');
  }
  function coverBlockMF(anim) {
    const t = curTrack();
    return '<div class="mfn-cover' + (anim ? ' drop' : '') + '"><span class="mfn-paint" aria-hidden="true"></span>' +
      '<div class="mfn-fr">' + (t ? coverImg(t.album, false) : '<span class="cov-fallback"></span>') + '</div></div>';
  }
  function lyricsBlockMF(anim) {
    const t = curTrack();
    const L = t ? S.lyrics.get(t.id) : null;
    return '<div class="mfn-ly' + (anim ? ' ly-in' : '') + '"><span class="mfn-paint" aria-hidden="true"></span><section aria-label="Текст песни" class="ly-card mfn-ly-card">' +
      '<div id="ly-body" style="position:absolute;inset:0">' + lyricsBody(L) + '</div>' +
      '<p class="ly-tag" id="ly-tag">' + lyricsTag(L) + '</p><p class="ly-src">тексты: lrclib.net</p></section></div>';
  }
  function viewNowMF() {
    const t = curTrack();
    const liked = !!(t && S.liked[t.id]);
    const ctl = (d, html) => '<div class="pop" style="animation-delay:' + d + 's">' + html + '</div>';
    return '<div class="np mfn">' +
      '<div class="mfn-num" aria-hidden="true"><b>04</b><i>Играет</i></div>' +
      '<main class="mfn-main">' +
      '<div class="mfn-left drop" style="animation-delay:.06s"><div id="np-art">' + (S.lyricsOn ? lyricsBlockMF(false) : coverBlockMF(false)) + '</div>' + nowLikeSlot(t, 'art') + '</div>' +
      '<div class="mfn-right">' +
      '<p class="mfn-ask rise" style="animation-delay:.08s">Что сейчас звучит?</p>' +
      '<div class="mfn-tags pop" style="animation-delay:.15s"><span class="mfn-pill">' + eqBars(4, '#0d1012', 3, 13) + '<span class="if-not-buffering">СЕЙЧАС ИГРАЕТ</span><span class="if-buffering blink">ЗАГРУЗКА…</span></span>' +
      '<span id="np-fav">' + (liked ? '<span class="pop" style="display:inline-block"><span class="np-fav" style="display:inline-block">В ИЗБРАННОМ</span></span>' : '') + '</span><span id="np-off"></span>' + nowLikeSlot(t, 'tags') + '</div>' +
      '<div class="mfn-menu slide" id="np-plaque" style="animation-delay:.12s">' + plaqueInnerMF() + '</div>' +
      '<div class="mfn-acts slide" style="animation-delay:.2s">' +
      '<button type="button" class="mfn-act" id="np-lybtn" data-act="lyrics" aria-pressed="' + S.lyricsOn + '"><span class="mfn-ab" aria-hidden="true"></span><i class="mf-dia" aria-hidden="true"></i><span class="mfn-at">Текст песни</span></button>' +
      '<button type="button" class="mfn-act mfn-q" data-act="queue-open" aria-expanded="false" aria-controls="queue"><span class="mfn-ab" aria-hidden="true"></span><i class="mf-dia" aria-hidden="true"></i><span class="mfn-at">Очередь</span>' +
      '<span class="mfn-nt">Далее: <span id="np-next">' + esc(nextTitle()) + '</span></span></button>' +
      '</div></div></main>' +
      '<section class="np-band mfn-band rise" aria-label="Управление воспроизведением" style="animation-delay:.24s"><div class="band-in mfn-band-in">' +
      '<div class="mfn-prog-row"><span class="mfn-time" data-b="elapsed">0:00</span>' +
      '<div class="mfn-prog"><div class="mfp-track" aria-hidden="true"><div class="mfp-fill" data-b="fill"></div></div>' +
      '<span class="mfp-knob" data-b="thumb" aria-hidden="true"></span>' +
      '<input type="range" class="range" data-b="range" min="0" max="1" step="1" value="0" aria-label="Позиция в треке"></div>' +
      '<span class="mfn-time r" data-b="total">0:00</span></div>' +
      '<div class="np-ctl-wrap"><div class="np-ctl mfn-ctl">' +
      ctl(0.33, '<button class="hop cbtn" type="button" data-act="shuffle" aria-label="Случайный порядок" aria-pressed="' + P.shuffle + '">' + MF_SHUF(42) + '</button>') +
      ctl(0.36, '<button class="hop cbtn" type="button" data-act="prev" aria-label="Предыдущий трек">' + MF_SKIP(44, true) + '</button>') +
      ctl(0.39, '<button class="hop cbtn big" type="button" data-act="toggle-play" aria-label="Играть или пауза">' + MF_PLAY(94) + '</button>') +
      ctl(0.42, '<button class="hop cbtn" type="button" data-act="next" aria-label="Следующий трек">' + MF_SKIP(44, false) + '</button>') +
      ctl(0.44, repBtn('cbtn', repIcon(42, 'mf'))) +
      nowLikeSlot(t, 'ctl') +
      '</div><div class="np-vol"><div class="pop" style="animation-delay:.48s">' + volHtml(true) + '</div></div></div>' +
      '</div></section></div>';
  }

  /* QUEUE — an item-menu list: a small question, rows stepping down to the right on thin rules,
     the playing track on the crimson stroke, and the panel's name huge at the bottom */
  function renderQueueMF() {
    const el = $('#queue');
    const t = curTrack();
    const prevT = P.cur > 0 ? TR.get(P.queue[P.cur - 1]) : null;
    const up = P.queue.slice(P.cur + 1);
    const remaining = up.reduce((s, id) => s + ((TR.get(id) || {}).sec || 0), 0) + Math.max(0, currentDur() - currentPos());
    const meta = tracksWord(up.length) + ' впереди · ' + Math.round(remaining / 60) + ' мин';
    let rows = '';
    if (prevT) {
      rows += '<div class="q-row qm-prev" style="transition-delay:.04s"><button type="button" data-act="q-play" data-i="' + (P.cur - 1) + '" aria-label="Включить предыдущий: ' + esc(prevT.title) + '"><i class="mf-dia" aria-hidden="true"></i>' + esc(prevT.title) + '</button></div>';
    }
    rows += '<div class="q-row qm-cap" style="transition-delay:.08s"><span>Играет</span></div>';
    if (t) {
      rows += '<div class="q-row" style="transition-delay:.12s"><div class="mfr mfq is-cur">' + mfPlate('Играет') +
        '<span class="mfq-in"><span class="mfr-txt"><span class="row-t">' + eqBars(3, '#ffffff', 3, 14) + '<span class="mfr-tt">' + esc(t.title) + '</span></span>' +
        '<span class="mfr-bars"><span class="mfr-hp"><i>' + esc(t.artist) + '</i></span><span class="mfr-mp mfq-tm"><i><span data-b="elapsed">' + fmt(currentPos()) + '</span> / <span data-b="total">' + fmt(currentDur()) + '</span></i></span></span></span>' +
        (S.liked[t.id] ? '<span class="qm-heart" aria-hidden="true">' + heartMF(24, true) + '</span>' : '') + '</span>' +
        mfCover(t) + '</div></div>';
    }
    rows += '<div class="q-row qm-cap" style="transition-delay:.16s"><span>Далее</span></div>';
    const Q_MAX = 60;
    up.slice(0, Q_MAX).forEach((id, j) => {
      const i = P.cur + 1 + j;
      const q = TR.get(id);
      if (!q) return;
      rows += '<div class="q-row q-drow" style="--ind:' + (S.liked[id] ? 20 : 0) + 'px;transition-delay:' + (0.2 + Math.min(j, 12) * 0.04).toFixed(2) + 's">' +
        '<div class="q-item qm-item mfr mfq" data-qi="' + i + '">' + mfPlate(mfCap(albumOf(q))) +
        '<button type="button" class="qm-play mfq-in" data-act="q-play" data-i="' + i + '" aria-label="Включить: ' + esc(q.title) + '">' +
        '<span class="mfr-txt"><span class="row-t"><span class="mfr-tt">' + esc(q.title) + '</span></span>' +
        '<span class="mfr-bars"><span class="mfr-hp"><i>' + esc(q.artist) + '</i></span><span class="mfr-mp"><i>' + fmtDur(q.sec) + '</i></span>' +
        '<span class="mfr-lv"><small>№</small><b>' + pad2(j + 1) + '</b></span></span></span>' +
        (S.liked[id] ? '<span class="qm-like" aria-hidden="true">' + heartMF(18, true) + '</span>' : '') + '</button>' +
        '<button class="grip" type="button" data-grip="' + i + '" aria-label="Переместить «' + esc(q.title) + '» в очереди: стрелки вверх и вниз"><span aria-hidden="true"></span><span aria-hidden="true"></span></button>' +
        mfCover(q) + '</div></div>';
    });
    if (up.length > Q_MAX) rows += '<p class="q-row qm-note">…и ещё ' + tracksWord(up.length - Q_MAX) + '</p>';
    if (!up.length) rows += '<p class="q-row qm-note">Это последний трек — дальше очередь начнётся сначала</p>';
    const scroll = el.querySelector('.q-body');
    const top = scroll ? scroll.scrollTop : 0;
    el.innerHTML =
      '<span class="qm-paint" aria-hidden="true"></span><span class="qm-big" aria-hidden="true">ОЧЕРЕДЬ</span>' +
      '<div class="qm-head"><h2 class="sr">Очередь</h2><p class="qm-ask">Что заиграет дальше?</p>' +
      '<p class="qm-src"><i class="mf-dia" aria-hidden="true"></i><span class="qm-src-t">' + esc(queueSourceLabel()) + '</span><span class="qm-meta">' + esc(meta) + '</span></p>' +
      MF_CLOSE('queue-close', 'Закрыть очередь') + '</div>' +
      '<div class="q-body qm-body"><div class="qm-list">' + rows + '</div>' +
      '<p class="qm-help">Нажмите на трек, чтобы включить его. Перетащите за полоски, чтобы поменять порядок.</p></div>';
    const ns = el.querySelector('.q-body');
    if (ns) ns.scrollTop = top;
  }

  function settingsMFHtml() {
    return '<span class="qm-paint" aria-hidden="true"></span><span class="qm-big sm-big" aria-hidden="true">НАСТРОЙКИ</span>' +
      '<div class="qm-head"><h2 class="sr">Настройки</h2><p class="qm-ask">Как всё устроить?</p>' + MF_CLOSE('settings-close', 'Закрыть настройки') + '</div>' +
      '<div class="s-body sm-body"><div class="sm-in">' +
      '<p class="sm-cap s-row" style="transition-delay:.08s"><i class="mf-dia" aria-hidden="true"></i>Тема оформления</p>' +
      '<div class="sm-list" role="radiogroup" aria-label="Тема оформления">' +
      THEMES.map((th, i) => '<button type="button" role="radio" class="sm-row s-row' + (S.theme === th.id ? ' is-on' : '') + '" data-act="set-theme" data-theme-id="' + th.id + '" aria-checked="' + (S.theme === th.id) + '" style="--k:' + i + ';transition-delay:' + (0.12 + i * 0.05).toFixed(2) + 's">' +
        '<span class="sm-br" aria-hidden="true"></span>' + themePreview(th.id) + '<span class="sm-t"><span class="sm-name">' + th.name + '</span><span class="sm-sub">' + th.sub + '</span></span>' +
        '<i class="mf-dia sm-mark" aria-hidden="true"></i></button>').join('') +
      '</div>' +
      '<p class="sm-cap s-row" style="margin-top:30px;transition-delay:.24s"><i class="mf-dia" aria-hidden="true"></i>Звук</p>' +
      (LEVEL_OK ? '<button type="button" role="switch" class="sm-row sm-sw s-row' + (S.level ? ' is-on' : '') + '" data-act="level-toggle" aria-checked="' + S.level + '" style="transition-delay:.27s">' +
      '<span class="sm-t"><span class="sm-name">Выравнивать громкость</span><span class="sm-sub">Тихие и громкие альбомы звучат одинаково</span></span><span class="sw" aria-hidden="true"><i></i></span></button>' : '') +
      '<button type="button" role="switch" class="sm-row sm-sw s-row' + (S.xfade ? ' is-on' : '') + '" data-act="xfade-toggle" aria-checked="' + S.xfade + '" style="transition-delay:.29s">' +
      '<span class="sm-t"><span class="sm-name">Плавный переход</span><span class="sm-sub">Следующий трек начинается без паузы, под конец текущего</span></span><span class="sw" aria-hidden="true"><i></i></span></button>' +
      '<div style="flex:1"></div>' +
      '<p class="sm-ver s-row" style="transition-delay:.3s">Personafy' + (appVersion ? ' · версия ' + esc(appVersion) : '') + '</p></div></div>';
  }

  function dlSlot(id) {
    const st = S.dl.get(id);
    if (st && st.error) return '<span class="dl-err">ОШИБКА</span>';
    if (st) {
      return '<span class="dl-bar" aria-hidden="true"><span><span style="width:' + (st.pct || 0) + '%"></span></span></span><span class="dl-pct">' + (st.queued ? 'ЖДЁТ' : (st.pct || 0) + '%') + '</span>';
    }
    if (S.downloads.has(id)) return '<span class="dl-done">' + DL_ICON('#0b0b0b', 14) + 'СКАЧАН</span>';
    return '';
  }

  /* (measured: skipping off-screen rows with content-visibility caused hitches, so rows are rendered plainly) */
  const chunked = (rows) => rows.join('');
  /* Metaphor: a track row is drawn like the party list — a white-framed dark plate with a rounded end,
     the caption in the scooped-out corner, two outlined bars under the name (artist, length), "№" in the LV slot
     and the cover as the round emblem; the playing row turns red under a brush stroke */
  /* the track's cover sits where the game puts the round emblem — as a plain square, no ring */
  const mfCover = (t) => '<span class="mfr-cv" aria-hidden="true">' + coverImg(t.album, true) + '</span>';
  /* the caption has to fit the scoop: long album names are shortened the way fans write them (P3R, P5R, P4G…) */
  function mfCap(a) {
    let s = a ? String(a.short || a.title).replace(/\s*original soundtrack\s*/i, ' ').trim() : '';
    const fits = (x) => x.length <= 13;
    if (fits(s)) return s;
    s = s.replace(/^persona\s+(\d)/i, 'P$1').replace(/\s*-\s*episode\s+/i, ' · ');
    if (fits(s)) return s;
    s = s.replace(/^P(\d)\s+(reload|royal)\b/i, 'P$1R').replace(/^P(\d)\s+golden\b/i, 'P$1G').replace(/^P(\d)\s+dancing( all night| in moonlight| in starlight)?/i, 'P$1D');
    if (fits(s)) return s;
    let out = '';
    for (const w of s.split(/\s+/)) {
      const nx = out ? out + ' ' + w : w;
      if (nx.length > 13) break;
      out = nx;
    }
    return (out || s.slice(0, 12)).replace(/[\s·-]+$/, '');
  }
  const mfPlate = (cap) => '<span class="mfr-fr" aria-hidden="true"></span><span class="mfr-br" aria-hidden="true"></span><span class="mfr-pn" aria-hidden="true"></span><span class="mfr-sc" aria-hidden="true"></span>' +
    '<span class="mfr-cap" aria-hidden="true"><b>' + esc(cap.charAt(0).toUpperCase()) + '</b>' + esc(cap.slice(1).toUpperCase()) + '</span>';
  function rowHtmlMF(t, i, listKey, o) {
    const isCur = t.id === curId();
    const a = albumOf(t);
    const num = o.num != null ? o.num : i + 1;
    const cap = mfCap(a);
    const delay = (0.06 + Math.min(i, 12) * 0.03).toFixed(2);
    /* only liked tracks step out to the right */
    return '<div class="row-wrap slide' + (S.liked[t.id] ? ' mf-lk' : '') + '" data-row="' + esc(t.id) + '" style="animation-delay:' + delay + 's">' +
      '<div class="row mfr' + (isCur ? ' is-cur' : '') + (o.off ? ' row-off' : '') + '" data-cur-id="' + esc(t.id) + '">' +
      mfPlate(cap) +
      '<div class="row-in">' + (o.select || '') +
      '<button type="button" class="row-play" data-act="play" data-list="' + listKey + '" data-i="' + i + '" data-id="' + esc(t.id) + '" aria-label="Играть: ' + esc(t.title) + '">' +
      '<span class="mfr-txt"><span class="row-t">' + eqBars(3, '#ffffff', 3, 14) + '<span class="mfr-tt">' + esc(t.title) + '</span></span>' +
      '<span class="mfr-bars"><span class="mfr-hp"><i>' + esc(t.artist) + '</i></span><span class="mfr-mp"><i class="row-d">' + fmtDur(t.sec) + '</i></span>' +
      '<span class="mfr-lv" aria-hidden="true"><small>№</small><b>' + pad2(num) + '</b></span></span></span>' +
      '<span class="dl-slot" data-dl="' + esc(t.id) + '">' + dlSlot(t.id) + '</span></button>' +
      '<button type="button" class="hop row-more" data-act="track-menu" data-list="' + listKey + '" data-i="' + i + '" data-id="' + esc(t.id) + '" aria-haspopup="menu" aria-expanded="false" aria-label="В очередь и другие действия: ' + esc(t.title) + '" title="В очередь">' + QADD_ICON + '</button>' +
      likeBtn(t.id, 'row') + mfCover(t) +
      '</div></div></div>';
  }
  function rowHtml(t, i, listKey, o) {
    o = o || {};
    if (isMF()) return rowHtmlMF(t, i, listKey, o);
    const isCur = t.id === curId();
    const a = albumOf(t);
    const indent = i % 2 === 0 ? 0 : 40;
    const rot = i % 2 === 0 ? -0.8 : 0.8;
    const coverRot = i % 2 === 0 ? -5 : 4;
    const delay = (0.06 + Math.min(i, 12) * 0.03).toFixed(2);
    const num = o.num != null ? o.num : i + 1;
    const sub = t.artist + (o.withAlbum && a ? ' · ' + a.short : '');
    return '<div class="row-wrap slide" data-row="' + esc(t.id) + '" style="--k:' + (i % 6) + ';margin-left:' + indent + 'px;animation-delay:' + delay + 's">' +
      '<div class="row' + (isCur ? ' is-cur' : '') + (o.off ? ' row-off' : '') + '" data-cur-id="' + esc(t.id) + '" style="rotate:' + rot + 'deg">' +
      '<span class="r-sh" aria-hidden="true"></span><span class="r-ol" aria-hidden="true"></span><span class="r-bg" aria-hidden="true"></span>' +
      '<div class="row-in">' + (o.select || '') +
      '<button type="button" class="row-play" data-act="play" data-list="' + listKey + '" data-i="' + i + '" data-id="' + esc(t.id) + '" aria-label="Играть: ' + esc(t.title) + '">' +
      '<span class="row-num">' + eqBars(4, '#ff2b3a', 5, 22) + '<span class="n">' + pad2(num) + '</span></span>' +
      '<span class="row-art" aria-hidden="true" style="rotate:' + coverRot + 'deg">' + coverImg(t.album, true) + '</span>' +
      '<span class="row-txt"><span class="row-t">' + esc(t.title) + '</span><span class="row-s">' + esc(sub) + '</span></span>' +
      '<span class="dl-slot" data-dl="' + esc(t.id) + '">' + dlSlot(t.id) + '</span>' +
      '<span class="row-d">' + fmtDur(t.sec) + '</span></button>' +
      '<button type="button" class="hop row-more" data-act="track-menu" data-list="' + listKey + '" data-i="' + i + '" data-id="' + esc(t.id) + '" aria-haspopup="menu" aria-expanded="false" aria-label="В очередь и другие действия: ' + esc(t.title) + '" title="В очередь">' + QADD_ICON + '</button>' +
      likeBtn(t.id, 'row') + '</div></div></div>';
  }

  /* ---------- HOME ---------- */
  function uniq(a) {
    return a.filter((x, i) => a.indexOf(x) === i);
  }
  function homeRecentHtml() {
    /* Metaphor: the field HUD takes the fifth column, so four cards */
    const mf = isMF();
    const hud = mf ? mfHudHtml() : '';
    /* P3R: the date sits at the end of the section caption's line, in the flow, so it can never cover the cards */
    const head = (lbl) => isP3() ? '<div class="p3-rhead">' + lbl + p3DateHtml() + '</div>' : hud + lbl;
    const recent = uniq(S.recent).map((id) => TR.get(id)).filter(Boolean).slice(0, mf ? 4 : 5);
    const rots = [-3, 2, -2, 3, -1];
    const cid = curId();
    if (recent.length) {
      return head(labelA('НЕДАВНИЕ', 'recent-h', 0.25)) + '<div class="home-row">' + recent.map((t, i) =>
        '<button type="button" class="card' + (t.id === cid ? ' is-cur' : '') + '" data-act="home-play" data-id="' + esc(t.id) + '" data-cur-id="' + esc(t.id) + '" aria-label="Играть: ' + esc(t.title) + '">' +
        '<div class="rise" style="animation-delay:' + (0.18 + i * 0.045).toFixed(2) + 's"><div class="art" style="position:relative;transform:rotate(' + rots[i] + 'deg)">' +
        '<div class="c-sh" aria-hidden="true" style="position:absolute;inset:0;background:#d4141a;transform:translate(9px,9px)"></div>' +
        '<div class="card-frame"><div class="sq">' + coverImg(t.album, false) + '</div></div>' +
        '<div class="cur-badge" aria-hidden="true">' + eqBars(3, '#ffffff', 4, 18) + '</div></div>' +
        '<p class="card-t">' + esc(t.title) + '</p><p class="card-s">' + esc(t.artist) + '</p></div></button>').join('') + '</div>';
    }
    return head(labelA('АЛЬБОМЫ', 'recent-h', 0.25)) + '<div class="home-row">' + CAT.albums.slice(0, mf ? 4 : 5).map((a, i) =>
      '<button type="button" class="card" data-act="open-album" data-id="' + esc(a.id) + '" aria-label="Открыть альбом ' + esc(a.title) + '">' +
      '<div class="rise" style="animation-delay:' + (0.18 + i * 0.045).toFixed(2) + 's"><div class="art" style="position:relative;transform:rotate(' + rots[i] + 'deg)">' +
      '<div class="c-sh" aria-hidden="true" style="position:absolute;inset:0;background:#d4141a;transform:translate(9px,9px)"></div>' +
      '<div class="card-frame"><div class="sq">' + coverImg(a.id, false) + '</div></div></div>' +
      '<p class="card-t">' + esc(a.short || a.title) + '</p><p class="card-s">' + esc(tracksWord(a.tracks.length)) + '</p></div></button>').join('') + '</div>';
  }
  function homeTopHtml() {
    const tops = Object.keys(S.plays).filter((id) => S.plays[id] > 0 && TR.has(id)).sort((a, b) => S.plays[b] - S.plays[a]).slice(0, 3);
    let body;
    if (!tops.length) {
      body = '<div><div class="pop" style="display:inline-block;max-width:640px;animation-delay:.3s"><p class="hint">Слушайте музыку — здесь появятся треки, которые вы включаете чаще всего.</p></div></div>';
    } else {
      const numStyle = [
        'color:#ffffff;background:#d4141a;padding:0 16px;transform:rotate(-8deg) skewX(-8deg)',
        'color:#0b0b0b;background:#ffffff;padding:0 14px;transform:rotate(6deg) skewX(-8deg)',
        'color:#ffffff;background:#0b0b0b;border:3px solid #ffffff;padding:0 14px;transform:rotate(-5deg) skewX(-8deg)'
      ];
      const clips = ['polygon(0% 8%, 100% 0%, 97% 100%, 2% 92%)', 'polygon(1% 0%, 99% 9%, 100% 92%, 0% 100%)', 'polygon(0% 0%, 98% 7%, 100% 100%, 3% 91%)'];
      const trot = [4, -3, 5];
      body = '<div style="display:flex;flex-wrap:wrap;gap:28px">' + tops.map((id, i) => {
        const t = TR.get(id);
        return '<button type="button" class="rank" data-act="home-play" data-id="' + esc(id) + '" aria-label="Играть: ' + esc(t.title) + '"><div class="rise" style="position:relative;animation-delay:' + (0.3 + i * 0.05).toFixed(2) + 's">' +
          '<span class="rk-ol" aria-hidden="true" style="position:absolute;inset:0;background:#ffffff;clip-path:' + clips[i] + '"></span>' +
          '<span class="rk-bg" aria-hidden="true" style="position:absolute;inset:5px;background:#0b0b0b;clip-path:' + clips[i] + '"></span>' +
          '<div style="position:relative;display:flex;align-items:center;gap:20px;padding:20px 30px 20px 22px">' +
          '<span class="rank-num" style="' + numStyle[i] + '">' + (i + 1) + '</span>' +
          '<div class="rk-art" aria-hidden="true" style="flex:none;width:76px;height:76px;background:#ffffff;padding:5px;transform:rotate(' + trot[i] + 'deg)">' + coverImg(t.album, true) + '</div>' +
          '<div style="min-width:0"><p class="rk-t" style="margin:0;font-weight:900;font-size:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(t.title) + '</p>' +
          '<p class="rk-s" style="margin:6px 0 0;font-weight:500;font-size:14px;color:#a8a8a8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(t.artist + ' · ' + plural(S.plays[id], 'раз', 'раза', 'раз')) + '</p></div></div></div></button>';
      }).join('') + '</div>';
    }
    return labelB('ЧАЩЕ ВСЕГО', 'top-h', 0.45) + body;
  }
  function viewHome() {
    return '<div class="page">' + (PHONE ? phoneGearHtml() : '') + '<main class="wrap" style="' + (isP5() ? 'position:relative;' : '') + 'flex:1;padding-top:110px;padding-bottom:64px">' + (isP5() ? p5DateHtml() : '') +
      '<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:28px 40px">' + titleH1('Главная', T_HOME, -4) + '</div>' +
      '<section id="home-recent" aria-labelledby="recent-h" style="margin-top:' + (isP3() ? 32 : isMF() ? 34 : 64) + 'px">' + homeRecentHtml() + '</section>' +
      '<section id="home-top" aria-labelledby="top-h" style="margin-top:64px">' + homeTopHtml() + '</section></main></div>';
  }
  function renderHomeSections() {
    const r = $('#home-recent');
    const tp = $('#home-top');
    if (r) {
      r.classList.add('still');
      r.innerHTML = homeRecentHtml();
    }
    if (tp) {
      tp.classList.add('still');
      tp.innerHTML = homeTopHtml();
    }
  }

  /* ---------- SEARCH ---------- */
  function viewSearch() {
    return '<div class="page"><div class="wrap" style="padding-top:110px">' +
      '<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:28px 36px">' + titleH1('Поиск', T_SEARCH, -4) +
      '<div class="slide" style="flex:1 1 420px;max-width:680px;display:flex;animation-delay:.09s"><div class="search-field"><span class="s1" aria-hidden="true"></span><span class="s2" aria-hidden="true"></span>' +
      '<label><svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true" style="flex:none"><circle cx="20" cy="20" r="12" fill="none" stroke="#ffffff" style="stroke-width:6"></circle><path d="M29 29 L41 41" stroke="#ffffff" style="stroke-width:7;stroke-linecap:round"></path></svg>' +
      '<span class="sr">Поиск трека</span><input id="q" type="search" placeholder="Поиск трека" value="' + esc(S.query) + '" autocomplete="off" spellcheck="false">' +
      '<button type="button" class="search-clear hop" data-act="clear-q" aria-label="Очистить поиск"' + (S.query ? '' : ' hidden') + '><svg viewBox="0 0 48 48" width="24" height="24" aria-hidden="true"><path d="M10 10 L38 38 M38 10 L10 38" stroke="#ff2b3a" style="stroke-width:7;stroke-linecap:round"></path></svg></button>' +
      '</label></div></div></div></div>' +
      '<div id="search-body" style="flex:1;display:flex;flex-direction:column">' + searchBodyHtml() + '</div></div>';
  }
  function searchBodyHtml() {
    const q = norm(S.query);
    S.wasSearching = !!q;
    if (q) return searchResultsHtml(q);
    const a = S.openAlbum ? AL.get(S.openAlbum) : null;
    if (a) return albumHtml(a);
    return albumsGridHtml();
  }
  function albumsGridHtml() {
    const rots = [-3, 2, -2, 3];
    return '<section class="wrap" aria-labelledby="albums-h" style="padding-top:48px;padding-bottom:48px">' + labelA('АЛЬБОМЫ', 'albums-h', 0.2, 'margin-bottom:44px') +
      '<div class="alb-grid">' + CAT.albums.map((a, i) =>
        '<div class="rise" style="min-width:0;animation-delay:' + (0.15 + i * 0.05).toFixed(2) + 's">' +
        '<button type="button" class="card" data-act="open-album" data-id="' + esc(a.id) + '" aria-label="Открыть альбом ' + esc(a.title) + '" style="max-width:none;width:100%">' +
        '<span class="art" style="display:block;position:relative;rotate:' + rots[i % 4] + 'deg">' +
        '<span class="c-sh" aria-hidden="true" style="position:absolute;inset:0;background:#d4141a;transform:translate(10px,10px)"></span>' +
        '<span class="c-fr" style="display:block;position:relative;background:#ffffff;padding:9px"><span class="c-in" style="display:block;width:100%;aspect-ratio:1/1;border:2px solid #0b0b0b;overflow:hidden">' + coverImg(a.id, false) + '</span></span>' +
        '<span class="c-tag" aria-hidden="true" style="position:absolute;right:-14px;bottom:-14px;background:#0b0b0b;color:#ffffff;border:3px solid #ffffff;padding:5px 12px;font-weight:900;font-style:italic;font-size:13px;letter-spacing:.08em;transform:skewX(-12deg) rotate(-4deg)">' + tracksWord(a.tracks.length).toUpperCase() + '</span></span>' +
        '<span class="c-t2" style="display:block;margin-top:26px;font-weight:900;font-size:18px;line-height:1.25">' + esc(a.title) + '</span>' +
        '<span class="c-s2" style="display:block;margin-top:6px;font-weight:500;font-size:14px;color:#a8a8a8">' + esc(a.artist + (a.year ? ' · ' + a.year : '')) + '</span></button></div>').join('') +
      '</div></section>';
  }
  function albumMetaText(a) {
    const total = a.tracks.reduce((s, id) => s + ((TR.get(id) || {}).sec || 0), 0);
    const known = a.tracks.every((id) => (TR.get(id) || {}).sec > 0);
    return [a.artist, a.year, tracksWord(a.tracks.length), total && known ? fmtLong(total) : null].filter(Boolean).join(' · ');
  }
  function albumHtml(a) {
    S.lists.album = a.tracks.slice();
    const meta = albumMetaText(a);
    const rows = chunked(a.tracks.map((id, i) => {
      const t = TR.get(id);
      return t ? rowHtml(t, i, 'album', { num: t.n || i + 1 }) : '';
    }).filter(Boolean));
    return '<div class="wrap" style="padding-top:36px">' +
      '<button class="tab btn b-ghost" type="button" data-act="close-album" style="padding:10px 22px;background:#0b0b0b;color:#ffffff;font-size:15px;transform:skewX(-14deg)">' +
      '<svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true"><polygon points="44,6 22,24 44,42 38,24" fill="#d4141a"></polygon><polygon points="26,6 4,24 26,42 20,24" fill="#ffffff"></polygon></svg>ВСЕ АЛЬБОМЫ</button>' +
      '<div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:36px 52px;margin-top:40px">' +
      '<div class="pop" style="flex:0 0 240px;position:relative"><div class="alb-cov" style="position:relative;transform:rotate(-4deg)"><div class="c-sh" aria-hidden="true" style="position:absolute;inset:0;background:#d4141a;transform:translate(12px,12px)"></div>' +
      '<div class="c-fr" style="position:relative;background:#ffffff;padding:10px"><div class="c-in" style="width:100%;aspect-ratio:1/1;border:3px solid #0b0b0b;overflow:hidden">' + coverImg(a.id, false) + '</div></div></div></div>' +
      '<div class="slide" style="flex:1 1 380px;min-width:0;animation-delay:.06s">' +
      '<span class="alb-tag" style="display:inline-block;background:#ffffff;color:#0b0b0b;padding:6px 18px;font-weight:900;font-style:italic;font-size:14px;letter-spacing:.12em;transform:skewX(-14deg) rotate(-2deg)">АЛЬБОМ</span>' +
      '<h2 class="alb-title" style="margin:18px 0 0;font-family:\'Dela Gothic One\',sans-serif;font-weight:400;font-size:40px;line-height:1.15;color:#ffffff;overflow-wrap:anywhere">' + esc(a.title) + '</h2>' +
      '<p class="alb-meta" style="margin:12px 0 0;font-weight:700;font-size:18px;color:#b5b5b5">' + esc(meta) + '</p>' +
      '<div style="display:flex;flex-wrap:wrap;gap:18px 24px;margin-top:26px">' +
      '<button class="tab btn b-pri" type="button" data-act="play-album" data-id="' + esc(a.id) + '" style="padding:14px 28px;background:#d4141a;color:#ffffff;font-size:17px;transform:skewX(-12deg) rotate(-2deg);box-shadow:6px 6px 0 #0b0b0b">' + PLAY_ICON(22) + 'ИГРАТЬ АЛЬБОМ</button>' +
      '<button class="tab btn b-sec" type="button" data-act="shuffle-album" data-id="' + esc(a.id) + '" style="padding:14px 26px;background:#ffffff;color:#0b0b0b;border-color:#ffffff;font-size:17px;transform:skewX(-12deg) rotate(2deg);box-shadow:6px 6px 0 #d4141a">' + SHUF_ICON(24, '#0b0b0b') + 'СЛУЧАЙНО</button>' +
      '</div></div></div></div>' +
      redBand(rows, 'margin-top:52px;min-height:420px;flex:1', 'Треки альбома');
  }
  function searchResultsHtml(q) {
    const words = q.split(' ').filter(Boolean);
    const scored = [];
    for (const t of CAT.tracks) {
      if (!t._n) t._n = norm(t.title + ' ' + t.artist);
      if (words.every((w) => t._n.includes(w))) scored.push(t);
    }
    const nt = (t) => norm(t.title);
    scored.sort((a, b) => (nt(b).startsWith(q) ? 1 : 0) - (nt(a).startsWith(q) ? 1 : 0));
    const res = scored.slice(0, 150);
    S.lists.results = res.map((t) => t.id);
    const inner = '<h2 class="pop found-h" style="display:inline-block;margin:0 0 32px;background:#0b0b0b;color:#ffffff;border:3px solid #ffffff;padding:8px 24px;font-family:\'Dela Gothic One\',sans-serif;font-weight:400;font-size:22px;letter-spacing:.1em;transform:rotate(-2deg) skewX(-10deg)">НАЙДЕНО: ' + scored.length + '</h2>' +
      (res.length ? chunked(res.map((t, i) => rowHtml(t, i, 'results', { withAlbum: true }))) :
        '<div class="pop" style="display:inline-block"><p class="hint" style="padding:18px 28px">Ничего не нашлось — попробуйте другое название</p></div>');
    return redBand(inner, 'margin-top:44px;min-height:520px;flex:1', 'Результаты поиска');
  }
  function renderSearchBody(forceAnim) {
    const body = $('#search-body');
    if (!body) return;
    const searching = !!norm(S.query);
    const anim = forceAnim === true || searching !== S.wasSearching;
    body.classList.toggle('still', !anim);
    body.innerHTML = searchBodyHtml();
    const clr = $('[data-act=clear-q]');
    if (clr) clr.hidden = !S.query;
  }

  /* ---------- LIBRARY ---------- */
  function likedIds() {
    return Object.keys(S.liked).filter((id) => TR.has(id));
  }
  function computeLibIds() {
    const ids = likedIds();
    const order = CAT.albums.map((a) => a.id);
    if (S.libSort === 'title') ids.sort((a, b) => TR.get(a).title.localeCompare(TR.get(b).title, 'ru', { sensitivity: 'base' }));
    else if (S.libSort === 'album') {
      ids.sort((a, b) => {
        const ta = TR.get(a);
        const tb = TR.get(b);
        return order.indexOf(ta.album) - order.indexOf(tb.album) || ta.n - tb.n;
      });
    } else ids.sort((a, b) => S.liked[b] - S.liked[a]);
    return ids;
  }
  function viewLibrary() {
    const btnBg = S.selecting ? '#ffffff' : '#0b0b0b';
    const btnFg = S.selecting ? '#0b0b0b' : '#ffffff';
    return '<div class="page"><div class="wrap" style="padding-top:110px">' +
      '<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:28px 36px">' + titleH1('Библиотека', T_LIB, -3, 'flex-wrap:wrap;') +
      '<div class="slide" style="display:flex;flex-wrap:wrap;align-items:center;gap:18px 26px;animation-delay:.09s">' +
      '<button class="tab btn b-pri" type="button" data-act="lib-play" style="padding:14px 28px;background:#d4141a;color:#ffffff;font-size:17px;transform:skewX(-12deg) rotate(-2deg);box-shadow:6px 6px 0 #5e070c">' + PLAY_ICON(22) + 'ИГРАТЬ ВСЕ</button>' +
      '<button class="tab btn b-sec" type="button" data-act="lib-shuffle" style="padding:14px 26px;background:#ffffff;color:#0b0b0b;border:0;font-size:17px;transform:skewX(-12deg) rotate(2deg);box-shadow:6px 6px 0 #d4141a">' + SHUF_ICON(24, '#0b0b0b') + 'СЛУЧАЙНО</button>' +
      '<button class="tab btn b-dl" type="button" id="lib-dl-btn" data-act="lib-select" aria-pressed="' + S.selecting + '" style="padding:12px 24px;background:' + btnBg + ';color:' + btnFg + ';font-size:17px;transform:skewX(-12deg) rotate(-1deg);box-shadow:6px 6px 0 #10d6b4">' + DL_ICON('currentColor', 24) + 'СКАЧАТЬ</button>' +
      '</div></div>' +
      '<div class="rise" id="lib-stats" style="margin-top:36px;display:flex;flex-wrap:wrap;align-items:center;gap:14px 16px;animation-delay:.15s">' + libStatsHtml() + '</div></div>' +
      '<section class="band-red" aria-labelledby="list-h" style="margin-top:40px;flex:1;min-height:420px"><div class="bg" aria-hidden="true"></div><div class="bgdots" aria-hidden="true"></div><div class="bolt" aria-hidden="true"></div>' +
      '<div class="in"><h2 id="list-h" class="sr">Любимые треки</h2><div id="lib-list">' + libListHtml({}) + '</div></div></section></div>';
  }
  function offlineLabel() {
    let n = 0;
    let bytes = 0;
    S.downloads.forEach((b, id) => {
      if (TR.has(id)) {
        n++;
        bytes += b;
      }
    });
    return n ? 'СКАЧАНО: ' + tracksWord(n).toUpperCase() + ' · ' + fmtMb(bytes) : 'НИЧЕГО НЕ СКАЧАНО';
  }
  function libStatsHtml() {
    const n = likedIds().length;
    const chip = (key, label) => '<button class="tab chip" type="button" data-act="lib-sort" data-sort="' + key + '" aria-pressed="' + (S.libSort === key) + '">' + label + '</button>';
    return '<span class="lib-tag" style="display:inline-flex;align-items:center;gap:10px;background:#ffffff;color:#0b0b0b;padding:6px 18px;font-weight:900;font-style:italic;font-size:14px;letter-spacing:.1em;transform:skewX(-14deg) rotate(-2deg)">' +
      '<span class="beat" aria-hidden="true" style="display:block">' + (isP3() ? heartP3(20, true) : isMF() ? heartMF(22, true) : heartFull(28)) + '</span>ЛЮБИМЫЕ ТРЕКИ</span>' +
      '<p class="lib-count" style="margin:0 18px 0 0;font-weight:700;font-size:15px;color:#c8c8c8">' + tracksWord(n) + '</p>' +
      chip('added', 'ПО ВРЕМЕНИ ДОБАВЛЕНИЯ') + chip('title', 'ПО НАЗВАНИЮ') + chip('album', 'ПО АЛЬБОМУ') +
      '<span id="lib-offline" style="display:inline-flex;align-items:center;gap:8px;margin-left:10px;font-weight:900;font-style:italic;font-size:14px;letter-spacing:.06em;color:#10d6b4">' + DL_ICON('#10d6b4', 20) + offlineLabel() + '</span>';
  }
  function renderLibStats() {
    const el = $('#lib-stats');
    if (el) el.innerHTML = libStatsHtml();
  }
  const isDownloaded = (id) => S.downloads.has(id);
  const isDownloading = (id) => S.dl.has(id) && !S.dl.get(id).error;
  function selectable() {
    return S.libIds.filter((id) => S.liked[id] && !isDownloaded(id) && !isDownloading(id));
  }
  function selBoxHtml(t, anim) {
    const cls = 'sel-box' + (anim ? ' pop-now' : '');
    if (isDownloaded(t.id)) {
      const rm = S.unsel.has(t.id);
      return '<button type="button" class="' + cls + '" data-act="unsel" data-id="' + esc(t.id) + '" aria-pressed="' + rm + '" aria-label="' + (rm ? 'Не удалять: ' : 'Удалить скачанный файл: ') + esc(t.title) + '">' +
        (rm ? '<svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true"><circle cx="24" cy="24" r="18" fill="#d4141a" stroke="#ffffff" style="stroke-width:3"></circle><path d="M17 17 L31 31 M31 17 L17 31" stroke="#ffffff" style="stroke-width:5;stroke-linecap:round"></path></svg>'
          : '<svg viewBox="0 0 48 48" width="34" height="34" aria-hidden="true"><circle cx="24" cy="24" r="18" fill="#10d6b4" stroke="#ffffff" style="stroke-width:3"></circle><path d="M15 25 L21 31 L33 17" fill="none" stroke="#0b0b0b" style="stroke-width:5;stroke-linecap:round;stroke-linejoin:round"></path></svg>') + '</button>';
    }
    if (isDownloading(t.id)) {
      return '<span class="sel-box" aria-hidden="true"><svg viewBox="0 0 48 48" width="34" height="34"><circle cx="24" cy="24" r="18" fill="#0b0b0b" stroke="#10d6b4" style="stroke-width:3"></circle>' + '<path d="M24 13 V29 M17 23 L24 31 L31 23" fill="none" stroke="#10d6b4" style="stroke-width:4;stroke-linecap:round;stroke-linejoin:round"></path></svg></span>';
    }
    const picked = S.sel.has(t.id);
    return '<button type="button" class="' + cls + '" data-act="sel" data-id="' + esc(t.id) + '" aria-pressed="' + picked + '" aria-label="Выбрать для скачивания: ' + esc(t.title) + '">' +
      '<svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true" style="overflow:visible"><rect x="7" y="7" width="34" height="34" transform="translate(3 3.5) rotate(-6 24 24)" fill="#d4141a"></rect>' +
      '<rect x="7" y="7" width="34" height="34" transform="rotate(-6 24 24)" fill="' + (picked ? '#d4141a' : '#0b0b0b') + '" stroke="#ffffff" style="stroke-width:4;stroke-linejoin:round"></rect>' +
      '<path d="M14 25 L21 32 L37 12" fill="none" stroke="#ffffff" opacity="' + (picked ? 1 : 0) + '" style="stroke-width:6.5;stroke-linecap:round;stroke-linejoin:round"></path></svg></button>';
  }
  function selPanelHtml(anim) {
    const n = S.sel.size + S.unsel.size;
    let mb = 0;
    S.sel.forEach((id) => { mb += ((TR.get(id) || {}).sec || 180) * EST_BYTES_PER_SEC; });
    const pool = selectable();
    const allPicked = pool.length > 0 && pool.every((id) => S.sel.has(id));
    let hint;
    if (S.sel.size && S.unsel.size) hint = 'Скачать ≈ ' + fmtMb(mb) + ' · удалить ' + ON_DEVICE + ': ' + S.unsel.size;
    else if (S.sel.size) hint = 'Будут доступны без интернета · ≈ ' + fmtMb(mb);
    else if (S.unsel.size) hint = 'Файлы удалятся ' + ON_DEVICE + ', треки останутся в библиотеке';
    else hint = 'Отметьте треки, которые хотите слушать без интернета. Бирюзовая галочка — трек уже скачан, нажмите на неё, чтобы удалить файл.';
    const btn = (act, label, extra) => '<button class="tab chip" type="button" data-act="' + act + '"' + (extra || '') + ' style="padding:9px 18px">' + label + '</button>';
    return '<div id="sel-panel" class="' + (anim ? 'pop-now' : '') + '" style="position:relative;max-width:980px;margin:0 0 34px">' +
      '<span class="sp-sh" aria-hidden="true" style="position:absolute;inset:0;background:#10d6b4;transform:translate(9px,9px);clip-path:polygon(0% 8%, 100% 0%, 99% 100%, 1% 93%)"></span>' +
      '<span class="sp-ol" aria-hidden="true" style="position:absolute;inset:-5px;background:#ffffff;clip-path:polygon(0% 8%, 100% 0%, 99% 100%, 1% 93%)"></span>' +
      '<div class="sp-bg" style="position:relative;background:#0b0b0b;clip-path:polygon(0% 8%, 100% 0%, 99% 100%, 1% 93%);padding:20px 30px 20px 26px;display:flex;flex-wrap:wrap;align-items:center;gap:14px 18px">' +
      '<div style="margin-right:auto;min-width:0;flex:1 1 260px"><p class="sp-t" style="margin:0;font-family:\'Dela Gothic One\',sans-serif;font-size:22px;letter-spacing:.06em;color:#ffffff">ВЫБРАНО: ' + n + '</p>' +
      '<p class="sp-h" style="margin:6px 0 0;font-weight:500;font-size:14px;color:#b5b5b5;line-height:1.4">' + esc(hint) + '</p></div>' +
      (pool.length ? btn('sel-all', allPicked ? 'СНЯТЬ ВСЕ' : 'ВЫБРАТЬ ВСЕ') : '') + btn('sel-cancel', 'ОТМЕНА') +
      (S.unsel.size ? '<button class="tab btn b-sec b-warn" type="button" data-act="sel-remove" style="padding:9px 18px;background:#ffffff;color:#d4141a;font-size:14px;transform:skewX(-14deg)">УДАЛИТЬ ФАЙЛЫ</button>' : '') +
      '<button class="tab btn b-pri" type="button" data-act="sel-download"' + (S.sel.size ? '' : ' disabled') + ' style="gap:10px;padding:11px 22px;background:#d4141a;color:#ffffff;font-size:16px;transform:skewX(-12deg) rotate(-2deg);box-shadow:5px 5px 0 #10d6b4">' + DL_ICON('#ffffff', 20) + 'СКАЧАТЬ</button>' +
      '</div></div>';
  }
  function libListHtml(o) {
    S.lists.lib = S.libIds.slice();
    const rows = chunked(S.libIds.map((id, i) => {
      const t = TR.get(id);
      if (!t) return '';
      return rowHtml(t, i, 'lib', { withAlbum: true, off: !S.liked[id], select: S.selecting ? selBoxHtml(t, o.boxAnim) : '' });
    }).filter(Boolean));
    const empty = S.libIds.length ? '' : '<div class="pop" style="display:inline-block;max-width:620px"><p class="hint">Здесь пока пусто. Нажмите на сердечко у трека в «Поиске» — и он появится тут.</p></div>';
    return (S.selecting ? selPanelHtml(o.panelAnim) : '') + rows + empty;
  }
  function renderLibList(o) {
    const el = $('#lib-list');
    if (!el) return;
    o = o || {};
    el.classList.toggle('still', !o.anim);
    el.innerHTML = libListHtml(o);
  }
  function renderSelPanel() {
    const p = $('#sel-panel');
    if (p) p.outerHTML = selPanelHtml(false);
  }
  function setSelecting(on) {
    S.selecting = on;
    S.sel.clear();
    S.unsel.clear();
    const b = $('#lib-dl-btn');
    if (b) {
      b.setAttribute('aria-pressed', String(on));
      b.style.background = on ? '#ffffff' : '#0b0b0b';
      b.style.color = on ? '#0b0b0b' : '#ffffff';
    }
    renderLibList({ boxAnim: on, panelAnim: on });
  }
  function refreshRowBox(id) {
    const t = TR.get(id);
    const row = $('[data-row="' + sel(id) + '"] .row-in');
    if (!row || !t) return;
    const old = row.querySelector('.sel-box');
    if (old) old.outerHTML = selBoxHtml(t, false);
  }

  /* downloads */
  function startDownloads(ids) {
    const list = ids.map((id) => TR.get(id)).filter(Boolean).filter((t) => !isDownloaded(t.id) && !isDownloading(t.id));
    if (!list.length) return;
    list.forEach((t) => S.dl.set(t.id, { pct: 0, queued: true }));
    S.dlBatch = new Set((S.dlBatch ? Array.from(S.dlBatch) : []).concat(list.map((t) => t.id)));
    api.download(list.map((t) => Object.assign({}, t, { albumTitle: (albumOf(t) || {}).title || '' })));
    toast('Скачиваю ' + tracksWord(list.length) + ' — можно слушать дальше', { teal: true });
    list.forEach((t) => updateDlUI(t.id));
  }
  async function removeDownloads(ids) {
    const list = ids.map((id) => TR.get(id)).filter(Boolean);
    if (!list.length) return;
    let res = null;
    try {
      res = await api.removeDownloads(list);
    } catch (e) {
      res = null;
    }
    if (res && Array.isArray(res.list)) {
      S.downloads = new Map(res.list.map((x) => [x.id, x.bytes]));
      if (res.failed) toast('Часть файлов занята (трек сейчас играет?) — они не удалились');
      else toast('Удалено ' + ON_DEVICE + ': ' + tracksWord(list.length));
    } else {
      toast('Не получилось удалить файлы');
    }
    list.forEach((t) => updateDlUI(t.id));
  }
  function updateDlUI(id) {
    const st = S.dl.get(id);
    $$('[data-dl="' + sel(id) + '"]').forEach((el) => {
      const bar = el.querySelector('.dl-bar>span>span');
      if (st && !st.error && bar) {
        bar.style.width = (st.pct || 0) + '%';
        const pc = el.querySelector('.dl-pct');
        if (pc) pc.textContent = st.queued ? 'ЖДЁТ' : (st.pct || 0) + '%';
      } else {
        el.innerHTML = dlSlot(id);
      }
    });
    if (S.view === 'library') {
      const off = $('#lib-offline');
      if (off) off.innerHTML = DL_ICON('#10d6b4', 20) + offlineLabel();
      if (S.selecting) refreshRowBox(id);
    }
  }
  function onDownloadEvent(p) {
    if (!p || !p.id) return;
    const t = TR.get(p.id);
    if (p.error) {
      S.dl.set(p.id, { error: p.error });
      toast('Не скачался «' + (t ? t.title : p.id) + '». Попробуйте ещё раз позже.');
    } else if (p.done) {
      S.dl.delete(p.id);
      S.downloads.set(p.id, p.bytes || 0);
    } else {
      S.dl.set(p.id, { pct: p.pct || 0, queued: !!p.queued });
    }
    updateDlUI(p.id);
    if (S.dlBatch && (p.done || p.error)) {
      const pending = Array.from(S.dlBatch).some((id) => isDownloading(id));
      if (!pending) {
        const ok = Array.from(S.dlBatch).filter((id) => isDownloaded(id)).length;
        S.dlBatch = null;
        if (ok) toast('Готово! Без интернета доступно: ' + tracksWord(ok), { teal: true });
      }
    }
  }

  /* ---------- NOW PLAYING ---------- */
  function nextTitle() {
    if (S.repeat && curTrack()) return 'этот же трек (повтор)';
    if (P.queue.length < 2) return 'конец очереди';
    const id = P.cur < P.queue.length - 1 ? P.queue[P.cur + 1] : P.queue[0];
    const t = TR.get(id);
    return t ? t.title : 'конец очереди';
  }
  function plaqueInner() {
    const t = curTrack();
    const a = albumOf(t);
    return '<h1 class="np-title">' + esc(t ? t.title : 'Ничего не играет') + '</h1>' +
      '<p class="np-sub">' + esc(t ? t.artist : 'Выберите трек в «Поиске»') + (a ? ' · <span class="alb">' + esc(a.short || a.title) + '</span>' : '') + '</p>';
  }
  function coverBlock(anim) {
    const t = curTrack();
    return '<div class="' + (anim ? 'drop' : '') + '" style="animation-duration:.7s"><div class="tilt" style="position:relative">' +
      '<div aria-hidden="true" style="position:absolute;inset:0;background:#d4141a;transform:translate(16px,16px) rotate(-4deg)"></div>' +
      '<div style="position:relative;background:#ffffff;padding:14px;transform:rotate(-4deg)">' +
      '<div style="width:100%;aspect-ratio:1/1;border:3px solid #0b0b0b;overflow:hidden">' + (t ? coverImg(t.album, false) : '<span class="cov-fallback"></span>') + '</div></div></div></div>';
  }
  function lyricsTag(L) {
    if (!L || L.kind === 'loading') return 'ТЕКСТ';
    if (L.kind === 'plain') return 'ТЕКСТ · БЕЗ ТАЙМИНГА';
    return 'ТЕКСТ';
  }
  function lyricsBody(L) {
    const msg = (cut, text, extra) => '<div class="ly-msg">' + (extra || '') +
      (isP3() || isMF() ? '<p class="ly3-big" aria-hidden="true">' + (P3_LY_WORD.get(cut) || '') + '</p>'
        : '<p aria-hidden="true" style="margin:0;display:flex;flex-wrap:wrap;justify-content:center;transform:rotate(-3deg)">' + letters(cut, false) + '</p>') +
      '<p class="t">' + text + '</p></div>';
    if ((!L || L.kind === 'loading') && isP3()) {
      return '<div class="ly-msg"><div class="ly3-bub" aria-hidden="true"><i></i><i></i><i></i></div><p class="t blink">Ищу текст…</p></div>';
    }
    if ((!L || L.kind === 'loading') && isMF()) {
      return '<div class="ly-msg"><div class="mf-dots" aria-hidden="true"><i></i><i></i><i></i></div><p class="t blink">Ищу текст…</p></div>';
    }
    if (!L || L.kind === 'loading') {
      return '<div class="ly-msg"><div style="width:70px;height:80px;animation:spinNote .8s ease-in-out infinite">' + noteSvg(70, 80, 11, 6) + '</div><p class="t blink" style="font-weight:900;font-style:italic;letter-spacing:.1em">ИЩУ ТЕКСТ…</p></div>';
    }
    if (L.kind === 'instr') return msg(T_INSTR, 'В этом треке нет слов');
    if (L.kind === 'none') return msg(T_NOLY, 'Текст для этого трека не нашёлся. Скорее всего, в нём нет слов.');
    if (L.kind === 'error' && L.online) return msg(T_NOLY, 'Сервис текстов lrclib.net сейчас не отвечает — попробуйте позже.');
    if (L.kind === 'error') return msg(T_NONET, 'Не получилось загрузить текст — проверьте интернет.');
    if (L.kind === 'plain') {
      return '<div class="ly-plain">' + L.lines.map((s) => '<p>' + (esc(s) || '&nbsp;') + '</p>').join('') + '</div><div class="ly-fade-b" style="height:50px"></div>';
    }
    return '<div class="ly-scroll" id="ly-scroll"><div class="ly-col" id="ly-col">' + L.lines.map((ln, i) =>
      '<button type="button" class="ly-line" data-act="ly-seek" data-t="' + ln.t + '" data-i="' + i + '">' + esc(ln.text) + '</button>').join('') + '</div></div>' +
      '<div class="ly-fade-t"></div><div class="ly-fade-b"></div>' +
      '<button type="button" class="ly-follow" data-act="ly-follow" hidden>' + (isP3() || isMF() ? 'К текущей строке' : 'К ТЕКУЩЕЙ СТРОКЕ') + '</button>';
  }
  function lyricsBlock(anim) {
    const t = curTrack();
    const L = t ? S.lyrics.get(t.id) : null;
    return '<div class="' + (anim ? 'ly-in' : '') + '" style="position:relative">' +
      '<div aria-hidden="true" style="position:absolute;inset:0;background:#d4141a;transform:translate(16px,16px) rotate(-4deg)"></div>' +
      '<section aria-label="Текст песни" style="position:relative;background:#ffffff;padding:14px;transform:rotate(-4deg)"><div class="ly-card">' +
      '<div aria-hidden="true" style="position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,0.07) 1.4px, transparent 1.7px);background-size:10px 10px"></div>' +
      '<div aria-hidden="true" style="position:absolute;left:-10%;right:-10%;top:50%;height:64px;margin-top:-32px;background:#d4141a;transform:rotate(-3deg);clip-path:polygon(0% 18%, 100% 0%, 100% 82%, 0% 100%)"></div>' +
      '<div id="ly-body" style="position:absolute;inset:0">' + lyricsBody(L) + '</div>' +
      '<p class="ly-tag" id="ly-tag">' + lyricsTag(L) + '</p><p class="ly-src">тексты: lrclib.net</p></div></section></div>';
  }
  function renderArt(anim) {
    const el = $('#np-art');
    if (!el) return;
    S.lyActive = -2;
    clearTimeout(lyFreeT);
    lyFreeUntil = 0;
    if (isP3()) el.innerHTML = S.lyricsOn ? lyricsBlockP3(anim) : coverBlockP3(anim);
    else if (isMF()) el.innerHTML = S.lyricsOn ? lyricsBlockMF(anim) : coverBlockMF(anim);
    else el.innerHTML = S.lyricsOn ? lyricsBlock(anim) : coverBlock(anim);
    if (S.lyricsOn) requestAnimationFrame(() => updateLyricsActive(currentPos(), true));
  }
  function renderLyricsContent() {
    const body = $('#ly-body');
    if (!body) return;
    clearTimeout(lyFreeT);
    lyFreeUntil = 0;
    const t = curTrack();
    const L = t ? S.lyrics.get(t.id) : null;
    body.innerHTML = lyricsBody(L);
    const tag = $('#ly-tag');
    if (tag) tag.textContent = lyricsTag(L);
    S.lyActive = -2;
    requestAnimationFrame(() => updateLyricsActive(currentPos(), true));
  }
  function updateNowTrack() {
    if (S.view !== 'now') return;
    renderArt(true);
    const pl = $('#np-plaque');
    if (pl) pl.innerHTML = isP3() ? plaqueInnerP3() : isMF() ? plaqueInnerMF() : '<div class="slide" style="animation-duration:.55s">' + plaqueInner() + '</div>';

    updateNowBits();
  }
  /* P3R: the artist line is tilted up to the right, so the pills above get as much room as the tilt needs */
  function fitN3Tags() {
    if (!isP3() || S.view !== 'now') return;
    const tags = $('.n3-tags');
    const art = $('.n3-menu .n3-it');
    if (!tags || !art) return;
    tags.style.marginBottom = '';
    const col = $('.n3-right');
    if (col) col.style.marginTop = '';
    const root = $('#view');
    /* narrow desktop windows: the pause menu in the top right corner can sit over the pills and the artist line —
       the column steps down below it (in CSS pixels of the column, which fitNow may have zoomed) */
    const menu = !PHONE && $('#nav .pm');
    if (menu && col) {
      const m = menu.getBoundingClientRect();
      const hit = [tags, art].map((e) => e.getBoundingClientRect()).find((b) => b.right > m.left && b.left < m.right && b.top < m.bottom);
      const z = parseFloat(($('.n3-main') || col).style.zoom) || 1;
      if (hit) col.style.marginTop = Math.ceil((m.bottom - hit.top + 10) / z) + 'px';
    }
    const pills = $$('.n3-pill, .np-fav, .dl-done', tags).map((c) => layoutBox(c, root)).filter((b) => b && b.w > 0);
    const tb = layoutBox(tags, root);
    const ab = layoutBox(art, root);
    if (!pills.length || !tb || !ab) return;
    const right = Math.max(...pills.map((b) => b.x + b.w));
    const bottom = Math.max(...pills.map((b) => b.y + b.h));
    const r = Math.abs(parseFloat(getComputedStyle(art).getPropertyValue('--r')) || 7) * Math.PI / 180;
    const run = clamp(Math.min(right, ab.x + ab.w * 0.86) - ab.x, 0, 2000);
    const need = bottom + 8 + run * Math.tan(r) - ab.y;
    if (need > 0) tags.style.marginBottom = Math.ceil(need) + 'px';
  }
  window.addEventListener('resize', () => { fitN3Tags(); fitNow(); });

  /* the desktop window at its smallest: when long names make "now playing" taller than the window, the upper part
     (cover, title, buttons) shrinks as a whole just enough for the controls band to stay on screen without scrolling */
  const NOW_MIN_ZOOM = 0.7;
  function fitNowDesktop(v, np) {
    const main = $('.np-main, .n3-main, .mfn-main', np);
    if (!main) return;
    main.style.zoom = '';
    let k = 1;
    for (let i = 0; i < 4 && k > NOW_MIN_ZOOM; i++) {
      const over = v.scrollHeight - v.clientHeight;
      if (over <= 1) break;
      const h = main.getBoundingClientRect().height;
      if (!(h > over)) break;
      k = Math.max(NOW_MIN_ZOOM, (k * (h - over - 2)) / h);
      main.style.zoom = k.toFixed(3);
    }
  }

  /* the phone: "now playing" always fits the screen, whatever the names — when the title, the album or the next
     track take more room, the cover gives up exactly that much (phone.css: --cut), so the buttons stay put above the tabs */
  function fitNow() {
    if (S.view !== 'now') return;
    const v = $('#view');
    const np = $('.np', v);
    const band = np && $('.np-band', np);
    if (!band) return;
    if (!PHONE) {
      fitNowDesktop(v, np);
      return;
    }
    let cut = 0;
    np.style.setProperty('--cut', '0px');
    for (let i = 0; i < 3 && cut < 140; i++) {
      const b = layoutBox(band, v);
      const over = b ? Math.ceil(b.y + b.h - v.clientHeight) : 0;
      if (over <= 0) break;
      cut = Math.min(cut + over, 140);
      np.style.setProperty('--cut', cut + 'px');
    }
  }

  function updateNowBits() {
    if (S.view !== 'now') return;
    const t = curTrack();
    const fav = $('#np-fav');
    if (fav) {
      const want = !!(t && S.liked[t.id]);
      if (want !== !!fav.firstElementChild) fav.innerHTML = want ? '<span class="pop-now" style="display:inline-block"><span class="np-fav" style="display:inline-block">В ИЗБРАННОМ</span></span>' : '';
    }
    const nx = $('#np-next');
    if (nx) nx.textContent = nextTitle();
    const lk = $('#np-like-slot');
    if (lk && t && (!lk.firstElementChild || lk.firstElementChild.dataset.id !== t.id)) lk.innerHTML = likeBtn(t.id, 'now');
    const off = $('#np-off');
    /* downloaded: plays without the network; not downloaded while offline: say so for as long as it lasts */
    if (off) {
      off.innerHTML = t && S.downloads.has(t.id) ? '<span class="dl-done" style="font-size:12px">' + DL_ICON('#0b0b0b', 14) + 'БЕЗ ИНТЕРНЕТА</span>'
        : t && !navigator.onLine ? '<span class="dl-done" style="font-size:12px;background:#ffffff;color:#d4141a">НЕ СКАЧАН · НУЖЕН ИНТЕРНЕТ</span>' : '';
    }
    fitN3Tags();
    fitNow();
    if (isP3() && !PHONE) fitN3Tags();
  }
  function viewNow() {
    const t = curTrack();
    const liked = !!(t && S.liked[t.id]);
    const lyBg = S.lyricsOn ? '#ffffff' : '#0b0b0b';
    const lyFg = S.lyricsOn ? '#0b0b0b' : '#ffffff';
    const shuf = (sw) => '<path d="M5 14 H14 L30 34 H35" fill="none" stroke="#0b0b0b" style="stroke-width:12;stroke-linejoin:round;stroke-linecap:round"></path>' +
      '<path d="M5 14 H14 L30 34 H35" fill="none" style="stroke:var(--sh);stroke-width:' + sw + ';stroke-linejoin:round;stroke-linecap:round"></path>' +
      '<path d="M5 34 H14 L30 14 H35" fill="none" stroke="#0b0b0b" style="stroke-width:12;stroke-linejoin:round;stroke-linecap:round"></path>' +
      '<path d="M5 34 H14 L30 14 H35" fill="none" style="stroke:var(--sh);stroke-width:' + sw + ';stroke-linejoin:round;stroke-linecap:round"></path>' +
      '<polygon points="32,4 47,14 32,24" stroke="#0b0b0b" style="fill:var(--sh);stroke-width:4;stroke-linejoin:round"></polygon>' +
      '<polygon points="32,24 47,34 32,44" stroke="#0b0b0b" style="fill:var(--sh);stroke-width:4;stroke-linejoin:round"></polygon>';
    const twoPoly = (pts, w1, w2) => '<g transform="translate(2.5 3.5)" fill="#0b0b0b" stroke="#0b0b0b" style="stroke-width:' + w1 + ';stroke-linejoin:round">' + pts + '</g><g fill="#ffffff" stroke="#0b0b0b" style="stroke-width:' + w2 + ';stroke-linejoin:round">' + pts + '</g>';
    return '<div class="np">' +
      '<main class="np-main">' +
      '<div class="np-left drop" style="animation-delay:.06s"><div id="np-art">' + (S.lyricsOn ? lyricsBlock(false) : coverBlock(false)) + '</div>' +
      '<div class="pop tyh" aria-hidden="true" style="animation-delay:.42s"><div style="display:flex;flex-direction:column;gap:6px;transform:rotate(-8deg)">' +
      '<div style="display:flex;align-items:center">' + letters(T_TYH1, true) + '</div>' +
      '<div style="display:flex;align-items:center;margin-left:70px">' + letters(T_TYH2, true) + '</div></div></div>' +
      nowLikeSlot(t, 'art') + '</div>' +
      '<div class="np-right">' +
      '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:14px">' +
      '<div class="pop" style="animation-delay:.18s"><div class="np-label">' + eqBars(4, '#d4141a', 4, 18) + '<span class="if-not-buffering">СЕЙЧАС ИГРАЕТ</span><span class="if-buffering blink">ЗАГРУЗКА…</span></div></div>' +
      '<span id="np-fav">' + (liked ? '<span class="pop" style="display:inline-block"><span class="np-fav" style="display:inline-block">В ИЗБРАННОМ</span></span>' : '') + '</span>' +
      '<span id="np-off"></span>' + nowLikeSlot(t, 'tags') + '</div>' +
      '<div class="slide plaque" style="animation-delay:.15s"><span class="p1" aria-hidden="true"></span><span class="p2" aria-hidden="true"></span><div class="p3" id="np-plaque">' + plaqueInner() + '</div></div>' +
      '<div class="slide np-btns" style="animation-delay:.27s">' +
      '<button class="qbtn teal" type="button" id="np-lybtn" data-act="lyrics" aria-pressed="' + S.lyricsOn + '" style="flex:none;background:' + lyBg + ';color:' + lyFg + ';box-shadow:6px 6px 0 #10d6b4">' +
      '<svg viewBox="0 0 48 48" width="28" height="28" aria-hidden="true" style="flex:none"><rect x="17" y="4" width="14" height="24" rx="7" fill="currentColor"></rect><path d="M10 22 C10 32 16 36 24 36 C32 36 38 32 38 22 M24 36 V44 M16 44 H32" fill="none" stroke="currentColor" style="stroke-width:4.5;stroke-linecap:round"></path></svg>' +
      '<span style="font-weight:900;font-style:italic;letter-spacing:.1em;font-size:15px">ТЕКСТ</span></button>' +
      '<button class="qbtn" type="button" data-act="queue-open" aria-expanded="false" aria-controls="queue" style="max-width:100%;gap:14px;padding:10px 22px 10px 16px;background:#0b0b0b;color:#ffffff;box-shadow:6px 6px 0 #d4141a;transform:skewX(-12deg) rotate(-1.5deg)">' +
      '<svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true" style="flex:none"><path d="M6 12 H30 M6 24 H26 M6 36 H22" stroke="#ffffff" style="stroke-width:6;stroke-linecap:round"></path><polygon points="32,26 46,36 32,46" fill="#ff3c5a"></polygon></svg>' +
      '<span style="flex:none;font-weight:900;font-style:italic;letter-spacing:.1em;font-size:15px">ДАЛЕЕ</span>' +
      '<span id="np-next" style="min-width:0;font-weight:700;font-size:15px;color:#ff5a61;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(nextTitle()) + '</span></button>' +
      '</div></div></main>' +
      '<section class="rise np-band" aria-label="Управление воспроизведением" style="animation-delay:.24s">' +
      '<div class="band-w" aria-hidden="true"></div><div class="band-g" aria-hidden="true"></div><div class="band-line" aria-hidden="true"></div>' +
      '<div class="band-in"><div style="position:relative;display:flex;align-items:center;gap:18px">' +
      '<span class="np-time" data-b="elapsed">0:00</span>' +
      '<div style="position:relative;flex:1;height:32px">' +
      '<div aria-hidden="true" style="position:absolute;inset:0;background:#ffffff;clip-path:polygon(0% 0%, 100% 0%, 95% 100%, 4% 100%)"></div>' +
      '<div aria-hidden="true" style="position:absolute;inset:6px 10px;background:#0b0b0b;clip-path:polygon(0% 0%, 100% 0%, 96% 100%, 3% 100%);overflow:hidden"><div data-b="fill" style="position:absolute;left:0;top:0;bottom:0;width:0;background:#d4141a"></div></div>' +
      '<div aria-hidden="true" data-b="thumb" style="position:absolute;top:50%;left:0;width:70px;height:80px;margin:-60px 0 0 -26px;pointer-events:none;z-index:2"><div class="wig" style="width:70px;height:80px;transform-origin:26px 60px">' + noteSvg(70, 80, 13, 7) + '</div></div>' +
      '<input type="range" class="range" data-b="range" min="0" max="1" step="1" value="0" aria-label="Позиция в треке"></div>' +
      '<span class="np-time" style="text-align:right" data-b="total">0:00</span></div>' +
      '<div class="np-ctl-wrap"><div class="np-ctl">' +
      '<div class="pop" style="animation-delay:.33s"><button class="hop cbtn" type="button" data-act="shuffle" aria-label="Случайный порядок" aria-pressed="' + P.shuffle + '"><span class="boil" aria-hidden="true" style="display:block;animation-delay:-.1s"><svg viewBox="0 0 48 48" width="62" height="62" style="overflow:visible;display:block">' +
      '<g transform="translate(2.5 3.5)"><path d="M5 14 H14 L30 34 H35" fill="none" stroke="#0b0b0b" style="stroke-width:12;stroke-linejoin:round;stroke-linecap:round"></path><path d="M5 34 H14 L30 14 H35" fill="none" stroke="#0b0b0b" style="stroke-width:12;stroke-linejoin:round;stroke-linecap:round"></path><polygon points="32,4 47,14 32,24" fill="#0b0b0b" stroke="#0b0b0b" style="stroke-width:6;stroke-linejoin:round"></polygon><polygon points="32,24 47,34 32,44" fill="#0b0b0b" stroke="#0b0b0b" style="stroke-width:6;stroke-linejoin:round"></polygon></g>' +
      shuf(5) + '</svg></span></button></div>' +
      '<div class="pop" style="animation-delay:.36s"><button class="hop cbtn" type="button" data-act="prev" aria-label="Предыдущий трек"><span class="boil" aria-hidden="true" style="display:block;animation-delay:-.3s"><svg viewBox="0 0 48 48" width="64" height="64" style="overflow:visible;display:block">' +
      twoPoly('<polygon points="46,8 25,23 45,40 39,24"></polygon><polygon points="28,6 3,24 29,42 21,24"></polygon>', 5, 4.5) + '</svg></span></button></div>' +
      '<div class="pop" style="animation-delay:.39s"><button class="hop cbtn big" type="button" data-act="toggle-play" aria-label="Играть или пауза"><span class="boil" aria-hidden="true" style="display:block;animation-delay:-.2s">' +
      '<svg class="ico-pause" viewBox="0 0 48 48" width="90" height="90" style="overflow:visible;display:block">' + twoPoly('<polygon points="9,5 21,3 18,45 4,43"></polygon><polygon points="28,4 42,6 37,45 24,43"></polygon>', 4, 3.5) + '</svg>' +
      '<svg class="ico-play" viewBox="0 0 48 48" width="90" height="90" style="overflow:visible;display:block"><polygon points="9,3 46,23 10,45 16,24" transform="translate(2.5 3.5)" fill="#0b0b0b" stroke="#0b0b0b" style="stroke-width:4;stroke-linejoin:round"></polygon><polygon points="9,3 46,23 10,45 16,24" fill="#ffffff" stroke="#0b0b0b" style="stroke-width:3.5;stroke-linejoin:round"></polygon></svg>' +
      '</span></button></div>' +
      '<div class="pop" style="animation-delay:.42s"><button class="hop cbtn" type="button" data-act="next" aria-label="Следующий трек"><span class="boil" aria-hidden="true" style="display:block;animation-delay:-.4s"><svg viewBox="0 0 48 48" width="64" height="64" style="overflow:visible;display:block">' +
      twoPoly('<polygon points="2,8 23,23 3,40 9,24"></polygon><polygon points="20,6 45,24 19,42 27,24"></polygon>', 5, 4.5) + '</svg></span></button></div>' +
      '<div class="pop" style="animation-delay:.44s">' + repBtn('cbtn', '<span class="boil" aria-hidden="true" style="display:block;animation-delay:-.15s">' + repIcon(60, 'now5') + '</span>') + '</div>' +
      nowLikeSlot(t, 'ctl') +
      '</div><div class="np-vol"><div class="pop" style="animation-delay:.48s">' + volHtml(true) + '</div></div></div></div></section></div>';
  }

  /* ---------- lyrics ---------- */
  function parseLrc(text) {
    const out = [];
    String(text || '').split(/\r?\n/).forEach((raw) => {
      const tags = Array.from(raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g));
      if (!tags.length) return;
      const body = raw.replace(/\[[^\]]*\]/g, '').trim();
      tags.forEach((m) => out.push({ t: parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.')), text: body || '♪' }));
    });
    out.sort((a, b) => a.t - b.t);
    return out.filter((l, i) => !(l.text === '♪' && i > 0 && out[i - 1].text === '♪'));
  }
  function toLyrics(r) {
    /* a failure with the network up means LRCLIB itself did not answer (it does return 503 now and then) */
    if (!r || (!r.found && r.error)) return { kind: 'error', online: navigator.onLine };
    if (!r.found) return { kind: 'none' };
    if (r.instrumental) return { kind: 'instr' };
    if (r.synced) {
      const lines = parseLrc(r.synced);
      if (lines.length) return { kind: 'synced', lines };
    }
    if (r.plain && String(r.plain).trim()) return { kind: 'plain', lines: String(r.plain).split(/\r?\n/) };
    return { kind: 'none' };
  }
  async function ensureLyrics(t) {
    if (!t) return;
    const have = S.lyrics.get(t.id);
    if (have && have.kind !== 'error') return;
    S.lyrics.set(t.id, { kind: 'loading' });
    if (S.view === 'now' && S.lyricsOn && curId() === t.id) renderLyricsContent();
    let r = null;
    try {
      r = await api.lyrics(Object.assign({}, t, { albumTitle: (albumOf(t) || {}).title || '' }));
    } catch (e) {
      r = { found: false, error: String(e) };
    }
    S.lyrics.set(t.id, toLyrics(r));
    if (S.view === 'now' && S.lyricsOn && curId() === t.id) renderLyricsContent();
  }
  function updateLyricsActive(pos, instant) {
    if (!S.lyricsOn || S.view !== 'now') return;
    const L = S.lyrics.get(curId());
    if (!L || L.kind !== 'synced') return;
    const col = $('#ly-col');
    if (!col) return;
    let a = -1;
    let lo = 0;
    let hi = L.lines.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (L.lines[mid].t <= pos + 0.2) {
        a = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (a === S.lyActive && !instant) return;
    S.lyActive = a;
    const kids = col.children;
    for (let i = 0; i < kids.length; i++) {
      kids[i].className = 'ly-line' + (i === a ? ' cur' : i < a ? ' past' : '');
      if (i === a) kids[i].setAttribute('aria-current', 'true');
      else kids[i].removeAttribute('aria-current');
    }
    const target = kids[Math.max(a, 0)];
    if (!target) return;
    if (Date.now() < lyFreeUntil) return;
    lyCenter(target, instant);
  }
  /* the whole text can be scrolled by hand; following the song pauses for a few seconds after that */
  let lyFreeUntil = 0;
  let lyFreeT = null;
  function lyCenter(target, instant) {
    const sc = $('#ly-scroll');
    const col = $('#ly-col');
    if (!sc || !col || !target) return;
    const half = Math.round(sc.clientHeight / 2) + 'px';
    if (col.style.paddingTop !== half) {
      col.style.paddingTop = half;
      col.style.paddingBottom = half;
      instant = true;
    }
    const top = target.offsetTop + target.offsetHeight / 2 - sc.clientHeight / 2;
    if (Math.abs(sc.scrollTop - top) < 1) return;
    sc.scrollTo({ top, behavior: instant || reduced ? 'auto' : 'smooth' });
  }
  function lyFollow(on) {
    clearTimeout(lyFreeT);
    const b = $('.ly-follow');
    if (on) {
      lyFreeUntil = 0;
      if (b) b.hidden = true;
      S.lyActive = -2;
      updateLyricsActive(currentPos(), false);
      return;
    }
    lyFreeUntil = Date.now() + 5000;
    if (b) b.hidden = false;
    lyFreeT = setTimeout(() => lyFollow(true), 5000);
  }
  const onLyHand = (e) => { if (e.target.closest && e.target.closest('#ly-scroll')) lyFollow(false); };
  doc.addEventListener('wheel', onLyHand, { passive: true });
  doc.addEventListener('touchstart', onLyHand, { passive: true });
  doc.addEventListener('keydown', (e) => {
    if (/^(PageUp|PageDown|ArrowUp|ArrowDown|Home|End)$/.test(e.key)) onLyHand(e);
  });

  /* ---------- queue drawer ---------- */
  const Q_INDENTS = [74, 44, 20, 58, 68, 32, 20, 50];
  const idHash = (str) => {
    let h = 7;
    for (let k = 0; k < str.length; k++) h = (h * 31 + str.charCodeAt(k)) | 0;
    return Math.abs(h);
  };
  function queueThumb(t, size, border, shadow) {
    return '<span aria-hidden="true" style="flex:none;position:relative;width:' + size[0] + 'px;height:' + size[1] + 'px;rotate:' + size[2] + 'deg">' +
      (shadow ? '<span style="position:absolute;inset:0;background:#0b0b0b;transform:translate(' + shadow + 'px,' + shadow + 'px)"></span>' : '') +
      '<span style="position:absolute;inset:0;background:' + border + ';padding:' + size[3] + 'px"><span style="display:block;width:100%;height:100%;overflow:hidden">' + coverImg(t.album, true) + '</span></span></span>';
  }
  const ZZ = (w, h, inset, fg, bg) => '<span aria-hidden="true" style="flex:none;position:relative;width:' + w + 'px;height:' + h + 'px;margin:0 -14px 0 -10px;z-index:1"><span class="q-zz" style="position:absolute;inset:0;background:' + bg + '"></span>' + (fg ? '<span class="q-zz" style="position:absolute;inset:' + inset + ';background:' + fg + '"></span>' : '') + '</span>';
  function queueHeart(size, right, top, rot) {
    return '<span aria-hidden="true" style="position:absolute;right:' + right + 'px;top:' + top + 'px;width:' + size + 'px;height:' + size + 'px;rotate:' + rot + 'deg;pointer-events:none">' + heartFull(size, { stroke: 34 }) + '</span>';
  }
  function renderQueue() {
    if (isP3()) {
      renderQueueP3();
      return;
    }
    if (isMF()) {
      renderQueueMF();
      return;
    }
    const el = $('#queue');
    const t = curTrack();
    const prevT = P.cur > 0 ? TR.get(P.queue[P.cur - 1]) : null;
    const up = P.queue.slice(P.cur + 1);
    const remaining = up.reduce((s, id) => s + ((TR.get(id) || {}).sec || 0), 0) + Math.max(0, currentDur() - currentPos());
    const meta = tracksWord(up.length) + ' впереди · ' + Math.round(remaining / 60) + ' мин';
    let rows = '';
    if (prevT) {
      rows += '<div class="q-row q-prev" style="position:relative;margin:0 0 6px 76px;transition-delay:.04s"><div style="display:flex;align-items:center">' +
        queueThumb(prevT, [78, 64, -5, 5], '#ff9aa0', 0) + ZZ(40, 50, 0, null, '#ff9aa0') +
        '<div style="flex:1;min-width:0;position:relative;height:62px;rotate:-1deg"><span aria-hidden="true" class="q-pl" style="position:absolute;inset:-4px;background:#ff9aa0"></span><span aria-hidden="true" class="q-pl" style="position:absolute;inset:0;background:#7d0a10"></span>' +
        '<button type="button" data-act="q-play" data-i="' + (P.cur - 1) + '" aria-label="Включить предыдущий: ' + esc(prevT.title) + '" style="position:relative;width:100%;height:100%;display:flex;align-items:center;background:none;border:0;padding:0 36px 0 26px;color:#ffb3b7;text-align:left;cursor:pointer;font-family:inherit">' +
        '<span style="display:block;min-width:0;font-weight:900;font-size:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(prevT.title) + '</span></button></div></div></div>';
    }
    rows += '<div class="q-row" style="position:relative;margin:22px 0 12px 22px;transition-delay:.08s"><span style="display:inline-block;background:#0b0b0b;color:#ffffff;padding:5px 12px 3px;font-family:\'Playfair Display\',serif;font-weight:900;font-size:26px;line-height:1.1;letter-spacing:.03em;transform:rotate(-3deg);box-shadow:4px 4px 0 #ffffff">ИГРАЕТ</span></div>';
    if (t) {
      rows += '<div class="q-row" style="position:relative;margin:0 0 6px 4px;transition-delay:.12s"><div style="display:flex;align-items:center">' +
        queueThumb(t, [96, 80, -6, 6], '#ffffff', 8) + ZZ(46, 60, '7px 5px', '#0b0b0b', '#ffffff') +
        '<div style="flex:1;min-width:0;position:relative;height:84px;rotate:-1.2deg"><span aria-hidden="true" class="q-pl" style="position:absolute;inset:-6px -8px -9px -5px;background:#ffffff"></span><span aria-hidden="true" class="q-pl" style="position:absolute;inset:0;background:#0b0b0b"></span>' +
        '<div style="position:relative;height:100%;display:flex;align-items:center;gap:12px;padding:0 40px 0 28px">' + eqBars(3, '#ff3c5a', 4, 20) +
        '<span style="flex:1;min-width:0;display:block"><span style="display:block;font-weight:900;font-size:22px;color:#ff3c5a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(t.title) + '</span>' +
        '<span style="display:block;margin-top:3px;font-weight:500;font-size:13px;color:#b5b5b5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(t.artist) + ' · <span data-b="elapsed">' + fmt(currentPos()) + '</span> / <span data-b="total">' + fmt(currentDur()) + '</span></span></span></div>' +
        (S.liked[t.id] ? queueHeart(52, 14, -32, 12) : '') + '</div></div></div>';
    }
    rows += '<div class="q-row" style="position:relative;margin:26px 0 16px 26px;transition-delay:.16s"><span style="display:inline-block;font-family:\'Rubik Mono One\',sans-serif;font-weight:400;font-size:22px;line-height:1;color:#ffffff;-webkit-text-stroke:5px #0b0b0b;paint-order:stroke fill;transform:rotate(-4deg)">ДАЛЕЕ</span></div>';
    const Q_MAX = 60;
    up.slice(0, Q_MAX).forEach((id, j) => {
      const i = P.cur + 1 + j;
      const q = TR.get(id);
      if (!q) return;
      const liked = !!S.liked[id];
      const hv = idHash(id);
      const odd = (hv >> 4) & 1;
      rows += '<div class="q-row q-drow" style="position:relative;margin:0 0 24px ' + Q_INDENTS[hv % Q_INDENTS.length] + 'px;transition-delay:' + (0.2 + Math.min(j, 12) * 0.05).toFixed(2) + 's">' +
        '<div class="q-item" data-qi="' + i + '" style="position:relative;display:flex;align-items:center">' +
        queueThumb(q, [84, 70, odd ? 4 : -6, 5], '#ffffff', 7) + ZZ(42, 54, '6px 4px', '#0b0b0b', '#ffffff') +
        '<div style="flex:1;min-width:0;position:relative;height:74px;rotate:' + (odd ? 0.9 : -1.4) + 'deg"><span aria-hidden="true" class="q-pl" style="position:absolute;inset:-5px -7px -8px -4px;background:#ffffff"></span><span aria-hidden="true" class="q-pl" style="position:absolute;inset:0;background:#0b0b0b"></span>' +
        '<div style="position:relative;height:100%;display:flex;align-items:center;gap:6px;padding:0 30px 0 24px">' +
        '<button type="button" data-act="q-play" data-i="' + i + '" aria-label="Включить: ' + esc(q.title) + '" style="flex:1;min-width:0;align-self:stretch;display:flex;flex-direction:column;justify-content:center;background:none;border:0;padding:0;color:#ffffff;text-align:left;cursor:pointer;font-family:inherit">' +
        '<span style="display:block;max-width:100%;font-weight:900;font-size:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(q.title) + '</span>' +
        '<span style="display:block;max-width:100%;margin-top:3px;font-weight:500;font-size:12px;color:#a8a8a8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(q.artist + ' · ' + fmtDur(q.sec)) + '</span></button>' +
        '<button class="grip" type="button" data-grip="' + i + '" aria-label="Переместить «' + esc(q.title) + '» в очереди: стрелки вверх и вниз"><span aria-hidden="true"></span><span aria-hidden="true"></span></button>' +
        '</div>' + (liked ? queueHeart(48, 26, -30, 10) : '') + '</div></div></div>';
    });
    if (up.length > Q_MAX) {
      rows += '<p class="q-row" style="position:relative;margin:0 0 18px 96px;display:inline-block;background:#0b0b0b;color:#ffffff;border:3px solid #ffffff;padding:10px 18px;font-weight:900;font-size:15px;transform:rotate(-1.5deg)">…и ещё ' + tracksWord(up.length - Q_MAX) + '</p>';
    }
    if (!up.length) {
      rows += '<p class="q-row" style="position:relative;margin:0 0 0 96px;display:inline-block;background:#0b0b0b;color:#ffffff;border:3px solid #ffffff;padding:14px 20px;font-weight:900;font-size:16px;transform:rotate(-2deg)">Это последний трек — дальше очередь начнётся сначала</p>';
    }
    rows += '<p class="q-row" style="position:relative;margin:18px 0 0 96px;font-weight:700;font-size:13px;color:#ffffff;transition-delay:.4s">Нажмите на трек, чтобы включить его. Перетащите за полоски, чтобы поменять порядок.</p>';

    const scroll = el.querySelector('.q-body');
    const top = scroll ? scroll.scrollTop : 0;
    el.innerHTML =
      '<div style="position:relative;flex:none;height:250px;background:#0b0b0b;overflow:hidden">' +
      '<div aria-hidden="true" style="position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,0.06) 1.4px, transparent 1.7px);background-size:11px 11px"></div>' +
      '<div aria-hidden="true" style="position:absolute;right:-40px;top:-30px;width:360px;height:220px;background:#5e070c;clip-path:polygon(20% 0%, 100% 0%, 100% 80%, 40% 100%, 55% 55%, 0% 62%)"></div>' +
      spark('right:210px;top:16px', 50, '#ffc21a', 0) +
      '<div aria-hidden="true" style="position:absolute;left:0;right:0;top:44px;height:150px;background:#ffffff;clip-path:polygon(0% 0%, 68% 42%, 68% 66%, 100% 74%, 100% 100%, 0% 100%)"></div>' +
      '<div aria-hidden="true" style="position:absolute;left:0;right:0;top:146px;height:96px;background:#0b0b0b;clip-path:polygon(0% 26%, 100% 0%, 100% 66%, 0% 100%)"></div>' +
      '<div aria-hidden="true" style="position:absolute;left:0;right:0;bottom:0;height:22px;background:#ffffff;clip-path:polygon(0% 100%, 0% 62%, 100% 0%, 100% 40%)"></div>' +
      '<h2 style="position:absolute;left:30px;top:66px;margin:0;display:flex;align-items:center;transform:rotate(-4deg)"><span class="sr">Очередь</span><span aria-hidden="true" style="display:flex;align-items:center;color:#0b0b0b">' +
      '<span style="display:inline-block;font-family:\'Dela Gothic One\',sans-serif;font-size:58px;line-height:1;transform:rotate(-4deg)">О</span>' +
      '<span style="display:inline-block;font-family:\'Rubik Mono One\',sans-serif;font-size:52px;line-height:1;transform:rotate(3deg) translateY(-3px)">Ч</span>' +
      '<span style="display:inline-block;font-family:\'Dela Gothic One\',sans-serif;font-size:50px;line-height:1;padding:0 5px;background:#ffffff;border:6px solid #0b0b0b;transform:rotate(-6deg);margin:0 2px">Е</span>' +
      '<span style="display:inline-block;font-family:\'Playfair Display\',serif;font-weight:900;font-size:62px;line-height:1;transform:rotate(5deg)">Р</span>' +
      '<span style="display:inline-block;font-family:\'Rubik Mono One\',sans-serif;font-size:50px;line-height:1;transform:rotate(-3deg) translateY(4px)">Е</span>' +
      '<span style="display:inline-block;font-family:\'Dela Gothic One\',sans-serif;font-size:56px;line-height:1;transform:rotate(4deg)">Д</span>' +
      '<span style="display:inline-block;font-family:\'Playfair Display\',serif;font-weight:900;font-style:italic;font-size:60px;line-height:1;transform:rotate(-5deg)">Ь</span></span></h2>' +
      '<p style="position:absolute;left:44px;right:30px;top:178px;margin:0;display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px;transform:rotate(-2.5deg)"><span style="font-weight:900;font-size:22px;color:#ffffff">' + esc(queueSourceLabel()) + '</span><span style="font-weight:700;font-size:14px;color:#b5b5b5">' + esc(meta) + '</span></p>' +
      P5_CLOSE('queue-close', 'Закрыть очередь') +
      '</div>' +
      '<div class="q-body"><div style="position:relative;min-height:100%;padding:26px 26px 34px 14px;background-image:radial-gradient(circle at 88% 30%, transparent 0 110px, rgba(0,0,0,0.09) 111px 150px, transparent 151px), radial-gradient(circle at 30% 78%, transparent 0 140px, rgba(0,0,0,0.08) 141px 185px, transparent 186px), radial-gradient(circle at 75% 92%, rgba(0,0,0,0.07) 0 90px, transparent 91px)">' +
      '<div aria-hidden="true" style="position:absolute;left:22px;top:0;bottom:0;width:86px;background:#0b0b0b;clip-path:polygon(42% 0%, 70% 0%, 46% 8%, 86% 17%, 40% 27%, 82% 37%, 36% 47%, 80% 57%, 38% 67%, 84% 77%, 40% 87%, 66% 100%, 38% 100%, 12% 87%, 56% 77%, 6% 67%, 50% 57%, 4% 47%, 52% 37%, 8% 27%, 56% 17%, 14% 8%)"></div>' +
      rows + '</div></div>';
    const ns = el.querySelector('.q-body');
    if (ns) ns.scrollTop = top;
  }
  function queueSourceLabel() {
    const ids = P.base.length ? P.base : P.queue;
    if (!ids.length) return 'Очередь пуста';
    const albums = uniq(ids.map((id) => (TR.get(id) || {}).album));
    const a = albums.length === 1 ? AL.get(albums[0]) : null;
    const allLiked = ids.every((id) => S.liked[id]);
    if (a && ids.length === a.tracks.length) return a.short || a.title;
    if (allLiked) return 'Ваша библиотека';
    return a ? a.short || a.title : 'Смешанная очередь';
  }
  /* ---------- settings drawer (empty for now — settings will be added later) ---------- */
  let appVersion = '';
  function renderSettings() {
    const el = $('#settings');
    if (isP3()) {
      el.innerHTML = settingsP3Html();
      return;
    }
    if (isMF()) {
      el.innerHTML = settingsMFHtml();
      return;
    }
    el.innerHTML =
      '<div class="s-head">' +
      '<div aria-hidden="true" style="position:absolute;inset:0;background-image:radial-gradient(rgba(0,0,0,0.22) 2px, transparent 2.4px);background-size:13px 13px"></div>' +
      '<div aria-hidden="true" class="s-gear" style="right:-70px;top:-80px;width:300px;height:300px;opacity:.9"><svg viewBox="0 0 48 48" width="300" height="300"><path d="' + GEAR_D + '" fill="#8e0a10" fill-rule="evenodd"></path></svg></div>' +
      '<div aria-hidden="true" style="position:absolute;left:0;right:0;top:34px;height:150px;background:#0b0b0b;clip-path:polygon(0% 8%, 74% 0%, 70% 22%, 100% 30%, 100% 88%, 0% 100%)"></div>' +
      '<div aria-hidden="true" style="position:absolute;left:0;right:0;bottom:0;height:26px;background:#0b0b0b;clip-path:polygon(0% 100%, 0% 40%, 100% 0%, 100% 100%)"></div>' +
      '<div aria-hidden="true" style="position:absolute;left:0;right:0;bottom:20px;height:8px;background:#ffffff;clip-path:polygon(0% 100%, 0% 60%, 100% 0%, 100% 40%)"></div>' +
      spark('right:250px;top:176px', 40, '#ffc21a', 0) +
      '<h2 style="position:absolute;left:26px;top:70px;margin:0;display:flex;align-items:center;transform:rotate(-4deg)"><span class="sr">Настройки</span><span aria-hidden="true" style="display:flex;align-items:center">' + letters(T_SET, true) + '</span></h2>' +
      P5_CLOSE('settings-close', 'Закрыть настройки') +
      '</div>' +
      '<div class="s-body"><div style="position:relative;min-height:100%;padding:56px 34px 40px;display:flex;flex-direction:column;overflow:clip">' +
      '<div aria-hidden="true" class="s-gear" style="left:-120px;bottom:-140px;width:420px;height:420px;animation-direction:reverse;animation-duration:30s"><svg viewBox="0 0 48 48" width="420" height="420"><path d="' + GEAR_D + '" fill="none" fill-rule="evenodd" stroke="rgba(255,255,255,0.07)" style="stroke-width:.5"></path></svg></div>' +
      '<p class="s-row s5-cap" style="transition-delay:.08s">ТЕМА ОФОРМЛЕНИЯ</p>' +
      '<div class="s5-list" role="radiogroup" aria-label="Тема оформления">' +
      THEMES.map((th, i) => '<button type="button" role="radio" class="s5-opt s-row' + (S.theme === th.id ? ' is-on' : '') + '" data-act="set-theme" data-theme-id="' + th.id + '" aria-checked="' + (S.theme === th.id) + '" style="transition-delay:' + (0.12 + i * 0.06).toFixed(2) + 's">' +
        '<span class="s5-sh" aria-hidden="true"></span><span class="s5-ol" aria-hidden="true"></span><span class="s5-in">' + themePreview(th.id) +
        '<span class="s5-txt"><span class="s5-name">' + th.name.toUpperCase() + '</span><span class="s5-sub">' + th.sub + '</span></span></span>' +
        (S.theme === th.id ? '<span class="s5-on" aria-hidden="true">ВЫБРАНО</span>' : '') + '</button>').join('') +
      '</div>' +
      '<p class="s-row s5-cap" style="margin-top:40px;transition-delay:.22s">ЗВУК</p>' +
      (LEVEL_OK ? '<button type="button" role="switch" class="s5-opt s5-sw s-row' + (S.level ? ' is-on' : '') + '" data-act="level-toggle" aria-checked="' + S.level + '" style="transition-delay:.25s">' +
      '<span class="s5-sh" aria-hidden="true"></span><span class="s5-ol" aria-hidden="true"></span><span class="s5-in">' +
      '<span class="s5-txt"><span class="s5-name">ВЫРАВНИВАТЬ ГРОМКОСТЬ</span><span class="s5-sub">Тихие и громкие альбомы звучат одинаково</span></span><span class="sw" aria-hidden="true"><i></i></span></span></button>' : '') +
      '<button type="button" role="switch" class="s5-opt s5-sw s-row' + (S.xfade ? ' is-on' : '') + '" data-act="xfade-toggle" aria-checked="' + S.xfade + '" style="transition-delay:.27s">' +
      '<span class="s5-sh" aria-hidden="true"></span><span class="s5-ol" aria-hidden="true"></span><span class="s5-in">' +
      '<span class="s5-txt"><span class="s5-name">ПЛАВНЫЙ ПЕРЕХОД</span><span class="s5-sub">Следующий трек начинается без паузы, под конец текущего</span></span><span class="sw" aria-hidden="true"><i></i></span></span></button>' +
      '<div style="flex:1"></div>' +
      '<p class="s-row" style="margin:48px 0 0;align-self:flex-end;display:inline-flex;align-items:center;gap:10px;background:#ffffff;color:#0b0b0b;padding:6px 16px;font-weight:900;font-style:italic;font-size:13px;letter-spacing:.1em;transform:skewX(-12deg) rotate(2deg);transition-delay:.26s">PERSONAFY' + (appVersion ? ' · ВЕРСИЯ ' + esc(appVersion) : '') + '</p>' +
      '</div></div>';
  }
  function setTheme(th) {
    if (!THEMES.some((x) => x.id === th) || th === S.theme) return;
    swapUnderWipe(() => {
      S.theme = th;
      doc.documentElement.dataset.theme = th;
      saveNow();
      $('.nav-in', $('#nav')).innerHTML = navHtml();
      renderMini(false);
      mountView(S.view, true);
      if (S.qOpen) renderQueue();
      if (S.sOpen) {
        renderSettings();
        const r = $('#settings [data-act=set-theme][aria-checked=true]');
        if (r) r.focus({ preventScroll: true });
      }
    });
  }
  function openSettings() {
    if (S.sOpen) return;
    if (S.qOpen) closeQueue(true);
    S.sOpen = true;
    renderSettings();
    const el = $('#settings');
    void el.offsetWidth;
    el.classList.add('open');
    $('#q-dim').classList.add('open');
    $$('[data-act=settings-open]').forEach((b) => b.setAttribute('aria-expanded', 'true'));
    setTimeout(() => {
      const c = el.querySelector('[data-act=settings-close]');
      if (c) c.focus({ preventScroll: true });
    }, 60);
  }
  function closeSettings(silent) {
    if (!S.sOpen) return;
    S.sOpen = false;
    $('#settings').classList.remove('open');
    if (!S.qOpen) $('#q-dim').classList.remove('open');
    $$('[data-act=settings-open]').forEach((b) => {
      b.setAttribute('aria-expanded', 'false');
      if (!silent) b.focus({ preventScroll: true });
    });
  }

  function openQueue() {
    if (S.qOpen) return;
    if (S.sOpen) closeSettings(true);
    S.qOpen = true;
    renderQueue();
    const el = $('#queue');
    void el.offsetWidth;
    el.classList.add('open');
    $('#q-dim').classList.add('open');
    $$('[data-act=queue-open]').forEach((b) => b.setAttribute('aria-expanded', 'true'));
    setTimeout(() => {
      const c = el.querySelector('[data-act=queue-close]');
      if (c) c.focus({ preventScroll: true });
      const cur = el.querySelector('.q-body');
      if (cur && P.cur > 3) cur.scrollTop = 0;
    }, 60);
  }
  function closeQueue(silent) {
    if (!S.qOpen) return;
    S.qOpen = false;
    if (QD) qDragEnd(true);
    $('#queue').classList.remove('open');
    if (!S.sOpen) $('#q-dim').classList.remove('open');
    $$('[data-act=queue-open]').forEach((b) => {
      b.setAttribute('aria-expanded', 'false');
      if (!silent) b.focus({ preventScroll: true });
    });
  }
  function moveInQueue(from, to) {
    if (from == null || from === to || from <= P.cur || to <= P.cur || to >= P.queue.length || from >= P.queue.length) return false;
    const item = P.queue.splice(from, 1)[0];
    P.queue.splice(to, 0, item);
    save();
    onQueueChange();
    return true;
  }

  /* ---------- mini player ---------- */
  function renderMini(first) {
    const t = curTrack();
    if (isP3()) {
      $('#mini').innerHTML = miniP3(t, first);
      updateTimes();
      return;
    }
    if (isMF()) {
      $('#mini').innerHTML = miniMF(t, first);
      updateTimes();
      return;
    }
    $('#mini').innerHTML = '<div class="' + (first ? 'rise' : '') + '" style="animation-delay:.45s">' +
      '<div class="mini-prog">' +
      '<div class="mp-clip" aria-hidden="true"><div class="mp-track"></div><div class="mp-fill" data-b="fill"></div></div>' +
      '<span class="mp-knob" data-b="thumb" aria-hidden="true"></span>' +
      '<span class="mp-time l" data-b="elapsed-t" aria-hidden="true"></span><span class="mp-time r" data-b="total-t" aria-hidden="true"></span>' +
      '<input type="range" class="range" data-b="range" min="0" max="1" step="1" value="0" aria-label="Позиция в треке"></div>' +
      '<div class="mini-bar"><div class="mini-in">' +
      '<button type="button" class="mini-now" data-act="go-now" aria-label="Открыть экран «Сейчас играет»">' +
      '<span class="mini-art" aria-hidden="true">' + (t ? coverImg(t.album, true) : '<span class="cov-fallback"></span>') + '</span>' +
      '<span style="min-width:0;display:block"><span class="mini-t">' + esc(t ? t.title : 'Выберите трек') + '</span><span class="mini-a">' + esc(t ? t.artist : 'в «Поиске» или «Библиотеке»') + '</span></span></button>' +
      '<div class="mini-ctl">' +
      '<button class="hop ibtn" type="button" data-act="shuffle" aria-label="Случайный порядок" aria-pressed="' + P.shuffle + '"><svg viewBox="0 0 48 48" width="36" height="36" aria-hidden="true">' +
      '<path d="M6 14 H14 L32 34 H40" fill="none" style="stroke:var(--sh);stroke-width:5;stroke-linejoin:round;stroke-linecap:round"></path><path d="M6 34 H14 L32 14 H40" fill="none" style="stroke:var(--sh);stroke-width:5;stroke-linejoin:round;stroke-linecap:round"></path>' +
      '<path d="M34 7 L42 14 L34 21" fill="none" style="stroke:var(--sh);stroke-width:5;stroke-linejoin:round;stroke-linecap:round"></path><path d="M34 27 L42 34 L34 41" fill="none" style="stroke:var(--sh);stroke-width:5;stroke-linejoin:round;stroke-linecap:round"></path></svg></button>' +
      '<button class="hop ibtn" type="button" data-act="prev" aria-label="Предыдущий трек"><svg viewBox="0 0 48 48" width="38" height="38" aria-hidden="true" style="filter:drop-shadow(2px 2px 0 #d4141a)"><polygon points="25,9 5,24 25,39 20,24" fill="#ffffff" stroke="#0b0b0b" style="stroke-width:3;stroke-linejoin:round"></polygon><polygon points="44,9 24,24 44,39 39,24" fill="#ffffff" stroke="#0b0b0b" style="stroke-width:3;stroke-linejoin:round"></polygon></svg></button>' +
      '<button class="hop" type="button" data-act="toggle-play" aria-label="Играть или пауза" style="position:relative;width:66px;height:66px;background:none;border:0;padding:0;cursor:pointer">' +
      '<span aria-hidden="true" style="position:absolute;inset:4px;background:#d4141a;transform:translate(5px,5px) rotate(-8deg)"></span><span aria-hidden="true" style="position:absolute;inset:4px;background:#0b0b0b;border:4px solid #ffffff;transform:rotate(-8deg)"></span>' +
      '<span aria-hidden="true" style="position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%">' +
      '<svg class="ico-pause" viewBox="0 0 48 48" width="34" height="34"><polygon points="11,7 22,7 17,41 6,41" fill="#ffffff"></polygon><polygon points="31,7 42,7 37,41 26,41" fill="#ffffff"></polygon></svg>' +
      '<svg class="ico-play" viewBox="0 0 48 48" width="36" height="36"><polygon points="13,6 43,24 13,42 19,24" fill="#ffffff"></polygon></svg></span></button>' +
      '<button class="hop ibtn" type="button" data-act="next" aria-label="Следующий трек"><svg viewBox="0 0 48 48" width="38" height="38" aria-hidden="true" style="filter:drop-shadow(2px 2px 0 #d4141a)"><polygon points="23,9 43,24 23,39 28,24" fill="#ffffff" stroke="#0b0b0b" style="stroke-width:3;stroke-linejoin:round"></polygon><polygon points="4,9 24,24 4,39 9,24" fill="#ffffff" stroke="#0b0b0b" style="stroke-width:3;stroke-linejoin:round"></polygon></svg></button>' +
      repBtn('ibtn', repIcon(36, 'mini5')) +
      (t ? likeBtn(t.id, 'mini') : '') + '</div>' +
      '<div class="mini-vol">' + volHtml(false) + '</div>' +
      '</div></div></div>';
    updateTimes();
  }

  /* ---------- view switching & fly-by transition ---------- */
  const VIEWS = { home: viewHome, search: viewSearch, library: viewLibrary, now: () => (isP3() ? viewNowP3() : isMF() ? viewNowMF() : viewNow()) };
  let nowFrom = 'home';
  function mountView(view, anim) {
    if (view === 'now' && S.view !== 'now') nowFrom = S.view || 'home';
    S.view = view;
    doc.body.dataset.view = view;
    if (view !== 'library') {
      S.selecting = false;
      S.sel.clear();
      S.unsel.clear();
    } else {
      S.libIds = computeLibIds();
    }
    $('.nav-in', $('#nav')).innerHTML = navHtml();
    $('#nav').classList.remove('nav-hide');
    navLastTop = 0;
    const v = $('#view');
    v.classList.toggle('still', !anim);
    v.innerHTML = decorHtml(view) + VIEWS[view]();
    v.scrollTop = 0;
    afterMount();
  }
  function afterMount() {
    if (S.view === 'now') {
      updateNowBits();
      updateTimes();
      if (S.lyricsOn) {
        const t = curTrack();
        if (t) ensureLyrics(t);
        requestAnimationFrame(() => updateLyricsActive(currentPos(), true));
      }
    } else {
      updateTimes();
    }
  }
  function focusKey() {
    const a = doc.activeElement;
    if (!a || a === doc.body || a.id === 'view') return null;
    if (a.id) return '#' + a.id;
    if (a.dataset && a.dataset.act) {
      return '[data-act="' + a.dataset.act + '"]' + (a.dataset.id ? '[data-id="' + sel(a.dataset.id) + '"]' : '') + (a.dataset.sort ? '[data-sort="' + a.dataset.sort + '"]' : '');
    }
    if (a.dataset && a.dataset.nav) return '[data-nav="' + a.dataset.nav + '"]';
    return null;
  }
  function renderView() {
    const v = $('#view');
    const top = v.scrollTop;
    const fk = focusKey();
    v.classList.add('still');
    if (S.view === 'library') S.libIds = computeLibIds();
    v.innerHTML = decorHtml(S.view) + VIEWS[S.view]();
    v.scrollTop = top;
    if (fk) {
      const el = $(fk);
      if (el) el.focus({ preventScroll: true });
    }
    afterMount();
  }

  let navBusy = false;
  let navQueued = null;
  /* P5: the black band of the transition carries the destination's name in cut-out letters */
  const T_NOWW = [['И', 'W', 'd', 54, '4px 10px', -6, 0], ['Г', 'RB', 'pi', 62, '0 9px', 5, -3], ['Р', 'K', 'm', 42, '7px 9px', -3, -2], ['А', 'WR', 'p', 60, '0 8px', 7, -3], ['Е', 'K', 'd', 50, '4px 9px', -5, -3], ['Т', 'R', 'm', 44, '7px 9px', 4, -2]];
  const WIPE_WORD = { home: T_HOME, search: T_SEARCH, library: T_LIB, now: T_NOWW };
  function setWipeWord(view) {
    const el = $('#wipe-word');
    if (el) el.innerHTML = view && WIPE_WORD[view] && isP5() ? '<span class="w5-wi">' + letters(WIPE_WORD[view], false) + '</span>' : '';
    const mw = $('#wipe-mf-word');
    if (mw) mw.innerHTML = view && MF_WIPE[view] && isMF() ? mfWord(MF_WIPE[view], 0.02) : '';
  }
  /* queued: a section asked for during the last wipe — a panel opened since then stays open over it */
  function go(view, queued) {
    closeTrackMenu();
    if (S.qOpen && !queued) closeQueue(true);
    if (S.sOpen && !queued) closeSettings(true);
    if (view === S.view && !navBusy) {
      if (view === 'search' && (S.openAlbum || S.query)) {
        S.openAlbum = null;
        S.query = '';
        mountView('search', true);
      } else {
        $('#view').scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }
    if (reduced) {
      mountView(view, true);
      return;
    }
    if (navBusy) {
      navQueued = view;
      return;
    }
    navBusy = true;
    const wipe = $('#wipe');
    const body = $('.wipe-body', wipe);
    wipeOrigin(wipe);
    setWipeWord(view);
    /* Metaphor: the paint starts in this section's colours and blends into the next one's while it covers the screen */
    wipe.dataset.mfTo = view;
    wipe.classList.add('run');
    wipe.dataset.phase = 'out';
    body.className = 'wipe-body wipe-out';
    setTimeout(() => {
      const target = navQueued || view;
      navQueued = null;
      mountView(target, true);
      wipe.dataset.phase = 'in';
      body.className = 'wipe-body wipe-in';
      setTimeout(() => {
        wipe.classList.remove('run');
        wipe.dataset.phase = '';
        body.className = 'wipe-body';
        navBusy = false;
        if (navQueued && navQueued !== S.view) {
          const v = navQueued;
          navQueued = null;
          go(v, true);
        }
        navQueued = null;
      }, 460);
    }, 280);
  }
  /* Android's back button/gesture (mobile/android, MainActivity): close what is open, else step back a screen.
     false — nothing left to close: the app goes to the background and the music keeps playing */
  function backStep() {
    if (ctx) {
      closeTrackMenu();
      return true;
    }
    if (S.sOpen) {
      closeSettings();
      return true;
    }
    if (S.qOpen) {
      closeQueue();
      return true;
    }
    if (S.selecting) {
      setSelecting(false);
      return true;
    }
    if (S.view === 'search' && S.openAlbum) {
      S.openAlbum = null;
      renderSearchBody(true);
      return true;
    }
    if (S.view === 'now') {
      go(nowFrom && nowFrom !== 'now' ? nowFrom : 'home');
      return true;
    }
    if (S.view !== 'home') {
      go('home');
      return true;
    }
    return false;
  }
  if (PHONE) window.personafyBack = backStep;

  function introReveal() {
    if (reduced) return;
    const wipe = $('#wipe');
    const body = $('.wipe-body', wipe);
    navBusy = true;
    setWipeWord(null);
    wipe.classList.add('run');
    wipe.dataset.phase = 'in';
    body.className = 'wipe-body wipe-in';
    setTimeout(() => {
      wipe.classList.remove('run');
      wipe.dataset.phase = '';
      body.className = 'wipe-body';
      navBusy = false;
    }, 460);
  }
  /* the P3R water wipe grows from wherever the click happened */
  let lastPress = null;
  doc.addEventListener('pointerdown', (e) => { lastPress = [e.clientX, e.clientY]; }, true);
  function wipeOrigin(wipe) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pt = lastPress || [w / 2, h / 2];
    wipe.style.setProperty('--ox', Math.round(pt[0]) + 'px');
    wipe.style.setProperty('--oy', Math.round(pt[1]) + 'px');
  }
  /* cover with the current theme's wipe, run fn underneath, reveal with whatever theme is active then */
  function swapUnderWipe(fn) {
    if (reduced || navBusy) {
      fn();
      return;
    }
    navBusy = true;
    const wipe = $('#wipe');
    const body = $('.wipe-body', wipe);
    wipeOrigin(wipe);
    setWipeWord(null);
    wipe.classList.add('run');
    wipe.dataset.phase = 'out';
    body.className = 'wipe-body wipe-out';
    setTimeout(() => {
      fn();
      wipe.dataset.phase = 'in';
      body.className = 'wipe-body wipe-in';
      setTimeout(() => {
        wipe.classList.remove('run');
        wipe.dataset.phase = '';
        body.className = 'wipe-body';
        navBusy = false;
      }, 460);
    }, 300);
  }

  /* ---------- events ---------- */
  function playFromList(listKey, i, id) {
    let ids = S.lists[listKey] || [];
    if (listKey === 'lib') ids = ids.filter((x) => S.liked[x] || x === id);
    const idx = ids.indexOf(id);
    if (id && id === curId() && P.loadedId === id) {
      togglePlay();
      return;
    }
    playList(ids, idx >= 0 ? idx : i);
  }
  function playTrackInAlbum(id) {
    const t = TR.get(id);
    if (!t) return;
    if (id === curId()) {
      if (P.loadedId !== id || audio.paused) togglePlay();
    } else {
      const a = albumOf(t);
      const ids = a ? a.tracks : [id];
      playList(ids, ids.indexOf(id));
    }
    go('now');
  }

  /* own window buttons (the system title bar is gone) */
  function setWinState(st) {
    const max = !!(st && (st.max || st.full));
    doc.body.classList.toggle('win-max', max);
    const b = $('#titlebar [data-win=max]');
    if (b) {
      b.setAttribute('aria-label', max ? 'Свернуть в окно' : 'Развернуть');
      b.title = max ? 'Свернуть в окно' : 'Развернуть';
    }
  }
  $('#titlebar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-win]');
    if (!b || !api.win) return;
    if (b.dataset.win === 'min') api.win.minimize();
    else if (b.dataset.win === 'max') api.win.toggleMaximize();
    else if (b.dataset.win === 'close') api.win.close();
  });

  doc.addEventListener('click', (e) => {
    if (ctx && !e.target.closest('#ctx') && e.target.closest('[data-act=track-menu]') !== ctx.opener) closeTrackMenu();
    const navBtn = e.target.closest('[data-nav]');
    if (navBtn) {
      go(navBtn.dataset.nav);
      return;
    }
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const id = el.dataset.id;
    switch (el.dataset.act) {
      case 'play': playFromList(el.dataset.list, +el.dataset.i, id); break;
      case 'home-play': playTrackInAlbum(id); break;
      case 'like': toggleLike(id); break;
      case 'go-now': go('now'); break;
      case 'toggle-play': togglePlay(); break;
      case 'mute': toggleMute(); break;
      case 'prev': prev(); break;
      case 'next': next(); break;
      case 'shuffle': toggleShuffle(); break;
      case 'repeat': toggleRepeat(); break;
      case 'level-toggle': setLevel(!S.level); break;
      case 'xfade-toggle': setXfade(!S.xfade); break;
      case 'track-menu':
        if (ctx && ctx.opener === el) closeTrackMenu();
        else openTrackMenu(id, el.dataset.list, +el.dataset.i, null, el, e.detail === 0);
        break;
      case 'ctx': runTrackMenu(el.dataset.ctx); break;
      case 'open-album':
        S.openAlbum = id;
        S.query = '';
        if (S.view === 'search') {
          renderSearchBody(true);
          $('#view').scrollTo({ top: 0 });
        } else go('search');
        break;
      case 'close-album':
        S.openAlbum = null;
        renderSearchBody(true);
        break;
      case 'play-album': {
        const a = AL.get(id);
        if (a) playList(a.tracks, 0, { shuffle: false });
        break;
      }
      case 'shuffle-album': {
        const a = AL.get(id);
        if (a) playList(a.tracks, Math.floor(Math.random() * a.tracks.length), { shuffle: true });
        break;
      }
      case 'clear-q': {
        S.query = '';
        const q = $('#q');
        if (q) {
          q.value = '';
          q.focus();
        }
        renderSearchBody();
        break;
      }
      case 'lib-play': {
        const ids = S.libIds.filter((x) => S.liked[x]);
        if (!ids.length) toast('В библиотеке пока нет треков — добавьте их сердечком');
        else playList(ids, 0, { shuffle: false });
        break;
      }
      case 'lib-shuffle': {
        const ids = S.libIds.filter((x) => S.liked[x]);
        if (!ids.length) toast('В библиотеке пока нет треков — добавьте их сердечком');
        else playList(ids, Math.floor(Math.random() * ids.length), { shuffle: true });
        break;
      }
      case 'lib-sort':
        if (S.libSort !== el.dataset.sort) {
          S.libSort = el.dataset.sort;
          S.libIds = computeLibIds();
          save();
          renderLibStats();
          renderLibList({ anim: true });
        }
        break;
      case 'lib-select':
        if (!S.selecting && !S.libIds.length) {
          toast('Сначала добавьте треки в библиотеку — потом их можно скачать');
          break;
        }
        setSelecting(!S.selecting);
        break;
      case 'sel':
        if (S.sel.has(id)) S.sel.delete(id);
        else S.sel.add(id);
        refreshRowBox(id);
        renderSelPanel();
        break;
      case 'unsel':
        if (S.unsel.has(id)) S.unsel.delete(id);
        else S.unsel.add(id);
        refreshRowBox(id);
        renderSelPanel();
        break;
      case 'sel-all': {
        const pool = selectable();
        const all = pool.length > 0 && pool.every((x) => S.sel.has(x));
        S.sel = all ? new Set() : new Set(pool);
        renderLibList({});
        break;
      }
      case 'sel-cancel': setSelecting(false); break;
      case 'sel-download': {
        const ids = Array.from(S.sel);
        const rm = Array.from(S.unsel);
        setSelecting(false);
        startDownloads(ids);
        if (rm.length) removeDownloads(rm);
        break;
      }
      case 'sel-remove': {
        const rm = Array.from(S.unsel);
        S.unsel.clear();
        removeDownloads(rm).then(() => {
          if (S.view === 'library' && S.selecting) renderLibList({});
        });
        renderSelPanel();
        break;
      }
      case 'lyrics': {
        S.lyricsOn = !S.lyricsOn;
        save();
        el.setAttribute('aria-pressed', String(S.lyricsOn));
        if (isP5()) {
          el.style.background = S.lyricsOn ? '#ffffff' : '#0b0b0b';
          el.style.color = S.lyricsOn ? '#0b0b0b' : '#ffffff';
        }
        const t = curTrack();
        if (S.lyricsOn && t) ensureLyrics(t);
        renderArt(true);
        break;
      }
      case 'ly-follow': lyFollow(true); break;
      case 'ly-seek': {
        lyFollow(true);
        seek(parseFloat(el.dataset.t) || 0);
        if (P.loadedId !== curId() || audio.paused) togglePlay();
        break;
      }
      case 'queue-open': openQueue(); break;
      case 'queue-close': closeQueue(); break;
      case 'settings-open': if (S.sOpen) closeSettings(); else openSettings(); break;
      case 'settings-close': closeSettings(); break;
      case 'set-theme': setTheme(el.dataset.themeId); break;
      case 'dim-close': if (S.sOpen) closeSettings(); if (S.qOpen) closeQueue(); break;
      case 'q-play': {
        const i = +el.dataset.i;
        closeQueue();
        jump(i);
        break;
      }
      default: break;
    }
  });

  doc.addEventListener('contextmenu', (e) => {
    const w = e.target.closest && e.target.closest('.row-wrap');
    if (!w) return;
    const b = w.querySelector('[data-act=play]');
    if (!b) return;
    e.preventDefault();
    openTrackMenu(b.dataset.id, b.dataset.list, +b.dataset.i, [e.clientX, e.clientY], w.querySelector('[data-act=track-menu]'), false);
  });
  window.addEventListener('resize', () => closeTrackMenu());
  window.addEventListener('blur', () => closeTrackMenu());

  doc.addEventListener('input', (e) => {
    const tg = e.target;
    if (tg.id === 'q') {
      S.query = tg.value;
      const clr = $('[data-act=clear-q]');
      if (clr) clr.hidden = !S.query;
      clearTimeout(S.qT);
      S.qT = setTimeout(renderSearchBody, 140);
    } else if (tg.matches && tg.matches('[data-b=range]')) {
      S.scrub = +tg.value;
      updateTimes();
    } else if (tg.matches && tg.matches('[data-b=vol-range]')) {
      setVolume(+tg.value / 100, { silent: true });
    }
  });
  doc.addEventListener('change', (e) => {
    const tg = e.target;
    if (tg.matches && tg.matches('[data-b=range]')) {
      const v = +tg.value;
      S.scrub = null;
      seek(v);
    }
  });
  doc.addEventListener('pointerup', () => {
    if (S.scrub != null) {
      const v = S.scrub;
      S.scrub = null;
      seek(v);
    }
  });

  /* touch (the phone): a slider jumps to where the finger lands and follows it — iOS sliders otherwise only move
     by their thumb, and ours are invisible. The input itself ignores touches there (phone.css), its box takes them. */
  if (PHONE) {
    let TS = null;
    const rangeIn = (el) => {
      for (let n = el, k = 0; n && n !== doc.body && k < 5; n = n.parentElement, k++) {
        const r = n.matches('input.range') ? n : n.querySelector(':scope > input.range');
        if (r) return r;
      }
      return null;
    };
    const setFromX = (el, x) => {
      const r = el.getBoundingClientRect();
      const min = +el.min || 0;
      const max = +el.max || 100;
      const v = Math.round(min + clamp((x - r.left) / (r.width || 1), 0, 1) * (max - min));
      if (String(el.value) !== String(v)) {
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
    doc.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const el = rangeIn(e.target);
      if (!el) return;
      e.preventDefault();
      TS = { el, id: e.pointerId };
      setFromX(el, e.clientX);
    }, { passive: false });
    doc.addEventListener('pointermove', (e) => {
      if (!TS || e.pointerId !== TS.id) return;
      e.preventDefault();
      setFromX(TS.el, e.clientX);
    }, { passive: false });
    const endScrub = (e) => {
      if (!TS || e.pointerId !== TS.id) return;
      const el = TS.el;
      TS = null;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    doc.addEventListener('pointerup', endScrub);
    doc.addEventListener('pointercancel', endScrub);

    /* a long press on a track opens its menu — the right click of the phone */
    let LP = null;
    const lpCancel = () => {
      if (!LP) return;
      clearTimeout(LP.t);
      if (LP.fired) setTimeout(() => { LP = null; }, 400);
      else LP = null;
    };
    doc.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      const w = e.target.closest && e.target.closest('.row-wrap');
      if (!w || e.target.closest('.like-btn, .row-more, .sel-box')) return;
      const b = w.querySelector('[data-act=play]');
      if (!b) return;
      if (LP) clearTimeout(LP.t);
      const st = { x: e.clientX, y: e.clientY, fired: false };
      st.t = setTimeout(() => {
        st.fired = true;
        openTrackMenu(b.dataset.id, b.dataset.list, +b.dataset.i, [st.x, st.y], w.querySelector('[data-act=track-menu]'), false);
      }, 480);
      LP = st;
    }, true);
    doc.addEventListener('pointermove', (e) => {
      if (LP && !LP.fired && (Math.abs(e.clientX - LP.x) > 8 || Math.abs(e.clientY - LP.y) > 8)) lpCancel();
    }, true);
    doc.addEventListener('pointerup', lpCancel, true);
    doc.addEventListener('pointercancel', lpCancel, true);
    $('#view').addEventListener('scroll', lpCancel, { passive: true });
    doc.addEventListener('click', (e) => {
      if (LP && LP.fired) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);

    /* the player bar has no skip buttons on the phone: drag it left for the next track, right for the previous one.
       The bar follows the finger, flies off, and the new track slides in from the other side. */
    const mini = $('#mini');
    let SW = null;
    let swiped = false;
    mini.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!e.target.closest('.mini-bar') || e.target.closest('[data-act=toggle-play]')) return;
      SW = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, on: false, t0: performance.now() };
    });
    window.addEventListener('pointermove', (e) => {
      if (!SW || e.pointerId !== SW.id) return;
      const dx = e.clientX - SW.x0;
      const dy = e.clientY - SW.y0;
      if (!SW.on) {
        if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) {
          SW = null;
          return;
        }
        if (Math.abs(dx) < 10) return;
        SW.on = true;
        SW.el = mini.querySelector('.mini-in');
        if (!SW.el) {
          SW = null;
          return;
        }
        SW.el.style.transition = 'none';
      }
      /* with nothing to switch to, the bar only gives a little */
      SW.dx = P.queue.length > 1 ? dx : dx * 0.25;
      SW.el.style.transform = 'translateX(' + SW.dx + 'px) rotate(' + (SW.dx / 90).toFixed(2) + 'deg)';
      SW.el.style.opacity = String(1 - Math.min(0.55, Math.abs(SW.dx) / 420));
    });
    const endSwipe = (e) => {
      if (!SW || e.pointerId !== SW.id) return;
      const s = SW;
      SW = null;
      if (!s.on) return;
      swiped = true;
      setTimeout(() => { swiped = false; }, 350);
      const speed = s.dx / Math.max(1, performance.now() - s.t0);
      const goes = e.type !== 'pointercancel' && P.queue.length > 1 && (Math.abs(s.dx) > 70 || Math.abs(speed) > 0.6);
      if (!goes || reduced) {
        s.el.style.transition = 'transform .28s cubic-bezier(.2,.9,.3,1.3), opacity .2s';
        s.el.style.transform = '';
        s.el.style.opacity = '';
        if (goes) (s.dx < 0 ? next() : prev(true));
        return;
      }
      const dir = s.dx < 0 ? -1 : 1;
      s.el.style.transition = 'transform .15s ease-in, opacity .15s ease-in';
      s.el.style.transform = 'translateX(' + dir * window.innerWidth + 'px) rotate(' + dir * 6 + 'deg)';
      s.el.style.opacity = '0';
      setTimeout(() => {
        if (dir < 0) next();
        else prev(true);
        const n = mini.querySelector('.mini-in');
        if (n && n.animate) {
          n.animate([{ transform: 'translateX(' + (-dir * 70) + '%) rotate(' + (-dir * 4) + 'deg)', opacity: 0 }, { transform: 'none', opacity: 1 }],
            { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1.15)' });
        }
      }, 140);
    };
    window.addEventListener('pointerup', endSwipe);
    window.addEventListener('pointercancel', endSwipe);
    /* a swipe that ends over the track's name must not also open "Now playing" */
    mini.addEventListener('click', (e) => {
      if (!swiped) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
    /* "Now playing" stands still on the phone (no scrolling): pull it down to close it, like a sheet,
       back to the screen it was opened from. The lyrics and the position slider keep their own drags. */
    const viewEl = $('#view');
    let PD = null;
    let pulled = false;
    viewEl.addEventListener('pointerdown', (e) => {
      if (S.view !== 'now' || (e.pointerType === 'mouse' && e.button !== 0)) return;
      if (e.target.closest('input, .ly-scroll, .ly-plain')) return;
      PD = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dy: 0, on: false, t0: performance.now() };
    });
    window.addEventListener('pointermove', (e) => {
      if (!PD || e.pointerId !== PD.id) return;
      const dx = e.clientX - PD.x0;
      const dy = e.clientY - PD.y0;
      if (!PD.on) {
        if ((Math.abs(dx) > 14 && Math.abs(dx) > Math.abs(dy)) || dy < -14) {
          PD = null;
          return;
        }
        if (dy < 12) return;
        PD.on = true;
        /* the whole interface goes down with the finger — screen, tabs and the theme's background alike */
        PD.el = $('#app');
        if (!PD.el) {
          PD = null;
          return;
        }
        PD.el.style.transition = 'none';
      }
      PD.dy = Math.max(0, dy);
      PD.el.style.transform = 'translateY(' + PD.dy + 'px)';
      PD.el.style.opacity = String(1 - Math.min(0.45, PD.dy / 800));
    });
    const endPull = (e) => {
      if (!PD || e.pointerId !== PD.id) return;
      const s = PD;
      PD = null;
      if (!s.on) return;
      pulled = true;
      setTimeout(() => { pulled = false; }, 350);
      const speed = s.dy / Math.max(1, performance.now() - s.t0);
      const goes = e.type !== 'pointercancel' && S.view === 'now' && (s.dy > 120 || speed > 0.7);
      if (!goes) {
        s.el.style.transition = 'transform .3s cubic-bezier(.2,.9,.3,1.2), opacity .2s';
        s.el.style.transform = '';
        s.el.style.opacity = '';
        return;
      }
      s.el.style.transition = 'transform .18s ease-in, opacity .18s ease-in';
      s.el.style.transform = 'translateY(' + window.innerHeight + 'px)';
      s.el.style.opacity = '0';
      setTimeout(() => {
        if (S.view === 'now') backStep();
        /* the screen it returns to comes up in place */
        s.el.style.transition = 'none';
        s.el.style.transform = '';
        s.el.style.opacity = '';
        if (s.el.animate && !reduced) s.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
      }, 190);
    };
    window.addEventListener('pointerup', endPull);
    window.addEventListener('pointercancel', endPull);
    viewEl.addEventListener('click', (e) => {
      if (!pulled) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
    /* the first start says how it works, once */
    try {
      if (!localStorage.getItem('personafy.swipe-hint')) {
        localStorage.setItem('personafy.swipe-hint', '1');
        setTimeout(() => toast('Треки переключаются свайпом: проведите по плееру внизу влево или вправо', { teal: true, ms: 5000 }), 2500);
      }
    } catch (e) { /* storage unavailable: no hint */ }
  }

  /* the section menu shows only while nothing on the page sits under it: at the top of the page,
     and on the way up again only once the content has moved out from under the menu */
  let navLimit = Infinity;
  const NAV_BLOCKS = '.row-wrap, .card, .rank, .band-red, .p3-label, .label-a, .label-b, .search-field, .btn, .chip, .found-h, .hint, .alb-cov, .alb-tag, .alb-title, .alb-meta, #sel-panel, #lib-stats > *, .p3-date, .p5-date, .mf-label, .mf-hud';
  function layoutBox(el, root) {
    let x = 0;
    let y = 0;
    let n = el;
    while (n && n !== root) {
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent;
    }
    return n === root ? { x, y, w: el.offsetWidth, h: el.offsetHeight } : null;
  }
  function applyNav() {
    $('#nav').classList.toggle('nav-hide', $('#view').scrollTop > navLimit);
  }
  function measureNav() {
    /* on the phone the sections are a bar at the bottom: nothing ever slides under it */
    if (PHONE) {
      navLimit = Infinity;
      applyNav();
      return;
    }
    const v = $('#view');
    const nav = $('#nav');
    const items = $$('.pm-it, .tab-nav, .mf-it', nav);
    let L = Infinity;
    let R = -Infinity;
    let B = -Infinity;
    items.forEach((it) => {
      const b = layoutBox(it, nav);
      if (!b) return;
      L = Math.min(L, b.x);
      R = Math.max(R, b.x + b.w);
      B = Math.max(B, b.y + b.h);
    });
    if (!isFinite(B)) {
      navLimit = Infinity;
      return;
    }
    L += nav.offsetLeft - 14;
    R += nav.offsetLeft + 14;
    B += nav.offsetTop + 12;
    let lim = Infinity;
    $$(NAV_BLOCKS, v).forEach((el) => {
      if (!el.offsetWidth || !el.offsetHeight) return;
      const b = layoutBox(el, v);
      if (!b || b.x + b.w <= L || b.x >= R || b.y < B) return;
      lim = Math.min(lim, b.y - B);
    });
    navLimit = lim;
    applyNav();
  }
  let navMeasureT = null;
  const scheduleNavMeasure = () => {
    clearTimeout(navMeasureT);
    navMeasureT = setTimeout(measureNav, 120);
  };
  new MutationObserver((recs) => {
    if (recs.every((r) => r.target.nodeType === 1 && (r.target.closest('[data-b], .dl-slot, #ly-body, .ly-tag') || r.target.matches('[data-b]')))) return;
    scheduleNavMeasure();
  }).observe($('#view'), { childList: true, subtree: true });
  window.addEventListener('resize', scheduleNavMeasure);
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(scheduleNavMeasure);

  let scrollIdle = null;
  $('#view').addEventListener('scroll', () => {
    const v = $('#view');
    if (ctx && Math.abs(v.scrollTop - ctx.top0) > 6) closeTrackMenu();
    if (!v.classList.contains('is-scrolling')) v.classList.add('is-scrolling');
    applyNav();
    clearTimeout(scrollIdle);
    scrollIdle = setTimeout(() => v.classList.remove('is-scrolling'), 160);
  }, { passive: true });

  /* a button clicked with the mouse keeps the focus, and Space would press it again instead of pausing:
     after a mouse click (detail > 0; keyboard presses report 0) the focus is let go */
  doc.addEventListener('click', (e) => {
    if (!e.detail) return;
    const b = e.target.closest && e.target.closest('button');
    if (b && b === doc.activeElement) b.blur();
  });

  doc.addEventListener('keydown', (e) => {
    const tg = e.target;
    const tag = tg && tg.tagName;
    const isText = (tag === 'INPUT' && tg.type !== 'range') || tag === 'TEXTAREA';
    if (ctx) {
      if (e.key === 'Escape' || e.key === 'Tab') {
        if (e.key === 'Escape') e.preventDefault();
        closeTrackMenu(e.key === 'Escape');
        return;
      }
      const items = $$('.ctx-it', ctx.el);
      const k = items.indexOf(doc.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        let n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : k + (e.key === 'ArrowDown' ? 1 : -1);
        if (k < 0 && e.key === 'ArrowUp') n = items.length - 1;
        items[(n + items.length) % items.length].focus();
        return;
      }
    }
    if (e.key === 'Escape') {
      if (S.sOpen) {
        e.preventDefault();
        closeSettings();
      } else if (S.qOpen) {
        e.preventDefault();
        closeQueue();
      } else if (S.selecting) {
        setSelecting(false);
      } else if (isText && tg.id === 'q' && S.query) {
        S.query = '';
        tg.value = '';
        renderSearchBody();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') {
      e.preventDefault();
      if (S.view !== 'search') {
        go('search');
        setTimeout(() => { const q = $('#q'); if (q) q.focus(); }, reduced ? 0 : 400);
      } else {
        const q = $('#q');
        if (q) {
          q.focus();
          q.select();
        }
      }
      return;
    }
    if (tg && tg.classList && tg.classList.contains('grip')) {
      const i = +tg.dataset.grip;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const to = e.key === 'ArrowUp' ? i - 1 : i + 1;
        if (flipQueue(() => moveInQueue(i, to))) {
          const g = $('[data-grip="' + to + '"]');
          if (g) g.focus();
        }
      }
      return;
    }
    if (isText) return;
    if (e.code === 'Space' && tag !== 'BUTTON' && tag !== 'A' && tag !== 'INPUT') {
      e.preventDefault();
      togglePlay();
      return;
    }
    if (tag === 'INPUT') return;
    if (e.code === 'KeyR' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      toggleRepeat();
      return;
    }
    if (e.ctrlKey && e.code === 'ArrowRight') {
      e.preventDefault();
      next();
    } else if (e.ctrlKey && e.code === 'ArrowLeft') {
      e.preventDefault();
      prev();
    } else if (e.ctrlKey && e.code === 'ArrowUp') {
      e.preventDefault();
      setVolume(S.volume + 0.05);
    } else if (e.ctrlKey && e.code === 'ArrowDown') {
      e.preventDefault();
      setVolume(S.volume - 0.05);
    } else if (!e.ctrlKey && !e.altKey && e.code === 'ArrowRight' && tag !== 'BUTTON') {
      e.preventDefault();
      seek(currentPos() + 5);
    } else if (!e.ctrlKey && !e.altKey && e.code === 'ArrowLeft' && tag !== 'BUTTON') {
      e.preventDefault();
      seek(currentPos() - 5);
    }
  });

  /* queue: pick a track up by its grip (or drag the row itself a little), the others slide apart,
     the list scrolls near its edges, and the track settles into its new place on release */
  const qEl = $('#queue');
  let QD = null;
  qEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || QD) return;
    const item = e.target.closest('[data-qi]');
    if (!item) return;
    const row = item.closest('.q-drow');
    if (!row) return;
    const grip = !!e.target.closest('.grip');
    QD = { pid: e.pointerId, x0: e.clientX, y0: e.clientY, y: e.clientY, row, from: +item.dataset.qi, active: false, moved: false };
    if (grip) {
      e.preventDefault();
      qDragStart();
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (!QD || e.pointerId !== QD.pid) return;
    QD.y = e.clientY;
    if (!QD.active) {
      if (Math.abs(e.clientY - QD.y0) < 7) return;
      qDragStart();
    }
    e.preventDefault();
    qDragMove();
  }, { passive: false });
  window.addEventListener('pointerup', (e) => { if (QD && e.pointerId === QD.pid) qDragEnd(false); });
  window.addEventListener('pointercancel', (e) => { if (QD && e.pointerId === QD.pid) qDragEnd(true); });
  /* a drag that began on the row must not also count as a click on it */
  qEl.addEventListener('click', (e) => {
    if (qEl.dataset.justDragged) {
      e.stopPropagation();
      e.preventDefault();
      delete qEl.dataset.justDragged;
    }
  }, true);

  function qDragStart() {
    const body = qEl.querySelector('.q-body');
    const rows = $$('.q-drow', qEl);
    const k = rows.indexOf(QD.row);
    if (!body || k < 0) {
      QD = null;
      return;
    }
    QD.active = true;
    QD.body = body;
    QD.top0 = body.scrollTop;
    QD.rows = rows.map((el) => ({ el, i: +el.querySelector('[data-qi]').dataset.qi, top: el.offsetTop, h: el.offsetHeight }));
    QD.k = k;
    QD.to = k;
    /* the distance from one row to the next is the gap a row leaves when it moves */
    QD.outer = QD.rows.map((r, n) => (n < QD.rows.length - 1 ? QD.rows[n + 1].top - r.top : (n > 0 ? r.top - QD.rows[n - 1].top : r.h)));
    body.classList.add('q-dragging');
    QD.row.classList.add('q-lift');
    doc.body.classList.add('q-grabbing');
    qAutoScroll();
  }
  function qDragDy() {
    return QD.y - QD.y0 + (QD.body.scrollTop - QD.top0);
  }
  function qDragMove() {
    const dy = qDragDy();
    const R = QD.rows;
    const me = R[QD.k];
    const mid = me.top + me.h / 2 + dy;
    let to = QD.k;
    for (let n = QD.k + 1; n < R.length; n++) if (mid > R[n].top + R[n].h / 2) to = n;
    for (let n = QD.k - 1; n >= 0; n--) if (mid < R[n].top + R[n].h / 2) to = n;
    QD.to = to;
    const gap = QD.outer[QD.k];
    R.forEach((r, n) => {
      if (n === QD.k) return;
      const shift = n > QD.k && n <= to ? -gap : n < QD.k && n >= to ? gap : 0;
      r.el.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
    });
    me.el.style.transform = 'translateY(' + dy + 'px)';
  }
  function qAutoScroll() {
    if (!QD || !QD.active) return;
    const b = QD.body.getBoundingClientRect();
    const edge = 70;
    let v = 0;
    if (QD.y < b.top + edge) v = -Math.ceil((b.top + edge - QD.y) / 5);
    else if (QD.y > b.bottom - edge) v = Math.ceil((QD.y - (b.bottom - edge)) / 5);
    if (v) {
      const before = QD.body.scrollTop;
      QD.body.scrollTop = before + clamp(v, -18, 18);
      if (QD.body.scrollTop !== before) qDragMove();
    }
    requestAnimationFrame(qAutoScroll);
  }
  function qDragEnd(cancel) {
    const st = QD;
    if (!st) return;
    QD = null;
    if (!st.active) return;
    qEl.dataset.justDragged = '1';
    setTimeout(() => { delete qEl.dataset.justDragged; }, 0);
    doc.body.classList.remove('q-grabbing');
    const R = st.rows;
    const to = cancel ? st.k : st.to;
    let dyEnd = 0;
    if (to > st.k) for (let n = st.k + 1; n <= to; n++) dyEnd += st.outer[n];
    else for (let n = to; n < st.k; n++) dyEnd -= st.outer[n];
    const me = R[st.k].el;
    me.classList.add('q-settle');
    me.style.transform = 'translateY(' + dyEnd + 'px)';
    if (cancel) R.forEach((r, n) => { if (n !== st.k) r.el.style.transform = ''; });
    const finish = () => {
      me.classList.remove('q-lift', 'q-settle');
      st.body.classList.remove('q-dragging');
      if (to !== st.k && moveInQueue(st.from, R[to].i)) return;
      R.forEach((r) => { r.el.style.transform = ''; });
    };
    if (reduced) finish();
    else setTimeout(finish, 190);
  }

  /* keyboard moves (grip + arrows) slide the rows too */
  function flipQueue(fn) {
    const body = qEl.querySelector('.q-body');
    const before = new Map();
    $$('.q-drow', qEl).forEach((el) => {
      const it = el.querySelector('[data-qi]');
      if (it) before.set(P.queue[+it.dataset.qi] + '#' + it.dataset.qi, el.getBoundingClientRect().top);
    });
    const ids = P.queue.slice();
    const ok = fn();
    if (!ok || reduced || !body) return ok;
    $$('.q-drow', qEl).forEach((el) => {
      const it = el.querySelector('[data-qi]');
      if (!it) return;
      const id = P.queue[+it.dataset.qi];
      const oldIdx = ids.indexOf(id, P.cur + 1);
      const was = before.get(id + '#' + oldIdx);
      if (was == null) return;
      const d = was - el.getBoundingClientRect().top;
      if (Math.abs(d) < 1) return;
      el.style.transition = 'none';
      el.style.transform = 'translateY(' + d + 'px)';
      void el.offsetHeight;
      el.style.transition = 'transform .24s cubic-bezier(.2,.9,.3,1), opacity .25s';
      el.style.transform = '';
      setTimeout(() => { el.style.transition = ''; }, 260);
    });
    return ok;
  }

  window.addEventListener('online', () => { toast('Интернет снова есть', { key: 'net', teal: true, ms: 1800 }); updateNowBits(); });
  window.addEventListener('offline', () => { toast('Пропал интернет — играют только скачанные треки', { key: 'net' }); updateNowBits(); });
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(() => { updateLyricsActive(currentPos(), true); fitN3Tags(); fitNow(); });

  /* durations / artists of newly added tracks arrive in small batches while the player reads them from Drive */
  let metaRedraw = null;
  function onMetaEvent(list) {
    if (!Array.isArray(list)) return;
    let textChanged = false;
    let relookCur = false;
    list.forEach((u) => {
      const t = u && TR.get(u.id);
      if (!t) return;
      let lyricsStale = false;
      if (u.sec > 0 && !t.sec) {
        t.sec = u.sec;
        lyricsStale = true;
        $$('[data-row="' + sel(t.id) + '"] .row-d').forEach((el) => { el.textContent = fmtDur(t.sec); });
      }
      if (u.artist && u.artist !== t.artist) {
        t.artist = u.artist;
        t._n = null;
        textChanged = true;
        lyricsStale = true;
      }
      /* a "no lyrics" answer looked up before the duration/artist were known is worth asking again */
      const L = lyricsStale ? S.lyrics.get(t.id) : null;
      if (L && L.kind === 'none') {
        S.lyrics.delete(t.id);
        if (t.id === curId()) relookCur = true;
      }
      const a = AL.get(u.album);
      if (a && a.auto) {
        if (u.year && !a.year) { a.year = u.year; textChanged = true; }
        if (u.albumArtist && u.albumArtist !== a.artist) { a.artist = u.albumArtist; textChanged = true; }
      }
    });
    if (relookCur && S.lyricsOn) ensureLyrics(TR.get(curId()));
    const albumOpen = S.view === 'search' && S.openAlbum && list.some((u) => u && u.album === S.openAlbum);
    if (!textChanged) {
      const el = albumOpen ? $('.alb-meta') : null;
      if (el) el.textContent = albumMetaText(AL.get(S.openAlbum));
      return;
    }
    clearTimeout(metaRedraw);
    metaRedraw = setTimeout(() => {
      if (S.view === 'now') updateNowTrack();
      else if (S.view !== 'library' || !S.selecting) renderView();
      renderMini(false);
      if (S.qOpen) renderQueue();
    }, 1200);
  }

  /* ---------- catalog refresh from Google Drive ---------- */
  async function refreshCatalog() {
    let r = null;
    try {
      r = await api.refreshCatalog();
    } catch (e) {
      return;
    }
    if (!r || !r.ok || !r.catalog || !Array.isArray(r.catalog.tracks) || !r.catalog.tracks.length) return;
    const before = new Set(CAT.tracks.map((t) => t.id + '|' + t.file));
    const sig = r.catalog.tracks.map((t) => t.id + '|' + t.file);
    /* a cover changed on Drive counts too, so the new picture shows without a restart */
    const covers = (c) => c.albums.map((a) => a.id + '|' + (a.cover || '') + '|' + (a.coverFile || '')).join(',');
    const changed = sig.length !== before.size || sig.some((s) => !before.has(s)) || r.catalog.albums.length !== CAT.albums.length ||
      covers(r.catalog) !== covers(CAT);
    if (!changed) return;
    const oldIds = new Set(CAT.tracks.map((t) => t.id));
    const cid = curId();
    setCatalog(r.catalog);
    const added = r.catalog.tracks.filter((t) => !oldIds.has(t.id)).length;
    P.queue = P.queue.filter((id) => TR.has(id));
    P.base = P.base.filter((id) => TR.has(id));
    const ni = P.queue.indexOf(cid);
    P.cur = ni >= 0 ? ni : clamp(P.cur, 0, Math.max(0, P.queue.length - 1));
    if (!P.queue.length && CAT.albums.length) {
      P.queue = CAT.albums[0].tracks.slice();
      P.base = P.queue.slice();
      P.cur = 0;
    }
    if (S.view === 'now') updateNowBits();
    else renderView();
    renderMini(false);
    save();
    if (added) toast('На диске появились новые треки: ' + added, { teal: true });
  }

  /* ---------- start ---------- */
  async function init() {
    let cat = null;
    try {
      cat = await api.catalog();
    } catch (e) {
      cat = null;
    }
    setCatalog(cat && Array.isArray(cat.tracks) ? cat : { albums: [], tracks: [] });
    applyVolume();
    doc.body.classList.toggle('shuf', P.shuffle);
    setRepeat(S.repeat, true);

    const q = Array.isArray(stored.queue) ? stored.queue.filter((id) => TR.has(id)) : [];
    if (q.length) {
      const wanted = stored.queue[stored.cur | 0];
      P.queue = q;
      P.base = (Array.isArray(stored.base) ? stored.base : q).filter((id) => TR.has(id));
      P.cur = Math.max(0, q.indexOf(wanted));
      P.pendingSeek = typeof stored.t === 'number' && stored.t > 0 ? stored.t : null;
    } else if (CAT.albums.length) {
      const first = AL.get('p5') || CAT.albums[0];
      P.queue = first.tracks.slice();
      P.base = P.queue.slice();
      P.cur = Math.max(0, P.queue.indexOf('p5-17'));
    }

    renderMini(true);
    mountView('home', true);
    introReveal();
    onTrackChange();
    setupMediaSession();

    try {
      const list = await api.downloads();
      S.downloads = new Map((list || []).map((x) => [x.id, x.bytes]));
      S.downloads.forEach((_b, id) => updateDlUI(id));
    } catch (e) { /* no downloads yet */ }
    api.onDownload(onDownloadEvent);
    if (api.onMeta) api.onMeta(onMetaEvent);
    /* the phone keeps Drive covers on disk; when new ones arrive, the screens pick them up */
    if (api.onCovers) {
      api.onCovers(() => {
        renderView();
        renderMini(false);
        if (S.qOpen) renderQueue();
        artCache.clear();
        updateMediaSession();
      });
    }
    if (api.win) {
      api.win.onState(setWinState);
      api.win.state().then(setWinState).catch(() => {});
    }
    if (api.version) api.version().then((v) => { appVersion = String(v || ''); if (S.sOpen) renderSettings(); }).catch(() => {});
    setTimeout(refreshCatalog, 1200);
    setTimeout(prewarm, 4000);
  }

  /* the first switch to another theme stuttered while its fonts and paint textures were fetched and decoded:
     they are loaded quietly a few seconds after start, so the switch itself has nothing left to wait for */
  function prewarm() {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1));
    idle(() => {
      if (doc.fonts) doc.fonts.forEach((f) => { if (f.status === 'unloaded') f.load().catch(() => {}); });
      ['swathe1', 'swathe2', 'splat', 'scratch', 'grain', 'brush1', 'brush2', 'brush3'].forEach((n) => {
        const img = new Image();
        img.src = 'mf/' + n + '.webp';
        if (img.decode) img.decode().catch(() => {});
      });
    });
  }

  window.__phantom = { LV, S, P, TR, AL, go, playList, toggleLike, next, prev, seek, setVolume, renderQueue, openQueue, openSettings, closeSettings, setTheme };
  init();
})();
