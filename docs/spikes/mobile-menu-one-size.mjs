/**
 * The mobile menu is one size, in the site's own heading face.
 *
 * The owner, 2 Oct 2026: "I don't really like the design of the mobile menu
 * - especially the different font sizes." It read 32px / 24px / 14px —
 * "Browse the collection" as a headline, Resources and Search in the grey,
 * the Location row in the body face — with a change of face and ink at each
 * step. From the options drawn they picked ONE size: "A, 18px, with the
 * same letter spacing as on site" (every heading on the site is the Display
 * face at letter-spacing 0).
 *
 * THE BROWSER (Chromium): the panel's real CSS and its real markup, read out
 * of sections/header.liquid rather than copied, laid out at a phone's 390px
 * with the menu open and the Resources fold opened. Every word in the panel
 * must be set at the one size, in the Display face, at the site's letter
 * spacing; no rule stands between the rows; every row is still a thumb's
 * tap; and the cart stays on the bar while the menu is open.
 *
 *   npm i --no-save playwright && node docs/spikes/mobile-menu-one-size.mjs
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const header = read('sections/header.liquid')

let failures = 0
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg) } }

// The panel's own stylesheet: the <style> block's rules for .st-mmenu*,
// with Liquid stripped first (a `%}` inside a rule otherwise ends it early).
const css = header.replace(/\{%-?[\s\S]*?-?%\}/g, '').replace(/\{\{[\s\S]*?\}\}/g, 'x')
// The toggle's own rules are left out: one of them hides it on a desk, and
// stripped of its @media it would hide it here too.
const rules = Array.from(css.matchAll(/(?:^|\n)\s*((?:\.st-mmenu(?!__toggle)|body\.st-menu-open|\.st-location__label)[^{]*)\{([^}]*)\}/g))
  .map((m) => `${m[1].trim()} {${m[2]}}`)
  // the desk's `.st-mmenu { display: none !important }`, likewise
  .filter((r) => !/display:\s*none\s*!important/.test(r))
  .join('\n')
check(rules.includes('.st-mmenu {'), 'the panel rule was not found in header.liquid')

// The panel's markup, as the section writes it, with the Liquid taken out:
// a `{{ x }}` becomes a word, a render becomes nothing, and every `{% if %}`
// renders as true — which is the panel with Resources, the journal and the
// Location fold all present.
const panelAt = header.indexOf('<div class="st-mmenu"')
const panelEnd = header.indexOf('</st-nav-menus>', panelAt)
check(panelAt > 0 && panelEnd > panelAt, 'the panel markup was not found in header.liquid')
const panel = header.slice(panelAt, panelEnd)
  .replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, '')
  .replace(/\{%-?\s*render[\s\S]*?-?%\}/g, 'United Kingdom')
  .replace(/\{%-?[\s\S]*?-?%\}/g, '')
  .replace(/\{\{[^}]*\|\s*t\s*\}\}/g, 'Word')
  .replace(/\{\{[\s\S]*?\}\}/g, 'Word')

const script = /class StNavMenus[\s\S]*?customElements\.define\('st-nav-menus', StNavMenus\);/.exec(header)[0]

const page = `<!doctype html><html><head><meta charset="utf-8"><style>
:root { --color-foreground: 18, 18, 18; --font-body-family: "Neue Haas Grotesk Text", sans-serif; --font-heading-family: "Neue Haas Grotesk Text", sans-serif; }
body { margin: 0; }
.header { display: flex; justify-content: space-between; align-items: flex-end; padding: 20px 12px; background: #fff; }
.st-header__utility { display: flex; gap: 24px; }
.st-nav-menus { display: contents; }
.header-wrapper { position: relative; }
.st-mmenu { position: absolute; top: 100%; left: 0; right: 0; display: none; }
.st-mmenu.is-open { display: block; }
${rules}
</style></head>
<body class="template-collection">
<div id="shopify-section-header"><div class="header-wrapper">
  <header class="header st-header">
    <a class="st-header__logo" href="#">Stendig Calendars</a>
    <div class="st-header__utility">
      <a href="#" class="st-header__link st-header__cart">Cart (0)</a>
      <button type="button" class="st-header__link st-mmenu__toggle" aria-expanded="false" aria-controls="StMobileMenu-header" data-label="Menu">Menu</button>
    </div>
  </header>
  <st-nav-menus class="st-nav-menus" data-header="shopify-section-header">
    ${panel}
  </st-nav-menus>
</div></div>
<script>${script}</script>
</body></html>`

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
try {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await p.setContent(page)
  await p.click('.st-mmenu__toggle')
  await p.click('.st-mmenu__acc') // Resources, unfolded
  const m = await p.evaluate(() => {
    const panel = document.querySelector('.st-mmenu')
    const seen = []
    // Every element that prints words of its own, the location list aside
    // (a snippet of its own, with its own type).
    for (const el of panel.querySelectorAll('*')) {
      if (el.closest('.st-mmenu__location')) continue
      const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())
      if (!own) continue
      if (!el.getClientRects().length) continue
      const s = getComputedStyle(el)
      seen.push({ text: el.textContent.trim().slice(0, 30), size: s.fontSize, family: s.fontFamily, spacing: s.letterSpacing })
    }
    const rows = Array.from(panel.querySelectorAll('.st-mmenu__collection, .st-mmenu__row, .st-mmenu__locrow'))
      .map((r) => ({ text: r.textContent.trim().slice(0, 30), h: r.getBoundingClientRect().height }))
    return {
      open: panel.classList.contains('is-open'),
      seen,
      rows,
      hrs: panel.querySelectorAll('hr').length,
      cart: getComputedStyle(document.querySelector('.st-header__cart')).display,
    }
  })
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT })
  check(m.open, 'the Menu press did not open the menu')
  check(m.seen.length >= 6, `only ${m.seen.length} words were found in the panel`)
  for (const w of m.seen) {
    check(w.size === '18px', `"${w.text}" is set at ${w.size}, not 18px`)
    check(/^"?Neue Haas Grotesk Display/.test(w.family), `"${w.text}" is not in the Display face: ${w.family}`)
    check(w.spacing === 'normal' || w.spacing === '0px', `"${w.text}" is tracked at ${w.spacing}; the site's headings are at 0`)
  }
  check(m.hrs === 0, `${m.hrs} rule${m.hrs === 1 ? '' : 's'} still stand between the rows`)
  for (const r of m.rows) check(r.h >= 44, `the "${r.text}" row is ${r.h}px tall, under a 44px tap`)
  check(m.cart !== 'none', 'the cart is hidden while the menu is open')
} finally {
  await browser.close()
}

if (failures) { console.log(`${failures} fault${failures === 1 ? '' : 's'}`); process.exit(1) }
console.log('ok — the mobile menu is one size, in the site\'s own heading face, and the cart stays on the bar')
