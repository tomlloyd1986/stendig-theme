/**
 * The mobile menu opens UNDER the header, on the home page too.
 *
 * The owner, 26 Sep 2026: "I don't want the mobile menu to cover the header
 * on mobile like it currently does." It did so on the HOME page only. There,
 * below 990px, assets/mw.style.css takes the header out of the wrapper's
 * flow (position: absolute, so it can sit over the hero), the wrapper
 * collapses to 0px, and the panel's `top: 100%` — 100% of nothing — opened
 * it at the very top of the window: over the logo and over the ✕ that
 * closes it. Every other page was right, which is why it went unnoticed.
 *
 * THE BROWSER (Chromium): the header's real CSS rules and the real
 * StNavMenus class, read out of the theme files rather than copied, laid
 * out at a phone's 390px as the home page and as any other page. Opened,
 * the panel must start at or below the header's own foot, and a tap on the
 * ✕ and on the logo must land on them rather than on the panel over them.
 * Closed again, the ✕ puts it away.
 *
 *   npm i --no-save playwright && node docs/spikes/mobile-menu-under-header.mjs
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const header = read('sections/header.liquid')
// Liquid tags stripped BEFORE a rule is cut out: the wrapper's rule holds a
// `{% if %}`, and the `}` of its `%}` read as the rule's end cut it short.
const headerCss = header.replace(/\{%[\s\S]*?%\}/g, '')
const mw = read('assets/mw.style.css')

let failures = 0
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg) } }

// The rules that decide where the panel stands, taken from the files.
const rule = (src, selector) => {
  const at = src.indexOf(selector + ' {')
  if (at < 0) throw new Error(`no rule for ${selector}`)
  return src.slice(at, src.indexOf('}', at) + 1)
}
const css = [
  rule(headerCss, '.st-nav-menus'),
  rule(headerCss, '.header-wrapper'),
  rule(headerCss, '.st-mmenu'),
  rule(headerCss, '.st-mmenu.is-open'),
  // the home page's own rule, as it stands in mw.style.css
  /@media only screen and \(max-width: 990px\) \{\s*\.template-index[^\n]*\n\s*(?:\/\*[^\n]*\*\/\s*)?\}/.exec(mw)[0],
  '.header { display: flex; justify-content: space-between; align-items: center; padding: 20px 12px; background: #fff; }',
  '.st-mmenu__collection { display: block; height: 300px; font-size: 32px; }',
  'body { margin: 0; } .hero { height: 1200px; background: #ddd; }',
].join('\n')

const script = /class StNavMenus[\s\S]*?customElements\.define\('st-nav-menus', StNavMenus\);/.exec(header)[0]

const page = (home) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head>
<body class="${home ? 'template-index' : 'template-collection'}">
<div id="shopify-section-header"><div class="header-wrapper" data-sticky="true">
  <header class="header st-header">
    <a class="st-header__logo" href="#">Stendig Calendars</a>
    <button type="button" class="st-mmenu__toggle" aria-expanded="false" aria-controls="StMobileMenu-header" data-label="Menu">Menu</button>
  </header>
  <st-nav-menus class="st-nav-menus" data-header="shopify-section-header">
    <div class="st-mmenu" id="StMobileMenu-header"><a class="st-mmenu__collection" href="#">Browse the collection</a></div>
  </st-nav-menus>
</div></div>
<div class="hero"></div>
<script>${script}</script>
</body></html>`

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
try {
  for (const home of [true, false]) {
    const where = home ? 'the home page' : 'another page'
    const p = await browser.newPage({ viewport: { width: 390, height: 780 } })
    await p.setContent(page(home))
    await p.click('.st-mmenu__toggle')
    const m = await p.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect()
      const hit = (s) => { const b = r(s); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!e && !!e.closest(s) }
      return { headerBottom: r('header').bottom, menuTop: r('.st-mmenu').top, open: document.querySelector('.st-mmenu').classList.contains('is-open'), toggle: hit('.st-mmenu__toggle'), logo: hit('.st-header__logo') }
    })
    check(m.open, `on ${where} the Menu press did not open the menu`)
    check(m.menuTop >= m.headerBottom - 0.5, `on ${where} the menu covers the header: it opens at ${m.menuTop}px and the header ends at ${m.headerBottom}px`)
    check(m.toggle, `on ${where} the menu covers the button that closes it`)
    check(m.logo, `on ${where} the menu covers the logo`)
    if (m.toggle) {
      await p.click('.st-mmenu__toggle')
      const shut = await p.evaluate(() => !document.querySelector('.st-mmenu').classList.contains('is-open'))
      check(shut, `on ${where} the close button did not close the menu`)
    }
    await p.close()
  }
} finally {
  await browser.close()
}

if (failures) { console.log(`${failures} fault${failures === 1 ? '' : 's'}`); process.exit(1) }
console.log('ok — the mobile menu opens under the header on the home page and every other')
