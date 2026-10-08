/**
 * The mobile menu scrolls inside itself, so a long fold can be reached.
 *
 * The owner, 8 Oct 2026, with the Location fold open on a phone: "You cant
 * scroll down this location list on mobile." The page is locked while the
 * menu is open (body.overflow-hidden) and the panel hung under the bar with
 * no scroll of its own, so a fold taller than what is left of the window —
 * Location's forty-odd countries, and the whole list behind Rest of world —
 * was cut at the window's foot with no way down. Resources holds three
 * links, which is why nothing had shown it before.
 *
 * THE BROWSER (Chromium): the panel's real CSS and real markup, the real
 * StNavMenus class and the list's real StLocationPicker.setLevel, read out of
 * the theme's files, laid out at a phone's 390×780 as the home page (where
 * mw.style.css takes the header out of the flow) and as any other page, with
 * the location list stood in by its own two levels — sixty named countries
 * and Rest of world, then a back row, the search and 180 more.
 *
 *   - Opened with every fold shut, the panel ends with its rows rather than
 *     stretched to the room.
 *   - With Location open, the list runs past the window (or nothing here could
 *     fail) and the panel ends EXACTLY at the window's foot — a ceiling and a
 *     floor, because a cap typed as 100vh less a guessed bar passes a ceiling.
 *   - A wheel over the panel brings the last country into the window, the ✕
 *     stays put; a second wheel from the panel's end does not move the page —
 *     asked again on a page with NO body lock, the browser that ignores it,
 *     which is the only way overscroll-behavior is under test at all.
 *   - Shut and opened again it starts at the top, not mid-country.
 *   - The window shrinking (the browser's bars, a turn of the phone) shrinks
 *     the panel; and the KEYBOARD, which on a phone shrinks the VISUAL viewport
 *     alone with no window resize, shrinks it too. Headless Chromium has no
 *     keyboard, so visualViewport is stood in by one whose height the check
 *     lowers by a keyboard's 336px before firing its own resize — exactly
 *     what an iPhone does and exactly what a window listener cannot hear.
 *   - Menu pressed while the sticky header is still sliding back into view
 *     (base.css's own .animate rule) leaves the panel ending at the window's
 *     foot once the slide is done, not a bar's height past it.
 *   - Rest of world tapped from far down the list leaves "← All locations"
 *     in view rather than behind the bar, at every length of named list from
 *     8 to 30.
 *
 * What it cannot see: innerHeight against 100vh is the same figure in a
 * headless browser, so the phone's own bars are not under test here.
 *
 *   npm i --no-save playwright && node docs/spikes/mobile-menu-scrolls.mjs
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const header = read('sections/header.liquid')
const mw = read('assets/mw.style.css')
const base = read('assets/base.css')
const picker = read('snippets/location-picker.liquid')

let failures = 0
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL', msg) } }
const W = 780
const KEYBOARD = 336

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
// the sticky header's slide, as base.css has it
const slide = ['.shopify-section-header-hidden {', '#shopify-section-header.animate {']
  .map((sel) => { const at = base.indexOf(sel); return at < 0 ? '' : base.slice(at, base.indexOf('}', at) + 1) })
check(slide.every(Boolean), 'the sticky header slide rules were not found in base.css')
// the list's two levels, as the picker shows one at a time
const levels = Array.from(picker.matchAll(/\.st-location__list\[data-level="(?:all|rest)"\][^{]*\{[^}]*\}/g)).map((m) => m[0]).join('\n')
check(levels.split('\n').length === 2, 'the two level rules were not found in location-picker.liquid')
const setLevelSrc = /static setLevel\(list, level\) \{([\s\S]*?)\n    \}/.exec(picker)
check(!!setLevelSrc, 'StLocationPicker.setLevel was not found in location-picker.liquid')

// The list in the fold, in its own two levels and its own class names
const list = (named) => {
  const row = (id, name) => `<li class="st-location__item"><button type="button" class="st-location__country" data-location-pick="${id}">${name}</button></li>`
  const all = Array.from({ length: named }, (_, i) => row(`C${i}`, `Country ${i + 1}`)).join('')
  const rest = Array.from({ length: 180 }, (_, i) => row(`R${i}`, `Rest ${i + 1}`)).join('')
  return `<div class="st-location__list" data-location-list data-level="all">
    <ul class="st-location__countries st-location__level st-location__level--all">${all}
      <li class="st-location__item"><button type="button" class="st-location__country st-location__more" data-location-level="rest" aria-expanded="false">Rest of world</button></li></ul>
    <div class="st-location__level st-location__level--rest">
      <button type="button" class="st-location__country st-location__back" data-location-level="all">← All locations</button>
      <label class="st-location__filter"><input type="search" class="st-location__filter-input" data-location-filter></label>
      <ul class="st-location__countries">${rest}</ul>
    </div></div>`
}

// The panel's markup with the Liquid taken out: comments, the two renders
// (the list stood in as above), every control tag, then the outputs.
const panelAt = header.indexOf('<div class="st-mmenu"')
const panelEnd = header.indexOf('</st-nav-menus>', panelAt)
check(panelAt > 0 && panelEnd > panelAt, 'the panel markup was not found in header.liquid')
const panel = (named) => header.slice(panelAt, panelEnd)
  .replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, '')
  .replace(/\{%-?\s*render\s*'location-list'[\s\S]*?-?%\}/g, list(named))
  .replace(/\{%-?\s*render[\s\S]*?-?%\}/g, 'United Kingdom')
  .replace(/\{%-?[\s\S]*?-?%\}/g, '')
  .replace(/\{\{[\s\S]*?\}\}/g, 'Word')

const script = /class StNavMenus[\s\S]*?customElements\.define\('st-nav-menus', StNavMenus\);/.exec(header)[0]

// A visual viewport the check can shrink the way a keyboard does: it follows
// the window until a keyboard is "raised", and only it fires on that.
const viewport = `
  window.__kb = 0;
  const vv = new EventTarget();
  Object.defineProperties(vv, {
    height: { get: () => window.innerHeight - window.__kb },
    width: { get: () => window.innerWidth },
    offsetTop: { get: () => 0 },
  });
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  window.addEventListener('resize', () => vv.dispatchEvent(new Event('resize')));
`

const page = (home, { lock = true, named = 60 } = {}) => `<!doctype html><html><head><meta charset="utf-8"><style>
:root { --color-foreground: 18, 18, 18; --color-background: 255, 255, 255; --font-body-family: sans-serif; --font-heading-family: sans-serif; }
body { margin: 0; }
${lock ? '.overflow-hidden { overflow: hidden; }' : ''}
.header { display: flex; justify-content: space-between; align-items: flex-end; padding: 20px 12px; background: #fff; }
.st-header__utility { display: flex; gap: 24px; }
.st-nav-menus { display: contents; }
.header-wrapper { position: relative; }
#shopify-section-header { position: sticky; top: 0; z-index: 3; }
.st-location__countries { list-style: none; margin: 0; padding: 0; }
.st-location__country { display: block; width: 100%; height: 45px; text-align: left; background: none; border: none; padding: 0; }
.st-location__filter-input { display: block; width: 100%; height: 45px; box-sizing: border-box; }
.hero { height: 1600px; background: #ddd; }
${rules}
${homeRule ? homeRule[0] : ''}
${slide.join('\n')}
${levels}
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
    ${panel(named)}
  </st-nav-menus>
</div></div>
<div class="hero"></div>
<script>${viewport}</script>
<script>${script}
window.setLevel = function (list, level) {${setLevelSrc ? setLevelSrc[1] : ''}\n};
document.addEventListener('click', (e) => { const b = e.target.closest('[data-location-level]'); if (b) window.setLevel(b.closest('[data-location-list]'), b.dataset.locationLevel); });
</script>
</body></html>`

const panelFoot = (p) => p.evaluate(() => document.querySelector('.st-mmenu').getBoundingClientRect().bottom)
const hit = (p, s) => p.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!e && !!e.closest(s) }, s)
const wheelOver = async (p) => {
  const box = await p.locator('.st-mmenu').boundingBox()
  await p.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height, W - box.y) / 2)
  await p.mouse.wheel(0, 6000)
  await p.waitForTimeout(150)
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
try {
  for (const home of [true, false]) {
    const where = home ? 'the home page' : 'another page'

    // ── opened, scrolled, shut and opened again ──────────────────────────
    let p = await browser.newPage({ viewport: { width: 390, height: W } })
    await p.setContent(page(home))
    await p.click('.st-mmenu__toggle')
    const closed = await p.evaluate(() => {
      const panel = document.querySelector('.st-mmenu')
      // the last DRAWN row: a shut fold has no box at all
      const rowsEnd = Math.max(...Array.from(panel.children).filter((c) => c.getClientRects().length).map((c) => c.getBoundingClientRect().bottom))
      return { open: panel.classList.contains('is-open'), bottom: panel.getBoundingClientRect().bottom, rowsEnd }
    })
    check(closed.open, `on ${where} the Menu press did not open the menu`)
    check(closed.bottom - closed.rowsEnd <= 48 && closed.bottom <= W - 200, `on ${where} the panel with every fold shut runs ${Math.round(closed.bottom - closed.rowsEnd)}px past its last row and reaches ${Math.round(closed.bottom)}px: it is sized to the room rather than capped by it`)

    await p.click('.st-mmenu__locrow')
    const before = await p.evaluate(() => {
      const panel = document.querySelector('.st-mmenu')
      return { lastBottom: panel.querySelector('[data-location-pick="C59"]').getBoundingClientRect().bottom, open: panel.querySelector('.st-mmenu__location').classList.contains('is-open'), panelBottom: panel.getBoundingClientRect().bottom }
    })
    check(before.open, `on ${where} the Location fold did not open`)
    check(before.lastBottom > W, `on ${where} the fixture's list is not longer than the window (${before.lastBottom}px), so nothing here can fail`)
    check(before.panelBottom <= W + 0.5, `on ${where} the open panel reaches ${Math.round(before.panelBottom)}px, past the window's foot at ${W}`)
    check(before.panelBottom >= W - 1, `on ${where} the open panel stops at ${Math.round(before.panelBottom)}px, short of the window's foot at ${W}: the cap was not measured from the bar`)

    await wheelOver(p)
    const after = await p.evaluate(() => {
      const panel = document.querySelector('.st-mmenu')
      return { lastBottom: panel.querySelector('[data-location-pick="C59"]').getBoundingClientRect().bottom, scrollTop: panel.scrollTop }
    })
    check(after.scrollTop > 0, `on ${where} you can't scroll down the location list: the panel stayed at the top and the last country stands ${Math.round(before.lastBottom - W)}px below the window's foot`)
    check(after.lastBottom <= W + 0.5, `on ${where} the last country is still ${Math.round(after.lastBottom - W)}px below the window's foot after scrolling`)
    check(await hit(p, '.st-mmenu__toggle'), `on ${where} the ✕ is not where it was once the list is scrolled`)

    await p.click('.st-mmenu__toggle')
    await p.click('.st-mmenu__toggle')
    const reopened = await p.evaluate(() => document.querySelector('.st-mmenu').scrollTop)
    check(reopened === 0, `on ${where} the menu opens again scrolled ${reopened}px down the countries, with Browse the collection out of sight`)
    check(await hit(p, '.st-mmenu__collection'), `on ${where} Browse the collection cannot be reached on a second open`)

    // ── the browser's bars, or the phone turned ──────────────────────────
    await p.setViewportSize({ width: 390, height: 500 })
    await p.waitForTimeout(100)
    const shrunk = await panelFoot(p)
    check(shrunk <= 500 + 0.5, `on ${where} a window shrunk to 500 leaves the panel reaching ${Math.round(shrunk)}px`)
    check(shrunk >= 500 - 1, `on ${where} a window shrunk to 500 leaves the panel stopping at ${Math.round(shrunk)}px: the cap was not measured from the bar`)
    await p.setViewportSize({ width: 390, height: W })
    await p.waitForTimeout(100)

    // ── the keyboard: the visual viewport shrinks, the window does not ──
    await p.evaluate((kb) => { window.__kb = kb; window.visualViewport.dispatchEvent(new Event('resize')) }, KEYBOARD)
    await p.waitForTimeout(50)
    const typed = await panelFoot(p)
    check(typed <= W - KEYBOARD + 0.5, `on ${where} with the keyboard up the panel still reaches ${Math.round(typed)}px, so its last ${Math.round(typed - (W - KEYBOARD))}px of countries are behind the keyboard and cannot be scrolled up`)
    check(typed >= W - KEYBOARD - 1, `on ${where} with the keyboard up the panel stops at ${Math.round(typed)}px, short of the keyboard's top at ${W - KEYBOARD}`)
    await p.evaluate(() => { window.__kb = 0; window.visualViewport.dispatchEvent(new Event('resize')) })
    await p.waitForTimeout(50)
    check(await panelFoot(p) >= W - 1, `on ${where} the panel does not grow back to the window's foot when the keyboard goes`)

    // ── Menu pressed while the header is still sliding back in ──────────
    await p.click('.st-mmenu__toggle') // shut, Location still unfolded
    await p.evaluate(() => {
      const s = document.getElementById('shopify-section-header')
      s.classList.add('shopify-section-header-hidden')
      s.getBoundingClientRect()
      // StickyHeader.reveal(), then a press in the same moment
      s.classList.add('animate')
      s.classList.remove('shopify-section-header-hidden')
      document.querySelector('.st-mmenu__toggle').click()
    })
    await p.waitForTimeout(400)
    const slid = await panelFoot(p)
    check(slid <= W + 0.5, `on ${where} Menu pressed while the header slid back in leaves the panel reaching ${Math.round(slid)}px, past the window's foot at ${W}`)
    check(slid >= W - 1, `on ${where} Menu pressed while the header slid back in leaves the panel stopping at ${Math.round(slid)}px`)
    await p.close()

    // ── a browser that ignores the body lock ─────────────────────────────
    p = await browser.newPage({ viewport: { width: 390, height: W } })
    await p.setContent(page(home, { lock: false }))
    await p.click('.st-mmenu__toggle')
    await p.click('.st-mmenu__locrow')
    await wheelOver(p)
    await wheelOver(p) // a second gesture, starting from the panel's end
    const pageY = await p.evaluate(() => window.scrollY)
    check(pageY === 0, `on ${where} a scroll that reaches the end of the list carries on into the page: it moved ${pageY}px under the menu`)
    check(await hit(p, '.st-mmenu__toggle'), `on ${where} the ✕ has moved once the scroll reached the end of the list`)
    await p.close()

    // ── Rest of world, tapped from far down the first level ──────────────
    const hidden = []
    for (let named = 8; named <= 30; named++) {
      p = await browser.newPage({ viewport: { width: 390, height: W } })
      await p.setContent(page(home, { named }))
      await p.click('.st-mmenu__toggle')
      await p.click('.st-mmenu__locrow')
      const back = await p.evaluate(() => {
        const panel = document.querySelector('.st-mmenu')
        panel.scrollTop = panel.scrollHeight
        document.querySelector('.st-location__more').click()
        return { back: document.querySelector('.st-location__back').getBoundingClientRect().top, top: panel.getBoundingClientRect().top }
      })
      if (back.back < back.top - 0.5) hidden.push(`${named} (${Math.round(back.top - back.back)}px behind the bar)`)
      await p.close()
    }
    check(hidden.length === 0, `on ${where} Rest of world tapped from the foot of the list leaves "← All locations" behind the bar with ${hidden.join(', ')} named countries`)
  }
} finally {
  await browser.close()
}

if (failures) { console.log(`${failures} fault${failures === 1 ? '' : 's'}`); process.exit(1) }
console.log('ok — the mobile menu scrolls inside itself: the whole list can be reached and ends at the keyboard when it is up, the page never moves, the ✕ stays put, a second open starts at the top, and "← All locations" is never behind the bar')
