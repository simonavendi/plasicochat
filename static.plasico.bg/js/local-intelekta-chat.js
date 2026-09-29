/**
 * Intelekta OS public chat widget
 * Demo: https://os.4chairs.bg/api/v1/public/chat/demo
 *
 * Loads via same-origin proxy (serve-local.py).
 * Shadow DOM restyle + auto-reply + unread badge + online/offline preview.
 */
(function () {
	'use strict';

	var API_BASE = location.origin + '/api/v1/public/chat';
	var WIDGET_SRC = API_BASE + '/widget.js';
	var GREEN = '#07a857';
	var GREEN_HOVER = '#06964c';
	var BUBBLE =
		"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8A2.5 2.5 0 0 1 17.5 16H10l-4.2 3.15A.75.75 0 0 1 4.5 18.5V16A2.5 2.5 0 0 1 4 13.5v-8Z' fill='%23fff'/%3E%3C/svg%3E\")";
	var SEND_ARROW =
		"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234b5563' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12h14M13 5l7 7-7 7'/%3E%3C/svg%3E\")";

	var TITLE_ONLINE = 'Пласико на линия';
	var SUB_ONLINE =
		'Пишете ни - отговаряме веднага в рамките на работното ни време 9:00-18:00 понеделник до петък.';
	var TITLE_OFFLINE = 'Пласико офлайн';
	var SUB_OFFLINE =
		'Пишете ни, ще получите отговор в работно време 9:00-18:00 понеделник до петък по имейл.';

	var NOTE_ONLINE =
		'Ако не можете да изчакате, оставете имейл - ще ви пишем там.';
	var NOTE_OFFLINE =
		'В момента сме извън работно време. Оставете данните и въпроса си и ще получите отговор по имейл когато отново сме на линия.';

	var WELCOME =
		'Здравей! 👋\n\n' +
		'Добре дошъл в Plasico – мястото за технологии, компютри и електроника. 💻✨\n\n' +
		'Търсиш нов лаптоп, компютър, телефон или аксесоар? Можем да ти помогнем да откриеш подходящия продукт според твоите нужди и бюджет.\n\n' +
		'Можеш да ни попиташ за продукти, цени, характеристики, наличности или препоръки.\n\n' +
		'Какво търсиш днес? 🚀';

	var AUTO_REPLY =
		'Здравейте, благодарим за съобщението. Наш служител ще ви отговори до няколко минути...';

	var tweaking = false;
	var localUnread = 0;
	var pendingAutoKeys = Object.create(null);
	/** Preview mode: 'online' | 'offline' — independent of real API hours */
	var previewMode = 'online';

	function findHost() {
		var nodes = document.querySelectorAll('body > div');
		for (var i = 0; i < nodes.length; i++) {
			var host = nodes[i];
			if (!host.shadowRoot) continue;
			if (host.shadowRoot.querySelector('button.launcher')) return host;
		}
		return null;
	}

	function isPanelOpen(root) {
		var panel = root.querySelector('.panel');
		return !!(panel && panel.classList.contains('open'));
	}

	function visitorText(vis) {
		var text = '';
		for (var i = 0; i < vis.childNodes.length; i++) {
			if (vis.childNodes[i].nodeType === 3) text += vis.childNodes[i].textContent;
		}
		return text.trim();
	}

	function formatTime() {
		return new Date().toLocaleTimeString('bg-BG', {
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function pendingCount() {
		var n = 0;
		for (var k in pendingAutoKeys) {
			if (pendingAutoKeys[k]) n++;
		}
		return n;
	}

	function clearUnread(root) {
		localUnread = 0;
		pendingAutoKeys = Object.create(null);
		updateBadge(root);
	}

	function updateBadge(root) {
		var badge = root.querySelector('.launcher .badge');
		if (!badge) return;
		if (isPanelOpen(root)) {
			badge.hidden = true;
			badge.textContent = '0';
			return;
		}
		localUnread = pendingCount();
		if (localUnread > 0) {
			badge.textContent = String(localUnread);
			badge.hidden = false;
		} else {
			badge.hidden = true;
			badge.textContent = '0';
		}
	}

	function makeAutoBubble() {
		var bubble = document.createElement('div');
		bubble.className = 'msg agent';
		bubble.setAttribute('data-plasico-auto', '1');
		bubble.appendChild(document.createTextNode(AUTO_REPLY));
		var time = document.createElement('time');
		time.textContent = formatTime();
		bubble.appendChild(time);
		return bubble;
	}

	function hasAutoAfter(vis) {
		var next = vis.nextElementSibling;
		return !!(
			next &&
			next.classList.contains('msg') &&
			next.classList.contains('agent') &&
			next.getAttribute('data-plasico-auto') === '1'
		);
	}

	function syncAutoReplies(root) {
		var log = root.querySelector('.log');
		if (!log) return;

		var visitors = log.querySelectorAll('.msg.visitor');
		if (!visitors.length) return;

		var injected = false;

		tweaking = true;
		try {
			for (var i = 0; i < visitors.length; i++) {
				var vis = visitors[i];
				var key = i + ':' + visitorText(vis);
				if (hasAutoAfter(vis)) {
					pendingAutoKeys[key] = true;
					continue;
				}

				var bubble = makeAutoBubble();
				var next = vis.nextElementSibling;
				if (next) log.insertBefore(bubble, next);
				else log.appendChild(bubble);
				pendingAutoKeys[key] = true;
				injected = true;
			}
			if (injected) log.scrollTop = log.scrollHeight;
		} finally {
			tweaking = false;
		}

		updateBadge(root);
	}

	function applyHeaderState(root) {
		var offline = previewMode === 'offline';
		var title = root.querySelector('.head h2');
		var status = root.querySelector('.head p');
		var wantSub = offline ? SUB_OFFLINE : SUB_ONLINE;
		var modeKey = offline ? 'offline' : 'online';

		if (title) {
			var needsTitle =
				title.getAttribute('data-plasico-title') !== modeKey ||
				!title.querySelector('.plasico-status-dot');
			if (needsTitle) {
				var prevTweaking = tweaking;
				tweaking = true;
				try {
					title.setAttribute('data-plasico-title', modeKey);
					title.textContent = '';
					title.appendChild(document.createTextNode('Пласико '));
					var dot = document.createElement('span');
					dot.className =
						'plasico-status-dot ' + (offline ? 'is-offline' : 'is-online');
					dot.setAttribute('aria-hidden', 'true');
					title.appendChild(dot);
					title.appendChild(
						document.createTextNode(offline ? ' офлайн' : ' на линия')
					);
				} finally {
					tweaking = prevTweaking;
				}
			}
		}

		if (status && status.textContent !== wantSub) status.textContent = wantSub;

		var head = root.querySelector('.head');
		if (head) {
			if (offline) head.classList.add('plasico-offline');
			else head.classList.remove('plasico-offline');
		}

		/* Remove legacy offline badge icon if present */
		var legacyIcon = root.querySelector('.plasico-offline-icon');
		if (legacyIcon) legacyIcon.remove();

		/* Show name/email row in offline preview (matches stock offline form) */
		var offlineRow = root.querySelector('form.compose .row');
		if (offlineRow) offlineRow.hidden = !offline;

		/* Mid-panel email note copy switches with online/offline preview */
		var note = root.querySelector('.note');
		if (note) {
			var noteText = note.querySelector(':scope > div:not(form)');
			if (!noteText) {
				/* First non-form child */
				for (var ni = 0; ni < note.children.length; ni++) {
					if (note.children[ni].tagName !== 'FORM') {
						noteText = note.children[ni];
						break;
					}
				}
			}
			var wantNote = offline ? NOTE_OFFLINE : NOTE_ONLINE;
			if (noteText && noteText.textContent !== wantNote) {
				noteText.textContent = wantNote;
			}
			if (offline) {
				note.hidden = false;
				/* Compose already has name/email; hide note's email mini-form offline */
				var noteForm = note.querySelector('form');
				if (noteForm) noteForm.hidden = true;
			} else {
				/* Online: restore form; leave note visibility to stock widget */
				var noteFormOn = note.querySelector('form');
				if (noteFormOn) noteFormOn.hidden = false;
				if (note.getAttribute('data-plasico-forced-offline') === '1') {
					note.hidden = true;
					note.removeAttribute('data-plasico-forced-offline');
				}
			}
			if (offline) note.setAttribute('data-plasico-forced-offline', '1');
		}

		var toggle = root.querySelector('.plasico-preview-toggle');
		if (toggle) {
			var onlineBtn = toggle.querySelector('[data-mode="online"]');
			var offlineBtn = toggle.querySelector('[data-mode="offline"]');
			if (onlineBtn) onlineBtn.setAttribute('aria-pressed', offline ? 'false' : 'true');
			if (offlineBtn) offlineBtn.setAttribute('aria-pressed', offline ? 'true' : 'false');
			if (onlineBtn) {
				if (offline) onlineBtn.classList.remove('is-active');
				else onlineBtn.classList.add('is-active');
			}
			if (offlineBtn) {
				if (offline) offlineBtn.classList.add('is-active');
				else offlineBtn.classList.remove('is-active');
			}
		}
	}

	function ensurePreviewToggle(root) {
		var panel = root.querySelector('.panel');
		if (!panel) return;

		if (!root.querySelector('.plasico-preview-toggle')) {
			var bar = document.createElement('div');
			bar.className = 'plasico-preview-toggle';
			bar.setAttribute('role', 'group');
			bar.setAttribute('aria-label', 'Преглед: онлайн / офлайн');

			var label = document.createElement('span');
			label.className = 'plasico-preview-label';
			label.textContent = 'Преглед:';

			var onlineBtn = document.createElement('button');
			onlineBtn.type = 'button';
			onlineBtn.setAttribute('data-mode', 'online');
			onlineBtn.textContent = 'онлайн';

			var sep = document.createElement('span');
			sep.className = 'plasico-preview-sep';
			sep.textContent = '/';

			var offlineBtn = document.createElement('button');
			offlineBtn.type = 'button';
			offlineBtn.setAttribute('data-mode', 'offline');
			offlineBtn.textContent = 'офлайн';

			bar.appendChild(label);
			bar.appendChild(onlineBtn);
			bar.appendChild(sep);
			bar.appendChild(offlineBtn);

			bar.addEventListener('click', function (e) {
				var btn = e.target.closest('button[data-mode]');
				if (!btn) return;
				previewMode = btn.getAttribute('data-mode') === 'offline' ? 'offline' : 'online';
				applyHeaderState(root);
			});

			panel.insertBefore(bar, panel.firstChild);
		}
	}

	function themeCss() {
		return [
			'.launcher{',
			'  width:56px;height:56px;min-width:56px;padding:0;gap:0;',
			'  border-radius:50%!important;',
			'  background-color:' + GREEN + '!important;',
			'  background-image:' + BUBBLE + '!important;',
			'  background-repeat:no-repeat!important;',
			'  background-position:center!important;',
			'  background-size:26px 26px!important;',
			'  color:transparent!important;font-size:0!important;line-height:0!important;',
			'  box-shadow:0 6px 20px rgba(0,0,0,.22);position:relative;',
			'}',
			'.launcher:hover{background-color:' + GREEN_HOVER + '!important;}',
			'.launcher > span:not(.badge){position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);}',
			'.launcher .badge{',
			'  position:absolute;top:-4px;right:-4px;z-index:2;',
			'  min-width:20px;height:20px;border-radius:999px;',
			'  background:#dc2626!important;color:#fff!important;',
			'  font-size:12px!important;font-weight:700!important;line-height:1!important;',
			'  display:inline-flex!important;align-items:center;justify-content:center;',
			'  padding:0 6px;box-sizing:border-box;',
			'  box-shadow:0 1px 3px rgba(0,0,0,.25);',
			'}',
			'.launcher .badge[hidden]{display:none!important;}',

			'.panel{',
			'  border-radius:0!important;',
			'  background:#fff!important;',
			'  box-shadow:0 12px 40px rgba(0,0,0,.18)!important;',
			'  color:#374151!important;',
			'}',

			'.plasico-preview-toggle{',
			'  display:flex;align-items:center;gap:6px;flex-wrap:wrap;',
			'  padding:8px 12px;background:#f3f4f6;border-bottom:1px solid #e5e7eb;',
			'  font-size:12px;color:#4b5563;',
			'}',
			'.plasico-preview-label{font-weight:600;color:#374151;}',
			'.plasico-preview-sep{color:#9ca3af;}',
			'.plasico-preview-toggle button{',
			'  border:0;background:transparent;padding:2px 8px;border-radius:4px;',
			'  font-size:12px;cursor:pointer;color:#6b7280;',
			'}',
			'.plasico-preview-toggle button.is-active{',
			'  background:' + GREEN + ';color:#fff;font-weight:600;',
			'}',
			'.plasico-preview-toggle button:hover:not(.is-active){background:#e5e7eb;color:#111827;}',

			'.head{',
			'  background:#fff!important;',
			'  color:#111827!important;',
			'  padding:16px 16px 14px!important;',
			'  border-bottom:1px solid #e5e7eb!important;',
			'  align-items:flex-start!important;',
			'}',
			'.head h2{margin:0!important;font-size:16px!important;font-weight:700!important;color:#111827!important;}',
			'.plasico-status-dot{',
			'  display:inline-block;width:8px;height:8px;border-radius:50%;',
			'  margin:0 1px 1px 2px;vertical-align:middle;',
			'}',
			'.plasico-status-dot.is-online{background:' + GREEN + ';}',
			'.plasico-status-dot.is-offline{background:#dc2626;}',
			'.head p{margin:4px 0 0!important;font-size:12px!important;opacity:1!important;color:#6b7280!important;line-height:1.4!important;}',
			'.x{',
			'  margin-left:auto!important;flex-shrink:0!important;',
			'  width:30px!important;height:30px!important;min-width:30px!important;',
			'  padding:0!important;border-radius:50%!important;',
			'  border:1px solid #e5e7eb!important;background:#f3f4f6!important;',
			'  color:#6b7280!important;font-size:18px!important;font-weight:500!important;',
			'  line-height:28px!important;text-align:center!important;',
			'  display:inline-flex!important;align-items:center!important;justify-content:center!important;',
			'  cursor:pointer!important;box-sizing:border-box!important;',
			'}',
			'.x:hover{background:#e5e7eb!important;color:#111827!important;border-color:#d1d5db!important;}',

			'.log{background:#fff!important;padding:16px 18px!important;gap:12px!important;}',
			'.hint{',
			'  font-size:14px!important;color:#4b5563!important;text-align:left!important;margin:0!important;',
			'  line-height:1.55!important;white-space:pre-wrap!important;word-wrap:break-word!important;',
			'}',
			'.msg{font-size:14px!important;line-height:1.5!important;border-radius:0!important;}',
			'.msg.visitor{background:' + GREEN + '!important;color:#fff!important;border-bottom-right-radius:0!important;}',
			'.msg.agent{background:#f3f4f6!important;border:0!important;color:#374151!important;border-bottom-left-radius:0!important;}',

			'.note{background:#ecfdf5!important;color:#065f46!important;border-top:1px solid #d1fae5!important;}',

			'form.compose{',
			'  flex-direction:row!important;flex-wrap:wrap!important;align-items:center!important;gap:10px!important;',
			'  padding:12px 14px 14px!important;border-top:1px solid #e5e7eb!important;background:#fff!important;',
			'}',
			'form.compose .row{width:100%!important;order:-1!important;}',
			'form.compose textarea{',
			'  flex:1!important;width:auto!important;min-width:0!important;height:40px!important;',
			'  border:0!important;border-bottom:1px solid #d1d5db!important;border-radius:0!important;',
			'  padding:8px 4px!important;resize:none!important;background:transparent!important;',
			'  color:#111827!important;font-size:14px!important;box-shadow:none!important;',
			'}',
			'form.compose textarea:focus{outline:none!important;border-bottom-color:' + GREEN + '!important;}',
			'form.compose input{border:0!important;border-bottom:1px solid #d1d5db!important;border-radius:0!important;background:transparent!important;}',
			'form.compose input:focus{outline:none!important;border-bottom-color:' + GREEN + '!important;}',
			'button.send{',
			'  width:40px!important;height:40px!important;min-width:40px!important;padding:0!important;',
			'  border-radius:50%!important;background:#e5e7eb!important;',
			'  background-image:' + SEND_ARROW + '!important;',
			'  background-repeat:no-repeat!important;background-position:center!important;background-size:18px 18px!important;',
			'  color:transparent!important;font-size:0!important;flex-shrink:0!important;',
			'}',
			'button.send:hover:not(:disabled){background-color:#d1d5db!important;}',
			'button.send:disabled{opacity:.55!important;}',
			'.note button.send{',
			'  width:auto!important;height:auto!important;border-radius:0!important;padding:8px 14px!important;',
			'  background:' + GREEN + '!important;background-image:none!important;color:#fff!important;',
			'  font-size:14px!important;font-weight:600!important;',
			'}'
		].join('');
	}

	function applyDomTweaks(root) {
		if (tweaking) return;
		tweaking = true;
		try {
			ensurePreviewToggle(root);
			applyHeaderState(root);

			var ta = root.querySelector('form.compose textarea');
			if (ta) {
				if (ta.getAttribute('placeholder') !== 'Напиши съобщение...') {
					ta.setAttribute('placeholder', 'Напиши съобщение...');
				}
				ta.setAttribute('aria-label', 'Напиши съобщение...');
			}

			var send = root.querySelector('form.compose > button.send');
			if (send) {
				send.setAttribute('aria-label', 'Изпрати');
				send.title = 'Изпрати';
			}

			var hint = root.querySelector('.log .hint');
			if (hint) {
				if (hint.textContent !== WELCOME) hint.textContent = WELCOME;
			} else {
				var log = root.querySelector('.log');
				if (log && !log.querySelector('.msg')) {
					var el = document.createElement('div');
					el.className = 'hint';
					el.textContent = WELCOME;
					log.appendChild(el);
				}
			}
		} finally {
			tweaking = false;
		}
	}

	function onLogChanged(root) {
		if (tweaking) return;
		applyDomTweaks(root);
		syncAutoReplies(root);
		updateBadge(root);
	}

	function observeLog(root) {
		if (root.__plasicoLogObserved) return;
		var log = root.querySelector('.log');
		if (!log || !window.MutationObserver) return;
		root.__plasicoLogObserved = true;
		var mo = new MutationObserver(function () {
			onLogChanged(root);
		});
		mo.observe(log, { childList: true });
	}

	/** Widget may overwrite h2 with plain text — restore our dotted title */
	function observeHead(root) {
		if (root.__plasicoHeadObserved) return;
		var head = root.querySelector('.head');
		if (!head || !window.MutationObserver) return;
		root.__plasicoHeadObserved = true;
		new MutationObserver(function () {
			if (tweaking) return;
			applyHeaderState(root);
		}).observe(head, { childList: true, subtree: true, characterData: true });
	}

	function wirePanelAndCompose(root) {
		if (root.__plasicoPanelWired) return;
		root.__plasicoPanelWired = true;

		var panel = root.querySelector('.panel');
		if (panel && window.MutationObserver) {
			var wasOpen = isPanelOpen(root);
			new MutationObserver(function () {
				var open = isPanelOpen(root);
				if (open && !wasOpen) clearUnread(root);
				else if (!open && wasOpen) updateBadge(root);
				wasOpen = open;
			}).observe(panel, { attributes: true, attributeFilter: ['class'] });
		}

		var launcher = root.querySelector('button.launcher');
		if (launcher) {
			launcher.addEventListener('click', function () {
				setTimeout(function () {
					if (isPanelOpen(root)) clearUnread(root);
					applyDomTweaks(root);
				}, 0);
			});
		}

		var closeBtn = root.querySelector('.x');
		if (closeBtn) {
			closeBtn.addEventListener('click', function () {
				setTimeout(function () {
					updateBadge(root);
				}, 0);
			});
		}

		var compose = root.querySelector('form.compose');
		if (compose) {
			compose.addEventListener('submit', function () {
				var tries = 0;
				var timer = setInterval(function () {
					syncAutoReplies(root);
					var visitors = root.querySelectorAll('.log .msg.visitor');
					var autos = root.querySelectorAll('.log .msg.agent[data-plasico-auto="1"]');
					if ((visitors.length && autos.length >= visitors.length) || ++tries > 40) {
						clearInterval(timer);
					}
				}, 120);
			});
		}
	}

	function styleWidget(host) {
		if (!host) return false;
		var root = host.shadowRoot;
		if (!root || !root.querySelector('button.launcher')) return false;

		if (!root.querySelector('style[data-plasico-theme]')) {
			var style = document.createElement('style');
			style.setAttribute('data-plasico-theme', '1');
			style.textContent = themeCss();
			root.appendChild(style);
		}

		var launcher = root.querySelector('button.launcher');
		if (launcher) {
			launcher.setAttribute('aria-label', 'Онлайн чат');
			launcher.title = 'Онлайн чат';
		}

		applyDomTweaks(root);
		observeLog(root);
		observeHead(root);
		wirePanelAndCompose(root);
		syncAutoReplies(root);
		updateBadge(root);
		return true;
	}

	function tryStyle() {
		return styleWidget(findHost());
	}

	function openPanel() {
		var host = findHost();
		if (!host) return false;
		styleWidget(host);
		var panel = host.shadowRoot.querySelector('.panel');
		var launcher = host.shadowRoot.querySelector('button.launcher');
		if (!panel || !launcher) return false;
		if (!panel.classList.contains('open')) launcher.click();
		setTimeout(function () {
			styleWidget(host);
			clearUnread(host.shadowRoot);
		}, 0);
		return true;
	}

	function openWhenReady() {
		if (openPanel()) return;
		var tries = 0;
		var timer = setInterval(function () {
			if (openPanel() || ++tries > 40) clearInterval(timer);
		}, 100);
	}

	function watchForWidget() {
		if (tryStyle()) return;

		if (window.MutationObserver && document.body) {
			var mo = new MutationObserver(function () {
				if (tryStyle()) mo.disconnect();
			});
			mo.observe(document.body, { childList: true });
			setTimeout(function () {
				mo.disconnect();
			}, 15000);
		}

		var tries = 0;
		var timer = setInterval(function () {
			if (tryStyle() || ++tries > 100) clearInterval(timer);
		}, 100);
	}

	document.addEventListener(
		'click',
		function (e) {
			var target = e.target;
			if (!target || !target.closest) return;
			if (!target.closest('#chat')) return;
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
			openWhenReady();
		},
		true
	);

	function loadWidget() {
		if (window.__intelektaChat) {
			watchForWidget();
			return;
		}

		fetch(WIDGET_SRC, { credentials: 'omit' })
			.then(function (r) {
				if (!r.ok) throw new Error('widget ' + r.status);
				return r.text();
			})
			.then(function (code) {
				var patched = code.replace(
					/var API = [^;]+;/,
					"var API = '" + API_BASE.replace(/'/g, "\\'") + "';"
				);
				var blob = new Blob([patched], { type: 'text/javascript' });
				var s = document.createElement('script');
				s.src = URL.createObjectURL(blob);
				s.onload = function () {
					URL.revokeObjectURL(s.src);
					watchForWidget();
				};
				s.onerror = function () {
					var fallback = document.createElement('script');
					fallback.src = WIDGET_SRC;
					fallback.async = true;
					fallback.onload = watchForWidget;
					(document.head || document.documentElement).appendChild(fallback);
				};
				(document.head || document.documentElement).appendChild(s);
			})
			.catch(function () {
				var fallback = document.createElement('script');
				fallback.src = WIDGET_SRC;
				fallback.async = true;
				fallback.onload = watchForWidget;
				(document.head || document.documentElement).appendChild(fallback);
			});
	}

	function boot() {
		watchForWidget();
		loadWidget();
	}

	if (document.body) boot();
	else document.addEventListener('DOMContentLoaded', boot);
})();
