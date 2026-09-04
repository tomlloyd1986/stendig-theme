/**
 * Renders the Shopify Flow request body OUT OF THE DOC — the ```liquid block
 * under "The whole body, after the insert" in docs/brevo-order-markers.md,
 * which is the text the live Flow action holds — against every shape of order
 * the store produces.
 *
 * The doc is the source, so the pin cannot drift away from what is running.
 *
 * ESM resolves packages from the file's own directory, so liquidjs has to be
 * reachable from here:
 *   cd docs/spikes && npm i liquidjs && node brevo-flow-body.mjs
 *
 * liquidjs is not Shopify Liquid and Flow is not either of them; what this
 * proves is that every branch renders valid JSON carrying the right values —
 * above all that adding the line-item fallback changes ONLY the express
 * checkouts and leaves every other order exactly as it was.
 */
import { Liquid } from 'liquidjs'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../brevo-order-markers.md', import.meta.url), 'utf8')
const heading = doc.indexOf('### The whole body, after the insert')
if (heading < 0) throw new Error('the whole-body section is not in the doc')
const open = doc.indexOf('```liquid', heading)
const close = doc.indexOf('```', open + 9)
if (open < 0 || close < 0) throw new Error('the liquid block is not in the doc')
const tpl = doc.slice(open + '```liquid'.length, close)

const engine = new Liquid()
// Shopify's own filter, which Flow has and liquidjs does not. nil renders as
// `null` exactly as Shopify's does — the one weakness the doc writes down.
engine.registerFilter('json', (v) => JSON.stringify(v === undefined || v === null ? null : v))

const attr = (key, value) => ({ key, value })
const stamped = (path, market, lang) =>
  path
    ? [attr('_st_path', path), attr('_st_market', market), attr('_st_lang', lang)]
    : [attr('_st_market', market), attr('_st_lang', lang)]

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — ' + extra}`)
  if (!ok) failed++
}

async function sent(order) {
  const out = (await engine.parseAndRender(tpl, { order })).trim()
  const json = JSON.parse(out)
  const a = json.attributes || {}
  return { json, market: a.MARKET, lang: a.LANGUAGE, path: a.PATH, silent: a.MARKET === undefined }
}

// 1. Through the cart. The case that already worked, which the insert must
//    leave alone — it is every order the shop has been getting right.
{
  const de = await sent({
    email: 'h@x.co.uk',
    customAttributes: stamped('/en-de', 'de', 'en'),
    lineItems: [{ customAttributes: stamped('/en-de', 'de', 'en') }],
  })
  check('a cart order still carries all three', de.market === 'de' && de.lang === 'en' && de.path === '/en-de', JSON.stringify(de.json))

  const home = await sent({
    email: 'h@x.co.uk',
    customAttributes: stamped('', 'primary', 'en'),
    lineItems: [{ customAttributes: [] }],
  })
  check('a cart order on the bare domain is unchanged', home.market === 'primary' && home.path === '', JSON.stringify(home.json))
}

// 2. An express checkout: nothing on the basket, everything on the line. The
//    case the whole change exists for, and the one that sent nothing before.
{
  const de = await sent({
    email: 'h@x.co.uk',
    customAttributes: [],
    lineItems: [{ customAttributes: stamped('/en-de', 'de', 'en') }],
  })
  check('an express order is read off the line', de.market === 'de' && de.path === '/en-de', JSON.stringify(de.json))

  const home = await sent({
    email: 'h@x.co.uk',
    customAttributes: [],
    lineItems: [{ customAttributes: stamped('', 'primary', 'en') }],
  })
  check('an express order on the bare domain says primary, path empty', home.market === 'primary' && home.path === '', JSON.stringify(home.json))
}

// 3. A line the drawer's cross-sell added carries nothing — it posts straight
//    to the cart rather than through a product form. Another line answers.
{
  const kr = await sent({
    email: 'h@x.co.uk',
    customAttributes: [],
    lineItems: [{ customAttributes: [] }, { customAttributes: stamped('/en-kr', 'kr', 'en') }],
  })
  check('a bare line does not stop the next one answering', kr.market === 'kr', JSON.stringify(kr.json))
}

// 4. The basket wins where the two disagree — somebody changed language
//    mid-visit, and checkout is what they meant.
{
  const ch = await sent({
    email: 'h@x.co.uk',
    customAttributes: stamped('/fr-ch', 'ch', 'fr'),
    lineItems: [{ customAttributes: stamped('/en-ch', 'ch', 'en') }],
  })
  check('the basket is what checkout said', ch.lang === 'fr' && ch.path === '/fr-ch', JSON.stringify(ch.json))
}

// 5. An order carrying nothing at all — a POS sale, a draft order, a basket
//    built before this shipped. It must send an EMPTY attributes object:
//    values would wipe the markers a signup put on the contact months ago.
{
  const bare = await sent({ email: 'h@x.co.uk', customAttributes: [], lineItems: [{ customAttributes: [] }] })
  check('an unstamped order blanks nothing', bare.silent && Object.keys(bare.json.attributes).length === 0, JSON.stringify(bare.json))
  check('…and still names the contact', bare.json.email === 'h@x.co.uk' && bare.json.updateEnabled === true, JSON.stringify(bare.json))
}

// 6. An email with quotes in it is the one field a stranger supplies, and the
//    json filter is what keeps the body parseable.
{
  const odd = await sent({
    email: '"quoted"@x.co.uk',
    customAttributes: stamped('/en-de', 'de', 'en'),
    lineItems: [],
  })
  check('an email with quotes in it still parses', odd.json.email === '"quoted"@x.co.uk', JSON.stringify(odd.json))
}

// 7. The weakness the doc writes down rather than fixes: an order with no
//    email renders null, and Brevo refuses it. Pinned so it stays KNOWN — if
//    this ever starts passing, the fallback went in and the doc should say so.
{
  const none = await sent({
    email: null,
    customer: { email: 'h@x.co.uk' },
    customAttributes: stamped('/en-de', 'de', 'en'),
    lineItems: [],
  })
  check('an order with no email still sends null — known, and guarded by the condition', none.json.email === null, JSON.stringify(none.json))
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass')
process.exit(failed ? 1 : 0)
