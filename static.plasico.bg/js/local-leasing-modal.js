(function () {
	var PROVIDERS = {
		unicredit: {
			name: 'UniCredit Consumer Financing',
			schemeLabel: 'UniCredit Bulbank схема',
			terms: [
				{ months: 3, multiplier: 1.201 },
				{ months: 7, multiplier: 1.261 },
				{ months: 12, multiplier: 1.337 },
				{ months: 18, multiplier: 1.434 },
			],
		},
		bnp: {
			name: 'BNP Paribas Personal Finance',
			schemeLabel: 'BNP Paribas схема',
			terms: [
				{ months: 3, multiplier: 1.185 },
				{ months: 6, multiplier: 1.235 },
				{ months: 12, multiplier: 1.29 },
				{ months: 24, multiplier: 1.38 },
			],
		},
	};

	var state = {
		provider: 'unicredit',
		selectedMonths: 12,
		price: 0,
		prodId: '',
	};

	function formatEuro(amount) {
		return amount.toFixed(2).replace('.', ',') + ' €';
	}

	function parsePrice() {
		var selectors = [
			'.promocode_price .codeprice',
			'.prod-price .price',
			'.prod-price .prices .price',
		];

		for (var i = 0; i < selectors.length; i++) {
			var el = document.querySelector(selectors[i]);
			if (!el) continue;

			var text = el.textContent.replace(/\s+/g, ' ').trim();
			var match = text.match(/(\d+)[.,](\d{2})/);
			if (match) {
				return parseFloat(match[1] + '.' + match[2]);
			}
		}

		return 0;
	}

	function getProdId() {
		var input = document.querySelector('#buy-form input[name="prod_id"]');
		return input ? input.value : '';
	}

	function calcTerm(price, term) {
		var total = price * term.multiplier;
		var monthly = total / term.months;
		return {
			months: term.months,
			monthly: monthly,
			total: total,
		};
	}

	function getTerms() {
		return PROVIDERS[state.provider].terms.map(function (term) {
			return calcTerm(state.price, term);
		});
	}

	function getSelectedTerm() {
		var terms = getTerms();
		for (var i = 0; i < terms.length; i++) {
			if (terms[i].months === state.selectedMonths) {
				return terms[i];
			}
		}
		return terms[terms.length - 1];
	}

	function teaserText(term) {
		return 'За ' + term.months + ' месеца x ' + formatEuro(term.monthly);
	}

	function summaryText(term) {
		return formatEuro(term.monthly) + ' / месец - ' + term.months + ' вноски';
	}

	function ensureModal() {
		if (document.getElementById('pl-leasing-overlay')) {
			return document.getElementById('pl-leasing-overlay');
		}

		var overlay = document.createElement('div');
		overlay.id = 'pl-leasing-overlay';
		overlay.className = 'pl-leasing-overlay';
		overlay.hidden = true;
		overlay.innerHTML =
			'<div class="pl-leasing-modal" role="dialog" aria-modal="true" aria-labelledby="pl-leasing-title">' +
			'  <div class="pl-leasing-head">' +
			'    <div class="pl-leasing-icon" aria-hidden="true">👍</div>' +
			'    <div class="pl-leasing-title-wrap">' +
			'      <h2 class="pl-leasing-title" id="pl-leasing-title">Купи на изплащане</h2>' +
			'      <p class="pl-leasing-subtitle">Избери финансираща институция и удобна схема...</p>' +
			'    </div>' +
			'    <button type="button" class="pl-leasing-close" aria-label="Затвори">&times;</button>' +
			'  </div>' +
			'  <div class="pl-leasing-body">' +
			'    <label class="pl-leasing-label" for="pl-leasing-provider">Финансираща институция</label>' +
			'    <div class="pl-leasing-select-wrap">' +
			'      <select id="pl-leasing-provider" class="pl-leasing-select"></select>' +
			'    </div>' +
			'    <div class="pl-leasing-summary" id="pl-leasing-summary"></div>' +
			'    <div class="pl-leasing-label" id="pl-leasing-scheme-label"></div>' +
			'    <div class="pl-leasing-schemes" id="pl-leasing-schemes"></div>' +
			'  </div>' +
			'</div>';

		document.body.appendChild(overlay);

		overlay.addEventListener('click', function (e) {
			if (e.target === overlay) closeModal();
		});

		overlay.querySelector('.pl-leasing-close').addEventListener('click', closeModal);

		overlay.querySelector('#pl-leasing-provider').addEventListener('change', function (e) {
			state.provider = e.target.value;
			var terms = PROVIDERS[state.provider].terms;
			if (!terms.some(function (t) { return t.months === state.selectedMonths; })) {
				state.selectedMonths = terms[terms.length - 1].months;
			}
			renderModal();
			renderTeaser();
		});

		document.addEventListener('keydown', function (e) {
			if (e.key === 'Escape' && !overlay.hidden) {
				closeModal();
			}
		});

		return overlay;
	}

	function renderProviderOptions() {
		var select = document.getElementById('pl-leasing-provider');
		if (!select) return;

		select.innerHTML = Object.keys(PROVIDERS)
			.map(function (key) {
				var selected = key === state.provider ? ' selected' : '';
				return (
					'<option value="' +
					key +
					'"' +
					selected +
					'>' +
					PROVIDERS[key].name +
					'</option>'
				);
			})
			.join('');
	}

	function renderModal() {
		ensureModal();
		renderProviderOptions();

		var selected = getSelectedTerm();
		var provider = PROVIDERS[state.provider];

		document.getElementById('pl-leasing-summary').textContent = summaryText(selected);
		document.getElementById('pl-leasing-scheme-label').textContent = provider.schemeLabel;

		document.getElementById('pl-leasing-schemes').innerHTML = getTerms()
			.map(function (term) {
				var active = term.months === state.selectedMonths ? ' is-active' : '';
				return (
					'<button type="button" class="pl-leasing-scheme' +
					active +
					'" data-months="' +
					term.months +
					'">' +
					'<div class="pl-leasing-scheme-months">' +
					term.months +
					' месеца</div>' +
					'<div class="pl-leasing-scheme-monthly">' +
					formatEuro(term.monthly) +
					' / мес.</div>' +
					'<div class="pl-leasing-scheme-total">Общо ' +
					formatEuro(term.total) +
					'</div>' +
					'</button>'
				);
			})
			.join('');

		Array.prototype.slice
			.call(document.querySelectorAll('.pl-leasing-scheme'))
			.forEach(function (button) {
				button.addEventListener('click', function () {
					state.selectedMonths = Number(button.getAttribute('data-months'));
					renderModal();
					renderTeaser();
				});
			});
	}

	function renderTeaser() {
		var holder = document.getElementById('load-leasing');
		if (!holder || !state.price) return;

		var term = getSelectedTerm();
		holder.innerHTML =
			'<a href="#" class="pl-leasing-teaser js-open-leasing">' +
			teaserText(term) +
			'</a>';
	}

	function openModal() {
		state.price = parsePrice();
		state.prodId = getProdId();

		if (!state.price) {
			state.price = 1305.46;
		}

		renderModal();
		var overlay = ensureModal();
		overlay.hidden = false;
		document.body.style.overflow = 'hidden';
	}

	function closeModal() {
		var overlay = document.getElementById('pl-leasing-overlay');
		if (!overlay) return;
		overlay.hidden = true;
		document.body.style.overflow = '';
	}

	function shouldHandleLocally() {
		return (
			document.body.id === 'product_preview' ||
			document.body.id === 'checkout' ||
			document.getElementById('load-leasing') ||
			document.querySelector('[data-url^="leasing"]') ||
			document.querySelector('.js-open-leasing')
		);
	}

	function bindTriggers() {
		document.body.addEventListener(
			'click',
			function (e) {
				var trigger = e.target.closest(
					'[data-url^="leasing"], .js-open-leasing, #load-leasing a'
				);
				if (!trigger) return;

				e.preventDefault();
				e.stopPropagation();
				openModal();
				return false;
			},
			true
		);
	}

	function init() {
		if (!shouldHandleLocally()) return;

		state.price = parsePrice();
		state.prodId = getProdId();
		renderTeaser();
		bindTriggers();

		window.PlasicoLeasing = {
			open: openModal,
			close: closeModal,
			getState: function () {
				return {
					price: state.price,
					prodId: state.prodId,
					provider: state.provider,
					selectedMonths: state.selectedMonths,
					selected: getSelectedTerm(),
				};
			},
		};
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}

	window.addEventListener('load', function () {
		if (!shouldHandleLocally()) return;
		state.price = parsePrice();
		renderTeaser();
	});
})();
