/**
 * Plasico slim — client-side shopping cart (localStorage).
 * Does not call ajax.php / server cart APIs. Leaves leasing modal alone.
 */
(function (window, document) {
	'use strict';

	var STORAGE_KEY = 'plasico_slim_cart';
	var CART_URL = 'poruchka.html';

	function readCart() {
		try {
			var raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return [];
			var data = JSON.parse(raw);
			return Array.isArray(data) ? data : [];
		} catch (e) {
			return [];
		}
	}

	function writeCart(items) {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
		updateBadge();
		try {
			window.dispatchEvent(new CustomEvent('plasico-cart-changed', { detail: { items: items } }));
		} catch (e) { /* IE */ }
	}

	function countItems(items) {
		items = items || readCart();
		return items.reduce(function (sum, p) {
			return sum + (parseInt(p.qty, 10) || 0);
		}, 0);
	}

	function money(n) {
		return (Number(n) || 0).toFixed(2).replace('.', ',') + ' €';
	}

	function parsePriceText(text) {
		if (!text) return 0;
		var cleaned = String(text)
			.replace(/\u00a0/g, ' ')
			.replace(/\s+/g, '')
			.replace(',', '.')
			.replace(/[^\d.]/g, '');
		var n = parseFloat(cleaned);
		return isNaN(n) ? 0 : n;
	}

	function priceFromContainer(root) {
		if (!root) return 0;
		var promo = root.querySelector('.promocode_price .codeprice, .promocode_price .price');
		if (promo) return parsePriceText(promo.textContent);
		var price = root.querySelector('.price');
		return price ? parsePriceText(price.textContent) : 0;
	}

	function absUrl(src) {
		if (!src) return '';
		try {
			return new URL(src, window.location.href).href;
		} catch (e) {
			return src;
		}
	}

	function localThumb(src) {
		if (!src) return '';
		src = String(src);
		// HTTrack wrapper: ../external.html?link=https://static.plasico.bg/...
		var wrapped = /external\.html\?link=https?:\/\/static\.plasico\.bg\/([^&\s"']+)/i.exec(src);
		if (wrapped) {
			try {
				return '../static.plasico.bg/' + decodeURIComponent(wrapped[1]);
			} catch (e) {
				return '../static.plasico.bg/' + wrapped[1];
			}
		}
		var m = src.match(/static\.plasico\.bg\/[^\s"'?]+/i);
		if (m) return '../' + m[0].replace(/\\/g, '/');
		if (src.indexOf('../static.plasico.bg/') === 0) return src;
		if (src.indexOf('static.plasico.bg/') === 0) return '../' + src;
		return src;
	}

	function basenamePath() {
		var path = window.location.pathname || '';
		var parts = path.split('/');
		return parts[parts.length - 1] || 'index.html';
	}

	function scrapeFromProductBox(form) {
		var box = form.closest ? form.closest('.product-box') : null;
		if (!box) {
			var p = form.parentNode;
			while (p && p !== document && !(p.classList && p.classList.contains('product-box'))) p = p.parentNode;
			box = p && p.classList && p.classList.contains('product-box') ? p : null;
		}
		if (!box) return null;

		var idInput = form.querySelector('input[name="prod_id"]');
		var qtyInput = form.querySelector('input[name="quantity"]');
		var link = box.querySelector('a.mainlink');
		var ttl = box.querySelector('.ttl');
		var img = box.querySelector('.cimg img');
		var id = idInput ? String(idInput.value) : (box.getAttribute('data-id') || '');
		if (!id) return null;

		return {
			id: id,
			title: (ttl && (ttl.getAttribute('title') || ttl.textContent) || (link && link.getAttribute('title')) || id).trim(),
			cat: '',
			href: link ? link.getAttribute('href') : '',
			img: localThumb(img ? (img.getAttribute('src') || img.getAttribute('data-original') || '') : ''),
			price: priceFromContainer(box.querySelector('.prices') || box),
			qty: Math.max(1, parseInt(qtyInput && qtyInput.value, 10) || 1)
		};
	}

	function scrapeFromProductPage(form) {
		var idInput = form.querySelector('input[name="prod_id"]');
		var qtyInput = form.querySelector('input[name="quantity"]');
		var id = idInput ? String(idInput.value) : '';
		if (!id) return null;

		var h1 = document.querySelector('.details h1, #full-details h1, h1');
		var priceRoot = document.querySelector('#full-details .prod-price, .price-buy .prod-price, .prod-price');
		var img =
			document.querySelector('#full-gallery img[src*="static.plasico.bg/thumbs"]') ||
			document.querySelector('#full-gallery figure.cimg.big img') ||
			document.querySelector('#full-gallery .cimg img') ||
			document.querySelector('.gallery .cimg img');
		var cat = '';
		var pathLinks = document.querySelectorAll('#path a');
		if (pathLinks.length >= 2) {
			cat = (pathLinks[pathLinks.length - 1].textContent || '').trim();
		}

		var imgSrc = '';
		if (img) {
			imgSrc = img.getAttribute('src') || img.getAttribute('data-original') || '';
		}
		if (!imgSrc || imgSrc.indexOf('transp.png') !== -1) {
			var og = document.querySelector('meta[property="og:image"]');
			if (og) imgSrc = og.getAttribute('content') || imgSrc;
		}
		var localBig = document.querySelector('#full-gallery [data-big*="static.plasico.bg/thumbs"]');
		if (localBig && (!imgSrc || imgSrc.indexOf('external.html') !== -1)) {
			imgSrc = localBig.getAttribute('data-big') || imgSrc;
		}

		return {
			id: id,
			title: (h1 ? h1.textContent : id).trim(),
			cat: cat,
			href: basenamePath(),
			img: localThumb(imgSrc),
			price: priceFromContainer(priceRoot || document.querySelector('.prices')),
			qty: Math.max(1, parseInt(qtyInput && qtyInput.value, 10) || 1)
		};
	}

	function itemFromForm(form) {
		if (!form) return null;
		if (form.id === 'quick' || form.querySelector('input[name="finish"]')) return null;
		return scrapeFromProductBox(form) || scrapeFromProductPage(form);
	}

	function addItem(item) {
		if (!item || !item.id) return readCart();
		var items = readCart();
		var found = null;
		for (var i = 0; i < items.length; i++) {
			if (String(items[i].id) === String(item.id)) {
				found = items[i];
				break;
			}
		}
		if (found) {
			found.qty = (parseInt(found.qty, 10) || 0) + (parseInt(item.qty, 10) || 1);
			if (item.price) found.price = item.price;
			if (item.img && !found.img) found.img = item.img;
			if (item.title) found.title = item.title;
			if (item.href) found.href = item.href;
			if (item.cat) found.cat = item.cat;
		} else {
			items.push({
				id: String(item.id),
				title: item.title || item.id,
				cat: item.cat || '',
				href: item.href || '',
				img: item.img || '',
				price: Number(item.price) || 0,
				qty: Math.max(1, parseInt(item.qty, 10) || 1)
			});
		}
		writeCart(items);
		return items;
	}

	function setQty(id, qty) {
		var items = readCart();
		qty = Math.max(1, parseInt(qty, 10) || 1);
		for (var i = 0; i < items.length; i++) {
			if (String(items[i].id) === String(id)) {
				items[i].qty = qty;
				writeCart(items);
				return items;
			}
		}
		return items;
	}

	function removeItem(id) {
		var items = readCart().filter(function (p) {
			return String(p.id) !== String(id);
		});
		writeCart(items);
		return items;
	}

	function updateBadge() {
		var n = countItems();
		var dots = document.querySelectorAll('#cart .dot, #cart-dot');
		for (var i = 0; i < dots.length; i++) {
			dots[i].textContent = String(n);
			if (n > 0) dots[i].classList.remove('hide');
		}
	}

	function flyToCart(img) {
		if (!img || !window.jQuery) return;
		var $ = window.jQuery;
		var $cart = $('#cart');
		if (!$cart.length) return;
		try {
			var $anim = $(img).clone();
			$anim
				.addClass('abs')
				.css({
					zIndex: 9999,
					left: $(img).offset().left,
					top: $(img).offset().top,
					width: $(img).width(),
					height: $(img).height()
				})
				.appendTo('body')
				.animate(
					{
						top: $cart.offset().top,
						left: $cart.offset().left,
						width: '56px',
						height: '39px',
						opacity: 0
					},
					500,
					function () {
						$(this).remove();
					}
				);
		} catch (e) { /* ignore */ }
	}

	function notifyAdded() {
		if (typeof window.notif === 'function') {
			try {
				window.notif('Продуктът беше добавен в количката Ви!', 3);
				return;
			} catch (e) { /* fall through */ }
		}
	}

	function goToCart() {
		var cart = document.getElementById('cart');
		var url = (cart && cart.getAttribute('data-url')) || CART_URL;
		window.location.href = url;
	}

	function handleBuySubmit(form, opts) {
		opts = opts || {};
		var item = itemFromForm(form);
		if (!item) return false;
		addItem(item);

		var box = form.closest ? form.closest('.product-box') : null;
		var img = box ? box.querySelector('.cimg img') : null;
		if (img) flyToCart(img);

		notifyAdded();

		var isCard = form.classList.contains('buy-form');
		var mobile = window.layout && window.layout !== 'desktop';
		if (opts.navigate || (!isCard) || mobile) {
			goToCart();
		}
		return true;
	}

	function bindDom() {
		updateBadge();

		document.addEventListener(
			'submit',
			function (e) {
				var form = e.target;
				if (!form || form.tagName !== 'FORM') return;
				var isBuyForm = form.classList.contains('buy-form');
				var isBuy = form.classList.contains('buy') && form.id !== 'quick';
				if (!isBuyForm && !isBuy) return;
				if (form.id === 'quick' || form.querySelector('input[name="finish"]')) return;

				e.preventDefault();
				e.stopPropagation();
				if (e.stopImmediatePropagation) e.stopImmediatePropagation();

				handleBuySubmit(form, { navigate: !isBuyForm });
			},
			true
		);

		document.addEventListener(
			'click',
			function (e) {
				var cart = e.target && e.target.closest ? e.target.closest('#cart') : null;
				if (!cart) {
					var t = e.target;
					while (t && t !== document) {
						if (t.id === 'cart') {
							cart = t;
							break;
						}
						t = t.parentNode;
					}
				}
				if (!cart) return;
				e.preventDefault();
				e.stopPropagation();
				if (e.stopImmediatePropagation) e.stopImmediatePropagation();
				goToCart();
			},
			true
		);

		// Neutralize original ajax cart reload (no ajax.php in slim)
		if (window.jQuery) {
			try {
				window.jQuery(document).ready(function ($) {
					$('#cart').off('reload');
					$('body').off('reload', '#cart');
					$('#cart').on('reload', function () {
						updateBadge();
					});
				});
			} catch (e) { /* ignore */ }
		}
	}

	window.PlasicoCart = {
		STORAGE_KEY: STORAGE_KEY,
		CART_URL: CART_URL,
		getItems: readCart,
		setItems: writeCart,
		addItem: addItem,
		setQty: setQty,
		removeItem: removeItem,
		count: countItems,
		money: money,
		updateBadge: updateBadge,
		parsePriceText: parsePriceText
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', bindDom);
	} else {
		bindDom();
	}
})(window, document);
