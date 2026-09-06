/**
 * Renders the cart drawer's REAL rule-selection region (extracted between its
 * xsell-rule markers) in liquidjs, against scripted rules and carts.
 *
 * Run from anywhere with liquidjs on the path:
 *   mkdir /tmp/spike && cd /tmp/spike && npm i liquidjs && node <this file>
 *
 * liquidjs is not Shopify Liquid, so the one `render` in the region — the
 * per-variant warehouse check — is swapped for the variant's own flag; what
 * this proves is the SELECTION: where the rules come from, what order they are
 * tried in, and which conditions drop one.
 */
import { Liquid } from 'liquidjs'
import { readFileSync } from 'node:fs'

const snippet = readFileSync(
  new URL('../../snippets/cart-notification-content.liquid', import.meta.url),
  'utf8',
)
const start = snippet.indexOf('{%- comment -%} xsell-rule-start')
const end = snippet.indexOf('{%- comment -%} xsell-rule-end')
if (start < 0 || end < 0) throw new Error('markers not found')

const tpl = snippet
  .slice(start, end)
  // The warehouse check is a partial of its own and not under test here.
  .replace(/render 'warehouse-variant-available'[^\n]*/g, 'echo variant.available')
  // Report the outcome, since the region itself only assigns.
  .concat('{{ cs_source }}|{% if cs_rule %}{{ cs_rule.system.handle }}{% else %}none{% endif %}')

const engine = new Liquid()

const product = (id, handle, variants = [{ id: id * 10, available: true }]) => ({
  id,
  handle,
  variants,
})

const RULES = {
  strips: product(1, 'hanging-strips'),
  stendig: product(2, 'stendig-calendar'),
  v: product(3, 'v-calendar'),
}

const rule = (handle, over = {}) => ({
  system: { handle },
  suggested_product: { value: RULES.stendig },
  cart_contains: { value: [] },
  cart_not_contains: { value: [] },
  domains: { value: [] },
  ...over,
})

const run = (over = {}) =>
  engine.parseAndRender(tpl, {
    cart: { items: [{ product_id: 3 }] }, // a V Calendar in the basket
    settings: { cross_sell_rules: [], warehouses: [] },
    metaobjects: { cross_sell_rule: { values: [] } },
    request: { host: 'stendigcalendars.com' },
    routes: { root_url: '/' },
    ...over,
  })

const withRules = (values, over = {}) =>
  run({ metaobjects: { cross_sell_rule: { values } }, ...over })

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — ' + extra}`)
  if (!ok) failed++
}

// 1. THE POINT OF THE CHANGE: a rule nobody added to the theme setting works.
{
  const out = await withRules([rule('get-20-when-you-combine')])
  check('a rule that is only a metaobject is used', out === 'metaobjects|get-20-when-you-combine', out)
}

// 2. The setting is the fallback, for a definition with no storefront access.
{
  const out = await run({ settings: { cross_sell_rules: [rule('from-the-setting')], warehouses: [] } })
  check('with no metaobjects the setting still answers', out === 'setting|from-the-setting', out)
}

// 3. Priority orders, whatever order the list arrives in.
{
  const out = await withRules([
    rule('second', { priority: { value: 2 } }),
    rule('first', { priority: { value: 1 } }),
  ])
  check('priority 1 beats priority 2', out === 'metaobjects|first', out)
}

// 4. Unranked rules come after ranked ones.
{
  const out = await withRules([rule('unranked'), rule('ranked', { priority: { value: 3 } })])
  check('a ranked rule beats an unranked one', out === 'metaobjects|ranked', out)
}

// 5. First MATCHING rule wins — a higher rule that cannot match is skipped,
//    rather than blocking the one that can.
{
  const out = await withRules([
    rule('needs-strips', { priority: { value: 1 }, cart_contains: { value: [RULES.strips] } }),
    rule('needs-v', { priority: { value: 2 }, cart_contains: { value: [RULES.v] } }),
  ])
  check('a rule that cannot match does not block the one that can', out === 'metaobjects|needs-v', out)
}

// 6. The conditions each still drop a rule.
{
  const inCart = await withRules([rule('already-there', { suggested_product: { value: RULES.v } })])
  check('never suggests what is already in the cart', inCart === 'metaobjects|none', inCart)

  const clash = await withRules([rule('clash', { cart_not_contains: { value: [RULES.v] } })])
  check('cart_not_contains drops the rule', clash === 'metaobjects|none', clash)

  const wants = await withRules([rule('wants', { cart_contains: { value: [RULES.strips] } })])
  check('cart_contains drops a basket without it', wants === 'metaobjects|none', wants)

  const elsewhere = await withRules([rule('elsewhere', { domains: { value: ['kr'] } })])
  check('domains drops another market', elsewhere === 'metaobjects|none', elsewhere)

  const oos = await withRules([
    rule('oos', { suggested_product: { value: product(2, 'stendig-calendar', [{ id: 20, available: false }]) } }),
  ])
  check('nothing purchasable drops the rule', oos === 'metaobjects|none', oos)

  /* An empty cart. Shopify's `cart != empty` is a Drop's own answer, which
     liquidjs has no equivalent for — `{ items: [] }` is a non-empty object to
     it — so the empty cart is modelled as the empty object liquidjs DOES call
     empty. What is under test is that the guard is there and wraps the walk,
     not Shopify's spelling of emptiness. */
  const empty = await withRules([rule('any')], { cart: {} })
  check('an empty cart suggests nothing', empty === 'metaobjects|none', empty)
}

// 7. An entry with no suggested product is skipped rather than crashing.
{
  const out = await withRules([
    rule('half-made', { priority: { value: 1 }, suggested_product: { value: null } }),
    rule('finished', { priority: { value: 2 } }),
  ])
  check('a half-made rule is stepped over', out === 'metaobjects|finished', out)
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass')
process.exit(failed ? 1 : 0)
