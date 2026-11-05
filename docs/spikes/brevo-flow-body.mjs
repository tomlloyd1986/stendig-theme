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

// 4b. The basket and the line name different MARKETS. The basket is the last
//     store page seen; the line is where the item was added. Where the
//     parcel goes settles it — ST39298, 5 Nov 2026.
{
  const st39298 = await sent({
    email: 'h@x.co.uk',
    shippingAddress: { countryCodeV2: 'US' },
    customAttributes: stamped('/en-hk', 'hk', 'en'),
    lineItems: [{ customAttributes: stamped('/en-us', 'us', 'en') }],
  })
  check('ST39298: added on /en-us, last seen /en-hk, shipped to the US → us',
    st39298.market === 'us' && st39298.path === '/en-us' && st39298.lang === 'en', JSON.stringify(st39298.json))

  const twoLines = await sent({
    email: 'h@x.co.uk',
    shippingAddress: { countryCodeV2: 'US' },
    customAttributes: stamped('/en-hk', 'hk', 'en'),
    lineItems: [{ customAttributes: stamped('/en-gb', 'gb', 'en') }, { customAttributes: stamped('/en-us', 'us', 'en') }],
  })
  check('the line that matches the parcel answers, not the last line', twoLines.market === 'us' && twoLines.path === '/en-us', JSON.stringify(twoLines.json))

  const neither = await sent({
    email: 'h@x.co.uk',
    shippingAddress: { countryCodeV2: 'FR' },
    customAttributes: stamped('/en-hk', 'hk', 'en'),
    lineItems: [{ customAttributes: stamped('/en-us', 'us', 'en') }],
  })
  check('where no line matches the parcel, the basket still wins', neither.market === 'hk' && neither.path === '/en-hk', JSON.stringify(neither.json))

  const austria = await sent({
    email: 'h@x.co.uk',
    shippingAddress: { countryCodeV2: 'AT' },
    customAttributes: stamped('/de-de', 'de', 'de'),
    lineItems: [{ customAttributes: stamped('/en-us', 'us', 'en') }],
  })
  check('a market of several countries keeps the basket', austria.market === 'de' && austria.lang === 'de', JSON.stringify(austria.json))

  const sameMarket = await sent({
    email: 'h@x.co.uk',
    shippingAddress: { countryCodeV2: 'CH' },
    customAttributes: stamped('/fr-ch', 'ch', 'fr'),
    lineItems: [{ customAttributes: stamped('/en-ch', 'ch', 'en') }],
  })
  check('a language change in one market still follows the basket', sameMarket.lang === 'fr' && sameMarket.path === '/fr-ch', JSON.stringify(sameMarket.json))

  const pickup = await sent({
    email: 'h@x.co.uk',
    shippingAddress: null,
    customAttributes: stamped('/en-hk', 'hk', 'en'),
    lineItems: [{ customAttributes: stamped('/en-us', 'us', 'en') }],
  })
  check('no shipping address keeps the basket', pickup.market === 'hk', JSON.stringify(pickup.json))

  const express = await sent({
    email: 'h@x.co.uk',
    shippingAddress: { countryCodeV2: 'GB' },
    customAttributes: [],
    lineItems: [{ customAttributes: stamped('/en-gb', 'gb', 'en') }],
  })
  check('an express order shipped home is unchanged', express.market === 'gb' && express.path === '/en-gb', JSON.stringify(express.json))
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
