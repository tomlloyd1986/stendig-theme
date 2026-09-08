/**
 * Runs the REAL market stamp — the block between the st-market-stamp markers
 * in layout/theme.liquid — against a scripted DOM and a scripted cart.
 *
 * ESM resolves packages from the file's own directory, so jsdom has to be
 * reachable from here:
 *   cd docs/spikes && npm i jsdom && node market-stamp.mjs
 *
 * jsdom is not a browser and this is not the live store, so what it proves is
 * the LOGIC — which market a URL resolves to, which fields land on a product
 * form, what the cart write carries and when it is made. What it cannot prove
 * is the thing the whole change rests on: that Shopify carries a hidden line
 * item property through an express checkout. That is Shopify's behaviour, the
 * same behaviour the Delivery Date property on the product form already
 * depends on, and it is checked by placing one Buy it now order.
 */
import { JSDOM, VirtualConsole } from 'jsdom'
import { readFileSync } from 'node:fs'

/* Clicking a real submit button asks jsdom for requestSubmit(), which it does
   not implement. The fixture stays faithful to the theme's own markup and the
   complaint is dropped instead. */
const quiet = () => new VirtualConsole().forwardTo(console, { jsdomErrors: 'none' })

const theme = readFileSync(new URL('../../layout/theme.liquid', import.meta.url), 'utf8')
const start = theme.indexOf('/* st-market-stamp-start */')
const end = theme.indexOf('/* st-market-stamp-end */')
if (start < 0 || end < 0) throw new Error('markers not found')
const block = theme.slice(start, end)

// The shared resolver the stamp — and all three signup forms — call. It is
// rendered in the head, so it runs before the block does.
const snippet = readFileSync(new URL('../../snippets/market-context.liquid', import.meta.url), 'utf8')
const resolver = snippet.slice(snippet.indexOf('<script>') + 8, snippet.indexOf('</script>'))

// The two Liquid outputs the resolver reads. Everything else is plain JS.
const script = (rootUrl, isoCode) =>
  (resolver + '\n' + block)
    .replace('{{ routes.root_url | json }}', JSON.stringify(rootUrl))
    .replace("{{ localization.language.iso_code | downcase | split: '-' | first | json }}", JSON.stringify(isoCode))

const PAGE = `<!doctype html><html><body>
  <form action="/cart/add" method="post" id="pf">
    <input type="hidden" name="id" value="1">
    <input type="hidden" name="properties[Delivery Date]" value="">
    <button type="submit" name="add">Add to cart</button>
    <button class="ctm-buy-btn">Buy it now</button>
  </form>
  <div id="later"></div>
</body></html>`

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — ' + extra}`)
  if (!ok) failed++
}

const tick = () => new Promise((r) => setTimeout(r, 0))

/**
 * @param rootUrl   what Liquid renders for routes.root_url
 * @param iso       localization.language.iso_code, already lowercased/split
 * @param url       the URL the visitor is actually on
 * @param cart      the cart /cart.js answers with
 */
async function run({ rootUrl = '/', iso = 'en', url = 'https://stendigcalendars.com/products/v-calendar', cart = { item_count: 0, attributes: {} } } = {}) {
  const dom = new JSDOM(PAGE, { url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: quiet() })
  const { window } = dom
  const writes = []
  window.fetch = (href, init) => {
    if (String(href).indexOf('/cart/update.js') === 0) {
      writes.push(JSON.parse(init.body))
      return Promise.resolve({ json: () => Promise.resolve({}) })
    }
    return Promise.resolve({ json: () => Promise.resolve(cart) })
  }
  window.eval(script(rootUrl, iso))
  await tick()
  const props = () => {
    const out = {}
    for (const el of window.document.querySelectorAll('#pf input[name^="properties["]')) {
      out[el.name.slice('properties['.length, -1)] = el.value
    }
    return out
  }
  return { window, props, writes }
}

// 1. A subfolder market: the path, the market and the language all land.
{
  const { props, writes } = await run({
    rootUrl: '/en-de',
    iso: 'en',
    url: 'https://stendigcalendars.com/en-de/products/v-calendar',
    cart: { item_count: 1, attributes: {} },
  })
  const p = props()
  check('a subfolder market stamps the form', p._st_path === '/en-de' && p._st_market === 'de' && p._st_lang === 'en', JSON.stringify(p))
  check('the cart write carries the same three', JSON.stringify(writes[0]) === JSON.stringify({ attributes: { _st_path: '/en-de', _st_market: 'de', _st_lang: 'en' } }), JSON.stringify(writes))
  check("the form's own properties are left alone", 'Delivery Date' in p, JSON.stringify(p))
}

// 2. A language that is not the country: /fr-ch is French, in Switzerland.
{
  const { props } = await run({ rootUrl: '/fr-ch', iso: 'fr', url: 'https://stendigcalendars.com/fr-ch/products/v-calendar' })
  const p = props()
  check('/fr-ch is the ch market in French', p._st_market === 'ch' && p._st_lang === 'fr', JSON.stringify(p))
}

// 3. The primary market. Its path is '' by design, and Shopify drops an empty
//    property — so no _st_path input is written at all, and the MARKET is what
//    says a primary-market order is stamped rather than bare.
{
  const { props, writes } = await run({ rootUrl: '/', iso: 'en', cart: { item_count: 1, attributes: {} } })
  const p = props()
  check('the primary market writes no path input', !('_st_path' in p), JSON.stringify(p))
  check('…but still says which market and which language', p._st_market === 'primary' && p._st_lang === 'en', JSON.stringify(p))
  check("the cart write still sends the empty path Shopify drops", writes[0].attributes._st_path === '' && writes[0].attributes._st_market === 'primary', JSON.stringify(writes))
}

