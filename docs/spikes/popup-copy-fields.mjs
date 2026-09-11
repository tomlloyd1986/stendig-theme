/**
 * The pop-up reads its copy from the ENTRY'S OWN FIELDS, which Shopify serves
 * already translated — not from one `copy` json field holding every language.
 *
 * The owner, 11 Sep 2026, seeing the pop-up's words nowhere in Website ›
 * Translations: *"I thought the idea was that the translations automatically
 * flow across in this?"* They could not. Shopify translates a FIELD and has
 * never been able to translate a json blob, so a `popup_version` entry whose
 * eight languages rode in one `copy` field was, as far as the store was
 * concerned, holding no copy at all. Split into a field a line and marked
 * translatable, the storefront serves each line in the request's own language
 * by itself — the way a cross-sell rule's headline already does — and the
 * site's own reading sees the pop-up like anything else.
 *
 * This renders the REAL copy region of the section (between its stp-copy
 * markers) in liquidjs, which is not Shopify Liquid: what it proves is where
 * the words COME FROM, which is the whole of the change.
 *
 * Run from anywhere with liquidjs on the path:
 *   mkdir /tmp/spike && cd /tmp/spike && npm i liquidjs && node <this file>
 */
import { Liquid } from 'liquidjs'
import { readFileSync } from 'node:fs'

const section = readFileSync(new URL('../../sections/popup-signup.liquid', import.meta.url), 'utf8')
const start = section.indexOf('# stp-copy-start')
const end = section.indexOf('# stp-copy-end')
if (start < 0 || end < 0) throw new Error('stp-copy markers not found — the region this spike renders has moved')

/* The region is the inside of a `{%- liquid -%}` block, so it is wrapped back
   into one and every line it assigns is echoed after it. */
const LINES = [
  'p_eyebrow',
  'p_heading',
  'p_body',
  'p_placeholder',
  'p_button',
  'p_dismiss',
  'p_ph_heading',
  'p_ph_body',
  'p_ph_placeholder',
  'p_ph_button',
  'p_ph_skip',
  'p_ph_small',
  'p_ty_eyebrow',
  'p_ty_heading',
  'p_ty_body',
  'p_shop',
]
const tpl =
  `{%- liquid\n${section.slice(start, end)}\n-%}` +
  LINES.map((n) => `${n}={{ ${n} }}`).join('|')

const engine = new Liquid()

/** A `popup_version` entry as the storefront meets it: a field a line. */
const entry = (over = {}) =>
  Object.fromEntries(
    Object.entries({
      eyebrow: 'The Stendig',
      heading: 'Be first in line',
      body: 'Leave your email and be the first to hear.',
      placeholder: 'Email address',
      button_label: 'Notify me',
      dismiss_label: 'No thanks',
      ph_heading: 'Be first in line',
      ph_body: 'Add your number.',
      ph_placeholder: 'Phone number',
      ph_button_label: "Text me when they're on sale",
      ph_skip_label: 'No thanks, email is fine',
      ph_smallprint: 'Reply STOP to opt out.',
      ty_eyebrow: 'Thank you',
      ty_heading: "You're on the list",
      ty_body: "We'll email you.",
      shop_label: 'Shop the store',
      ...over,
    }).map(([k, value]) => [k, { value }]),
  )

const read = async (v, extra = {}) => {
  const out = await engine.parseAndRender(tpl, { v: { ...v, ...extra }, lang_code: 'de' })
  return Object.fromEntries(out.split('|').map((pair) => {
    const i = pair.indexOf('=')
    return [pair.slice(0, i), pair.slice(i + 1)]
  }))
}

const faults = []
const fail = (s) => faults.push(s)

/* 1. Every line comes off its own field. This is what fails on the old code:
      there the words were dug out of `v.copy.value[lang_code]`, so an entry
      carrying the fields and no `copy` at all rendered nothing but the
      hardcoded defaults. */
{
  const got = await read(entry())
  const want = {
    p_eyebrow: 'The Stendig',
    p_heading: 'Be first in line',
    p_placeholder: 'Email address',
    p_button: 'Notify me',
    p_ph_skip: 'No thanks, email is fine',
    p_ty_heading: "You're on the list",
    p_shop: 'Shop the store',
  }
  for (const [k, v] of Object.entries(want)) if (got[k] !== v) fail(`${k} read ${JSON.stringify(got[k])}, not ${JSON.stringify(v)}`)
  for (const n of LINES) if (!got[n]) fail(`${n} rendered empty, so the panel would print nothing there`)
}

/* 2. A translated storefront is served by SHOPIFY: the field arrives already
      in the request's language and the section picks no language itself. So
      German words on the fields are German words on the panel, with
      `lang_code` still 'de' and nothing in here looking at it. */
{
  const got = await read(entry({ heading: 'Bald zurück', button_label: 'Benachrichtigen' }))
  if (got.p_heading !== 'Bald zurück') fail(`a translated heading read ${JSON.stringify(got.p_heading)}`)
  if (got.p_button !== 'Benachrichtigen') fail(`a translated button read ${JSON.stringify(got.p_button)}`)
}

/* 3. The retired `copy` blob is not read at all. The admin still writes it
      while the live theme is the old one, so a stale language block sits on
      every entry — and if this region still reached into it, the words on the
      page would be whichever of the two was last written rather than the ones
      Shopify serves. */
{
  const stale = {
    copy: { value: { en: { heading: 'STALE ENGLISH' }, de: { heading: 'STALE DEUTSCH' } } },
  }
  const got = await read(entry(), stale)
  for (const [n, v] of Object.entries(got)) if (v.includes('STALE')) fail(`${n} read the retired copy blob: ${JSON.stringify(v)}`)
}

/* 4. A line the pop-up leaves blank still prints something a visitor can act
      on, where the panel cannot work without one — the placeholder, the two
      buttons, the skip link. A line that is decoration (an eyebrow, the
      smallprint) is empty and the panel omits it. */
{
  const blank = Object.fromEntries(Object.keys(entry()).map((k) => [k, { value: '' }]))
  const got = await read(blank)
  const needed = {
    p_placeholder: 'Email address',
    p_button: 'Notify me',
    p_dismiss: 'No thanks',
    p_ph_heading: 'Be first in line',
    p_ph_placeholder: 'Phone number',
    p_ph_skip: 'No thanks, email is fine',
    p_ty_heading: "You're on the list",
    p_shop: 'Shop the store',
  }
  for (const [k, v] of Object.entries(needed)) if (got[k] !== v) fail(`with nothing written, ${k} read ${JSON.stringify(got[k])} rather than ${JSON.stringify(v)}`)
  if (got.p_eyebrow !== '') fail(`an unwritten eyebrow read ${JSON.stringify(got.p_eyebrow)} rather than nothing`)
}

if (faults.length) {
  console.error(`popup-copy-fields: ${faults.length} fault(s)`)
  for (const f of faults) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(
  'popup-copy-fields: every line comes off the entry’s own field, a translated field is printed as it arrives, the retired copy blob is never read, and an unwritten line still prints what the panel cannot work without',
)
