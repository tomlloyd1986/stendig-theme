/**
 * The location picker: "Location: United Kingdom" in the bar, a drawer that
 * names the country and its currency and lists every country the store
 * sells to, and the same list folded into the foot of the mobile menu.
 *
 * Two halves, because two different things can go wrong.
 *
 * THE LIQUID (liquidjs, not Shopify's — this proves the branching and the
 * markup, not Shopify's objects): the heading carries the country and its
 * currency; the language row appears only where a market can be read in
 * more than one language, with the current one marked; every country is a
 * button carrying its code, and exactly one carries aria-current; the two
 * renders of the list (drawer, menu) get distinct ids; and the bar's
 * trigger and the menu's row both say the same words. The list is asserted
 * at the store's real size — 215 countries — because that is the number
 * the design was not drawn for and the filter exists because of.
 *
 * THE BROWSER (Chromium, the rendered fragments plus the theme's own CSS):
 * the trigger opens the drawer and the drawer is the cart drawer's 480px;
 * a country row is a finger's target; typing narrows the list and clearing
 * restores it; Escape closes and hands focus back to the trigger; and on a
 * phone the menu's SECOND fold opens — the accordion used to bind only the
 * first, so Location beneath Resources would have opened nothing.
 *
 *   npm i --no-save liquidjs playwright jsdom && node docs/spikes/location-picker.mjs
 */
import { readFileSync } from 'node:fs'
import { Liquid } from 'liquidjs'
import { chromium } from 'playwright'

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const failures = []
const check = (ok, msg) => { if (!ok) failures.push(msg) }

// ---------- the store's countries, at the store's size ----------
const NAMED = ['Australia','Austria','Belgium','Canada','Denmark','Finland','France','Germany','Hong Kong SAR','Ireland','Italy','Japan','Netherlands','New Zealand','Singapore','South Korea','Spain','Sweden','Switzerland','Taiwan','United Kingdom','United States']
const ISO = { 'United Kingdom': 'GB', 'United States': 'US', Switzerland: 'CH', Sweden: 'SE', Ireland: 'IE' }
const countries = []
for (const n of NAMED) countries.push({ name: n, iso_code: ISO[n] || n.slice(0, 2).toUpperCase(), currency: { iso_code: 'XXX' } })
for (let i = countries.length; i < 215; i++) countries.push({ name: `Country ${String(i).padStart(3, '0')}`, iso_code: `Z${i}`, currency: { iso_code: 'XXX' } })
countries.sort((a, b) => a.name.localeCompare(b.name))
const UK = { name: 'United Kingdom', iso_code: 'GB', currency: { iso_code: 'GBP' } }
const CH = { name: 'Switzerland', iso_code: 'CH', currency: { iso_code: 'CHF' } }
const EN = { iso_code: 'en', endonym_name: 'English' }
const CH_LANGS = [{ iso_code: 'de', endonym_name: 'Deutsch' }, EN, { iso_code: 'fr', endonym_name: 'Français' }, { iso_code: 'it', endonym_name: 'Italiano' }]

// ---------- a Liquid that knows the theme's tags ----------
// Shopify's `localization` and `settings` are globals every snippet can
// read, `render` included. liquidjs's render is scope-isolated, so the
// engine is made per store state with those as globals — the harness's
// concession, not the theme's.
const mk = (localization, settings = { enable_location_picker: true }) => {
  const engine = new Liquid({ root: [new URL('../../snippets/', import.meta.url).pathname], extname: '.liquid', strictFilters: false, globals: { localization, settings, section: { id: 'header' } } })
  tune(engine)
  return engine
}
const tune = (engine) => {
const STRINGS = { 'localization.location': 'Location', 'localization.change_location': 'Change location', 'localization.find_country': 'Find your country', 'localization.no_match': 'No country matches that', 'localization.language_label': 'Language', 'accessibility.close': 'Close', 'general.search.search': 'Search' }
engine.registerFilter('t', (k) => STRINGS[k] ?? k)
engine.registerTag('form', {
  parse(token, remainTokens) {
    this.args = token.args
    this.tpls = []
    const stream = this.liquid.parser.parseStream(remainTokens)
      .on('tag:endform', () => stream.stop())
      .on('template', (t) => this.tpls.push(t))
      .on('end', () => { throw new Error('form not closed') })
    stream.start()
  },
  * render(ctx, emitter) {
    const id = /id:\s*'([^']+)'/.exec(this.args)?.[1] ?? ''
    emitter.write(`<form method="post" action="/localization" id="${id}" accept-charset="UTF-8"><input type="hidden" name="form_type" value="localization"><input type="hidden" name="_method" value="put">`)
    yield this.liquid.renderer.renderTemplates(this.tpls, ctx, emitter)
    emitter.write('</form>')
  },
})
engine.registerTag('comment', {
  parse(token, remainTokens) {
    const stream = this.liquid.parser.parseStream(remainTokens).on('tag:endcomment', () => stream.stop()).on('template', () => {}).on('end', () => { throw new Error('comment not closed') })
    stream.start()
  },
  render() {},
})
}
const render = (file, localization) => mk(localization).renderFile(file, {})

