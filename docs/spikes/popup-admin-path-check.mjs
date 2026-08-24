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

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks pass')
process.exit(failed ? 1 : 0)
