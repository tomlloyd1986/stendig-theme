/**
 * The dispatch-dates source in `snippets/delivery-date-buttons.liquid`, run.
 *
 * A Shopify theme cannot be rendered here, so this renders the snippet against
 * liquidjs with the objects it reads stubbed. That does not prove Shopify's
 * Liquid agrees in every corner — it proves the things this change actually
 * got wrong on the way in: a filter inside an `if` condition (which Liquid
 * refuses), the rank walk, and each of the three filters that decide whether
 * a button is drawn.
 *
 *   node docs/spikes/dispatch-dates.mjs
 *
 * Needs liquidjs:  npm i --no-save liquidjs
 */
import { Liquid } from 'liquidjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const SNIPPET = readFileSync(join(here, '../../snippets/delivery-date-buttons.liquid'), 'utf8')

const engine = new Liquid({ strictFilters: false, strictVariables: false })
/* The storefront's own translation filter. The spike only needs it to return
   something stable, so it echoes the key's last segment. */
engine.registerFilter('t', (key) => String(key).split('.').pop())

const f = (value) => ({ value })
const entry = (o) => ({
  rank: f(o.rank),
  date: f(o.date ?? ''),
  special: f(o.special ?? ''),
  label: f(o.label ?? ''),
  show_on: f(o.show_on ?? ''),
  hide_after: f(o.hide_after ?? ''),
  markets: f(o.markets ?? []),
  products: f(o.products ?? []),
})

/* Named so a wrong head is visibly wrong: the UK's warehouse head is 'uk'
   while its path token is 'gb', which is the mapping this all turns on. */
const WAREHOUSES = [
  { system: { handle: 'uk-3-pl' }, is_default: f(true), domains: f(['gb', 'main']) },
  { system: { handle: 'eu' }, is_default: f(false), domains: f(['de', 'fr', 'it', 'es']) },
  { system: { handle: 'go-bolt-yyz-5' }, is_default: f(false), domains: f(['ca']) },
]

const ENTRIES = [
  /* Deliberately OUT of rank order in the source array: if the walk followed
     the array this would draw By Xmas first, which is the bug `sort: 'rank'`
     silently ships. */
  entry({ rank: 3, special: 'By Xmas', markets: ['uk'], products: ['sc', 'vc'] }),
  entry({ rank: 1, special: 'ASAP', label: 'Send now', markets: ['uk', 'eu', 'primary'], products: ['sc', 'vc'] }),
  entry({ rank: 2, date: '2026-12-07', markets: ['uk', 'eu'], products: ['sc', 'vc'] }),
  entry({ rank: 4, date: '2026-11-09', markets: ['uk'], products: ['vc'] }),
  entry({ rank: 5, date: '2026-11-23', markets: ['uk'], products: ['sc'], show_on: '2099-01-01' }),
  entry({ rank: 6, date: '2026-11-30', markets: ['uk'], products: ['sc'], hide_after: '2000-01-01' }),
]

const render = (over = {}) =>
  engine.parseAndRender(SNIPPET, {
    routes: { root_url: over.root_url ?? '/en-gb' },
    request: { host: 'stendig.com' },
    product: { handle: over.handle ?? 'stendig-calendar', metafields: { custom: {} } },
    settings: {
      dispatch_from_admin: over.on ?? true,
      warehouses: WAREHOUSES,
      delivery_date_entries: { count: 0 },
      delivery_dates: '<p>ASAP</p>',
    },
    metaobjects: { delivery_date_option: { values: over.entries ?? ENTRIES } },
  })

const buttons = (html) => [...html.matchAll(/data-date="([^"]*)"/g)].map((m) => m[1])
const faults = []
const check = (what, got, want) => {
  const a = JSON.stringify(got)
  const b = JSON.stringify(want)
  if (a !== b) faults.push(`${what}\n      got  ${a}\n      want ${b}`)
  else console.log(`  ok  ${what}`)
}

/* 1. The rank walk. Source order would give By Xmas first. */
check('draws in rank order, not source order', buttons(await render()), ['ASAP', '7 Dec', 'By Xmas'])

/* 2. Markets. On /en-de our code is 'eu' — the token is 'de', which no entry
      names, so a snippet matching the raw token would draw nothing. */
check('matches our market name, not the path token', buttons(await render({ root_url: '/en-de' })), [
  'ASAP',
  '7 Dec',
])

/* 3. The root domain is the primary market — rest of world. */
check('resolves the bare domain to primary', buttons(await render({ root_url: '/' })), ['ASAP'])

/* 4. Products. The V Calendar gets rank 4, which the Stendig does not. */
check('filters by product', buttons(await render({ handle: 'v-calendar' })), [
  'ASAP',
  '7 Dec',
  'By Xmas',
  '9 Nov',
])

/* 5. A product the snippet cannot name is offered everything rather than
      nothing — a new product on the shop must not silently lose its picker.
      "Everything" still means everything the OTHER filters allow: ranks 5 and
      6 are outside their windows whatever product is asking, which is what
      this expectation got wrong the first time it was written. */
check('offers an unknown product every option the window allows', buttons(await render({ handle: 'something-new' })), [
  'ASAP',
  '7 Dec',
  'By Xmas',
  '9 Nov',
])

/* 6. The window: rank 5 is not shown yet, rank 6 stopped being shown. Neither
      appears above, which is what the two dates are doing in the fixture. */
check(
  'honours show_on and hide_after',
  buttons(await render()).filter((d) => d === '23 Nov' || d === '30 Nov'),
  [],
)

/* 7. The kill switch. Off, the file behaves exactly as it did — here that is
      the legacy comma list, since no entries are picked in the theme editor. */
check('falls back to the old path with the switch off', buttons(await render({ on: false })), ['ASAP'])

/* 8. And with the switch on but nothing published, the old path still runs
      rather than the shop losing its buttons. */
check('falls back when the admin has published nothing', buttons(await render({ entries: [] })), ['ASAP'])

if (faults.length) {
  console.error('\ndispatch dates:\n  - ' + faults.join('\n  - '))
  process.exit(1)
}
console.log('\ndispatch dates: the rank walk, the market name, the product filter and the switch')
