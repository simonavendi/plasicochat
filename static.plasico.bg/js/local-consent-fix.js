/**
 * Accept cookies locally / suppress CookieScript banner without freezing the page.
 * Never observe the whole document and mutate it in the same callback — that races
 * CookieScript reinjection and locks the main thread.
 */
(function () {
	var storageKey = '__plasico_local_cookies__';
	var store = {};

	try {
		store = JSON.parse(localStorage.getItem(storageKey) || '{}');
	} catch (e) {
		store = {};
	}

	var proto = Document.prototype;
	var desc =
		Object.getOwnPropertyDescriptor(proto, 'cookie') ||
		Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');

	if (desc && desc.configurable !== false) {
		Object.defineProperty(document, 'cookie', {
			get: function () {
				var orig = desc.get ? desc.get.call(document) : '';
				var extras = Object.keys(store)
					.map(function (name) {
						return name + '=' + store[name];
					})
					.join('; ');
				return extras ? (orig ? orig + '; ' + extras : extras) : orig;
			},
			set: function (value) {
				var match = /^([^=]+)=([^;]*)/.exec(value);
				if (match) {
					store[match[1].trim()] = match[2];
					try {
						localStorage.setItem(storageKey, JSON.stringify(store));
					} catch (e) {}
				}
				if (desc.set) {
					try {
						desc.set.call(document, value);
					} catch (e) {}
				}
			},
			configurable: true,
		});
	}

	if (!store.CookieScriptConsent) {
		document.cookie =
			'CookieScriptConsent=' +
			encodeURIComponent(
				JSON.stringify({
					action: 'accept',
					categories:
						'["strict","targeting","performance","functionality","unclassified"]',
					key: 'local',
					bannershown: 1,
				})
			) +
			'; path=/; max-age=31536000';
	}

	document.documentElement.classList.add('plasico-local-consent-accepted');

	if (!document.getElementById('plasico-local-consent-style')) {
		var style = document.createElement('style');
		style.id = 'plasico-local-consent-style';
		style.textContent =
			'#cookiescript_injected,#cookiescript_injected_fsd,#cookiescript_badge,.cookiescript_overlay{display:none!important;visibility:hidden!important;pointer-events:none!important;}';
		(document.head || document.documentElement).appendChild(style);
	}

	function hideCookieNodes() {
		if (window.CookieScript && CookieScript.instance && CookieScript.instance.hide) {
			try {
				CookieScript.instance.hide();
			} catch (e) {}
		}
		document.documentElement.classList.remove('cookiescript_overlay');
		/* CSS hides banners; avoid remove() here — it retriggers CookieScript and freezes. */
		[
			'#cookiescript_injected',
			'#cookiescript_injected_fsd',
			'#cookiescript_badge',
			'.cookiescript_overlay',
		].forEach(function (sel) {
			document.querySelectorAll(sel).forEach(function (el) {
				el.style.setProperty('display', 'none', 'important');
				el.style.setProperty('visibility', 'hidden', 'important');
				el.style.setProperty('pointer-events', 'none', 'important');
			});
		});
	}

	function scheduleHide() {
		hideCookieNodes();
		setTimeout(hideCookieNodes, 0);
		setTimeout(hideCookieNodes, 250);
		setTimeout(hideCookieNodes, 1000);
		setTimeout(hideCookieNodes, 3000);
	}

	scheduleHide();
	document.addEventListener('DOMContentLoaded', scheduleHide);
	window.addEventListener('load', scheduleHide);
	document.addEventListener('CookieScriptLoaded', scheduleHide);
})();
