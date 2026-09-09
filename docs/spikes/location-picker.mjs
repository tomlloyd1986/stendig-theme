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
 * at the store's real size — 215 countries — in its two levels: the named
 * ones and "Rest of world" first, the other 193 behind it with the filter,
 * and a visitor from a rest-of-world country told so on that row.
 *
 * THE BROWSER (Chromium, the rendered fragments plus the theme's own CSS):
 * the trigger opens the drawer and the drawer is the cart drawer's 480px;
 * a country row is a finger's target; typing narrows the list and clearing
 * restores it; Escape closes and hands focus back to the trigger; and on a
 * phone the menu's SECOND fold opens — the accordion used to bind only the
 * first, so Location beneath Resources would have opened nothing.
 *
 * AND THE VISITOR'S OWN COUNTRY. On a store that serves many countries
 * Shopify renders the market's primary one — Ireland for everyone on the
 * European store — until the visitor says otherwise. The picker asks
 * Shopify's suggestion endpoint (stubbed here) and adopts the answer only
 * when it is on the SAME store: Portugal on the European store becomes
 * Portugal everywhere the country is printed, with one post and no reload,
 * and is remembered; the United States on the European store is left alone,
 * and not asked about twice in a session; India on the International store
 * lands on the Rest of world row, which says so.
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
// The named ones are what the setting lists (the eleven markets plus Mexico,
// Norway and Switzerland, here a representative 22); the rest of the world
// is a few real names the filter can be asked for, and fillers to 215.
const NAMED = { AU: 'Australia', AT: 'Austria', BE: 'Belgium', CA: 'Canada', DK: 'Denmark', FI: 'Finland', FR: 'France', DE: 'Germany', HK: 'Hong Kong SAR', IE: 'Ireland', IT: 'Italy', JP: 'Japan', NL: 'Netherlands', NZ: 'New Zealand', SG: 'Singapore', KR: 'South Korea', ES: 'Spain', PT: 'Portugal', SE: 'Sweden', CH: 'Switzerland', TW: 'Taiwan', GB: 'United Kingdom', US: 'United States' }
const N = Object.keys(NAMED).length
const REST = { IN: 'India', ID: 'Indonesia', IS: 'Iceland', IL: 'Israel', ZA: 'South Africa', SA: 'Saudi Arabia', BR: 'Brazil' }
const NAMED_SETTING = Object.keys(NAMED).join(', ')
const countries = []
// Each country belongs to a market: the EU members to one, the rest of the
// named ones to a market of their own, and the rest of the world to the
// International market — the shape Shopify's country.market gives.
const EU = ['AT', 'BE', 'DK', 'FI', 'FR', 'DE', 'IE', 'IT', 'NL', 'PT', 'ES', 'SE']
const marketOf = (iso) => (EU.includes(iso) ? 'eu' : NAMED[iso] ? iso.toLowerCase() : 'international')
for (const [iso, name] of Object.entries(NAMED)) countries.push({ name, iso_code: iso, currency: { iso_code: 'XXX' }, market: { handle: marketOf(iso) } })
for (const [iso, name] of Object.entries(REST)) countries.push({ name, iso_code: iso, currency: { iso_code: 'XXX' }, market: { handle: 'international' } })
for (let i = countries.length; i < 215; i++) countries.push({ name: `Country ${String(i).padStart(3, '0')}`, iso_code: `Z${i}`, currency: { iso_code: 'XXX' }, market: { handle: 'international' } })
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
const mk = (localization, settings = { enable_location_picker: true, location_named_countries: NAMED_SETTING }) => {
  const engine = new Liquid({ root: [new URL('../../snippets/', import.meta.url).pathname], extname: '.liquid', strictFilters: false, globals: { localization, settings, section: { id: 'header' } } })
  tune(engine)
  return engine
}
const tune = (engine) => {
const STRINGS = { 'localization.location': 'Location', 'localization.change_location': 'Change location', 'localization.find_country': 'Find your country', 'localization.no_match': 'No country matches that', 'localization.language_label': 'Language', 'accessibility.close': 'Close', 'general.search.search': 'Search', 'localization.rest_of_world': 'Rest of world', 'localization.all_locations': 'All locations' }
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

const ukLoc = { country: UK, language: EN, available_languages: [EN], available_countries: countries, market: { handle: 'gb' } }
const IE = { name: 'Ireland', iso_code: 'IE', currency: { iso_code: 'EUR' } }
const euLoc = { country: IE, language: EN, available_languages: [EN], available_countries: countries, market: { handle: 'eu' } }
const chLoc = { country: CH, language: CH_LANGS[0], available_languages: CH_LANGS, available_countries: countries, market: { handle: 'ch' } }

const [drawerUK, drawerCH, triggerUK, rowUK, rowCH] = await Promise.all([
  render('location-picker', ukLoc), render('location-picker', chLoc),
  mk(ukLoc).parseAndRender(triggerSrc, {}),
  mk(ukLoc).parseAndRender(rowSrc, {}),
  mk(chLoc).parseAndRender(rowSrc, {}),
])

// ---------- Liquid assertions ----------
const HEADING = (name, cur) => new RegExp(`<span data-location-name>${name}</span> \\(${cur}\\)`)
check(HEADING('United Kingdom', 'GBP').test(drawerUK), 'the drawer does not name the country and its currency')
// Markup, not the string: the drawer's own stylesheet names the class too,
// and the first draft of this check failed a correct render on that.
check(!drawerUK.includes('class="st-location__languages'), 'a one-language market grew a language row')
check(HEADING('Switzerland', 'CHF').test(drawerCH), 'the Swiss drawer does not read Switzerland (CHF)')
const chLangs = (drawerCH.match(/data-location-pick-language="/g) || []).length
check(chLangs === 4, `Switzerland offers ${chLangs} languages, not 4`)
check(/class="st-location__language is-current"[^>]*lang="de"[^>]*aria-current="true"[^>]*>Deutsch</.test(drawerCH), 'the current language is not the one marked')
// Read off the MARKUP: the snippet's script names these attributes too.
const markup = (html) => html.slice(html.indexOf('<st-location-picker'), html.indexOf('</st-location-picker>'))
const picks = (markup(drawerUK).match(/data-location-pick="/g) || []).length
check(picks === 215, `the drawer lists ${picks} countries, not the store's 215`)
// Two levels: the named ones and one row more; everything else behind it.
// (N named in the harness; the store's own setting names 41.)
const levelAll = /st-location__level--all[\s\S]*?<\/ul>/.exec(markup(drawerUK))[0]
const levelRest = /st-location__level--rest[\s\S]*$/.exec(markup(drawerUK))[0]
const named = (levelAll.match(/data-location-pick="/g) || []).length
check(named === N, `the first level names ${named} countries, not the setting's ${N}`)
check(/data-location-level="rest"[^>]*>(?:(?!<\/button>)[\s\S])*Rest of world/.test(levelAll), 'the first level has no "Rest of world" row')
check((levelRest.match(/data-location-item/g) || []).length === 215 - N, `the rest of the world is not the other ${215 - N}`)
check(!levelAll.includes('data-location-filter') && levelRest.includes('data-location-filter'), 'the filter belongs to the long level only')
check(levelRest.includes('data-location-level="all"') && levelRest.includes('All locations'), 'the second level has no way back')
// A visitor whose own country is a rest-of-world one is told so on the row.
const inLoc = { ...ukLoc, country: { name: 'India', iso_code: 'IN', currency: { iso_code: 'INR' } } }
const drawerIN = await render('location-picker', inLoc)
check(HEADING('India', 'INR').test(drawerIN), 'the heading does not name India')
check(/st-location__more is-current[^>]*aria-current="true"[^>]*>(?:(?!<\/button>)[\s\S])*Rest of world<span data-location-rest-name> &middot; India</.test(drawerIN), 'the Rest of world row does not carry India as current')
check((markup(drawerIN).match(/aria-current="true"/g) || []).length === 2, 'India should be current in its own row and on the Rest of world row, nowhere else')
// The script's handholds: the element knows its country and market, every
// row knows its market, and the name is addressable wherever it is printed.
check(/<st-location-picker[^>]*data-country="GB"[^>]*data-market="gb"/.test(drawerUK), 'the picker does not carry its country and market')
check(/data-location-pick="IE"[^>]*data-market="eu"/.test(drawerUK) && /data-location-pick="IN"[^>]*data-market="international"/.test(drawerUK), 'the rows do not carry their markets')
check((markup(drawerUK).match(/data-location-name/g) || []).length === 1 && triggerUK.includes('data-location-name') && rowUK.includes('data-location-name'), 'the country name is not addressable in the heading, the trigger and the menu row')
// The setting left empty is the flat list, and no second level.
const flat = await mk(ukLoc, { enable_location_picker: true, location_named_countries: '' }).renderFile('location-picker', {})
check((markup(flat).match(/data-location-pick="/g) || []).length === 215 && !markup(flat).includes('data-location-level="rest"'), 'an empty setting should list every country with no Rest of world')
check((drawerUK.match(/aria-current="true"/g) || []).length === 1, 'exactly one country should be current')
check(/is-current"[^>]*data-location-pick="GB"/.test(drawerUK), 'the current country is not the United Kingdom')
check(drawerUK.includes('id="StLocationFilter-drawer"') && rowUK.includes('id="StLocationFilter-menu"'), 'the two lists share an id')
check(drawerUK.includes('name="country_code" value="GB"') && drawerUK.includes('name="language_code" value="en"'), 'the form does not carry the current country and language')
const WORDS = /<span class="st-location__label">Location:<\/span> <span data-location-name>United Kingdom<\/span>/
check(WORDS.test(triggerUK), 'the bar trigger does not read "Location: United Kingdom"')
check(WORDS.test(rowUK), 'the menu row does not read the same words as the bar')
check(rowUK.includes('aria-controls="StMobileLocation-header"') && rowUK.includes('id="StMobileLocation-header"'), "the menu row's fold is not wired to its panel")
check(!rowUK.includes('class="st-location__languages') && rowCH.includes('st-location__languages--menu'), 'the menu shows a language row where it should not, or hides it where it should')
const off = await mk(ukLoc, { enable_location_picker: false, location_named_countries: NAMED_SETTING }).parseAndRender(triggerSrc, {})
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
  // Shopify's suggestion is a network call; here it answers "where you are".
  await desktop.addInitScript(() => { window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ detected_values: { country: { handle: 'GB' } } }) }) })
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
  // The first level: the named countries and Rest of world, no filter in view.
  const drawerList = desktop.locator('.st-location__drawer [data-location-list]')
  check(await drawerList.locator('.st-location__level--all [data-location-pick]').count() === N, `the first level does not show the ${N} named countries`)
  check(!(await desktop.locator('#StLocationFilter-drawer').isVisible()), 'the filter shows before the long list is opened')
  const more = drawerList.locator('[data-location-level="rest"]')
  const moreBox = await more.boundingBox()
  check(moreBox.height >= 44, `the Rest of world row is ${moreBox.height}px tall`)
  await more.click()
  check(await drawerList.getAttribute('data-level') === 'rest', 'Rest of world did not open the second level')
  check(await desktop.evaluate(() => document.activeElement.id === 'StLocationFilter-drawer'), 'the filter did not take focus when the long list opened')
  check(!(await drawerList.locator('.st-location__level--all').isVisible()), 'the first level is still in view under the second')
  // typing narrows, clearing restores — on the long level, where the filter is
  const filter = desktop.locator('#StLocationFilter-drawer')
  await filter.fill('ind')
  const shown = await desktop.locator('.st-location__drawer [data-location-item]:not([hidden])').allInnerTexts()
  check(shown.length === 2 && shown.includes('India') && shown.includes('Indonesia'), `"ind" shows ${JSON.stringify(shown)}`)
  await filter.fill('s')
  const ess = await desktop.locator('.st-location__drawer [data-location-item]:not([hidden])').allInnerTexts()
  check(ess.includes('South Africa') && ess.includes('Saudi Arabia') && !ess.includes('Israel') && !ess.includes('Iceland'), `one letter matches the start of a word, not anywhere in it: "s" shows ${JSON.stringify(ess)}`)
  await filter.fill('africa')
  const africa = await desktop.locator('.st-location__drawer [data-location-item]:not([hidden])').allInnerTexts()
  check(africa.length === 1 && africa[0] === 'South Africa', `"africa" shows ${JSON.stringify(africa)}`)
  await filter.fill('zzzz')
  check(await desktop.locator('.st-location__drawer [data-location-none]').isVisible(), 'no match shows no note')
  await filter.fill('')
  check(await desktop.locator('.st-location__drawer [data-location-item]:not([hidden])').count() === 215 - N, 'clearing the filter did not restore the whole rest of the world')
  // and back
  await drawerList.locator('[data-location-level="all"]').click()
  check(await drawerList.getAttribute('data-level') === 'all', 'the way back did not return to the first level')
  check(await desktop.evaluate(() => document.activeElement.dataset.locationLevel === 'rest'), 'focus did not return to the Rest of world row')
  await more.click()
  // choosing submits the form with that country — from the long level too
  await desktop.locator('.st-location__drawer [data-location-pick="BR"]').click()
  check(await desktop.evaluate(() => window.__submitted) === 'BR', 'choosing a country did not submit it')
  // Escape closes and hands focus back
  await desktop.keyboard.press('Escape')
  await desktop.waitForTimeout(500)
  check(!(await desktop.locator('st-location-picker').evaluate((el) => el.classList.contains('is-open'))), 'Escape did not close the drawer')
  check(await desktop.evaluate(() => document.activeElement.classList.contains('st-location__toggle')), 'focus did not return to the trigger')
  check(await desktop.locator('.st-location__drawer').evaluate((el) => getComputedStyle(el).visibility) === 'hidden', 'the closed drawer is still reachable')
  check(await drawerList.getAttribute('data-level') === 'all', 'closing the drawer did not return the list to its first level')

  // ---- the visitor's own country, on a store that serves many ----
  // Rendered as Ireland on the European store; Shopify's suggestion says
  // Portugal, which is on the same store — so the page becomes Portugal's
  // without a reload, and says so everywhere the country is printed.
  const [drawerEU, triggerEU, rowEU] = await Promise.all([render('location-picker', euLoc), mk(euLoc).parseAndRender(triggerSrc, {}), mk(euLoc).parseAndRender(rowSrc, {})])
  const stubbed = (html, suggested) => html.replace('<script>', `<script>
      window.__posts = []; window.__asked = 0;
      window.fetch = (url, opts) => {
        if (String(url).includes('browsing_context_suggestions')) { window.__asked += 1; return Promise.resolve({ ok: true, json: () => Promise.resolve({ detected_values: { country: { handle: ${JSON.stringify(suggested)}, name: 'x' } } }) }) }
        if (opts && opts.method === 'POST') { window.__posts.push(Object.fromEntries(opts.body.entries())); return Promise.resolve({ ok: true, type: 'opaqueredirect' }) }
        return Promise.reject(new Error('unexpected fetch ' + url))
      }
    </script><script>`)
  const euPage = (suggested) => stubbed(page_html(1440).replace(triggerUK, triggerEU).replace(rowUK, rowEU).replace(drawerUK, drawerEU), suggested)
  const nameAll = (p) => p.$$eval('[data-location-name]', (ns) => ns.map((n) => n.textContent.trim()))
  // These pages read storage, and a page written with setContent sits on a
  // blank origin where the browser refuses it (the picker's own guard hides
  // that; the checks below must not). So they are served from an origin.
  const load = async (p, html) => {
    p.__html = html
    if (!p.__routed) { await p.route('https://stendig.test/**', (r) => r.fulfill({ body: p.__html, contentType: 'text/html' })); p.__routed = true }
    await p.goto('https://stendig.test/')
  }

  const eu = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  await load(eu, euPage('PT'))
  await eu.waitForTimeout(300)
  check((await eu.evaluate(() => window.__asked)) === 1, 'the suggestion was not asked for once')
  const posts = await eu.evaluate(() => window.__posts)
  check(posts.length === 1 && posts[0].country_code === 'PT', `expected one post setting PT, got ${JSON.stringify(posts)}`)
  const names = await nameAll(eu)
  check(names.length === 3 && names.every((n) => n === 'Portugal'), `after adoption the names read ${JSON.stringify(names)}`)
  check(await eu.$eval('.st-location__current', (el) => el.textContent.replace(/\s+/g, ' ').trim()) === 'Portugal (EUR)', 'the heading did not become Portugal (EUR)')
  const currents = await eu.$$eval('[data-location-pick][aria-current="true"]', (bs) => bs.map((b) => b.dataset.locationPick))
  check(currents.length === 2 && currents.every((c) => c === 'PT'), `current marks after adoption: ${JSON.stringify(currents)}`)
  check(await eu.$eval('[data-location-country]', (i) => i.value) === 'PT', 'the form still carries Ireland')
  check(await eu.evaluate(() => localStorage.getItem('st-location')) === 'PT', 'the adoption was not remembered')
  // Asked again on a fresh load, it stays quiet: settled.
  await load(eu, euPage('PT'))
  await eu.waitForTimeout(200)
  check((await eu.evaluate(() => window.__asked)) === 0, 'a settled visitor was asked again')

  // A visitor whose country is on ANOTHER store is left alone.
  await eu.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await load(eu, euPage('US'))
  await eu.waitForTimeout(300)
  check((await eu.evaluate(() => window.__posts.length)) === 0, 'a country on another store was adopted')
  check((await nameAll(eu)).every((n) => n === 'Ireland'), 'the names changed for a country on another store')
  check((await eu.evaluate(() => localStorage.getItem('st-location'))) === null, 'a refusal was remembered as a settlement')
  // …and not asked twice in one session.
  await load(eu, euPage('US'))
  await eu.waitForTimeout(200)
  check((await eu.evaluate(() => window.__asked)) === 0, 'the same session asked twice')

  // A rest-of-world country on the same store: the row says so.
  const usLoc = { ...ukLoc, market: { handle: 'international' }, country: { name: 'United States', iso_code: 'US', currency: { iso_code: 'USD' } } }
  countries.find((c) => c.iso_code === 'US').market.handle = 'international'
  const [drawerUS, triggerUS, rowUS] = await Promise.all([render('location-picker', usLoc), mk(usLoc).parseAndRender(triggerSrc, {}), mk(usLoc).parseAndRender(rowSrc, {})])
  const us = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
  await load(us, stubbed(page_html(1440).replace(triggerUK, triggerUS).replace(rowUK, rowUS).replace(drawerUK, drawerUS), 'IN'))
  await us.waitForTimeout(300)
  const restRow = await us.$eval('.st-location__drawer [data-location-level="rest"]', (b) => ({ text: b.textContent.replace(/\s+/g, ' ').trim(), current: b.getAttribute('aria-current') }))
  check(restRow.text.startsWith('Rest of world · India') && restRow.current === 'true', `the Rest of world row reads "${restRow.text}" (current: ${restRow.current})`)
  check(await us.$eval('[data-location-country]', (i) => i.value) === 'IN', 'India was not adopted on the International store')

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await phone.addInitScript(() => { window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ detected_values: { country: { handle: 'GB' } } }) }) })
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
  await phone.locator('#StMobileLocation-header [data-location-level="rest"]').click()
  await phone.locator('#StLocationFilter-menu').fill('ice')
  const ice = await phone.locator('#StMobileLocation-header [data-location-item]:not([hidden])').allInnerTexts()
  check(ice.length === 1 && ice[0] === 'Iceland', `"ice" in the menu shows ${JSON.stringify(ice)}`)
} finally {
  await browser.close()
}

if (failures.length) {
  console.error(`FAIL (${failures.length})`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('PASS: the picker names the country, lists all 215, filters, submits, and folds into the menu')
