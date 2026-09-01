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
  skus: f(o.skus ?? []),
})

/* The real catalogue: one SKU for the Stendig, four colourways for the V
   Calendar, and HL — not HS — for the strips, which is what the SKUs say. */
const VARIANTS = {
  'stendig-calendar': ['SC26'],
  'v-calendar': ['VC26W', 'VC26R', 'VC26B', 'VC26Y'],
  'hanging-strips': ['HL06'],
  'something-new': ['ZZ01'],
}

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
  entry({ rank: 3, special: 'By Xmas', markets: ['uk'], skus: ['SC26', 'VC26W', 'VC26R', 'VC26B', 'VC26Y'] }),
  entry({ rank: 1, special: 'ASAP', label: 'Send now', markets: ['uk', 'eu', 'primary'], skus: ['SC26', 'VC26W', 'VC26R', 'VC26B', 'VC26Y'] }),
  entry({ rank: 2, date: '2026-12-07', markets: ['uk', 'eu'], skus: ['SC26', 'VC26W', 'VC26R', 'VC26B', 'VC26Y'] }),
  entry({ rank: 4, date: '2026-11-09', markets: ['uk'], skus: ['VC26W', 'VC26R', 'VC26B', 'VC26Y'] }),
  entry({ rank: 5, date: '2026-11-23', markets: ['uk'], skus: ['SC26'], show_on: '2099-01-01' }),
  entry({ rank: 6, date: '2026-11-30', markets: ['uk'], skus: ['SC26'], hide_after: '2000-01-01' }),
]

const render = (over = {}) =>
  engine.parseAndRender(SNIPPET, {
    routes: { root_url: over.root_url ?? '/en-gb' },
    request: { host: 'stendig.com' },
    product: {
      handle: over.handle ?? 'stendig-calendar',
      variants: (VARIANTS[over.handle ?? 'stendig-calendar'] ?? []).map((sku) => ({ sku })),
      metafields: { custom: {} },
    },
    settings: {
      dispatch_from_admin: over.on ?? true,
      warehouses: WAREHOUSES,
      delivery_date_entries: { count: 0 },
      delivery_dates: '<p>ASAP</p>',
    },
    metaobjects: { delivery_date_option: { values: over.entries ?? ENTRIES } },
  })

const buttons = (html) => [...html.matchAll(/data-date="([^"]*)"/g)].map((m) => m[1])
/* The label, the wrapper and the required input all hang off there being at
   least one button — see check 14. */
const chrome = (html) => ({
  label: html.includes('delivery-date-label-custom'),
  wrapper: html.includes('delivery-date-wrapper-custom'),
  required: html.includes('properties[Delivery Date]'),
})
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
check('filters by product, by whole SKU', buttons(await render({ handle: 'v-calendar' })), [
  'ASAP',
  '7 Dec',
  'By Xmas',
  '9 Nov',
])

/* 5. The safety the SKU change buys. A product whose SKUs match no prefix is
      offered nothing, rather than silently inheriting every dispatch date the
      season has. It loses the picker, not the sale: with no buttons the field
      stops being required. Under the old handle matching this product got
      everything, which is the behaviour being deliberately reversed. */
check('offers nothing to a product no option names', buttons(await render({ handle: 'something-new' })), [])

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

/* 9. The one that matters on the day the switch is flipped. The store already
      holds the hand-made entries the picked list renders, and they carry no
      rank — so "are there any entries" is TRUE while "is there anything this
      file can draw" is false. Asking the wrong one empties the picker. */
const UNRANKED = [
  { date: f(''), special: f('ASAP'), label: f(''), show_on: f(''), hide_after: f(''), markets: f([]), products: f([]), rank: f(null) },
  { date: f('2026-12-07'), special: f(''), label: f(''), show_on: f(''), hide_after: f(''), markets: f([]), products: f([]), rank: f(null) },
]
check('falls back when the only entries are hand-made and unranked', buttons(await render({ entries: UNRANKED })), ['ASAP'])

/* 10. And once one ranked entry exists, the admin's list wins outright — the
       unranked ones are not mixed in beside it. */
check(
  'ignores unranked entries once the admin has published',
  buttons(await render({ entries: [...UNRANKED, ENTRIES[1]] })),
  ['ASAP'],
)

/* 11. A prefix has to match at the START. 'C' must not match 'SC26', or one
       family's prefix would quietly pick up another's. */
check(
  'a prefix is not a SKU — equality, so SC does not match SC26',
  buttons(await render({ entries: [entry({ rank: 1, special: 'ASAP', markets: ['uk'], skus: ['SC'] })] })),
  [],
)

/* 12. Naming ONE colourway shows the option on the whole product page — the
       buttons sit outside the variant chooser, so this is what "per SKU"
       can and cannot buy. Asserted so nobody reads more precision into it. */
check(
  'one colourway shows the option for the whole product',
  buttons(await render({
    handle: 'v-calendar',
    entries: [entry({ rank: 1, date: '2026-12-07', markets: ['uk'], skus: ['VC26W'] })],
  })),
  ['7 Dec'],
)

/* 13. Uniform: a product with no SKU at all cannot match a prefix either, so
       it is treated exactly as one whose SKU is unrecognised. One rule, no
       special case to remember. */
check(
  'a product with no SKU is offered nothing an option names',
  buttons(await render({
    handle: 'no-sku',
    entries: [entry({ rank: 1, date: '2026-12-07', markets: ['uk'], skus: ['SC26'] })],
  })),
  [],
)

/* 14. The first option arrives already chosen, and the hidden field already
       carries it — before any JavaScript runs. A required field that starts
       empty is a red label every shopper meets on arrival, which is what the
       French page showed on a season with no ASAP button. */
{
  const html = await render()
  const drawn = buttons(html)
  const active = [...html.matchAll(/class="delivery-date-button-custom active-custom"[^>]*data-date="([^"]*)"/g)].map((m) => m[1])
  check('marks exactly the first drawn option as chosen', active, [drawn[0]])
  const value = /id="delivery-date-input-custom"[\s\S]*?value="([^"]*)"/.exec(html)
  check('fills the hidden field with it server-side', value?.[1], drawn[0])
}

/* 15. Nothing to choose means nothing drawn — no heading over an empty space,
       and no required hidden input nobody can satisfy. This shipped wrong: the
       French Stendig page printed "Choisir une date de livraison" above the
       quantity box with not one button under it. */
{
  const empty = await render({ handle: 'something-new' })
  const c = chrome(empty)
  check('draws no buttons for a product no option names', buttons(empty), [])
  check('draws no label, wrapper or required input with them', [c.label, c.wrapper, c.required], [false, false, false])

  const some = await render()
  const c2 = chrome(some)
  check('draws all three when there IS something to choose', [c2.label, c2.wrapper, c2.required], [true, true, true])
}

if (faults.length) {
  console.error('\ndispatch dates:\n  - ' + faults.join('\n  - '))
  process.exit(1)
}
console.log('\ndispatch dates: the rank walk, the market name, the product filter and the switch')
