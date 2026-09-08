/**
 * Renders the section's REAL admin-path region (extracted between its
 * stp-admin markers) in liquidjs, against scripted metaobject entries.
 *
 * Run from anywhere with liquidjs on the path:
 *   mkdir /tmp/spike && cd /tmp/spike && npm i liquidjs && NODE_PATH=$PWD/node_modules node <this file>
 *
 * liquidjs is not Shopify Liquid, so Shopify-only tags and filters are
 * stubbed; what this proves is the logic — rank walk, market filter, live
 * window, per-field copy fallback, arm grouping — not Shopify's runtime.
 */
import { Liquid } from 'liquidjs'
import { readFileSync } from 'node:fs'

const section = readFileSync(new URL('../../sections/popup-signup.liquid', import.meta.url), 'utf8')
const start = section.indexOf('{%- comment -%} stp-admin-start')
const endMark = 'stp-admin-end {%- endcomment -%}'
const end = section.indexOf(endMark) + endMark.length
if (start < 0 || end < endMark.length) throw new Error('markers not found')
// Shopify's own {% form %} tag is not under test — render its body bare.
const tpl = section
  .slice(start, end)
  .replace(/\{%-?\s*form[^%]*%\}/g, '')
  .replace(/\{%-?\s*endform\s*-?%\}/g, '')

