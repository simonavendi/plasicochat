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

	var style = document.createElement('style');
	style.textContent =
		'#cookiescript_injected,#cookiescript_injected_fsd,#cookiescript_badge,.cookiescript_overlay{display:none!important;}';
	(document.head || document.documentElement).appendChild(style);

	function suppressBanner() {
		if (window.CookieScript && CookieScript.instance && CookieScript.instance.hide) {
			CookieScript.instance.hide();
		}
		document.documentElement.classList.remove('cookiescript_overlay');
		[
			'#cookiescript_injected',
			'#cookiescript_injected_fsd',
			'#cookiescript_badge',
			'.cookiescript_overlay',
		].forEach(function (sel) {
			document.querySelectorAll(sel).forEach(function (el) {
				el.style.setProperty('display', 'none', 'important');
				el.remove();
			});
		});
	}

	suppressBanner();
	document.addEventListener('DOMContentLoaded', suppressBanner);
	window.addEventListener('load', suppressBanner);
	document.addEventListener('CookieScriptLoaded', suppressBanner);

	if (window.MutationObserver) {
		new MutationObserver(suppressBanner).observe(document.documentElement, {
			childList: true,
			subtree: true,
		});
	}
})();
