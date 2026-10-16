/* Plasico fork of Intelekta OS /api/v1/public/chat/frame.js
 * Fix: `var mode = layout()` was shadowed by `var mode = 'online'|'offline'`,
 * so mobile open never applied fullscreen host/panel sizing or reportSize(full).
 * Served at /api/v1/public/chat/frame.js (same-origin) so API base stays correct.
 */
/* Чатът на сайта - прозорецът, в рамка от нашия адрес. Intelekta OS.
 *
 * Този код живее в `/api/v1/public/chat/frame`, в iframe, който зареждащият
 * скрипт на сайта (`widget.js`, по желание копиран на самия сайт) слага в
 * ъгъла. Браузърът разделя двата адреса: страницата на магазина не вижда
 * този код и жетона му, а той не вижда нея. Пробив при нас засяга само
 * прозорчето на чата, не касата на магазина.
 *
 * Със страницата се говори само с `postMessage`, и само с адресите от
 * Настройки → Входящи → Чат („Сайтове", в `<meta name="intelekta-parents">`):
 * тя казва на коя страница е посетителят, този код казва колко място иска.
 *
 * Отговорите се пазят на сървъра и бутонът ги взима сам - отговор, написан,
 * докато посетителят е бил на друга страница, пак го чака. Докато страницата
 * е отворена, бутонът държи поток (`/stream`), по който сървърът казва
 * „има ново" и „Пласико пише" веднага; питането на няколко секунди остава
 * като резерва, ако потокът го няма.
 *
 * Текстът от сървъра се слага само с `textContent`, никога с `innerHTML`:
 * той е написан от хора, единият от които е непознат.
 *
 * Преди първото съобщение - форма: имейлът е задължителен, телефонът е
 * препоръчителен, името - по желание. Щом сървърът знае имейла, формата не
 * се показва повече.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var API = new URL('.', script ? script.src : location.href).href.replace(/\/$/, '');
  var TOKEN_KEY = 'intelekta_chat_token';
  var SEEN_KEY = 'intelekta_chat_seen';
  var MUTE_KEY = 'intelekta_chat_muted';
  var OPEN_POLL_MS = 4000;
  var CLOSED_POLL_MS = 30000;
  // С отворен поток питането е само резерва.
  var STREAM_POLL_MS = 30000;
  var TYPING_SHOW_MS = 6000;
  var TYPING_SEND_MS = 3000;
  // Сървърът проверява вида по съдържание; тук е само за да се каже веднага.
  var MAX_FILE_BYTES = 10 * 1024 * 1024;
  var MAX_FILES_AT_ONCE = 5;
  var ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx';
  // Временната връзка към хранилището живее минути; пазим я по-кратко.
  var LINK_TTL_MS = 4 * 60 * 1000;

  // --- Страницата отвън -----------------------------------------------------

  var parentsMeta = document.querySelector('meta[name="intelekta-parents"]');
  var PARENTS = ((parentsMeta && parentsMeta.getAttribute('content')) || '')
    .split(/\s+/).filter(Boolean).concat([location.origin]);
  var parentOrigin = null;
  // На коя страница е посетителят. Идва от зареждащия скрипт; до тогава -
  // каквото браузърът е казал при отварянето на рамката.
  var page = { url: document.referrer || '', title: '' };
  var viewport = { width: 1024, height: 768 };

  window.addEventListener('message', function (e) {
    // Само от изброените сайтове и само от прозореца, който ни съдържа.
    if (e.source !== window.parent || PARENTS.indexOf(e.origin) < 0) return;
    var d = e.data || {};
    // Елемент на сайта („Чат" в горната лента) отваря прозореца.
    if (d.type === 'intelekta-chat:open') {
      if (!state.open) toggle(true);
      return;
    }
    // „Нов посетител" - само от нашия адрес (демо страницата). Чужд сайт не
    // може да изтрие разговора на човек от неговия браузър.
    if (d.type === 'intelekta-chat:reset' && e.origin === location.origin) {
      newVisitor();
      return;
    }
    if (d.type !== 'intelekta-chat:page') return;
    parentOrigin = e.origin;
    if (typeof d.url === 'string' && /^https?:\/\//i.test(d.url)) page.url = d.url.slice(0, 1000);
    if (typeof d.title === 'string') page.title = d.title.slice(0, 300);
    reportPresence();
    if (d.viewport && d.viewport.width > 0 && d.viewport.height > 0) {
      viewport = { width: d.viewport.width, height: d.viewport.height };
      if (typeof render === 'function') render();
    }
  });

  function tellParent(message) {
    if (window.parent === window) return;
    // Размерът не е тайна; до първото съобщение от страницата не знаем кой
    // точно е тя, затова тогава - към всеки.
    window.parent.postMessage(message, parentOrigin || '*');
  }

  // Текстовете - от дизайна на Пласико (github.com/simonavendi/plasicochat).
  // Работното време идва от настройките, не е написано тук.
  var T = {
    title: 'Пласико',
    titleOnline: ' на линия',
    titleOffline: ' извън линия',
    online: 'Пишете ни - отговаряме веднага в рамките на работното ни време {hours}.',
    onlineAlways: 'Пишете ни - отговаряме веднага.',
    offline: 'Пишете ни - ще ви отговорим в работно време {hours}.',
    offlineNoHours: 'Пишете ни - ще ви отговорим възможно най-скоро.',
    onlineLead: 'Не се притеснявайте да затворите този прозорец, чатът се запазва.',
    offlineNote: 'В момента сме извън работно време. Оставете данните и въпроса си и ще получите ' +
      'отговор, когато отново сме на линия.',
    launcher: 'Онлайн чат',
    placeholder: 'Напиши съобщение...',
    send: 'Изпрати',
    name: 'Име',
    email: 'Имейл (по желание)',
    phone: 'Телефон',
    emailNeeded: 'Моля, въведете имейл, за да можем да ви отговорим.',
    emailInvalid: 'Моля въведете Правилен email или продължете без.',
    nameNeeded: 'Моля, въведете име.',
    phoneNeeded: 'Моля, въведете телефон, за да можем да се свържем с вас.',
    messageNeeded: 'Напишете съобщение.',
    phoneInvalid: 'Моля, въведете валиден телефонен номер (напр. 0888 123 456 или +359 888 123 456).',
    privacy: 'Как пазим личните ви данни',
    tooMany: 'Твърде много съобщения. Опитайте след малко.',
    failed: 'Съобщението не беше изпратено. Опитайте отново.',
    empty: 'Здравей! 👋 Добре дошъл в Plasico – мястото за технологии, компютри и електроника. 💻✨\n\n' +
      'Можеш да ни попиташ за продукти, цени, характеристики, наличности, препоръки и всичко ' +
      'останало. Наш служител ще ти отговори в най-кратък срок.\n\n' +
      'Какво търсиш днес? 🚀',
    close: 'Затвори',
    attach: 'Прикачи файл',
    uploading: 'Качва се…',
    fileTooBig: 'Файлът е над 10 MB.',
    fileType: 'Приемаме снимки, PDF и файлове от Word, Excel и PowerPoint.',
    writeFirst: 'Първо напишете съобщение, после прикачете файл.',
    tooManyAtOnce: 'До 5 файла наведнъж.',
    agentTyping: 'Пласико пише…',
    soundOn: 'Звукът е включен',
    soundOff: 'Звукът е изключен',
    you: 'Вие'
  };

  // Същите правила като на сървъра (`schemas/public_chat.py`) - тук само за
  // да не чака човек отговор, за да разбере, че е сбъркал цифра. Пази
  // сървърът.
  var PHONE_SHAPE = /^\+?[0-9\s().\-]+$/;
  var EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /** `+` само отпред, цифри, интервали, тирета, точки, скоби; 8-15 цифри. */
  function validPhone(v) {
    v = String(v || '').trim();
    var digits = v.replace(/\D/g, '').length;
    return PHONE_SHAPE.test(v) && digits >= 8 && digits <= 15;
  }

  function validEmail(v) {
    return EMAIL_SHAPE.test(String(v || '').trim());
  }

  function storage(method, key, value) {
    // Частен режим или блокирани бисквитки: чатът работи до края на
    // страницата, вместо да не тръгне изобщо.
    try {
      if (method === 'get') return window.localStorage.getItem(key);
      if (method === 'set') window.localStorage.setItem(key, value);
      if (method === 'del') window.localStorage.removeItem(key);
    } catch (e) {}
    return null;
  }

  var memoryToken = null;
  function getToken() { return storage('get', TOKEN_KEY) || memoryToken; }
  function setToken(t) { memoryToken = t; storage('set', TOKEN_KEY, t); }
  function dropToken() { memoryToken = null; storage('del', TOKEN_KEY); }

  function request(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(API + path, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'omit'
    }).then(function (r) {
      var retryAfter = Number(r.headers.get('Retry-After')) || 0;
      if (r.status === 204) return { status: 204, data: null, retryAfter: retryAfter };
      return r.json().then(
        function (data) { return { status: r.status, data: data, retryAfter: retryAfter }; },
        function () { return { status: r.status, data: null, retryAfter: retryAfter }; }
      );
    });
  }

  // Едно искане наведнъж. Отварянето на прозореца и първото съобщение го
  // искат почти едновременно; без това излизаха два жетона, и вторият -
  // по-нов - започваше чакането отначало.
  var tokenRequest = null;
  function ensureToken() {
    if (getToken()) return Promise.resolve();
    if (!tokenRequest) {
      tokenRequest = request('POST', '/visitors').then(function (res) {
        tokenRequest = null;
        if (res.status !== 201) throw res;
        setToken(res.data.token);
      }, function (err) {
        tokenRequest = null;
        throw err;
      });
    }
    return tokenRequest;
  }

  // --- Звук -----------------------------------------------------------------
  //
  // Нов отговор и изпратено съобщение. Тонове от Web Audio, не файлове.
  // Изключва се с иконата в прозореца, за този браузър. Браузърът пуска звук
  // чак след щракване в рамката - отварянето на чата е такова.

  var audioCtx = null;

  function audio() {
    if (!audioCtx) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      try { audioCtx = new Ctor(); } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(function () {});
    return audioCtx;
  }

  function muted() { return storage('get', MUTE_KEY) === 'true'; }

  function tone(ctx, at, freq, length, loud, to) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    var start = ctx.currentTime + at;
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, start);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, start + length);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(loud, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + length + 0.02);
  }

  function chime(kind) {
    if (muted()) return;
    var ctx = audio();
    if (!ctx || ctx.state !== 'running') return;
    if (kind === 'message') {
      tone(ctx, 0, 880, 0.16, 0.2);
      tone(ctx, 0.14, 1175, 0.2, 0.18);
    } else {
      tone(ctx, 0, 520, 0.09, 0.08, 780);
    }
  }

  // --- DOM -----------------------------------------------------------------
  //
  // Видът - по дизайна на Пласико: зелен кръгъл бутон, бял прозорец с прави
  // ъгли, данните в един ред, полето за текст с линия отдолу. На телефон
  // отвореният прозорец е на целия екран под горната лента на сайта (виж
  // `reportSize` и зареждащия скрипт).

  var GREEN = '#07a857';
  var GREEN_HOVER = '#06964c';
  // Иконите са вградени SVG елементи, не `data:` адреси: CSP-то на рамката
  // (`img-src`) не пуска `data:`, и така трябва да остане.
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var ICONS = {
    bubble: { fill: '#fff', d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H10l-4.2 ' +
      '3.15A.75.75 0 0 1 4.5 18.5V16A2.5 2.5 0 0 1 4 13.5v-8Z' },
    send: { stroke: '#4b5563', d: 'M5 12h14M13 5l7 7-7 7' },
    clip: { stroke: '#6b7280', d: 'm21 11-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 ' +
      '8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9' },
    sound: { stroke: '#6b7280', d: 'M11 5 6 9H2v6h4l5 4V5z M15.5 8.5a5 5 0 0 1 0 7 M19 5a10 10 0 0 1 0 14' },
    mute: { stroke: '#6b7280', d: 'M11 5 6 9H2v6h4l5 4V5z M22 9l-6 6 M16 9l6 6' }
  };

  function icon(name, size) {
    var spec = ICONS[name];
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', spec.fill || 'none');
    if (spec.stroke) {
      svg.setAttribute('stroke', spec.stroke);
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
    }
    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', spec.d);
    svg.appendChild(path);
    return svg;
  }

  // Под тази ширина на страницата отвън - режимът за телефон (както в
  // дизайна: там горната лента на сайта сменя вида си).
  var MOBILE_WIDTH = 990;
  // Нисък лаптоп - по-сбит прозорец.
  var SHORT_HEIGHT = 800;

  var host = document.createElement('div');
  var root = host.attachShadow({ mode: 'open' });

  var css = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '[hidden]{display:none!important}',

    // Бутонът.
    '.launcher{position:relative;width:56px;height:56px;min-width:56px;padding:0;border:0;border-radius:50%;',
    ' cursor:pointer;background:' + GREEN + ';box-shadow:0 6px 20px rgba(0,0,0,.22);',
    ' display:inline-flex;align-items:center;justify-content:center}',
    '.launcher:hover{background-color:' + GREEN_HOVER + '}',
    '.badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:999px;',
    ' background:#dc2626;color:#fff;font-size:12px;font-weight:700;line-height:1;padding:0 6px;',
    ' display:inline-flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.25)}',

    // Прозорецът. Размерът се слага от `render` по екрана на страницата
    // отвън - вътре в рамката `100vh` е височината на самата рамка.
    '.panel{display:none;flex-direction:column;background:#fff;color:#374151;overflow:hidden;',
    ' box-shadow:0 12px 40px rgba(0,0,0,.18);margin-bottom:12px}',
    '.panel.open{display:flex}',
    '.panel > :not(.log){flex-shrink:0}',

    '.head{display:flex;align-items:flex-start;gap:8px;padding:16px 16px 14px;border-bottom:1px solid #e5e7eb}',
    '.head h2{margin:0;font-size:16px;font-weight:700;color:#111827}',
    '.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin:0 1px 1px 2px;vertical-align:middle;',
    ' background:' + GREEN + '}',
    '.dot.off{background:#dc2626}',
    '.head p{margin:4px 0 0;font-size:12px;color:#6b7280;line-height:1.4}',
    '.x{margin-left:auto;flex-shrink:0;width:30px;height:30px;padding:0;border-radius:50%;',
    ' border:1px solid #e5e7eb;background:#f3f4f6;color:#6b7280;font-size:18px;line-height:1;cursor:pointer;',
    ' display:inline-flex;align-items:center;justify-content:center}',
    '.x:hover{background:#e5e7eb;color:#111827;border-color:#d1d5db}',
    '.snd{margin-left:auto;flex-shrink:0;width:30px;height:30px;padding:0;border:0;border-radius:50%;',
    ' background:transparent;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}',
    '.snd:hover{background:#f3f4f6}',
    '.snd + .x{margin-left:4px}',

    '.log{flex:1 1 auto;min-height:0;overflow-y:auto;padding:16px 18px;display:flex;flex-direction:column;gap:12px}',
    '.hint{font-size:14px;color:#4b5563;line-height:1.55;white-space:pre-wrap;word-wrap:break-word}',
    '.msg{max-width:80%;padding:8px 12px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}',
    '.msg.visitor{align-self:flex-end;background:' + GREEN + ';color:#fff}',
    '.msg.agent{align-self:flex-start;background:#f3f4f6;color:#374151}',
    '.msg time{display:block;font-size:10px;opacity:.7;margin-top:2px}',
    '.msg a{color:inherit;text-decoration:underline;word-break:break-all}',
    '.typing{font-size:12px;color:#6b7280;font-style:italic}',
    '.file{display:inline-flex;gap:4px;align-items:center;margin-top:4px;font-size:13px;color:inherit;',
    ' text-decoration:underline;cursor:pointer;background:none;border:0;padding:0;text-align:left}',
    '.thumb{display:block;max-width:200px;max-height:160px;margin-top:4px;cursor:pointer;background:#e5e7eb;',
    ' min-width:60px;min-height:40px}',

    // Бележките над полето: зелена на линия, червена извън.
    '.lead,.note,.err{padding:8px 12px;font-size:12px;line-height:1.4}',
    '.lead{background:#ecfdf5;color:#065f46;border-top:1px solid #d1fae5}',
    '.note{background:#fef2f2;color:#991b1b;border-top:1px solid #fecaca;border-bottom:1px solid #fecaca}',
    '.err{background:#fef2f2;color:#991b1b;border-top:1px solid #fecaca}',

    'form.compose{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 14px 14px;',
    ' border-top:1px solid #e5e7eb;background:#fff}',
    '.row{display:flex;gap:10px;width:100%}',
    '.row input{flex:1 1 0;min-width:0}',
    '.row input[type="email"]{flex-grow:1.4}',
    'input,textarea{border:0;border-bottom:1px solid #d1d5db;border-radius:0;background:transparent;',
    ' color:#111827;font-size:14px;padding:6px 4px}',
    'input:focus,textarea:focus{outline:none;border-bottom-color:' + GREEN + '}',
    'input.bad{border-bottom-color:#dc2626}',
    '.privacy{width:100%;font-size:11px;color:#6b7280}',
    '.privacy a{color:' + GREEN + '}',
    'textarea{flex:1;min-width:0;height:40px;padding:8px 4px;resize:none}',
    'button.send{width:40px;height:40px;min-width:40px;padding:0;border:0;border-radius:50%;cursor:pointer;',
    ' background:#e5e7eb;display:inline-flex;align-items:center;justify-content:center;color:#4b5563;font-size:10px}',
    'button.send:hover:not(:disabled){background-color:#d1d5db}',
    'button.send:disabled{opacity:.55;cursor:default}',
    'button.send.busy svg{display:none}',
    'button.attach{width:32px;height:32px;min-width:32px;padding:0;border:0;background:transparent;cursor:pointer;',
    ' opacity:.8;display:inline-flex;align-items:center;justify-content:center}',
    'button.attach:hover{opacity:1}',
    '.panel.drop{outline:3px dashed ' + GREEN + ';outline-offset:-6px}',

    // Нисък лаптоп: всичко по-сбито, за да се вижда разговорът.
    '.short .launcher{width:52px;height:52px;min-width:52px}',
    '.short .head{padding:10px 14px 9px}',
    '.short .head h2{font-size:15px}',
    '.short .head p{font-size:11.5px;line-height:1.35;margin-top:3px}',
    '.short .x{width:28px;height:28px;font-size:16px}',
    '.short .log{padding:10px 14px;gap:10px}',
    '.short .hint{font-size:13px;line-height:1.5}',
    '.short .msg{font-size:13px;padding:7px 11px}',
    '.short .lead,.short .note,.short .err{padding:5px 12px;font-size:11.5px;line-height:1.35}',
    '.short form.compose{padding:6px 12px 8px;gap:6px}',
    '.short .row input{padding:5px 6px;font-size:13px}',
    '.short textarea{height:34px;padding:6px 4px;font-size:13px}',
    '.short button.send{width:34px;height:34px;min-width:34px}',

    // Телефон, отворен: целият екран на рамката; бутонът се скрива.
    '.full .panel{width:100%!important;height:100%!important;margin:0;box-shadow:none;flex:1 1 auto}',
    '.full .launcher{display:none}'
  ].join('');

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  var style = el('style');
  style.textContent = css;

  var titleName = document.createTextNode(T.title);
  var titleDot = el('span', { class: 'dot', 'aria-hidden': 'true' });
  var titleState = document.createTextNode(T.titleOnline);
  var titleEl = el('h2', {}, [titleName, document.createTextNode(' '), titleDot, titleState]);
  var statusEl = el('p');
  var closeBtn = el('button', { class: 'x', 'aria-label': T.close, title: T.close, type: 'button', text: '×' });
  var soundBtn = el('button', { class: 'snd', type: 'button' });
  var head = el('div', { class: 'head' }, [el('div', {}, [titleEl, statusEl]), soundBtn, closeBtn]);

  function drawSound() {
    var off = muted();
    soundBtn.textContent = '';
    soundBtn.appendChild(icon(off ? 'mute' : 'sound', 16));
    soundBtn.setAttribute('aria-label', off ? T.soundOff : T.soundOn);
    soundBtn.title = off ? T.soundOff : T.soundOn;
  }
  soundBtn.addEventListener('click', function () {
    storage('set', MUTE_KEY, muted() ? 'false' : 'true');
    drawSound();
  });
  drawSound();

  var log = el('div', { class: 'log', role: 'log', 'aria-live': 'polite' });

  var leadEl = el('div', { class: 'lead', text: T.onlineLead });
  var noteEl = el('div', { class: 'note', text: T.offlineNote });
  var errorEl = el('div', { class: 'err', role: 'alert' });
  errorEl.hidden = true;

  var nameInput = el('input', { type: 'text', placeholder: T.name, 'aria-label': T.name, maxlength: '100', autocomplete: 'name' });
  var emailInput = el('input', { type: 'email', placeholder: T.email, 'aria-label': T.email, maxlength: '200', autocomplete: 'email' });
  var phoneInput = el('input', { type: 'tel', placeholder: T.phone, 'aria-label': T.phone, maxlength: '30', autocomplete: 'tel' });
  // Име, Телефон, Имейл - в реда, в който се питат (решено 2026-10-08):
  // първите две задължителни, имейлът по желание.
  var contactRow = el('div', { class: 'row' }, [nameInput, phoneInput, emailInput]);
  var privacyLink = el('a', { target: '_blank', rel: 'noopener noreferrer', text: T.privacy });
  var privacyLine = el('div', { class: 'privacy' }, [privacyLink]);
  privacyLine.hidden = true;
  var textarea = el('textarea', { placeholder: T.placeholder, maxlength: '2000', 'aria-label': T.placeholder });
  var sendIcon = icon('send', 18);
  var sendLabel = el('span');
  var sendBtn = el('button', { class: 'send', type: 'submit', title: T.send, 'aria-label': T.send }, [sendIcon, sendLabel]);
  var fileInput = el('input', { type: 'file', accept: ACCEPT, multiple: 'multiple', hidden: 'hidden' });
  var attachBtn = el('button', { class: 'attach', type: 'button', title: T.attach, 'aria-label': T.attach }, [icon('clip', 18)]);
  // Скрито поле: човек не го вижда и не стига до него с Tab, бот, който
  // попълва форми, го попълва. Тогава сървърът не записва съобщението.
  var honeypot = el('input', {
    type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', 'aria-hidden': 'true',
    style: 'position:absolute;left:-10000px;width:1px;height:1px;opacity:0'
  });
  var compose = el('form', { class: 'compose', novalidate: 'novalidate' }, [
    contactRow, privacyLine, attachBtn, textarea, sendBtn, fileInput, honeypot
  ]);

  var panel = el('div', { class: 'panel', role: 'dialog', 'aria-label': T.title }, [
    head, log, leadEl, noteEl, errorEl, compose
  ]);

  var badge = el('span', { class: 'badge' });
  badge.hidden = true;
  var launcher = el('button', { class: 'launcher', type: 'button', title: T.launcher, 'aria-label': T.launcher }, [
    icon('bubble', 26), badge
  ]);

  var wrap = el('div', {}, [panel, launcher]);
  root.appendChild(style);
  root.appendChild(wrap);

  // --- Състояние -------------------------------------------------------------

  var state = {
    online: true, hours: '', privacyUrl: '', open: false, messages: [], hasEmail: false,
    hasPhone: false, hasName: false, sending: false, timer: null, streaming: false, agentTypingUntil: 0,
    lastTypingSent: 0
  };

  function showError(text) {
    errorEl.textContent = text || '';
    errorEl.hidden = !text;
  }

  // Адресите в текста стават връзки - без HTML: текстът се реже на парчета,
  // връзката е отделен `<a>` с `textContent`. Само `http(s)://` и `www.`,
  // тоест `javascript:` не може да стане връзка, каквото и да напише някой.
  var URL_IN_TEXT = /(?:https?:\/\/|www\.)[^\s<>"]+/gi;

  function withLinks(text) {
    var out = document.createDocumentFragment();
    var last = 0;
    text.replace(URL_IN_TEXT, function (match, at) {
      var url = trimUrl(match);
      if (at > last) out.appendChild(document.createTextNode(text.slice(last, at)));
      var href = /^www\./i.test(url) ? 'https://' + url : url;
      out.appendChild(el('a', { href: href, target: '_blank', rel: 'noopener noreferrer nofollow', text: url }));
      last = at + url.length;
      return match;
    });
    if (last < text.length) out.appendChild(document.createTextNode(text.slice(last)));
    return out;
  }

  // „(https://home.abv.bg/)" и „вижте https://x.bg." - скобата и точката са
  // от изречението, не от адреса. Затваряща скоба остава, ако адресът си
  // има отваряща (Уикипедия).
  function trimUrl(url) {
    for (;;) {
      var tail = url.charAt(url.length - 1);
      if (/[.,!?;:'"]/.test(tail)) {
        url = url.slice(0, -1);
      } else if (tail === ')' && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
        url = url.slice(0, -1);
      } else {
        return url;
      }
    }
  }

  function formatTime(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' });
  }

  // Режимът по екрана на страницата отвън: телефон (отворен - цял екран),
  // нисък лаптоп (сбит) или обикновен.
  function layout() {
    var mobile = viewport.width <= MOBILE_WIDTH;
    return {
      full: mobile && state.open,
      short: !mobile && viewport.height <= SHORT_HEIGHT
    };
  }

  function render() {
    /* Plasico patch: do not reuse `mode` for online/offline — that shadowed
       layout() and broke mobile fullscreen (host stayed desktop-sized). */
    var layoutMode = layout();
    wrap.className = (layoutMode.full ? 'full' : '') + (layoutMode.short ? ' short' : '');

    titleName.textContent = state.name || T.title;
    titleState.textContent = state.online ? T.titleOnline : T.titleOffline;
    titleDot.className = 'dot' + (state.online ? '' : ' off');
    // Текстовете идват от настройките (`/status` -> `texts`); тукашните са
    // само за сървър отпреди тях.
    var texts = state.texts || {};
    var mode = state.online ? 'online' : 'offline';
    statusEl.textContent = texts['subtitle_' + mode] || (state.online
      ? (state.hours ? T.online.replace('{hours}', state.hours) : T.onlineAlways)
      : (state.hours ? T.offline.replace('{hours}', state.hours) : T.offlineNoHours));
    leadEl.textContent = texts.note_online || T.onlineLead;
    noteEl.textContent = texts.note_offline || T.offlineNote;
    privacyLink.textContent = texts.privacy || T.privacy;
    leadEl.hidden = !state.online;
    noteEl.hidden = state.online;
    launcher.setAttribute('aria-label', T.launcher + (state.online ? T.titleOnline : T.titleOffline));

    // Данните - докато сървърът не ги знае; каквото знае, не се пита пак.
    // Щом знае името и телефона, редът изчезва: имейлът е по желание.
    nameInput.hidden = state.hasName;
    phoneInput.hidden = state.hasPhone;
    emailInput.hidden = state.hasEmail;
    contactRow.hidden = state.hasName && state.hasPhone;
    // Само http(s) става връзка - адресът идва от настройките, но стои на
    // чужд сайт.
    var safePrivacy = /^https?:\/\//i.test(state.privacyUrl) ? state.privacyUrl : '';
    privacyLine.hidden = !safePrivacy || contactRow.hidden;
    if (safePrivacy) privacyLink.setAttribute('href', safePrivacy);

    log.textContent = '';
    if (!state.messages.length) {
      log.appendChild(el('div', { class: 'hint', text: texts['welcome_' + mode] || T.empty }));
    }
    state.messages.forEach(function (m) {
      var bubble = el('div', { class: 'msg ' + m.author });
      if (m.body) bubble.appendChild(withLinks(m.body));
      (m.files || []).forEach(function (f) { bubble.appendChild(fileNode(f)); });
      bubble.appendChild(el('time', { text: formatTime(m.at) }));
      log.appendChild(bubble);
    });
    if (state.agentTypingUntil > Date.now()) {
      log.appendChild(el('div', { class: 'typing', text: T.agentTyping }));
    }
    log.scrollTop = log.scrollHeight;

    var unread = unreadCount();
    badge.textContent = String(unread);
    badge.hidden = state.open || unread === 0;
    sendBtn.disabled = state.sending;

    if (layoutMode.full) {
      host.style.cssText = 'position:fixed;inset:0;display:flex';
      wrap.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%';
      panel.style.width = panel.style.height = '';
    } else {
      host.style.cssText = 'position:fixed;right:20px;bottom:20px';
      wrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end';
      // Над бутона (20 отдолу + 56 бутон + 12 разстояние) и с 20 отгоре.
      var w = layoutMode.short ? 340 : 360;
      var h = layoutMode.short ? Math.min(500, viewport.height - 100) : Math.min(520, viewport.height - 108);
      panel.style.width = Math.max(260, Math.min(w, viewport.width - 40)) + 'px';
      panel.style.height = Math.max(300, h) + 'px';
    }
    reportSize(layoutMode.full);
  }

  // Колко място иска рамката: затворена - колкото бутона, отворена - и
  // прозореца, на телефон - целия екран. Зареждащият скрипт мени размера на
  // iframe-а; иначе празен правоъгълник в ъгъла пречи на кликовете по сайта.
  var lastSize = '';
  function reportSize(full) {
    if (full) {
      if (lastSize === 'full') return;
      lastSize = 'full';
      return tellParent({ type: 'intelekta-chat:size', fullscreen: true });
    }
    var box = wrap.getBoundingClientRect();
    // С отстъпа от ъгъла (20) и място за сянката - иначе рамката я реже.
    var size = { width: Math.ceil(box.width) + 40, height: Math.ceil(box.height) + 40 };
    var key = size.width + 'x' + size.height;
    if (key === lastSize || !box.width) return;
    lastSize = key;
    tellParent({ type: 'intelekta-chat:size', width: size.width, height: size.height });
  }

  // --- Файлове --------------------------------------------------------------
  //
  // Жетонът не може да влезе в `<img src>`. Затова: временна връзка към
  // хранилището (S3), ако то дава; иначе байтовете през нас със жетона и
  // локален адрес в паметта на страницата.

  var links = {};

  function fileUrl(f) {
    var hit = links[f.id];
    if (hit && hit.until > Date.now()) return Promise.resolve(hit.url);
    return request('GET', '/files/' + encodeURIComponent(f.id) + '/link').then(function (res) {
      if (res.status !== 200) throw res;
      if (res.data && res.data.url) return res.data.url;
      return fetch(API + '/files/' + encodeURIComponent(f.id) + '/content', {
        headers: { Authorization: 'Bearer ' + getToken() },
        credentials: 'omit'
      }).then(function (r) {
        if (!r.ok) throw r;
        return r.blob();
      }).then(function (blob) { return URL.createObjectURL(blob); });
    }).then(function (url) {
      links[f.id] = { url: url, until: Date.now() + LINK_TTL_MS };
      return url;
    });
  }

  function formatSize(n) {
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  function fileNode(f) {
    if (/^image\//.test(f.type)) {
      var img = el('img', { class: 'thumb', alt: f.name, title: f.name });
      fileUrl(f).then(function (url) { img.src = url; }, function () {});
      img.addEventListener('click', function () {
        fileUrl(f).then(function (url) { window.open(url, '_blank', 'noopener'); });
      });
      return img;
    }
    var link = el('button', { class: 'file', type: 'button', text: '📄 ' + f.name + ' (' + formatSize(f.size) + ')' });
    link.addEventListener('click', function () {
      fileUrl(f).then(function (url) {
        var a = el('a', { href: url, download: f.name, target: '_blank', rel: 'noopener' });
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, function () { showError(T.failed); });
    });
    return link;
  }

  function uploadFiles(list) {
    var files = Array.prototype.slice.call(list || []);
    if (!files.length) return;
    var started = state.hasEmail && state.messages.some(function (m) { return m.author === 'visitor'; });
    if (!started) return showError(T.writeFirst);
    if (files.length > MAX_FILES_AT_ONCE) return showError(T.tooManyAtOnce);
    for (var i = 0; i < files.length; i++) {
      if (files[i].size > MAX_FILE_BYTES) return showError(T.fileTooBig);
    }
    showError('');
    state.sending = true;
    sendBtn.classList.add('busy');
    sendLabel.textContent = '…';
    sendBtn.title = T.uploading;
    render();
    // Един по един: всеки е отделно съобщение и редът им е редът на избора.
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () {
        var form = new FormData();
        form.append('file', file, file.name || 'file');
        if (page.url) form.append('page_url', page.url);
        if (page.title) form.append('page_title', page.title);
        return fetch(API + '/files', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + getToken() },
          body: form,
          credentials: 'omit'
        }).then(function (r) {
          return r.json().then(function (data) { return { status: r.status, data: data }; },
            function () { return { status: r.status, data: null }; });
        }).then(function (res) {
          if (res.status === 201) return apply(res.data);
          if (res.status === 429) throw T.tooMany;
          var detail = res.data && res.data.detail;
          throw typeof detail === 'string' ? detail : T.fileType;
        });
      });
    });
    chain.catch(function (msg) { showError(typeof msg === 'string' ? msg : T.failed); })
      .then(function () {
        state.sending = false;
        sendBtn.classList.remove('busy');
        sendLabel.textContent = '';
        sendBtn.title = T.send;
        fileInput.value = '';
        render();
      });
  }

  function lastAgentId() {
    for (var i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].author === 'agent') return state.messages[i].id;
    }
    return null;
  }

  function unreadCount() {
    var seen = storage('get', SEEN_KEY);
    var count = 0;
    for (var i = state.messages.length - 1; i >= 0; i--) {
      var m = state.messages[i];
      if (m.author !== 'agent') continue;
      if (m.id === seen) break;
      count++;
    }
    return count;
  }

  function markSeen() {
    var id = lastAgentId();
    if (id) storage('set', SEEN_KEY, id);
  }

  function apply(data) {
    if (!data) return;
    var before = state.messages.length;
    var lastAgent = lastAgentId();
    var wasLoaded = state.loaded;
    state.messages = data.messages || [];
    state.loaded = true;
    // Нов отговор от Пласико - звук. Не при първото зареждане на историята.
    if (wasLoaded && lastAgentId() && lastAgentId() !== lastAgent) chime('message');
    state.hasEmail = !!data.has_email;
    state.hasPhone = !!data.has_phone;
    state.hasName = !!data.has_name;
    // Дошъл отговор слага край на „пише"; без поток знакът идва от питането.
    if (state.messages.length !== before) state.agentTypingUntil = 0;
    if (data.agent_typing) showAgentTyping();
    if (state.open) markSeen();
    render();
  }

  function fetchMessages() {
    if (!getToken()) return Promise.resolve();
    return request('GET', '/messages').then(function (res) {
      if (res.status === 401) { dropToken(); state.messages = []; render(); return; }
      if (res.status === 200) apply(res.data);
    }, function () {});
  }

  function schedule() {
    clearTimeout(state.timer);
    if (document.hidden || !getToken()) return;
    var every = state.streaming ? STREAM_POLL_MS : state.open ? OPEN_POLL_MS : CLOSED_POLL_MS;
    state.timer = setTimeout(function () {
      fetchMessages().then(schedule);
    }, every);
  }

  var typingTimer = null;
  function showAgentTyping() {
    state.agentTypingUntil = Date.now() + TYPING_SHOW_MS;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(render, TYPING_SHOW_MS + 50);
    render();
  }

  // --- Потокът -------------------------------------------------------------
  //
  // С `fetch`, не с `EventSource`: той не праща заглавки, а жетонът е в
  // `Authorization` - не в адреса, който остава в дневниците по пътя.
  // По потока идва само вид на събитие; съдържанието се тегли по `/messages`.

  var streamAbort = null;
  var streamBackoff = 2000;

  function openStream() {
    if (streamAbort || document.hidden || !getToken() || !window.fetch || !window.AbortController) return;
    var controller = new AbortController();
    streamAbort = controller;
    fetch(API + '/stream', {
      headers: { Authorization: 'Bearer ' + getToken() },
      credentials: 'omit',
      signal: controller.signal
    }).then(function (r) {
      if (r.status === 401) { dropToken(); throw r; }
      if (!r.ok || !r.body) throw r;
      state.streaming = true;
      // Нов поток - нова страница или рестартиран сървър: казва се наново.
      reportPresence(true);
      streamBackoff = 2000;
      schedule();
      var reader = r.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) return;
          buffer += decoder.decode(chunk.value, { stream: true });
          var parts = buffer.split('\n\n');
          buffer = parts.pop();
          parts.forEach(function (block) {
            var m = /^event: (\w+)/m.exec(block);
            if (!m) return;
            if (m[1] === 'messages') fetchMessages();
            if (m[1] === 'typing') showAgentTyping();
            // Някой във Входящи е спрял или пуснал чата - „на линия" веднага.
            if (m[1] === 'status') loadStatus().then(render);
          });
          return pump();
        });
      }
      return pump();
    }).catch(function () {}).then(function () {
      var aborted = controller.signal.aborted;
      streamAbort = null;
      state.streaming = false;
      schedule();
      if (aborted) return;
      // Сървърът затваря потока на няколко минути; мрежа или рестарт - също.
      // Отваря се пак, по-рядко при поредни откази.
      setTimeout(openStream, streamBackoff);
      streamBackoff = Math.min(streamBackoff * 2, 30000);
    });
  }

  // Отворен ли е прозорецът и на коя страница е посетителят - за „на сайта
  // сега" във Входящи (решено 2026-10-13). Само с жетон: посетител, който
  // никога не е отварял чата, не се следи. Пак същото не се праща.
  var presenceSent = '';
  var presenceTimer = null;
  function reportPresence(force) {
    if (!getToken()) return;
    clearTimeout(presenceTimer);
    presenceTimer = setTimeout(function () {
      var body = { open: !!state.open, page_url: page.url || null, page_title: page.title || null };
      var key = JSON.stringify(body);
      if (!force && key === presenceSent) return;
      presenceSent = key;
      request('POST', '/presence', body).catch(function () { presenceSent = ''; });
    }, 300);
  }

  function closeStream() {
    if (streamAbort) streamAbort.abort();
  }

  // Забравя посетителя в този браузър: следващото съобщение е нов разговор.
  // Разговорът във Входящи остава - забравя се само жетонът.
  function newVisitor() {
    closeStream();
    clearTimeout(state.timer);
    dropToken();
    storage('del', SEEN_KEY);
    state.messages = [];
    state.hasEmail = false;
    state.hasPhone = false;
    state.hasName = false;
    state.agentTypingUntil = 0;
    [nameInput, emailInput, phoneInput, textarea].forEach(function (input) { input.value = ''; });
    showError('');
    render();
    if (state.open) ensureToken().then(openStream, function () {});
  }

  function loadStatus() {
    return request('GET', '/status').then(function (res) {
      if (res.status !== 200) return false;
      state.online = !!res.data.online;
      state.hours = res.data.hours || '';
      state.privacyUrl = res.data.privacy_url || '';
      state.texts = res.data.texts || {};
      state.name = res.data.name || '';
      return true;
    }, function () { return false; });
  }

  // --- Действия --------------------------------------------------------------

  function toggle(open) {
    state.open = open;
    panel.classList.toggle('open', open);
    if (open) {
      // Жетонът - при отваряне, не при първото съобщение: сървърът отказва
      // съобщение в първите секунди след жетона (бот пише веднага, човек
      // първо чете). Отварянето е действие на посетителя - дотогава бутонът
      // не пише нищо в браузъра.
      ensureToken().then(function () { openStream(); reportPresence(); }, function () {});
      markSeen();
      loadStatus().then(render);
      fetchMessages();
      setTimeout(function () { textarea.focus(); }, 0);
    } else {
      reportPresence();
    }
    render();
    schedule();
  }

  launcher.addEventListener('click', function () {
    audio();
    toggle(!state.open);
  });
  closeBtn.addEventListener('click', function () { toggle(false); });

  attachBtn.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () { uploadFiles(fileInput.files); });

  // Снимка от клипборда - Ctrl+V на екранна снимка.
  textarea.addEventListener('paste', function (e) {
    var files = e.clipboardData && e.clipboardData.files;
    if (files && files.length) {
      e.preventDefault();
      uploadFiles(files);
    }
  });

  // Пуснат файл върху прозореца.
  panel.addEventListener('dragover', function (e) {
    e.preventDefault();
    panel.classList.add('drop');
  });
  panel.addEventListener('dragleave', function () { panel.classList.remove('drop'); });
  panel.addEventListener('drop', function (e) {
    e.preventDefault();
    panel.classList.remove('drop');
    uploadFiles(e.dataTransfer && e.dataTransfer.files);
  });

  // „Клиентът пише" във Входящи - най-много на три секунди и само в разговор,
  // който вече е започнал: преди първото съобщение няма на кого да се каже.
  textarea.addEventListener('input', function () {
    var now = Date.now();
    if (!textarea.value.trim() || !state.messages.length || !getToken()) return;
    if (now - state.lastTypingSent < TYPING_SEND_MS) return;
    state.lastTypingSent = now;
    request('POST', '/typing').catch(function () {});
  });

  textarea.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      compose.requestSubmit ? compose.requestSubmit() : compose.dispatchEvent(new Event('submit'));
    }
  });

  // Какво не е наред с едно поле - или `null`. Каквото сървърът знае, не се
  // проверява: полето е скрито.
  function fieldProblem(input) {
    var value = input.value.trim();
    if (input === nameInput && !state.hasName && !value) {
      return { input: input, text: T.nameNeeded };
    }
    if (input === phoneInput && !state.hasPhone) {
      if (!value) return { input: input, text: T.phoneNeeded };
      if (!validPhone(value)) return { input: input, text: T.phoneInvalid };
    }
    // Имейлът е по желание - но написан, трябва да е верен.
    if (input === emailInput && !state.hasEmail && value && !validEmail(value)) {
      return { input: input, text: T.emailInvalid };
    }
    return null;
  }

  function contactProblem() {
    return fieldProblem(nameInput) || fieldProblem(phoneInput) || fieldProblem(emailInput);
  }

  function flag(problem) {
    showError(problem.text);
    problem.input.classList.add('bad');
  }

  [nameInput, phoneInput, emailInput].forEach(function (input) {
    input.addEventListener('input', function () {
      input.classList.remove('bad');
      if (!errorEl.hidden) showError('');
    });
    // Още при излизане от полето - не чак при „Изпрати", когато човекът
    // вече гледа съобщението си. Празно поле не се кори: може да не е стигнал.
    input.addEventListener('blur', function () {
      var problem = fieldProblem(input);
      if (problem && input.value.trim()) flag(problem);
    });
  });

  // Сървърът е отказал поле (Pydantic връща списък): кое - по `loc`.
  function serverProblem(detail) {
    if (!Array.isArray(detail)) return null;
    for (var i = 0; i < detail.length; i++) {
      var loc = (detail[i] && detail[i].loc) || [];
      var field = loc[loc.length - 1];
      if (field === 'email') return { input: emailInput, text: T.emailInvalid };
      if (field === 'name') return { input: nameInput, text: T.nameNeeded };
      if (field === 'phone') return { input: phoneInput, text: T.phoneInvalid };
    }
    return null;
  }

  compose.addEventListener('submit', function (e) {
    e.preventDefault();
    var body = textarea.value.trim();
    if (state.sending) return;
    // Имейл и телефон - задължителни, докато сървърът не ги знае (решено
    // 2026-10-06 с новия вид). Името - по желание. Проверяват се преди
    // текста: попълнени данни и празно съобщение мълчаха.
    var problem = contactProblem();
    if (problem) {
      flag(problem);
      problem.input.focus();
      return;
    }
    if (!body) {
      showError(T.messageNeeded);
      textarea.focus();
      return;
    }
    state.sending = true;
    showError('');
    render();

    var payload = { body: body, page_url: page.url || null, page_title: page.title || null };
    // Само каквото сървърът още не знае - скритите полета не се пращат пак.
    if (!state.hasName) payload.name = nameInput.value.trim();
    if (!state.hasPhone) payload.phone = phoneInput.value.trim();
    if (!state.hasEmail && emailInput.value.trim()) payload.email = emailInput.value.trim();
    if (honeypot.value) payload.website = honeypot.value;

    // Писал е по-бързо, отколкото сървърът приема от нов жетон: изчаква
    // колкото казва сървърът и праща сам, веднъж. Човекът не вижда грешка.
    function send(retried) {
      return request('POST', '/messages', payload).then(function (res) {
        if (res.status === 429 && !retried && res.retryAfter > 0 && res.retryAfter <= 5) {
          return new Promise(function (resolve) {
            setTimeout(resolve, res.retryAfter * 1000 + 250);
          }).then(function () { return send(true); });
        }
        return res;
      });
    }

    ensureToken()
      .then(function () { return send(false); })
      .then(function (res) {
        if (res.status === 201) {
          textarea.value = '';
          chime('sent');
          apply(res.data);
          return;
        }
        if (res.status === 401) dropToken();
        if (res.status === 429) return showError(T.tooMany);
        var detail = res.data && res.data.detail;
        var rejected = serverProblem(detail);
        if (rejected) {
          // Скритото поле се показва пак - иначе няма какво да поправи.
          if (rejected.input === emailInput) state.hasEmail = false;
          if (rejected.input === phoneInput) state.hasPhone = false;
          if (rejected.input === nameInput) state.hasName = false;
          render();
          return flag(rejected);
        }
        showError(typeof detail === 'string' ? detail : T.failed);
      })
      .catch(function (res) {
        showError(res && res.status === 429 ? T.tooMany : T.failed);
      })
      .then(function () {
        state.sending = false;
        render();
        schedule();
      });
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) {
      fetchMessages().then(schedule);
      openStream();
    } else {
      clearTimeout(state.timer);
      closeStream();
    }
  });

  // --- Старт ------------------------------------------------------------------

  // Изключен чат (404) или недостъпен сървър - бутонът не се показва изобщо.
  // По-добре никакъв бутон от бутон, който не работи.
  loadStatus().then(function (ok) {
    // Изключен чат - рамката казва на страницата да я скрие изобщо.
    if (!ok) return tellParent({ type: 'intelekta-chat:hide' });
    (document.body || document.documentElement).appendChild(host);
    tellParent({ type: 'intelekta-chat:ready' });
    render();
    fetchMessages().then(schedule);
    openStream();
  });
})();