const engine = new Liquid()
engine.registerFilter('handleize', (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
engine.registerFilter('t', (v) => v)

const entry = (over) => ({
  campaign: { value: 'out-of-stock' },
  name: { value: 'Out of stock' },
  rank: { value: 1 },
  arm: { value: 'A' },
  weight: { value: 100 },
  markets: { value: ['au', 'nz'] },
  live_from: { value: '' },
  live_until: { value: '' },
  phone: { value: false },
  code: { value: '' },
  copy: { value: { en: { eyebrow: 'All calendars', heading: 'Sold out', body: 'Be first.', placeholder: 'Email address', buttonLabel: 'Notify me', dismissLabel: 'No thanks', tyHeading: "You're on the list", shopLabel: 'Shop the store' } } },
  ...over,
})

async function render(values, over = {}) {
  const html = await engine.parseAndRender(tpl, {
    section: { settings: { brevo_form_url: 'https://sibforms.example/serve/x', error_text: '', use_admin_popups: true } },
    metaobjects: { popup_version: { values } },
    market_key: 'au',
    // Our name for the visitor's market, which the section resolves from the
    // warehouse serving it. Equal to the token on /en-au; the cases where it
    // is NOT equal are the ones this file exists to pin (Britain, and every
    // country inside the EU market).
    market_code: 'au',
    lang_code: 'en',
    path_prefix: '/en-au',
    request: { path: '/' },
    routes: { all_products_collection_url: '/collections/all' },
    ...over,
  })
  const panels = [...html.matchAll(/data-campaign="([^"]*)"[\s\S]*?data-experiment="([^"]*)"[\s\S]*?data-variant="([^"]*)"[\s\S]*?data-weight="([^"]*)"[\s\S]*?data-delay="([^"]*)"[\s\S]*?data-scroll="([^"]*)"[\s\S]*?data-dismiss-days="([^"]*)"[\s\S]*?data-signup-days="([^"]*)"/g)]
    .map((m) => ({ campaign: m[1], experiment: m[2], variant: m[3], weight: m[4], delay: m[5], scroll: m[6], dismissDays: m[7], signupDays: m[8] }))
  return { html, panels }
}

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' — ' + extra}`)
  if (!ok) failed++
}

// 1. Rank order beats source order.
{
  const { panels } = await render([
    entry({ campaign: { value: 'second' }, name: { value: 'Second' }, rank: { value: 2 } }),
    entry({}),
  ])
  check('rank order beats source order', panels.map((p) => p.campaign).join(',') === 'out-of-stock,second', panels.map((p) => p.campaign).join(','))
}

// 2. A version not naming this market never renders.
{
  const { panels } = await render([entry({ markets: { value: ['us', 'uk'] } })])
  check('market filter drops non-matching versions', panels.length === 0, `${panels.length} panels`)
}

// 2b. Shopify's ISO token is not our market code, and both are accepted.
//
// This is the fault that kept the popup off stendigcalendars.com/en-gb while
// it ran everywhere else: /en-gb resolves to token 'gb', the admin stores
// 'uk', and the raw comparison could never hit. The warehouse serving the
// request is what carries our name for the market, so the section matches on
// either — and on 'all', which is Everywhere said in one word.
{
  const gb = { market_key: 'gb', market_code: 'uk', path_prefix: '/en-gb' }
  const uk = await render([entry({ markets: { value: ['uk'] } })], gb)
  check('a UK version shows on /en-gb, where the token says gb', uk.panels.length === 1, `${uk.panels.length} panels`)

  const everywhere = await render([entry({ markets: { value: ['au', 'ca', 'eu', 'hk', 'jp', 'kr', 'nz', 'sg', 'tw', 'uk', 'us', 'primary'] } })], gb)
  check('an Everywhere version shows on /en-gb', everywhere.panels.length === 1, `${everywhere.panels.length} panels`)

  // A country inside a grouped market: /en-de is served by the EU warehouse.
  const de = { market_key: 'de', market_code: 'eu', path_prefix: '/en-de' }
  const eu = await render([entry({ markets: { value: ['eu'] } })], de)
  check('an EU version shows on /en-de', eu.panels.length === 1, `${eu.panels.length} panels`)

  // Canada has no XX 3PL location, so its warehouse handle does not head 'ca'
  // — the raw token is what carries it, and must keep working.
  const ca = { market_key: 'ca', market_code: 'go', path_prefix: '/en-ca' }
  const canada = await render([entry({ markets: { value: ['ca'] } })], ca)
  check('a CA version shows on /en-ca, whose warehouse is not named for it', canada.panels.length === 1, `${canada.panels.length} panels`)

  // And targeting still TARGETS: a market not named is still dropped.
  const miss = await render([entry({ markets: { value: ['us'] } })], gb)
  check('a US-only version stays off /en-gb', miss.panels.length === 0, `${miss.panels.length} panels`)

  // 'all' covers a market the version was written before.
  const wild = await render([entry({ markets: { value: ['all'] } })], { market_key: 'ph', market_code: '', path_prefix: '/en-ph' })
  check("'all' shows on a market nobody enumerated", wild.panels.length === 1, `${wild.panels.length} panels`)
}

// 3. The live window, in store wall-clock time.
{
  const future = await render([entry({ live_from: { value: '2099-01-01T09:00' } })])
  check('a future start is not live yet', future.panels.length === 0, `${future.panels.length}`)
  const ended = await render([entry({ live_until: { value: '2020-01-01T09:00' } })])
  check('a past end has ended', ended.panels.length === 0, `${ended.panels.length}`)
  const open = await render([entry({ live_from: { value: '2020-01-01T09:00' } })])
  check('an open-ended window is live', open.panels.length === 1, `${open.panels.length}`)
}

// 4. Copy falls back to English PER FIELD.
{
  const ko = entry({
    copy: { value: { en: entry({}).copy.value.en, ko: { heading: '판매 완료' } } },
  })
  const { html } = await render([ko], { lang_code: 'ko' })
  check('a translated field renders its language', html.includes('판매 완료'))
  check('an untranslated field falls back to English', html.includes('Be first.'))
}

// 5. Arms sharing a campaign carry the experiment; a lone arm does not.
{
  const a = entry({ campaign: { value: 'winter' }, name: { value: 'Winter sale' }, arm: { value: 'A' }, weight: { value: 70 } })
  const b = entry({ campaign: { value: 'winter' }, name: { value: 'Winter sale' }, arm: { value: 'B' }, weight: { value: 30 } })
  const { panels } = await render([a, b])
  check('both arms render with the campaign as experiment', panels.length === 2 && panels.every((p) => p.experiment === 'winter'), JSON.stringify(panels))
  check('weights ride the panels', panels.map((p) => p.weight).join(',') === '70,30', panels.map((p) => p.weight).join(','))
  const lone = await render([entry({})])
  check('a lone arm carries no experiment', lone.panels[0].experiment === '', lone.panels[0].experiment)
}

// 6. The Brevo form renders; the escape hatch to the customer form parses.
{
  const { html } = await render([entry({})])
  check('the Brevo form is the submit path', html.includes('data-stp-brevo'))
  const noBrevo = await render([entry({})], { section: { settings: { brevo_form_url: '', error_text: '', use_admin_popups: true } } })
  check('without a Brevo URL the customer form branch renders', noBrevo.html.includes('contact[tags]'))
}

// 7. A version's own rules ride its panel; unset rides as '' for the script
//    to fall through to the store's.
{
  const own = entry({ delay_seconds: { value: '10' }, dismiss_days: { value: '7' } })
  const { panels } = await render([own])
  check('a rule override rides its panel', panels[0].delay === '10' && panels[0].dismissDays === '7', JSON.stringify(panels[0]))
  check("an unset rule rides as ''", panels[0].scroll === '' && panels[0].signupDays === '', JSON.stringify(panels[0]))
}

// 8. The store-wide defaults: section settings, admin store rules over them —
//    the assign block above the root element, rendered on its own.
{
  const top = section.slice(
    section.indexOf('# The behaviour defaults'),
    section.indexOf('# Warehouse serving'),
  )
  if (!top) throw new Error('behaviour-defaults block not found')
  const probe =
    '{% liquid\n' +
    top.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n') +
    '\n%}{{ stp_delay }}|{{ stp_scroll }}|{{ stp_dismiss_days }}|{{ stp_signup_days }}'
  const resolve = (settings, rules) =>
    engine.parseAndRender(probe, {
      section: { settings },
      metaobjects: { popup_settings: rules ? { store: rules } : {} },
    })
  check(
    'section settings alone resolve the defaults',
    (await resolve({ use_admin_popups: true, delay_seconds: 8 }, null)) === '8|50|14|180',
    await resolve({ use_admin_popups: true, delay_seconds: 8 }, null),
  )
  check(
    "the admin's store rules override the section",
    (await resolve(
      { use_admin_popups: true, delay_seconds: 8 },
      { delay_seconds: { value: '9' }, signup_days: { value: '30' } },
    )) === '9|50|14|30',
    'got a different resolution',
  )
  check(
    'the kill switch off ignores the store rules entirely',
    (await resolve(
      { use_admin_popups: false, delay_seconds: 8 },
      { delay_seconds: { value: '9' } },
    )) === '8|50|14|180',
    'got a different resolution',
  )
}

// 9. Chinese collapses onto one language slot.
//
//    Shopify ships Chinese as zh-TW (and zh-CN); our copy object and the
//    campaign's language branch both key on the bare two-letter code, so a
//    raw iso_code found no 'zh' copy and no 'zh' branch -- English popup,
//    English email, and a Brevo record saying zh-tw. The assign is read out
//    of the section itself so the pin cannot drift away from the source.
{
  const line = section.split('\n').find((l) => l.trim().startsWith('assign lang_code ='))
  if (!line) throw new Error('lang_code assign not found')
  const probe = `{% liquid\n${line.trim()}\n%}{{ lang_code }}`
  const resolve = (iso) => engine.parseAndRender(probe, { localization: { language: { iso_code: iso } } })
  check('zh-TW resolves to the zh slot', (await resolve('zh-TW')) === 'zh', await resolve('zh-TW'))
  check('zh-CN resolves to the same slot', (await resolve('zh-CN')) === 'zh', await resolve('zh-CN'))
  check('a plain code is untouched', (await resolve('ko')) === 'ko', await resolve('ko'))

  // …and the copy object, which is keyed 'zh', is what a Chinese visitor gets.
  const zh = entry({ copy: { value: { en: entry({}).copy.value.en, zh: { heading: '\u552e\u5b8c' } } } })
  const { html } = await render([zh], { lang_code: 'zh' })
  check('the zh copy renders for a Chinese visitor', html.includes('\u552e\u5b8c'))
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass')
process.exit(failed ? 1 : 0)
