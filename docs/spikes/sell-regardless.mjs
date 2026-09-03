/**
 * "Sell regardless of stock": opening preorders in a market whose stock
 * Shopify cannot see.
 *
 * Canada is the case. Its inventory lives in GoBolt's own app rather than in
 * a Shopify location, so Shopify reads zero however many units are on the
 * way, and Shopify Flow duly writes the Canada warehouse into every
 * product's custom.oos_warehouses. The storefront then offers Join waitlist
 * and no amount of "continue selling when out of stock" changes it — the
 * theme stops consulting native availability the moment any list is set.
 *
 * The switch therefore cannot live in the metafield: Flow rewrites that on
 * every inventory movement and would undo a hand edit within minutes. It
 * lives on the WAREHOUSE metaobject, which Flow never touches, and the
 * theme reads it beside the location name.
 *
 * Three properties this pins, because each is a way to get it wrong:
 *
 *  - It beats Flow's automatic list. That is the entire point.
 *  - It does NOT beat a manual 'all'. That is a person deliberately
 *    stopping sales everywhere; a per-market preorder switch is a smaller
 *    statement and must not overrule it.
 *  - It reaches ONLY its own market. Ticking Canada must not open a market
 *    that is genuinely out.
 *
 * Both paths are checked. Liquid decides the stock pill and the cart
 * cross-sell; JavaScript decides the buy buttons on the product page, and
 * the two disagreeing is how a shopper gets a Sold out pill above a live
 * Add to cart.
 *
 *   npm i --no-save liquidjs && node docs/spikes/sell-regardless.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Liquid } from 'liquidjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const engine = new Liquid({ root: join(root, 'snippets'), extname: '.liquid', strictFilters: false, strictVariables: false })
const faults = []
const ok = (m) => console.log(`  ok  ${m}`)

/* Warehouse entries as the theme sees them: metaobject fields are {value}. */
const wh = (loc, domains, { def = false, open = false } = {}) => ({
  location: { value: loc },
  domains: { value: domains },
  is_default: { value: def },
  sell_regardless: { value: open },
})
const WAREHOUSES = (canadaOpen) => [
  wh('UK 3PL', ['main', 'gb'], { def: true }),
  wh('GoBolt YYZ5', ['ca'], { open: canadaOpen }),
  wh('US 3PL', ['us']),
]

const mf = (list) => (list ? { value: list } : {})
const product = ({ auto = null, manual = null, native = false } = {}) => ({
  metafields: { custom: { oos_warehouses: mf(auto), oos_warehouses_manual: mf(manual) } },
  variants: [],
  available: native,
})

/* ---------- 1. the stock pill (snippets/stock-state.liquid) ---------- */

async function pill({ market, canadaOpen, auto, manual, native = false }) {
  const out = await engine.parseAndRender(read('snippets/stock-state.liquid'), {
    product: product({ auto, manual, native }),
    variant: null,
    settings: { warehouses: WAREHOUSES(canadaOpen) },
    routes: { root_url: market === 'main' ? '/' : `/en-${market}` },
  })
  return out.trim()
}

const FLOW = ['gobolt yyz5']            // what Flow writes while Canada reads zero
const cases = [
  ['ca', false, FLOW, null, 'sold_out', 'Canada today: Flow says out, so the waitlist shows'],
  ['ca', true, FLOW, null, '', 'Canada with the tick: Flow still says out, the market ignores it'],
  ['us', true, ['us 3pl'], null, 'sold_out', "ticking Canada does not open a market that is genuinely out"],
  ['ca', true, FLOW, ['all'], 'sold_out', "a manual 'all' outranks the tick — a deliberate stop stays stopped"],
  ['ca', true, null, ['gobolt yyz5'], '', 'a manual per-market out is overruled, like the automatic one'],
  ['ca', false, null, null, 'sold_out', 'no lists at all: native availability decides, and Shopify says out'],
  /* The tick is NOT a way to sell something Shopify itself calls unavailable
     when no list has ever been written — with no lists there is nothing for
     it to overrule, so native still decides and the answer is still out.
     That is why "sell beyond stock" alone did not fix Canada either. */
  ['ca', true, null, null, 'sold_out', 'and the tick does not overrule native availability on its own'],
]
for (const [market, open, auto, manual, want, why] of cases) {
  const got = await pill({ market, canadaOpen: open, auto, manual })
  if (got !== want) faults.push(`pill ${market}/${open ? 'open' : 'shut'} gave ${JSON.stringify(got)}, wanted ${JSON.stringify(want)} — ${why}`)
  else ok(`pill: ${why}`)
}

/* ---------- 2. the buy buttons (window.warehouseAvailability) ---------- */

const src = read('sections/main-product.liquid')
const fn = /window\.warehouseAvailability = function[\s\S]*?\n  \};/.exec(src)
if (!fn) faults.push('could not find window.warehouseAvailability in main-product.liquid')