// The header's two fragments, lifted from the section rather than retyped.
const header = read('sections/header.liquid')
const between = (a, b) => { const i = header.indexOf(a); const j = header.indexOf(b, i); if (i < 0 || j < 0) throw new Error(`fragment not found: ${a}`); return header.slice(i, j) }
const triggerSrc = between("{%- if settings.enable_location_picker and localization.available_countries.size > 1 -%}\n        <button", '{%- comment -%}\n        Resources dropdown trigger')
const rowSrc = between("{%- if settings.enable_location_picker and localization.available_countries.size > 1 -%}\n        <hr", '    </div>\n  </st-nav-menus>')
const menuCss = /<style>([\s\S]*?)<\/style>/.exec(header)[1].replace(/\{\{[^}]*\}\}/g, 'shopify-section-header').replace(/\{%[^%]*%\}/g, '')

const ukLoc = { country: UK, language: EN, available_languages: [EN], available_countries: countries }
const chLoc = { country: CH, language: CH_LANGS[0], available_languages: CH_LANGS, available_countries: countries }

const [drawerUK, drawerCH, triggerUK, rowUK, rowCH] = await Promise.all([
  render('location-picker', ukLoc), render('location-picker', chLoc),
  mk(ukLoc).parseAndRender(triggerSrc, {}),
  mk(ukLoc).parseAndRender(rowSrc, {}),
  mk(chLoc).parseAndRender(rowSrc, {}),
])

