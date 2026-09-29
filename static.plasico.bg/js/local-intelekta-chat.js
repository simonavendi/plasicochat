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
	var TITLE_OFFLINE = 'Пласико извън линия';
	var SUB_OFFLINE =
		'Пишете ни, ще получите отговор в работно време 9:00-18:00 понеделник до петък по имейл.';

	var NOTE_OFFLINE =
		'В момента сме извън работно време. Оставете данните и въпроса си и ще получите отговор по имейл когато отново сме на линия.';
	var ONLINE_LEAD = 'Не се притеснявайте да затворите този прозорец, чатът се запазва.';
	var CONTACT_KEY = 'plasico_chat_contact';
	var PHONE_RE = /^\+?[0-9\s().\-]+$/;
	var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

	/** Optional leading +, digits, spaces, dashes, dots, parentheses; 8-15 digits (E.164 max). */
	function isValidPhone(v) {
		v = String(v || '').trim();
		var digits = v.replace(/\D/g, '').length;
		return PHONE_RE.test(v) && digits >= 8 && digits <= 15;
	}

	function readContact() {
		try {
			return JSON.parse(localStorage.getItem(CONTACT_KEY) || 'null');
		} catch (e) {
			return null;
		}
	}

	/** Name is optional in the form; email and phone must be valid to skip the fields. */
	function contactComplete(c) {
		return !!(c && EMAIL_RE.test(String(c.email || '').trim()) && isValidPhone(c.phone));
	}

	/* Read by the patched widget source (see patchWidgetSource). */
	window.__plasicoPhoneOk = isValidPhone;
	window.__plasicoContactHidden = contactComplete(readContact());
	window.__plasicoContactSaved = function (contact) {
		try {
			localStorage.setItem(CONTACT_KEY, JSON.stringify(contact));
		} catch (e) {}
		window.__plasicoContactHidden = contactComplete(contact);
		var host = findHost();
		if (host && host.shadowRoot) applyHeaderState(host.shadowRoot);
	};
	var PHONE_PLACEHOLDER = 'Телефон';
	var PHONE_NEEDED = 'Моля, въведете телефон, за да можем да се свържем с вас.';
	var PHONE_INVALID =
		'Моля, въведете валиден телефонен номер (напр. 0888 123 456 или +359 888 123 456).';

	var WELCOME =
		'Здравей! 👋 ' +
		'Добре дошъл в Plasico – мястото за технологии, компютри и електроника. 💻✨\n\n' +
		'Можеш да ни попиташ за продукти, цени, характеристики, наличности, препоръки и всичко останало. Наш служител ще ти отговори в най-кратък срок.\n\n' +
		'Какво търсиш днес? 🚀';

	var AUTO_REPLY =
		'Здравейте, благодарим за съобщението. Наш служител ще ви отговори до няколко минути...';

	var tweaking = false;
	var localUnread = 0;
	var pendingAutoKeys = Object.create(null);
	/** Preview mode: 'online' | 'offline' — independent of real API hours */
	var previewMode = 'online';
	var previewInitDone = false;
	/** Match #chat hide breakpoint in local-chat-button.css */
	var MOBILE_MQ = '(max-width: 990px)';
	var HOST_DESKTOP =
		'position:fixed;right:20px;bottom:20px;z-index:2147483000;';
	/** Fullscreen host below the pinned mobile top bar; top offset is filled in at runtime. */
	function hostMobileFs(topPx) {
		return (
			'position:fixed;top:' + topPx + 'px;left:0;right:0;bottom:0;width:100%;' +
			'height:calc(100% - ' + topPx + 'px);height:calc(100dvh - ' + topPx + 'px);' +
			'max-height:calc(100dvh - ' + topPx + 'px);z-index:2147483000;'
		);
	}

	/** Bottom edge of the site top bar if it is currently on screen (sticky on mobile). */
	function siteHeaderOffset() {
		var header = document.querySelector('body > header');
		if (!header) return 0;
		var bottom = header.getBoundingClientRect().bottom;
		return bottom > 0 ? Math.round(bottom) : 0;
	}
	var WRAP_DESKTOP = 'display:flex;flex-direction:column;align-items:flex-end';
	var WRAP_MOBILE_FS =
		'display:flex;flex-direction:column;align-items:stretch;width:100%;height:100%;';
	var resizeWired = false;

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

	function isMobileViewport() {
		return !!(window.matchMedia && window.matchMedia(MOBILE_MQ).matches);
	}

	/** Open panel on mobile → edge-to-edge; otherwise keep floating desktop host. */
	function syncFullscreenLayout(host, root) {
		if (!host || !root) return;
		var panel = root.querySelector('.panel');
		var wrap = panel && panel.parentElement;
		var fullscreen = isPanelOpen(root) && isMobileViewport();

		if (fullscreen) {
			host.style.cssText = hostMobileFs(siteHeaderOffset());
			host.setAttribute('data-plasico-fs', '1');
			if (wrap) wrap.style.cssText = WRAP_MOBILE_FS;
			document.documentElement.style.overflow = 'hidden';
		} else {
			host.style.cssText = HOST_DESKTOP;
			host.removeAttribute('data-plasico-fs');
			if (wrap) wrap.style.cssText = WRAP_DESKTOP;
			if (!document.querySelector('[data-plasico-fs="1"]')) {
				document.documentElement.style.overflow = '';
			}
		}
	}

	function wireResizeSync() {
		if (resizeWired) return;
		resizeWired = true;
		window.addEventListener('resize', function () {
			var host = findHost();
			if (host && host.shadowRoot) syncFullscreenLayout(host, host.shadowRoot);
		});
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

		if (previewMode === 'offline') {
			var autos = log.querySelectorAll('.msg.agent[data-plasico-auto="1"]');
			if (autos.length) {
				withTweaking(function () {
					for (var a = 0; a < autos.length; a++) autos[a].remove();
				});
			}
			pendingAutoKeys = Object.create(null);
			updateBadge(root);
			return;
		}

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

	function withTweaking(fn) {
		var prev = tweaking;
		tweaking = true;
		try {
			fn();
		} finally {
			tweaking = prev;
		}
	}

	function applyHeaderState(root) {
		var offline = previewMode === 'offline';
		var title = root.querySelector('.head h2');
		var status = root.querySelector('.head p');
		var wantSub = offline ? SUB_OFFLINE : SUB_ONLINE;
		var modeKey = offline ? 'offline' : 'online';

		withTweaking(function () {
			if (title) {
				var needsTitle =
					title.getAttribute('data-plasico-title') !== modeKey ||
					!title.querySelector('.plasico-status-dot');
				if (needsTitle) {
					title.setAttribute('data-plasico-title', modeKey);
					title.textContent = '';
					title.appendChild(document.createTextNode('Пласико '));
					var dot = document.createElement('span');
					dot.className =
						'plasico-status-dot ' + (offline ? 'is-offline' : 'is-online');
					dot.setAttribute('aria-hidden', 'true');
					title.appendChild(dot);
					title.appendChild(
						document.createTextNode(offline ? ' извън линия' : ' на линия')
					);
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

			/* Same Име / Имейл / Телефон form in both modes; hidden once valid details are saved */
			var hideContact = !!window.__plasicoContactHidden;
			var contactRow = root.querySelector('form.compose .row');
			if (contactRow && contactRow.hidden !== hideContact) contactRow.hidden = hideContact;
			var rowInputs = contactRow ? contactRow.querySelectorAll('input') : [];
			for (var ri = 1; ri < rowInputs.length; ri++) rowInputs[ri].required = !hideContact;

			var lead = root.querySelector('.plasico-offline-lead');
			if (lead) {
				if (lead.textContent !== ONLINE_LEAD) lead.textContent = ONLINE_LEAD;
				lead.hidden = offline;
			}

			/* Red out-of-hours notice only offline; its stock email form is replaced by the row */
			var note = root.querySelector('.note');
			if (note) {
				note.classList.add('plasico-offline');
				var noteText = null;
				for (var ni = 0; ni < note.children.length; ni++) {
					if (note.children[ni].tagName !== 'FORM') {
						noteText = note.children[ni];
						break;
					}
				}
				if (noteText && noteText.textContent !== NOTE_OFFLINE) {
					noteText.textContent = NOTE_OFFLINE;
				}
				var noteForm = note.querySelector('form');
				if (noteForm) noteForm.hidden = true;
				note.hidden = !offline;
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
		});
	}

	function ensurePreviewToggle(root) {
		var panel = root.querySelector('.panel');
		if (!panel) return;

		if (!root.querySelector('.plasico-preview-toggle')) {
			var bar = document.createElement('div');
			bar.className = 'plasico-preview-toggle';
			bar.setAttribute('role', 'group');
			bar.setAttribute('aria-label', 'Преглед: онлайн / извън линия');

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
			offlineBtn.textContent = 'извън линия';

			bar.appendChild(label);
			bar.appendChild(onlineBtn);
			bar.appendChild(sep);
			bar.appendChild(offlineBtn);

			bar.addEventListener('click', function (e) {
				var btn = e.target.closest('button[data-mode]');
				if (!btn) return;
				previewMode = btn.getAttribute('data-mode') === 'offline' ? 'offline' : 'online';
				applyHeaderState(root);
				syncAutoReplies(root);
			});

			panel.insertBefore(bar, panel.firstChild);
		}
	}

	/** Green note above the compose area in online mode, shown even when the contact fields are hidden */
	function ensureOfflineLead(root) {
		var compose = root.querySelector('form.compose');
		if (!compose || root.querySelector('.plasico-offline-lead')) return;
		var lead = document.createElement('div');
		lead.className = 'plasico-offline-lead';
		lead.textContent = ONLINE_LEAD;
		lead.hidden = true;
		compose.parentNode.insertBefore(lead, compose);
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

			/* Desktop: panel sits above the FAB (host bottom 20 + FAB 56 + gap 12) and
			   must fit the viewport with a 20px top margin, so cap at 100vh - 108px. */
			'@media only screen and (min-width: 991px){',
			'  .panel{',
			'    width:min(360px, calc(100vw - 40px));max-width:none;',
			'    height:min(520px, calc(100vh - 108px));',
			'    height:min(520px, calc(100dvh - 108px));',
			'    max-height:none;min-height:0;',
			'  }',
			'}',
			'.panel > :not(.log){flex-shrink:0;}',
			'.log{flex:1 1 auto;min-height:0;overflow-y:auto;}',
			/* Mobile: open panel fills the viewport (host inset set in JS). */
			'@media only screen and (max-width: 990px){',
			'  .panel.open{',
			'    width:100%!important;max-width:none!important;',
			'    height:100%!important;max-height:none!important;',
			'    margin:0!important;border-radius:0!important;',
			'    box-shadow:none!important;flex:1 1 auto!important;',
			'  }',
			'  .panel.open ~ .launcher{display:none!important;}',
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
			'.note.plasico-offline{background:#fef2f2!important;color:#991b1b!important;border-top:1px solid #fecaca!important;border-bottom:1px solid #fecaca!important;}',
			'.plasico-offline-lead{',
			'  padding:8px 12px;font-size:12px;line-height:1.4;',
			'  background:#ecfdf5;color:#065f46;border-top:1px solid #d1fae5;',
			'}',
			'.plasico-offline-lead[hidden]{display:none!important;}',

			'form.compose{',
			'  flex-direction:row!important;flex-wrap:wrap!important;align-items:center!important;gap:10px!important;',
			'  padding:12px 14px 14px!important;border-top:1px solid #e5e7eb!important;background:#fff!important;',
			'}',
			'form.compose .row{width:100%!important;order:-1!important;flex-wrap:nowrap;}',
			'form.compose .row input{flex:1 1 0;min-width:0;}',
			'form.compose .row input[type="email"]{flex-grow:1.4;}',
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
			'}',

			/* Short laptop screens; kept last so it overrides the base rules above. */
			'@media only screen and (min-width: 991px) and (max-height: 800px){',
			'  .panel{',
			'    width:min(340px, calc(100vw - 40px));',
			'    height:min(500px, calc(100vh - 100px));',
			'    height:min(500px, calc(100dvh - 100px));',
			'    margin-bottom:10px;',
			'  }',
			'  .launcher{width:52px;height:52px;min-width:52px;}',
			'  .plasico-preview-toggle{padding:4px 12px;}',
			'  .head{padding:10px 14px 9px!important;}',
			'  .head h2{font-size:15px!important;}',
			'  .head p{font-size:11.5px!important;line-height:1.35!important;margin-top:3px!important;}',
			'  .x{width:28px!important;height:28px!important;min-width:28px!important;font-size:16px!important;}',
			'  .log{padding:10px 14px!important;gap:10px!important;}',
			'  .hint{font-size:13px!important;line-height:1.5!important;}',
			'  .msg{font-size:13px!important;padding:7px 11px;}',
			'  .note,.plasico-offline-lead{padding:5px 12px;font-size:11.5px;line-height:1.35;}',
			'  form.compose .row input{padding:5px 6px;font-size:13px;}',
			'  form.compose{padding:6px 12px 8px!important;gap:6px!important;}',
			'  form.compose textarea{height:34px!important;padding:6px 4px!important;font-size:13px!important;}',
			'  form.compose > button.send{width:34px!important;height:34px!important;min-width:34px!important;}',
			'}'
		].join('');
	}

	function applyDomTweaks(root) {
		if (tweaking) return;
		tweaking = true;
		try {
			ensurePreviewToggle(root);
			ensureOfflineLead(root);
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
			if (tweaking) return;
			onLogChanged(root);
		});
		mo.observe(log, { childList: true });
		root.__plasicoLogMo = mo;
	}

	/** Widget may overwrite h2 with plain text — restore our dotted title */
	function observeHead(root) {
		if (root.__plasicoHeadObserved) return;
		var head = root.querySelector('.head');
		if (!head || !window.MutationObserver) return;
		root.__plasicoHeadObserved = true;
		var scheduled = false;
		var mo = new MutationObserver(function () {
			if (tweaking || scheduled) return;
			scheduled = true;
			setTimeout(function () {
				scheduled = false;
				if (tweaking) return;
				applyHeaderState(root);
			}, 0);
		});
		mo.observe(head, { childList: true, subtree: true, characterData: true });
		root.__plasicoHeadMo = mo;
	}

	function wirePanelAndCompose(root) {
		if (root.__plasicoPanelWired) return;
		root.__plasicoPanelWired = true;

		var panel = root.querySelector('.panel');
		var hostEl = root.host || findHost();
		if (panel && window.MutationObserver) {
			var wasOpen = isPanelOpen(root);
			new MutationObserver(function () {
				var open = isPanelOpen(root);
				if (open && !wasOpen) clearUnread(root);
				else if (!open && wasOpen) updateBadge(root);
				wasOpen = open;
				syncFullscreenLayout(hostEl, root);
			}).observe(panel, { attributes: true, attributeFilter: ['class'] });
		}

		var launcher = root.querySelector('button.launcher');
		if (launcher) {
			launcher.addEventListener('click', function () {
				setTimeout(function () {
					if (isPanelOpen(root)) clearUnread(root);
					applyDomTweaks(root);
					syncFullscreenLayout(hostEl, root);
				}, 0);
			});
		}

		var closeBtn = root.querySelector('.x');
		if (closeBtn) {
			closeBtn.addEventListener('click', function () {
				setTimeout(function () {
					updateBadge(root);
					syncFullscreenLayout(hostEl, root);
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
					if (
						previewMode === 'offline' ||
						(visitors.length && autos.length >= visitors.length) ||
						++tries > 40
					) {
						clearInterval(timer);
					}
				}, 120);
			});
		}
	}

	/**
	 * Prefill Име / Имейл / Телефон from the details saved after a successful send,
	 * so hidden fields still carry them on later messages.
	 */
	function wireContactMemory(root) {
		if (root.__plasicoContactWired) return;
		var inputs = root.querySelectorAll('form.compose .row input');
		if (inputs.length < 3) return;
		root.__plasicoContactWired = true;
		var saved = readContact() || {};
		var keys = ['name', 'email', 'phone'];
		for (var i = 0; i < 3; i++) {
			if (!inputs[i].value && saved[keys[i]]) inputs[i].value = saved[keys[i]];
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

		var realState = window.__plasicoChatState;
		if (!previewInitDone && realState) {
			previewInitDone = true;
			previewMode = realState.online ? 'online' : 'offline';
		}

		applyDomTweaks(root);
		wireContactMemory(root);
		observeLog(root);
		observeHead(root);
		wirePanelAndCompose(root);
		syncAutoReplies(root);
		updateBadge(root);
		syncFullscreenLayout(host, root);
		wireResizeSync();
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

	function jsString(s) {
		return (
			"'" +
			String(s)
				.replace(/\\/g, '\\\\')
				.replace(/'/g, "\\'")
				.replace(/\n/g, '\\n')
				.replace(/\r/g, '\\r') +
			"'"
		);
	}

	/**
	 * Shows the same name/email/phone row in online and offline mode, with email
	 * and phone required, until valid details have been sent once (then hidden).
	 * The API ignores unknown payload keys, so a new phone is also appended to the
	 * message body. The .note is shown by this script only.
	 * Each replace is a no-op if upstream changes, leaving the stock widget intact.
	 */
	function patchWidgetSource(code) {
		function sub(re, fn) {
			code = code.replace(re, fn);
		}
		sub(/var API = [^;]+;/, function () {
			return 'var API = ' + jsString(API_BASE) + ';';
		});
		sub(
			/var offlineFields = el\('div', \{ class: 'row' \}, \[nameInput, emailInput\]\);/,
			function () {
				return (
					"var phoneInput = el('input', { type: 'tel', class: 'plasico-phone', placeholder: " +
					jsString(PHONE_PLACEHOLDER) +
					", maxlength: '30', autocomplete: 'tel', 'aria-label': " +
					jsString(PHONE_PLACEHOLDER) +
					' });' +
					"var offlineFields = el('div', { class: 'row' }, [nameInput, emailInput, phoneInput]);"
				);
			}
		);
		sub(/var state = \{[^;]*\};/, function (m) {
			return m + 'window.__plasicoChatState = state;';
		});
		sub(/offlineFields\.hidden = state\.online \|\| state\.hasEmail;/, function () {
			return 'offlineFields.hidden = !!window.__plasicoContactHidden;';
		});
		sub(/emailInput\.required = [^;]+;/, function () {
			return 'emailInput.required = phoneInput.required = !offlineFields.hidden;';
		});
		sub(/note\.hidden = !\(state\.online && wrote && !state\.hasEmail\);/, function () {
			return '';
		});
		/* A failed check re-shows the fields so the visitor can fix them. */
		var reveal = 'window.__plasicoContactHidden = false;offlineFields.hidden = false;';
		sub(/if \(!state\.online && !state\.hasEmail && !emailInput\.value\.trim\(\)\) \{/, function () {
			return 'if (!emailInput.value.trim()) {' + reveal;
		});
		sub(/state\.sending = true;\s*showError\(''\);/, function (m) {
			return (
				'var plasicoPhone = phoneInput.value.trim();' +
				'if (!plasicoPhone) {' +
				reveal +
				'showError(' +
				jsString(PHONE_NEEDED) +
				');phoneInput.focus();return;}' +
				'if (!window.__plasicoPhoneOk(plasicoPhone)) {' +
				reveal +
				'showError(' +
				jsString(PHONE_INVALID) +
				');phoneInput.focus();return;}' +
				m
			);
		});
		sub(/if \(emailInput\.value\.trim\(\)\) payload\.email = emailInput\.value\.trim\(\);/, function (m) {
			return (
				m +
				'payload.phone = plasicoPhone;' +
				"if (storage('get', 'plasico_chat_phone_sent') !== plasicoPhone) {" +
				'payload.body = body + ' +
				jsString('\n\n' + PHONE_PLACEHOLDER + ': ') +
				' + plasicoPhone;}'
			);
		});
		sub(/if \(res\.status === 201\) \{/, function (m) {
			return (
				m +
				"storage('set', 'plasico_chat_phone_sent', payload.phone);" +
				'window.__plasicoContactSaved({ name: nameInput.value.trim(), email: emailInput.value.trim(), phone: plasicoPhone });' +
				'offlineFields.hidden = !!window.__plasicoContactHidden;'
			);
		});
		return code;
	}

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
				var patched = patchWidgetSource(code);
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
