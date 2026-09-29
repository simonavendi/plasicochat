# Plasico slim copy

Minimal offline mirror for UI work: homepage + 4 products + cart.

## Open
- `index.html` → redirects to `plasico.bg/index.html`
- Cart: `plasico.bg/poruchka.html`
- Local server (required for live chat proxy):

```bash
python serve-local.py
```

Then open http://127.0.0.1:3000/plasico.bg/index.html

## Included pages
1. Homepage (`plasico.bg/index.html`)
2. Cart (`plasico.bg/poruchka.html`) with leasing modal on cart total
3. Products:
   - Dell P2425HE monitor
   - ViewSonic VX2479A gaming monitor
   - Dell Pro 15 Essential laptop
   - Eaton 5E 700 UPS

## Also included
- Cookie consent local fix
- Installment modal (`local-leasing-modal.js`)
- Intelekta OS live chat (`local-intelekta-chat.js` → `/api/v1/public/chat`, proxied to os.4chairs.bg)

## Size
Much smaller than the full HTTrack copy (~700MB). This slim folder is ~30MB.