// ---------- Liquid assertions ----------
check(drawerUK.includes('United Kingdom (GBP)'), 'the drawer does not name the country and its currency')
// Markup, not the string: the drawer's own stylesheet names the class too,
// and the first draft of this check failed a correct render on that.
check(!drawerUK.includes('class="st-location__languages'), 'a one-language market grew a language row')
check(drawerCH.includes('Switzerland (CHF)'), 'the Swiss drawer does not read Switzerland (CHF)')
const chLangs = (drawerCH.match(/data-location-pick-language="/g) || []).length
check(chLangs === 4, `Switzerland offers ${chLangs} languages, not 4`)
check(/class="st-location__language is-current"[^>]*lang="de"[^>]*aria-current="true"[^>]*>Deutsch</.test(drawerCH), 'the current language is not the one marked')
const picks = (drawerUK.match(/data-location-pick="/g) || []).length
check(picks === 215, `the drawer lists ${picks} countries, not the store's 215`)
check((drawerUK.match(/aria-current="true"/g) || []).length === 1, 'exactly one country should be current')
check(/is-current"[^>]*data-location-pick="GB"/.test(drawerUK), 'the current country is not the United Kingdom')
check(drawerUK.includes('id="StLocationFilter-drawer"') && rowUK.includes('id="StLocationFilter-menu"'), 'the two lists share an id')
check(drawerUK.includes('name="country_code" value="GB"') && drawerUK.includes('name="language_code" value="en"'), 'the form does not carry the current country and language')
check(/<span class="st-location__label">Location:<\/span> United Kingdom</.test(triggerUK), 'the bar trigger does not read "Location: United Kingdom"')
check(/<span class="st-location__label">Location:<\/span> United Kingdom</.test(rowUK), 'the menu row does not read the same words as the bar')
check(rowUK.includes('aria-controls="StMobileLocation-header"') && rowUK.includes('id="StMobileLocation-header"'), "the menu row's fold is not wired to its panel")
check(!rowUK.includes('class="st-location__languages') && rowCH.includes('st-location__languages--menu'), 'the menu shows a language row where it should not, or hides it where it should')
const off = await mk(ukLoc, { enable_location_picker: false }).parseAndRender(triggerSrc, {})
check(!off.includes('st-location__toggle'), 'the theme setting does not switch the trigger off')
const one = await mk({ ...ukLoc, available_countries: [UK] }).parseAndRender(triggerSrc, {})
check(!one.includes('st-location__toggle'), 'a store selling to one country still shows a picker')

// ---------- the browser ----------
// The theme's base colours (--color-base-text and kin) are set in
// layout/theme.liquid; base.css derives --color-foreground FROM them. Without
// the base value every rgba(var(--color-foreground), .55) is invalid and the
// muted label renders full black — which a first screenshot showed, and
// which setting --color-foreground directly did not fix, because base.css
// then overwrote it with the undefined base.
const page_html = (width) => `<!doctype html><html><head><meta charset="utf-8"><style>html{font-size:62.5%}:root{--color-base-text:18,18,18;--color-base-background-1:255,255,255}${read('assets/base.css').replace(/@font-face[\s\S]*?\}/g, '')}${menuCss}</style></head><body>
<div class="header-wrapper"><header class="header page-width st-header">
  <div class="st-header__utility">${triggerUK}<a class="st-header__link" href="#">Cart (0)</a>
    <button type="button" class="st-header__link st-mmenu__toggle" aria-expanded="false" aria-controls="StMobileMenu-header" data-label="Menu"><span class="st-mmenu__toggle-open">Menu</span></button></div>
</header>
<st-nav-menus class="st-nav-menus" data-header="x">
  <div class="st-mmenu" id="StMobileMenu-header">
    <button type="button" class="st-mmenu__row st-mmenu__acc" aria-expanded="false" aria-controls="StMobileResources-header"><span>Resources</span><span class="st-mmenu__glyph" data-glyph>+</span></button>
    <div class="st-mmenu__sub" id="StMobileResources-header"><a class="st-mmenu__sublink" href="#">Journal</a></div>
    <button type="button" class="st-mmenu__row st-mmenu__searchrow">Search</button>
    ${rowUK}
  </div>
</st-nav-menus></div>
<svg class="hidden"><symbol id="icon-close" viewBox="0 0 18 17"><path d="M1 1l16 15M17 1L1 16" stroke="currentColor"/></symbol></svg>
${drawerUK}
<script>${/class StNavMenus[\s\S]*?customElements\.define\('st-nav-menus', StNavMenus\);/.exec(header)[0]}</script>
</body></html>`

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await desktop.setContent(page_html(1440))
  await desktop.evaluate(() => { document.querySelector('form').submit = () => { window.__submitted = new FormData(document.querySelector('form')).get('country_code') } })
  const trigger = desktop.locator('.st-location__toggle')
  check(await trigger.isVisible(), 'the trigger is not visible on desktop')
  check((await trigger.innerText()).replace(/\s+/g, ' ').trim() === 'Location: United Kingdom', `the trigger reads "${await trigger.innerText()}"`)
  const inks = await trigger.evaluate((el) => [getComputedStyle(el.querySelector('.st-location__label')).color, getComputedStyle(el).color])
  check(inks[0] === 'rgba(18, 18, 18, 0.55)' && inks[1] === 'rgb(18, 18, 18)', `the label is ${inks[0]} against a country in ${inks[1]} — the label should be the muted one`)
  await trigger.click()
  await desktop.waitForTimeout(500)
  // The cart drawer's box: 48rem of content plus its hairline (the theme
  // sets no global border-box), flush to the right edge. Measured as the
  // content width because that is what the shared rule states.
  const box = await desktop.locator('.st-location__drawer').evaluate((el) => ({ content: el.clientWidth, right: el.getBoundingClientRect().right }))
  check(box.content === 480 && Math.round(box.right) === 1440, `the drawer is ${box.content}px of content ending at x=${box.right}, not the cart drawer's 480 on the right edge`)
  check(await desktop.locator('.st-location__drawer').getAttribute('aria-hidden') === 'false', 'the open drawer is still aria-hidden')
  check(await trigger.getAttribute('aria-expanded') === 'true', 'the trigger does not say it is expanded')
  check(await desktop.evaluate(() => document.activeElement.classList.contains('st-location__close')), 'focus did not land on Close')
  const head = await desktop.locator('.st-location__current').first().evaluate((el) => ({ size: getComputedStyle(el).fontSize, text: el.textContent }))
  check(head.size === '40px', `the heading is ${head.size}, not the theme's 40px h0`)
  const rowBox = await desktop.locator('.st-location__drawer [data-location-pick="GB"]').boundingBox()
  check(rowBox.height >= 44, `a country row is ${rowBox.height}px tall — under a finger's 44`)
  // typing narrows, clearing restores
  const filter = desktop.locator('#StLocationFilter-drawer')
  await filter.fill('sw')
  const shown = await desktop.locator('.st-location__drawer [data-location-item]:not([hidden])').allInnerTexts()
  check(shown.length === 2 && shown.includes('Sweden') && shown.includes('Switzerland'), `"sw" shows ${JSON.stringify(shown)}`)
  await filter.fill('s')
  const ess = await desktop.locator('.st-location__drawer [data-location-item]:not([hidden])').allInnerTexts()
  check(ess.includes('Sweden') && ess.includes('Spain') && !ess.includes('Australia') && !ess.includes('Austria'), `one letter matches the start of a word, not anywhere in it: "s" shows ${JSON.stringify(ess)}`)
  await filter.fill('kingdom')
  const kingdom = await desktop.locator('.st-location__drawer [data-location-item]:not([hidden])').allInnerTexts()
  check(kingdom.length === 1 && kingdom[0] === 'United Kingdom', `"kingdom" shows ${JSON.stringify(kingdom)}`)
  await filter.fill('united')
  const united = await desktop.locator('.st-location__drawer [data-location-item]:not([hidden])').allInnerTexts()
  check(united.length === 2, `"united" shows ${JSON.stringify(united)}`)
  await filter.fill('zzzz')
  check(await desktop.locator('.st-location__drawer [data-location-none]').isVisible(), 'no match shows no note')
  await filter.fill('')
  check(await desktop.locator('.st-location__drawer [data-location-item]:not([hidden])').count() === 215, 'clearing the filter did not restore every country')
  // choosing submits the form with that country
  await desktop.locator('.st-location__drawer [data-location-pick="CH"]').click()
  check(await desktop.evaluate(() => window.__submitted) === 'CH', 'choosing a country did not submit it')
  // Escape closes and hands focus back
  await desktop.keyboard.press('Escape')
  await desktop.waitForTimeout(500)
  check(!(await desktop.locator('st-location-picker').evaluate((el) => el.classList.contains('is-open'))), 'Escape did not close the drawer')
  check(await desktop.evaluate(() => document.activeElement.classList.contains('st-location__toggle')), 'focus did not return to the trigger')
  check(await desktop.locator('.st-location__drawer').evaluate((el) => getComputedStyle(el).visibility) === 'hidden', 'the closed drawer is still reachable')

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await phone.setContent(page_html(390))
  check(!(await phone.locator('.st-location__toggle').isVisible()), 'the bar trigger shows on a phone')
  await phone.locator('.st-mmenu__toggle').click()
  const row = phone.locator('.st-mmenu__locrow')
  check(await row.isVisible(), 'the menu has no Location row')
  const rowStyle = await row.evaluate((el) => ({ size: getComputedStyle(el).fontSize, h: el.getBoundingClientRect().height }))
  check(rowStyle.size === '14px', `the menu row is ${rowStyle.size}, not the sub-links' 14px`)
  check(rowStyle.h >= 44, `the menu row is ${rowStyle.h}px tall — under a finger's 44`)
  const order = await phone.evaluate(() => Array.from(document.querySelectorAll('.st-mmenu > *')).map((n) => n.className.split(' ')[0]))
  check(order[order.length - 1] === 'st-mmenu__sub' && order[order.length - 2] === 'st-mmenu__locrow', `Location is not at the foot of the menu: ${order.join(' › ')}`)
  // the SECOND fold opens — and the first still does
  await row.click()
  check(await phone.locator('#StMobileLocation-header').evaluate((el) => el.classList.contains('is-open')), 'the Location fold did not open')
  check((await row.locator('[data-glyph]').innerText()) === '−', 'the glyph did not turn to −')
  await phone.locator('.st-mmenu__acc').first().click()
  check(await phone.locator('#StMobileResources-header').evaluate((el) => el.classList.contains('is-open')), 'Resources stopped opening')
  await phone.locator('#StLocationFilter-menu').fill('ire')
  const ire = await phone.locator('#StMobileLocation-header [data-location-item]:not([hidden])').allInnerTexts()
  check(ire.length === 1 && ire[0] === 'Ireland', `"ire" in the menu shows ${JSON.stringify(ire)}`)
} finally {
  await browser.close()
}

if (failures.length) {
  console.error(`FAIL (${failures.length})`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('PASS: the picker names the country, lists all 215, filters, submits, and folds into the menu')
