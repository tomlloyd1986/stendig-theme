/**
 * The mobile menu scrolls inside itself, so a long fold can be reached.
 *
 * The owner, 8 Oct 2026, with the Location fold open on a phone: "You cant
 * scroll down this location list on mobile." The page is locked while the
 * menu is open (body.overflow-hidden) and the panel hangs under the bar with
 * no scroll of its own, so a fold taller than what is left of the window —
 * Location's forty-odd countries, and the whole list behind Rest of world —
 * was cut at the window's foot with no way down. Resources holds three
 * links, which is why nothing had shown it before.
 *
 * THE BROWSER (Chromium): the panel's real CSS and real markup, and the real
 * StNavMenus class, read out of sections/header.liquid, laid out at a
 * phone's 390×780 as the home page (where mw.style.css takes the header out
 * of the flow) and as any other page, with the location list stood in by
 * sixty rows. With the Location fold open the last row must start below the
 * window's foot (or the check could not fail); a wheel over the panel must
 * then bring it into the window, with the ✕ still where it was; a fold shut
 * again must leave the panel no taller than its rows; and a window that
 * shrinks — the keyboard rising for the country search — must shrink the
 * panel with it.
 *
 *   npm i --no-save playwright && node docs/spikes/mobile-menu-scrolls.mjs
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const header = read('sections/header.liquid')
const mw = read('assets/mw.style.css')

let failures = 0
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg) } }

// The panel's own stylesheet, Liquid stripped first (a `%}` inside a rule
// otherwise ends it early); the toggle's rules and the desk's
// `display: none !important` left out, as mobile-menu-one-size.mjs does.
const css = header.replace(/\{%-?[\s\S]*?-?%\}/g, '').replace(/\{\{[\s\S]*?\}\}/g, 'x')
const rules = Array.from(css.matchAll(/(?:^|\n)\s*((?:\.st-mmenu(?!__toggle)|body\.st-menu-open)[^{]*)\{([^}]*)\}/g))
  .map((m) => `${m[1].trim()} {${m[2]}}`)
  .filter((r) => !/display:\s*none\s*!important/.test(r))
  .join('\n')
check(rules.includes('.st-mmenu {'), 'the panel rule was not found in header.liquid')
const homeRule = /@media only screen and \(max-width: 990px\) \{\s*\.template-index[^\n]*\n\s*(?:\/\*[^\n]*\*\/\s*)?\}/.exec(mw)
check(!!homeRule, 'the home page rule was not found in mw.style.css')

// The panel's markup with the Liquid taken out, the location list stood in
// by sixty rows of the list's own class.
const rows = Array.from({ length: 60 }, (_, i) => `<button type="button" class="st-location__country" data-location-pick="C${i}">Country ${i + 1}</button>`).join('')
const panelAt = header.indexOf('<div class="st-mmenu"')
const panelEnd = header.indexOf('</st-nav-menus>', panelAt)
check(panelAt > 0 && panelEnd > panelAt, 'the panel markup was not found in header.liquid')
const panel = header.slice(panelAt, panelEnd)
  .replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, '')
  .replace(/\{%-?\s*render\s*'location-list'[\s\S]*?-?%\}/g, `<div class="st-location__list">${rows}</div>`)
  .replace(/\{%-?\s*render[\s\S]*?-?%\}/g, 'United Kingdom')
  .replace(/\{\{[\s\S]*?\}\}/g, 'Word')

const script = /class StNavMenus[\s\S]*?customElements\.define\('st-nav-menus', StNavMenus\);/.exec(header)[0]

const page = (home) => `<!doctype html><html><head><meta charset="utf-8"><style>
:root { --color-foreground: 18, 18, 18; --color-background: 255, 255, 255; --font-body-family: sans-serif; --font-heading-family: sans-serif; }
body { margin: 0; }
.overflow-hidden { overflow: hidden; }
.header { display: flex; justify-content: space-between; align-items: flex-end; padding: 20px 12px; background: #fff; }
.st-header__utility { display: flex; gap: 24px; }
.st-nav-menus { display: contents; }
.header-wrapper { position: relative; }
.st-location__country { display: block; width: 100%; height: 40px; text-align: left; background: none; border: none; padding: 0; }
.hero { height: 1600px; background: #ddd; }
${rules}
${homeRule ? homeRule[0] : ''}
</style></head>
<body class="${home ? 'template-index' : 'template-collection'}">
<div id="shopify-section-header"><div class="header-wrapper" data-sticky="true">
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
    const closed = await p.evaluate(() => {
      const panel = document.querySelector('.st-mmenu')
      const r = panel.getBoundingClientRect()
      // the last DRAWN row: a shut fold has no box at all
      const rowsEnd = Math.max(...Array.from(panel.children).filter((c) => c.getClientRects().length).map((c) => c.getBoundingClientRect().bottom))
      return { open: panel.classList.contains('is-open'), bottom: r.bottom, rowsEnd }
    })
    check(closed.open, `on ${where} the Menu press did not open the menu`)
    check(closed.bottom <= window_h(780), `on ${where} the panel reaches ${closed.bottom}px, past the window's 780`)
    // every fold shut: the panel ends with its rows, not stretched to the room
    // (its own inset and edge under the last row, and nothing like the room)
    check(closed.bottom - closed.rowsEnd <= 48 && closed.bottom <= 780 - 200, `on ${where} the panel with every fold shut runs ${Math.round(closed.bottom - closed.rowsEnd)}px past its last row and reaches ${Math.round(closed.bottom)}px: it is sized to the room rather than capped by it`)

    await p.click('.st-mmenu__locrow')
    const before = await p.evaluate(() => {
      const panel = document.querySelector('.st-mmenu')
      const last = panel.querySelector('[data-location-pick="C59"]')
      return { lastBottom: last.getBoundingClientRect().bottom, open: panel.querySelector('.st-mmenu__location').classList.contains('is-open'), scrollTop: panel.scrollTop, panelBottom: panel.getBoundingClientRect().bottom }
    })
    check(before.open, `on ${where} the Location fold did not open`)
    check(before.lastBottom > 780, `on ${where} the fixture's list is not longer than the window (${before.lastBottom}px), so nothing here can fail`)
    check(before.panelBottom <= 780 + 0.5, `on ${where} the open panel reaches ${before.panelBottom}px, past the window's foot at 780`)

    // A wheel over the panel, the way a thumb moves it
    const box = await p.locator('.st-mmenu').boundingBox()
    await p.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height, 780 - box.y) / 2)
    await p.mouse.wheel(0, 4000)
    await p.waitForTimeout(150)
    const after = await p.evaluate(() => {
      const panel = document.querySelector('.st-mmenu')
      const last = panel.querySelector('[data-location-pick="C59"]')
      const hit = (s) => { const b = document.querySelector(s).getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!e && !!e.closest(s) }
      return { lastBottom: last.getBoundingClientRect().bottom, scrollTop: panel.scrollTop, pageY: window.scrollY, toggle: hit('.st-mmenu__toggle') }
    })
    check(after.scrollTop > 0, `on ${where} you can't scroll down the location list: the panel stayed at the top and the last country stands ${Math.round(before.lastBottom - 780)}px below the window's foot`)
    check(after.lastBottom <= 780 + 0.5, `on ${where} the last country is still ${Math.round(after.lastBottom - 780)}px below the window's foot after scrolling`)
    check(after.pageY === 0, `on ${where} the page scrolled ${after.pageY}px under the menu`)
    check(after.toggle, `on ${where} the ✕ is not where it was once the list is scrolled`)

    // The keyboard rises for the country search: the window shrinks and the
    // panel must shrink with it rather than keep the height it opened at.
    await p.setViewportSize({ width: 390, height: 500 })
    await p.waitForTimeout(100)
    const shrunk = await p.evaluate(() => document.querySelector('.st-mmenu').getBoundingClientRect().bottom)
    check(shrunk <= 500 + 0.5, `on ${where} a window shrunk to 500 leaves the panel reaching ${Math.round(shrunk)}px`)
    await p.close()
  }
} finally {
  await browser.close()
}

function window_h(h) { return h + 0.5 }

if (failures) { console.log(`${failures} fault${failures === 1 ? '' : 's'}`); process.exit(1) }
console.log('ok — the mobile menu scrolls inside itself: the whole location list can be reached, the ✕ stays put, and the panel follows the window')
