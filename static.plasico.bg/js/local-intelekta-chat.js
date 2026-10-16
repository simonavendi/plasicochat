/**
 * Intelekta OS public chat — same-origin proxy loader.
 *
 * Upstream replaced the old in-page Shadow DOM widget (button.launcher) with a
 * small iframe embed. The floating bottom-right control lives inside that
 * iframe (`/frame`), not on the host page.
 *
 * Load widget.js as a real script (not a blob): the embed reads data-chat /
 * data-open / data-header from document.currentScript.
 *
 * Local/Vercel: /api/v1/public/chat → https://os.4chairs.bg/api/v1/public/chat
 */
(function () {
	'use strict';

	if (window.__plasicoChatLoader) return;
	window.__plasicoChatLoader = true;

	var API_BASE = location.origin + '/api/v1/public/chat/';

	function inject() {
		if (window.__intelektaChat) return;

		var s = document.createElement('script');
		s.src = API_BASE + 'widget.js';
		s.async = true;
		s.setAttribute('data-chat', API_BASE);
		/* Header #chat opens the iframe panel (capture handler inside widget). */
		s.setAttribute('data-open', '#chat');
		/* Mobile fullscreen panel sits below the sticky site header. */
		s.setAttribute('data-header', 'body > header');
		(document.head || document.documentElement).appendChild(s);
	}

	if (document.body) inject();
	else document.addEventListener('DOMContentLoaded', inject);
})();
