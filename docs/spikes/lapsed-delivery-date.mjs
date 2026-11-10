/**
 * A basket line whose delivery date is no longer offered takes the first date
 * on offer now (the owner's choice, 10 Nov 2026).
 *
 * Reported: ST39600 checked out on 9 Nov with "Delivery Date: 9 Nov", two days
 * after 9 Nov stopped showing on the product page. The calendar had sat in the
 * basket since before the cut-off; nothing checked its date again.
 *
 * Two kinds, both run here:
 *   1. Liquid under liquidjs: the drawer (cart-notification-content.liquid)
 *      rendered with a basket holding a 9 Nov line works out the swap.
 *   2. Chromium: cart-notification.js sends that swap to /cart/change.js,
 *      keeping the line's hidden properties.
 *
 *   npm i --no-save liquidjs
 *   node docs/spikes/lapsed-delivery-date.mjs
 */
import { Liquid } from 'liquidjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../..')
const DRAWER = readFileSync(join(root, 'snippets/cart-notification-content.liquid'), 'utf8')

const f = (value) => ({ value })
const entry = (o) => ({
  rank: f(o.rank),
  date: f(o.date ?? ''),
  special: f(o.special ?? ''),
  label: f(o.label ?? ''),
  show_on: f(''),
  hide_after: f(o.hide_after ?? ''),
  markets: f(o.markets ?? []),
  skus: f(o.skus ?? []),
})
const CAL = ['SC27', 'VC27R']
/* Today as the store sees it is the real today, so the fixture is relative. */
const iso = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10)
const words = (d) => {
  const x = new Date(`${d}T12:00:00Z`)
  return `${x.getUTCDate()} ${'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[x.getUTCMonth()]}`
}
const GONE = iso(3) // a dated option whose window closed yesterday
const NEXT = iso(13)
const ENTRIES = [
  entry({ rank: 1, special: 'ASAP', label: 'Send now', markets: ['us', 'uk'], skus: CAL }),
  entry({ rank: 2, date: GONE, hide_after: iso(-1), skus: CAL }),
  entry({ rank: 3, date: NEXT, skus: CAL }),
]
const WAREHOUSES = [
  { system: { handle: 'uk-3-pl' }, is_default: f(true), domains: f(['gb', 'main']) },
  { system: { handle: 'us-3-pl' }, is_default: f(false), domains: f(['us']) },
  { system: { handle: 'tw-3-pl' }, is_default: f(false), domains: f(['tw']) },
]

const product = (title, skus) => ({
  title,
  handle: title.toLowerCase().replace(/ /g, '-'),
  variants: skus.map((sku) => ({ sku })),
  metafields: { custom: {} },
  has_only_default_variant: true,
})
const line = (key, p, date, extra = {}) => ({
  key,
  product: p,
  quantity: 1,
  properties: { 'Delivery Date': date, _st_market: 'us', ...extra },
  options_with_values: [],
})
const STENDIG = product('Stendig Calendar', ['SC27'])
const STRIPS = product('Hanging Strips', ['HL06'])

const engine = new Liquid({ root: join(root, 'snippets'), extname: '.liquid', strictFilters: false, strictVariables: false })
engine.registerFilter('t', (key) => String(key).split('.').pop())
engine.registerFilter('money', (v) => String(v))
engine.registerFilter('img_url', (v) => String(v))

const fixesOf = async (root_url, items) => {
  const globals = {
    routes: { root_url },
    request: { host: 'stendigcalendars.com' },
    settings: { dispatch_from_admin: true, warehouses: WAREHOUSES, delivery_date_entries: { count: 0 }, cross_sell_rules: [] },
    metaobjects: { delivery_date_option: { values: ENTRIES }, cross_sell_rule: { values: [] } },
    cart: { items, item_count: items.length },
  }
  const html = await engine.parseAndRender(DRAWER, globals, { globals })
  const m = /<script type="application\/json" data-dd-fixes>([\s\S]*?)<\/script>/.exec(html)
  return m ? JSON.parse(m[1]) : []
}

