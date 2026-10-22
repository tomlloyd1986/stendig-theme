/**
 * The admin's two per-product lists: one product sells regardless of stock in
 * one market, and stops again when that market's orders reach the stock the
 * admin set for it.
 *
 * The owner, 21 Oct 2026, after the White V Calendar oversold in Canada:
 * *"can we not find a way of continuing to sell pre-orders when there is no
 * GoBolt stock but only up to the point that we have stock as decided in the
 * admin?"* Canada's warehouse tick opens every product with no ceiling, and
 * once GoBolt's stock lands its count includes the units kept for Canadian
 * shops. So the admin writes two lists on the variant, which Flow never
 * touches:
 *
 *  - custom.sell_regardless_warehouses — this product sells in that market
 *    whatever Flow's list says. The admin has written it since 2 Oct 2026;
 *    no theme read it until now.
 *  - custom.stop_selling_warehouses — this product is sold out in that
 *    market, whatever opens it. Written when the market's orders reach the
 *    admin's consumer figure.
 *
 * What this pins, both paths (the pill in Liquid, the buy buttons in JS):
 *
 *  - The stop beats the warehouse tick: Canada with the tick still on stops.
 *  - The stop beats the product's own opening.
 *  - The stop beats stock: once GoBolt's count lands, a stopped product
 *    stays stopped.
 *  - The opening beats Flow, like the tick, but not a manual 'all'.
 *  - Each list reaches only the market it names.
 *  - A product with neither list behaves exactly as before.
 *
 *   npm i --no-save liquidjs && node docs/spikes/stop-selling.mjs
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
/* The admin writes on the VARIANT, so the lists live there; the product
   level carries Flow's list, as it does in the store. */
const variant = ({ open = null, stop = null } = {}) => ({
  id: 1,
  metafields: { custom: { sell_regardless_warehouses: mf(open), stop_selling_warehouses: mf(stop) } },
  available: false,
})
const product = ({ auto = null, manual = null, v }) => ({
  metafields: { custom: { oos_warehouses: mf(auto), oos_warehouses_manual: mf(manual) } },
  variants: [v],
  available: false,
})
const routeOf = (market) => ({ root_url: market === 'main' ? '/' : `/en-${market}` })
const nameOf = { ca: 'gobolt yyz5', us: 'us 3pl', gb: 'uk 3pl' }

/* ---------- 1. the stock pill, product-scoped and variant-scoped ---------- */
async function pill(c, scoped) {
  const v = variant(c)
  const out = await engine.parseAndRender(read('snippets/stock-state.liquid'), {
    product: product({ auto: c.auto, manual: c.manual, v }),
    variant: scoped ? v : null,
    settings: { warehouses: WAREHOUSES(c.tick) },
    routes: routeOf(c.market),
  })
  return out.trim() === '' // true = on sale
}

/* ---------- 2. the variant check (cart cross-sell, server side) ---------- */
async function variantCheck(c) {
  const v = variant(c)
  const out = await engine.parseAndRender(
    "{%- render 'warehouse-variant-available', variant: v, parent: p, current_wh: cw, wh_open: wo -%}",
    { v, p: product({ auto: c.auto, manual: c.manual, v }), cw: nameOf[c.market], wo: c.tick && c.market === 'ca' },
  )
  return out.trim() === 'true'
}

/* ---------- 3. the buy buttons (window.warehouseAvailability) ---------- */
const src = read('sections/main-product.liquid')
const fn = /window\.warehouseAvailability = function[\s\S]*?\n  \};/.exec(src)
if (!fn) faults.push('could not find window.warehouseAvailability in main-product.liquid')
function buttons(c) {
  const w = {
    currentWarehouse: nameOf[c.market],
    openWarehouses: c.tick ? { 'gobolt yyz5': true } : {},
    productOOSWarehouses: c.auto,
    productOOSManual: c.manual,
    variantOOSWarehouses: { 1: null },
    variantOOSManual: { 1: null },
    productOpenAt: null,
    productStopAt: null,
    variantOpenAt: { 1: c.open },
    variantStopAt: { 1: c.stop },
  }
  const body = fn[0].replace(/window\./g, 'w.')
  const got = new Function('w', `${body.replace('w.warehouseAvailability = function', 'const f = function')}; return f(1)`)(w)
  return got === null ? false : got // native says out in every case here
}

const FLOW_CA = ['gobolt yyz5'] // what Flow writes while Canada reads zero
const cases = [
  { market: 'ca', tick: true, auto: FLOW_CA, want: true, why: 'Canada with the tick and no stop: on sale, as today' },
  { market: 'ca', tick: true, auto: FLOW_CA, stop: ['GoBolt YYZ5'], want: false, why: "Canada with the tick: the admin's stop closes it — the White V at 14" },
  { market: 'ca', tick: false, auto: FLOW_CA, open: ['GoBolt YYZ5'], want: true, why: 'Canada without the tick: the product opens on its own' },
  { market: 'ca', tick: false, auto: FLOW_CA, open: ['GoBolt YYZ5'], stop: ['GoBolt YYZ5'], want: false, why: 'the stop beats the product opening' },
  { market: 'ca', tick: false, auto: null, stop: ['GoBolt YYZ5'], want: false, why: "GoBolt's stock has landed (Flow says in): the stop still holds, so shops' units stay theirs" },
  { market: 'ca', tick: false, auto: FLOW_CA, manual: ['all'], open: ['GoBolt YYZ5'], want: false, why: "a manual 'all' outranks the product opening" },
  { market: 'us', tick: false, auto: ['us 3pl'], open: ['GoBolt YYZ5'], want: false, why: "Canada's opening does not open the US" },
  { market: 'us', tick: false, auto: FLOW_CA, stop: ['GoBolt YYZ5'], want: true, why: "Canada's stop does not close the US" },
  { market: 'us', tick: false, auto: ['us 3pl'], open: ['US 3PL'], want: true, why: 'one product open in the US (ruling 175a) now reaches the shop' },
  { market: 'ca', tick: false, auto: FLOW_CA, want: false, why: 'neither list, no tick: exactly as before' },
]

for (const c of cases) {
  const results = {
    'pill (product)': await pill(c, false),
    'pill (variant)': await pill(c, true),
    'variant check': await variantCheck(c),
    'buy buttons': buttons(c),
  }
  const wrong = Object.entries(results).filter(([, got]) => got !== c.want)
  if (wrong.length) {
    for (const [path, got] of wrong) {
      faults.push(`${path}: ${c.why} — it says ${got ? 'on sale' : 'sold out'}, wanted ${c.want ? 'on sale' : 'sold out'}`)
    }
  } else ok(`${c.why} (all four paths)`)
}

if (faults.length) {
  console.error('\nstop selling:\n  - ' + faults.join('\n  - '))
  process.exit(1)
}
console.log("\nstop selling: a product sells in a market up to the admin's stock, and only there")
