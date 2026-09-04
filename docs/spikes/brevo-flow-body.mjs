/**
 * Renders the Shopify Flow request body OUT OF THE DOC — the ```liquid block
 * in docs/brevo-order-markers.md, which is the text that gets pasted into the
 * Flow action — against every shape of order the store produces.
 *
 * The doc is the source, so the pin cannot drift away from what is actually
 * pasted in.
 *
 * ESM resolves packages from the file's own directory, so liquidjs has to be
 * reachable from here:
 *   cd docs/spikes && npm i liquidjs && node brevo-flow-body.mjs
 *
 * liquidjs is not Shopify Liquid and Flow is not either of them; what this
 * proves is that every branch renders valid JSON carrying the right values —
 * in particular that an order carrying nothing sends no attributes at all
 * rather than blanking the ones the contact already has.
 */
import { Liquid } from 'liquidjs'
import { readFileSync } from 'node:fs'

const doc = readFileSync(new URL('../brevo-order-markers.md', import.meta.url), 'utf8')
const open = doc.indexOf('```liquid')
const close = doc.indexOf('```', open + 9)
if (open < 0 || close < 0) throw new Error('the liquid block is not in the doc')
const tpl = doc.slice(open + '```liquid'.length, close)

const engine = new Liquid()
// Shopify's own filter, which Flow has and liquidjs does not.
engine.registerFilter('json', (v) => JSON.stringify(v === undefined || v === null ? '' : v))

const attr = (key, value) => ({ key, value })
const stamped = (path, market, lang) =>
  path ? [attr('_st_path', path), attr('_st_market', market), attr('_st_lang', lang)]
       : [attr('_st_market', market), attr('_st_lang', lang)]

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — ' + extra}`)
  if (!ok) failed++
}

async function body(order) {
  const out = (await engine.parseAndRender(tpl, { order })).trim()
  return { out, json: JSON.parse(out) }
}

// 1. Through the cart, on a subfolder market. The ordinary case, unchanged.
{
  const { json } = await body({
    email: 'h@x.co.uk',
    customAttributes: stamped('/en-de', 'de', 'en'),
    lineItems: [{ customAttributes: stamped('/en-de', 'de', 'en') }],
  })
  check('a cart order carries all three', JSON.stringify(json.attributes) === JSON.stringify({ MARKET: 'de', LANGUAGE: 'en', PATH: '/en-de' }), JSON.stringify(json))
}

// 2. An express checkout: nothing on the basket, everything on the line. The
//    case the whole change exists for.
{
  const { json } = await body({
    email: 'h@x.co.uk',
    customAttributes: [],
    lineItems: [{ customAttributes: stamped('/en-de', 'de', 'en') }],
  })
  check('an express order is read off the line', json.attributes && json.attributes.MARKET === 'de' && json.attributes.PATH === '/en-de', JSON.stringify(json))
}

// 3. The primary market, either way in: no path anywhere, and an empty PATH is
//    the right answer rather than a missing one.
{
  const cart = await body({ email: 'h@x.co.uk', customAttributes: stamped('', 'primary', 'en'), lineItems: [{ customAttributes: [] }] })
  const express = await body({ email: 'h@x.co.uk', customAttributes: [], lineItems: [{ customAttributes: stamped('', 'primary', 'en') }] })
  check('the primary market sends an empty path, not a missing one', cart.json.attributes.PATH === '' && cart.json.attributes.MARKET === 'primary', JSON.stringify(cart.json))
  check('…by either route', express.json.attributes.PATH === '' && express.json.attributes.MARKET === 'primary', JSON.stringify(express.json))
}

// 4. The basket wins where the two disagree — somebody who changed language
//    mid-visit checked out on the second one.
{
  const { json } = await body({
    email: 'h@x.co.uk',
    customAttributes: stamped('/fr-ch', 'ch', 'fr'),
    lineItems: [{ customAttributes: stamped('/en-ch', 'ch', 'en') }],
  })
  check('the basket is what checkout said', json.attributes.LANGUAGE === 'fr' && json.attributes.PATH === '/fr-ch', JSON.stringify(json))
}

// 5. A line the drawer's cross-sell added carries nothing — it posts straight
//    to the cart rather than through a product form. Another line answers.
{
  const { json } = await body({
    email: 'h@x.co.uk',
    customAttributes: [],
    lineItems: [{ customAttributes: [] }, { customAttributes: stamped('/en-kr', 'kr', 'en') }],
  })
  check('a bare line does not stop the next one answering', json.attributes.MARKET === 'kr', JSON.stringify(json))
}

// 6. An order carrying nothing at all — a POS sale, a draft order, a basket
//    built before this shipped. It must send NO attributes: empty strings
//    would wipe the markers a signup put on the contact months ago.
{
  const { json } = await body({ email: 'h@x.co.uk', customAttributes: [], lineItems: [{ customAttributes: [] }] })
  check('an unstamped order blanks nothing', !('attributes' in json), JSON.stringify(json))
  check('…and still names the contact', json.email === 'h@x.co.uk' && json.updateEnabled === true, JSON.stringify(json))
}

// 7. The email falls back to the customer's, and is JSON-escaped — the one
//    field on this request a stranger supplies.
{
  const { json } = await body({
    email: '',
    customer: { email: 'h@x.co.uk' },
    customAttributes: stamped('/en-de', 'de', 'en'),
    lineItems: [],
  })
  check("an order with no email uses the customer's", json.email === 'h@x.co.uk', JSON.stringify(json))
  const odd = await body({
    email: '"quoted"@x.co.uk',
    customAttributes: stamped('/en-de', 'de', 'en'),
    lineItems: [],
  })
  check('an email with quotes in it still parses', odd.json.email === '"quoted"@x.co.uk', odd.out)
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass')
process.exit(failed ? 1 : 0)