const faults = []
const check = (what, got, want) => {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  if (a !== b) faults.push(`${what}\n      got  ${a}\n      want ${b}`)
  else console.log(`  ok  ${what}`)
}

/* 1. The reported symptom: a US basket holding a date no longer offered. */
check(
  'a US basket line with a withdrawn date takes the first date on offer (Send now)',
  await fixesOf('/en-us', [line('k1', STENDIG, words(GONE))]),
  [{ key: 'k1', date: 'ASAP' }],
)

/* 2. Taiwan is offered no Send now, so the first on offer there is the next date. */
check(
  'in Taiwan it takes the next dated option',
  await fixesOf('/zh-tw', [line('k1', STENDIG, words(GONE))]),
  [{ key: 'k1', date: words(NEXT) }],
)

/* 3. A date still offered is left as the customer chose it. */
check('a date still on offer is left alone', await fixesOf('/en-us', [line('k1', STENDIG, words(NEXT))]), [])

/* 4. An add-on offered no dates of its own, carrying the calendar's old date,
      follows the calendar. One carrying no date is left blank. */
check(
  'an add-on that copied the old date follows the calendar',
  await fixesOf('/en-us', [line('k2', STRIPS, words(GONE)), line('k1', STENDIG, words(GONE)), line('k3', STRIPS, '')]),
  [
    { key: 'k1', date: 'ASAP' },
    { key: 'k2', date: 'ASAP' },
  ],
)

/* 5. The product page is unchanged: the snippet still draws its buttons. */
{
  const html = await engine.parseAndRender(
    readFileSync(join(root, 'snippets/delivery-date-buttons.liquid'), 'utf8'),
    {
      routes: { root_url: '/en-us' },
      request: { host: 'stendigcalendars.com' },
      product: STENDIG,
      settings: { dispatch_from_admin: true, warehouses: WAREHOUSES, delivery_date_entries: { count: 0 } },
      metaobjects: { delivery_date_option: { values: ENTRIES } },
    },
  )
  check(
    'the product page still draws Send now and the next date, not the withdrawn one',
    [...html.matchAll(/data-date="([^"]*)"/g)].map((m) => m[1]),
    ['ASAP', words(NEXT)],
  )
}

/* 6. Chromium: the script sends the swap, hidden properties kept. */
{
  const require = createRequire(import.meta.url)
  const { chromium } = require('playwright')
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  const page = await browser.newPage()
  await page.setContent(`<!doctype html><body>
    <script>
      window.routes = { cart_change_url: '/en-us/cart/change' };
      window.calls = [];
      window.fetch = async (url, init) => {
        window.calls.push({ url, body: init && init.body ? JSON.parse(init.body) : null });
        if (url === '/en-us/cart.js') return { ok: true, json: async () => ({ items: [
          { key: 'k1', quantity: 2, properties: { 'Delivery Date': '9 Nov', _st_market: 'us', _st_path: '/en-us' } },
        ] }) };
        return { ok: true, json: async () => ({ sections: {} }) };
      };
    </script>
    <cart-notification>
      <div id="cart-notification"><div id="cart-notification-content">
        <script type="application/json" data-dd-fixes>[{"key":"k1","date":"ASAP"}]</script>
      </div></div>
    </cart-notification>
  </body>`)
  await page.addScriptTag({ content: readFileSync(join(root, 'assets/cart-notification.js'), 'utf8') })
  await page.waitForFunction(() => window.calls.length >= 2, null, { timeout: 3000 }).catch(() => {})
  const calls = await page.evaluate(() => window.calls)
  await browser.close()
  check(
    'the basket sends the new date to Shopify, keeping the hidden properties and quantity',
    calls.map((c) => [c.url, c.body && { id: c.body.id, quantity: c.body.quantity, properties: c.body.properties }]),
    [
      ['/en-us/cart.js', null],
      ['/en-us/cart/change.js', { id: 'k1', quantity: 2, properties: { 'Delivery Date': 'ASAP', _st_market: 'us', _st_path: '/en-us' } }],
    ],
  )
}

if (faults.length) {
  console.log(`\n${faults.length} failed:\n  - ${faults.join('\n  - ')}`)
  process.exit(1)
}
console.log('\nall passed')