function js({ current, open, auto, manual }) {
  const w = {
    currentWarehouse: current,
    openWarehouses: open ? { 'gobolt yyz5': true } : {},
    productOOSWarehouses: auto,
    productOOSManual: manual,
    variantOOSWarehouses: { 1: null },
    variantOOSManual: { 1: null },
  }
  const body = fn[0].replace(/window\./g, 'w.')
  return new Function('w', `${body.replace('w.warehouseAvailability = function', 'const f = function')}; return f(1)`)(w)
}

const jsCases = [
  ['gobolt yyz5', false, FLOW, null, false, 'Canada today: waitlist'],
  ['gobolt yyz5', true, FLOW, null, true, 'Canada with the tick: buy buttons'],
  ['us 3pl', true, ['us 3pl'], null, false, 'another market genuinely out stays out'],
  ['gobolt yyz5', true, FLOW, ['all'], false, "'all' outranks the tick here too"],
  ['gobolt yyz5', false, null, null, null, 'no lists: null, so the caller falls back to native'],
]
for (const [current, open, auto, manual, want, why] of jsCases) {
  const got = js({ current, open, auto, manual })
  if (got !== want) faults.push(`js ${current}/${open ? 'open' : 'shut'} gave ${JSON.stringify(got)}, wanted ${JSON.stringify(want)} — ${why}`)
  else ok(`buttons: ${why}`)
}

/* ---------- 3. the two paths agree ---------- */
for (const [market, wname] of [['ca', 'gobolt yyz5'], ['us', 'us 3pl']]) {
  for (const open of [false, true]) {
    const p = (await pill({ market, canadaOpen: open, auto: FLOW.concat(['us 3pl']), manual: null })) === ''
    const j = js({ current: wname, open, auto: FLOW.concat(['us 3pl']), manual: null })
    if (p !== j) faults.push(`${market}/${open ? 'open' : 'shut'}: the pill says ${p ? 'in' : 'out'} and the buttons say ${j ? 'in' : 'out'}`)
  }
}
ok('the pill and the buy buttons reach the same answer in every market')

/* ---------- 4. an untouched theme is an unchanged theme ---------- */
const untouched = await pill({ market: 'ca', canadaOpen: false, auto: FLOW, manual: null })
if (untouched !== 'sold_out') faults.push('with nothing ticked the Canada waitlist no longer shows — this change is not inert')
else ok('with nothing ticked anywhere, every market behaves exactly as it did')

/* ---------- 5. the field does not exist yet ---------- */
/* The order of work is: deploy the theme, then add the field to the
   Warehouse definition in Shopify. Between the two, every warehouse entry
   answers nil for sell_regardless, and the theme has to carry on exactly as
   before rather than erroring or opening every market. */
const NO_FIELD = [
  { location: { value: 'UK 3PL' }, domains: { value: ['main', 'gb'] }, is_default: { value: true } },
  { location: { value: 'GoBolt YYZ5' }, domains: { value: ['ca'] }, is_default: { value: false } },
]
const beforeField = await engine.parseAndRender(read('snippets/stock-state.liquid'), {
  product: product({ auto: FLOW }),
  variant: null,
  settings: { warehouses: NO_FIELD },
  routes: { root_url: '/en-ca' },
})
if (beforeField.trim() !== 'sold_out') {
  faults.push(`with the field not yet added the pill gave ${JSON.stringify(beforeField.trim())} — deploying before creating it must change nothing`)
} else {
  ok('deployed before the field exists: unchanged, no error')
}

/* ---------- 6. two entries claiming one market ---------- */
/* Real, not hypothetical: Canada carried two Warehouse entries at once —
   one made by hand and one created by the rates app — with only one of
   them holding the ca domain. The last match must win BOTH the location
   name and the tick, never one from each entry. Checked in both orders,
   because a bug here would show in one order and hide in the other. */
const dup = (openFirst) => [
  wh('UK 3PL', ['main'], { def: true }),
  wh('GoBolt YYZ5', ['ca'], { open: openFirst }),
  wh('CA 3PL (GoBolt YYZ5)', ['ca'], { open: !openFirst }),
]
for (const openFirst of [true, false]) {
  /* Flow has marked the SECOND entry's location out. The second entry is
     the last match, so it owns the market — and its own tick decides. */
  const out = await engine.parseAndRender(read('snippets/stock-state.liquid'), {
    product: product({ auto: ['ca 3pl (gobolt yyz5)'] }),
    variant: null,
    settings: { warehouses: dup(openFirst) },
    routes: { root_url: '/en-ca' },
  })
  const got = out.trim()
  const want = openFirst ? 'sold_out' : ''
  if (got !== want) {
    faults.push(`two entries for ca, tick on the ${openFirst ? 'first' : 'second'}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)} — the location and the tick must come from the same entry`)
  }
}
ok('two entries claiming one market: the last one wins both its name and its tick')

if (faults.length) {
  console.error('\nsell regardless:\n  - ' + faults.join('\n  - '))
  process.exit(1)
}
console.log('\nsell regardless: a market can open preorders over Flow, and only its own')