// 4. The URL beats a root_url that has lost the prefix. This is the whole
//    reason the resolution is done in the browser and not in Liquid.
{
  const { props } = await run({ rootUrl: '/', iso: 'en', url: 'https://stendigcalendars.com/en-au/products/v-calendar' })
  const p = props()
  check('a prefix in the URL wins over a bare root_url', p._st_path === '/en-au' && p._st_market === 'au', JSON.stringify(p))
}

// 5. A form mounted later — quick add, a re-rendered section, a page builder —
//    is stamped when it arrives.
{
  const { window, props } = await run({ rootUrl: '/en-kr', iso: 'ko', url: 'https://stendigcalendars.com/en-kr/products/v-calendar' })
  window.document.getElementById('later').innerHTML =
    '<div><form action="/en-kr/cart/add" method="post" id="late"><input type="hidden" name="id" value="2"></form></div>'
  await tick()
  const late = {}
  for (const el of window.document.querySelectorAll('#late input[name^="properties["]')) {
    late[el.name.slice('properties['.length, -1)] = el.value
  }
  check('a form added after load is stamped too', late._st_path === '/en-kr' && late._st_market === 'kr' && late._st_lang === 'en', JSON.stringify(late))
  check('the form already there is unchanged', props()._st_market === 'kr', JSON.stringify(props()))
}

// 6. An empty cart takes no attributes — Shopify would not keep them — and a
//    cart already carrying the right ones is not written to again.
{
  const empty = await run({ rootUrl: '/en-de', iso: 'en', url: 'https://stendigcalendars.com/en-de/', cart: { item_count: 0, attributes: {} } })
  check('an empty cart is not written to', empty.writes.length === 0, JSON.stringify(empty.writes))
  const fresh = await run({
    rootUrl: '/en-de',
    iso: 'en',
    url: 'https://stendigcalendars.com/en-de/',
    cart: { item_count: 1, attributes: { _st_path: '/en-de', _st_market: 'de', _st_lang: 'en' } },
  })
  check('a cart already stamped is left alone', fresh.writes.length === 0, JSON.stringify(fresh.writes))
}

// 7. The retry ladder. A click on add-to-cart looks again three times, so an
//    add slower than the old single 800ms guess is still caught — and the
//    look that lands mid-flight is not thrown away.
{
  const dom = new JSDOM(PAGE, { url: 'https://stendigcalendars.com/en-de/products/v-calendar', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: quiet() })
  const { window } = dom
  const writes = []
  let items = 0
  let inflight = 0
  let overlapped = false
  window.fetch = (href, init) => {
    if (String(href).indexOf('/cart/update.js') === 0) {
      writes.push(JSON.parse(init.body))
      return Promise.resolve({ json: () => Promise.resolve({}) })
    }
    if (inflight > 0) overlapped = true
    inflight++
    // The add lands only after the first look — the case that used to lose it.
    return new Promise((resolve) =>
      setTimeout(() => {
        inflight--
        resolve({ json: () => Promise.resolve({ item_count: items, attributes: {} }) })
      }, 60),
    )
  }
  window.eval(script('/en-de', 'en'))
  window.document.querySelector('[name="add"]').click()
  items = 1
  await new Promise((r) => setTimeout(r, 3000))
  check('a slow add is still caught by a later rung', writes.length > 0, `${writes.length} writes`)
  check('the write carries the market', writes.length > 0 && writes[0].attributes._st_market === 'de', JSON.stringify(writes[0]))
  check('two reads never overlap', !overlapped)
}

// 8. The failure the signup forms used to have, and the one this snippet
//    exists to stop: routes.root_url renders as '/' on a market subfolder.
//    The three forms read that value ALONE, so a Berlin shopper on /en-de
//    filed as market 'primary' with no path — indistinguishable on the
//    contact from somebody who really was on the international site.
{
  const { window, props } = await run({
    rootUrl: '/',                                            // the value that lied
    iso: 'en',
    url: 'https://stendigcalendars.com/en-de/products/v-calendar',
  })
  const p = props()
  check('a lying root_url does not become the primary market', p._st_market === 'de' && p._st_path === '/en-de', JSON.stringify(p))
  const ctx = window.STMarket()
  check('the resolver every signup form now calls says the same', ctx.market === 'de' && ctx.path === '/en-de' && ctx.language === 'en', JSON.stringify(ctx))
}

// 9. …and the bare domain still resolves to primary, because sometimes
//    'primary' is simply the truth: an international shopper in English.
{
  const { window } = await run({ rootUrl: '/', iso: 'en', url: 'https://stendigcalendars.com/products/v-calendar' })
  const ctx = window.STMarket()
  check('the bare domain is still primary, in English, with no path', ctx.market === 'primary' && ctx.language === 'en' && ctx.path === '', JSON.stringify(ctx))
}

// 10. The language does NOT come from routes.root_url, so it is the one field
//     that stays true when that value fails — which is what says a contact
//     logged 'en' was on an ENGLISH page, never on /de-de.
{
  const { window } = await run({ rootUrl: '/', iso: 'de', url: 'https://stendigcalendars.com/de-de/products/v-calendar' })
  const ctx = window.STMarket()
  check('a German-language page says de however root_url renders', ctx.language === 'de' && ctx.market === 'de', JSON.stringify(ctx))
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass')
process.exit(failed ? 1 : 0)
