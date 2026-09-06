/**
 * Hiding a product's images by colourway, on a storefront that is not English.
 *
 * The product page shows one colourway's photographs at a time, matching each
 * media item's ALT TEXT against the selected option value. Two things about
 * that are language-dependent, and both were wrong:
 *
 *  1. The colour option was found by looking for an option NAME containing
 *     "color" or "colour". Shopify translates option names, so on /de-de it is
 *     "Farbe" and on /ja-jp "カラー" — nothing matched, the block returned
 *     early, and no filtering happened at all. English worked, so it looked
 *     correct wherever anybody checked.
 *
 *  2. The option VALUE is translated too, while the alt text is typed once in
 *     the media library and is almost never translated. "rot" matches no alt
 *     saying "red", so every image was hidden — a product page with no
 *     pictures, which is worse than one that is merely unfiltered.
 *
 * The second cannot be MATCHED correctly from the theme: nothing in Liquid
 * hands back the option value in the language the alt was written in. What is
 * fixed is how it fails — nothing matching means the two vocabularies do not
 * meet, so every picture shows.
 *
 * A press on any slide opens the LIGHTBOX — a second list of every photograph,
 * rendered by product-media — and that list stood outside the filter: a Red
 * page narrowed to its red photographs opened a lightbox that scrolled through
 * every colourway's. It takes the same answer now, item for item, and this
 * checks that it does.
 *
 * The functions are lifted out of the section VERBATIM rather than retyped, so
 * this tests what ships. Not liquidjs: the code under test is the JavaScript
 * inside the section, and its Liquid inputs are supplied here.
 *
 *   node docs/spikes/variant-images-locale.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const src = readFileSync(join(root, 'sections/main-product.liquid'), 'utf8')
const faults = []
const ok = (m) => console.log(`  ok  ${m}`)

/* ---------- the code under test, lifted from the section ---------- */

const metaBlock = /const colorOptionMeta = \(\(\) => \{[\s\S]*?\}\)\(\);/.exec(src)
if (!metaBlock) throw new Error('colorOptionMeta is no longer where this spike looks for it')
const colourOption = (productOptions) =>
  new Function('productOptions', `${metaBlock[0]}; return colorOptionMeta`)(productOptions)

const aliasBlock = /const COLOUR_ALIASES = \{[\s\S]*?\n  \};/.exec(src)
if (!aliasBlock) throw new Error('COLOUR_ALIASES is no longer where this spike looks for it')
const canonBlock = /const canonicalColour = \(value\) => \{[\s\S]*?\n  \};/.exec(src)
if (!canonBlock) throw new Error('canonicalColour is no longer where this spike looks for it')
const thumbBlock = /const updateThumbnails = \(targetProduct, colorValue\) => \{[\s\S]*?\n  \};/.exec(src)
if (!thumbBlock) throw new Error('updateThumbnails is no longer where this spike looks for it')

const prelude = `${aliasBlock[0]}\n${canonBlock[0]}`
const canonicalColour = new Function(`${prelude}; return canonicalColour`)()
const updateThumbnails = new Function(`${prelude}\n${thumbBlock[0]}; return updateThumbnails`)()

/* ---------- the smallest DOM these two actually touch ---------- */

const media = (alt) => ({
  dataset: { mediaAlt: alt },
  style: {},
  classList: { add() {}, remove() {} },
  matches: () => false,
  querySelector: () => null,
})
/* A lightbox item is the img itself (product-media renders one per media),
   carrying data-media-alt like a slide — or, on a page cached from before it
   did, only its alt. */
const boxImage = (alt, attr) => ({
  dataset: attr ? { mediaAlt: alt } : {},
  alt,
  style: {},
  classList: { add() {}, remove() {} },
  matches: (sel) => sel === 'img',
  querySelector: () => null,
})
/* updateThumbnails reaches the lightbox the way the theme pairs them: the
   slide's opener names its modal (data-modal) and document.querySelector finds
   it — so document is the one global the fake has to supply. */
const modals = new Map()
globalThis.document = { querySelector: (sel) => modals.get(sel) || null }
let modalCount = 0
const productEl = (alts, { lightbox = null, attr = true } = {}) => {
  const items = alts.map(media)
  const box = lightbox ? lightbox.map((alt) => boxImage(alt, attr)) : []
  const key = `#ProductModal-${++modalCount}`
  if (lightbox) modals.set(key, { querySelectorAll: () => box })
  const el = {
    querySelectorAll: () => items,
    querySelector: () => (lightbox ? { dataset: { modal: key } } : null),
  }
  return { el, items, box }
}
const shown = (items) => items.filter((i) => i.style.display !== 'none').length

/* ---------- 1. the option is found in every language ---------- */

const LANGS = [
  ['en', [{ name: 'Color', values: ['Black', 'Red'] }]],
  ['de', [{ name: 'Farbe', values: ['Schwarz', 'Rot'] }]],
  ['ja', [{ name: 'カラー', values: ['ブラック', 'レッド'] }]],
  ['zh-TW', [{ name: '顏色', values: ['黑色', '紅色'] }]],
]
for (const [lang, opts] of LANGS) {
  const m = colourOption(opts)
  if (!m.enabled) faults.push(`the colour option is not found on ${lang} (${opts[0].name}), so nothing is filtered at all`)
  else if (m.index !== 1) faults.push(`${lang} found the option at index ${m.index}, not 1`)
}
ok('the colour option is found whatever the storefront calls it')

/* A product with SEVERAL options is not guessed at: the fallback is the sole
   option, never the first of many. On Size + Colour with translated names,
   taking the first would filter the photographs by size. */
const many = colourOption([{ name: 'Größe', values: ['S'] }, { name: 'Farbe', values: ['Rot'] }])
if (many.enabled) faults.push('a product with two translated options was guessed at rather than left alone')
else ok('two options and no recognisable name: left alone rather than guessed')

/* Where the name IS recognisable it still wins, so a multi-option English
   product picks the colour option and not the first one. */
const sized = colourOption([{ name: 'Size', values: ['S'] }, { name: 'Colour', values: ['Red'] }])
if (sized.index !== 2) faults.push(`a named colour option must win on a multi-option product; got index ${sized.index}`)
else ok('a recognisable name still picks the right option out of several')

/* ---------- 2. what gets shown ---------- */

const ALTS = ['Stendig Red front', 'Stendig Red detail', 'Stendig Black front']

/* English, or any storefront whose option values are untranslated: the filter
   does its job and only the matching colourway is drawn. */
{
  const { el, items } = productEl(ALTS)
  updateThumbnails(el, 'Red')
  if (shown(items) !== 2) faults.push(`English filters to the two red images; ${shown(items)} were shown`)
  else ok('the matching colourway is filtered to, as it always did')
}

/* The translated value against untranslated alt text — the case that hid every
   image. It now names the colourway and filters to it, exactly as English does:
   two red photographs out of three, not none and not all. */
{
  const { el, items } = productEl(ALTS)
  updateThumbnails(el, 'Rot')
  if (shown(items) === 0) faults.push('a translated colour value hid EVERY image — the page has no pictures at all')
  else if (shown(items) !== 2) faults.push(`"Rot" filters to the two red photographs; ${shown(items)} of ${ALTS.length} were shown`)
  else ok('a translated value filters to its own colourway, like English does')
}

/* No colour selected at all: unchanged, everything shows. */
{
  const { el, items } = productEl(ALTS)
  updateThumbnails(el, '')
  if (shown(items) !== ALTS.length) faults.push(`no colour selected shows everything; ${shown(items)} of ${ALTS.length}`)
  else ok('no colour selected still shows everything')
}

/* A colourway that genuinely has no photographs is the same case as a language
   mismatch from here, and takes the same answer rather than an empty gallery. */
{
  const { el, items } = productEl(ALTS)
  updateThumbnails(el, 'Yellow')
  if (shown(items) !== ALTS.length) faults.push(`a colourway with no images of its own shows the rest; ${shown(items)} shown`)
  else ok('a colourway with no photographs of its own shows the product’s, not a blank gallery')
}

/* ---------- 3. every value the shop actually shows ---------- */
/* Taken from the live product pages, one screenshot per storefront. These are
   the strings the filter is handed; each has to name its colourway. */
const LIVE = {
  en: { 'Red': 'red', 'Double Blue': 'double blue', 'Light Blue': 'light blue', 'Black': 'black', 'White': 'white' },
  fr: { 'Rouge': 'red', 'Bleu double': 'double blue', 'Bleu clair': 'light blue', 'Noir': 'black', 'Blanc': 'white' },
  de: { 'Rot': 'red', 'Doppelblau': 'double blue', 'Hellblau': 'light blue', 'Schwarz': 'black', 'Weiß': 'white' },
  it: { 'Rosso': 'red', 'Blu doppio': 'double blue', 'Azzurro': 'light blue', 'Nero': 'black', 'Bianco': 'white' },
  es: { 'Rojo': 'red', 'Doble azul': 'double blue', 'Azul claro': 'light blue', 'Negro': 'black', 'Blanco': 'white' },
  ja: { '赤': 'red', 'ダブルブルー': 'double blue', 'ライトブルー': 'light blue', '黒': 'black', '白': 'white' },
  ko: { '빨간색': 'red', '더블 블루': 'double blue', '라이트 블루': 'light blue', '검은색': 'black', '하얀색': 'white' },
  'zh-TW': { '紅色的': 'red', '雙藍色': 'double blue', '淺藍色': 'light blue', '黑色的': 'black', '白色的': 'white' },
}
for (const [lang, values] of Object.entries(LIVE)) {
  for (const [shown, want] of Object.entries(values)) {
    const got = canonicalColour(shown)
    if (got !== want) faults.push(`${lang}: "${shown}" names ${JSON.stringify(want)}, but resolved to ${JSON.stringify(got)}`)
  }
}
ok(`every colourway on all ${Object.keys(LIVE).length} storefronts names its English word`)

/* The one pair that can collide: both blues carry the word for "blue" in most
   of these languages, so a loose match must never answer one with the other. */
for (const [lang, values] of Object.entries(LIVE)) {
  const dbl = Object.keys(values).find((k) => values[k] === 'double blue')
  const lgt = Object.keys(values).find((k) => values[k] === 'light blue')
  if (canonicalColour(dbl) === canonicalColour(lgt))
    faults.push(`${lang}: "${dbl}" and "${lgt}" resolved to the same colourway`)
}
ok('the two blues are never confused for one another')

/* A value carrying a season or a suffix still names its colourway. */
for (const [shown, want] of [['Rot – 2027', 'red'], ['Bleu double (2027)', 'double blue'], ['Light Blue 2027', 'light blue']]) {
  const got = canonicalColour(shown)
  if (got !== want) faults.push(`a suffixed value must still name its colourway: "${shown}" gave ${JSON.stringify(got)}`)
}
ok('a value carrying a season or a suffix still names its colourway')

/* And the filter end to end: a German shopper picking Hellblau sees the light
   blue photographs, which is the whole point. */
{
  const alts = ['V Calendar Light Blue front', 'V Calendar Light Blue detail', 'V Calendar Double Blue front', 'V Calendar Red front']
  const { el, items } = productEl(alts)
  updateThumbnails(el, 'Hellblau')
  const visible = items.filter((i) => i.style.display !== 'none').length
  if (visible !== 2) faults.push(`Hellblau shows the two light blue photographs; ${visible} of ${alts.length} were shown`)
  else ok('a German shopper picking Hellblau sees the light blue photographs, not all four')
}

/* An unlisted colourway still degrades to the whole gallery rather than none. */
{
  const { el, items } = productEl(['V Calendar Red front'])
  updateThumbnails(el, 'Türkis')
  if (items.filter((i) => i.style.display !== 'none').length !== 1)
    faults.push('a colourway nobody has listed must still show the gallery, not empty it')
  else ok('a colourway nobody has listed shows the gallery rather than emptying it')
}

/* ---------- 4. the lightbox shows what the gallery shows ---------- */
/* The same three photographs, in the gallery and in the lightbox a slide
   opens. Red narrows both to the two red ones — not the gallery to two and
   the lightbox to all three, which is the fault this section is about. */
{
  const { el, items, box } = productEl(ALTS, { lightbox: ALTS })
  updateThumbnails(el, 'Red')
  const visible = box.filter((i) => i.style.display !== 'none')
  if (visible.length !== 2) faults.push(`the lightbox shows the two red photographs like the gallery; ${visible.length} of ${box.length} were shown`)
  else if (visible.some((i) => !i.alt.toLowerCase().includes('red'))) faults.push('the lightbox still shows a photograph of another colourway')
  else ok('the lightbox is narrowed to the same photographs as the gallery')
  if (shown(items) !== 2) faults.push('narrowing the lightbox changed what the gallery shows')

  /* Shown is CLEARED, never forced to block: below 750px the lightbox shows
     only the photograph pressed (:not(.active) is hidden), and an inline
     block on every match would put them all on screen at once. */
  if (visible.some((i) => i.style.display !== '')) faults.push('a matching lightbox photograph is forced to block, which on a phone shows every match at once')
  else ok('a matching lightbox photograph is left to the stylesheet, so a phone still shows one at a time')
}

/* A translated value narrows the lightbox through the same English word. */
{
  const { el, box } = productEl(ALTS, { lightbox: ALTS })
  updateThumbnails(el, 'Rot')
  const visible = box.filter((i) => i.style.display !== 'none').length
  if (visible !== 2) faults.push(`"Rot" narrows the lightbox to the two red photographs; ${visible} of ${box.length} were shown`)
  else ok('a translated value narrows the lightbox as it does the gallery')
}

/* A page cached from before product-media carried data-media-alt: the img's
   own alt is read instead, so the lightbox is still narrowed. */
{
  const { el, box } = productEl(ALTS, { lightbox: ALTS, attr: false })
  updateThumbnails(el, 'Red')
  const visible = box.filter((i) => i.style.display !== 'none').length
  if (visible !== 2) faults.push(`a lightbox item without data-media-alt is read off its alt; ${visible} of ${box.length} were shown`)
  else ok('a lightbox item carrying only its alt is still narrowed')
}

/* The vocabulary guard holds for the lightbox as well: nothing matching shows
   the lot in both, never a gallery of three and a lightbox of none. */
{
  const { el, items, box } = productEl(ALTS, { lightbox: ALTS })
  updateThumbnails(el, 'Yellow')
  if (shown(items) !== ALTS.length || shown(box) !== ALTS.length)
    faults.push('a colourway with no photographs must show the lot in the lightbox as in the gallery')
  else ok('a colourway with no photographs shows the whole lightbox, as it does the gallery')
}

/* Changing colourway puts the hidden ones back: what Black hid, Red shows. */
{
  const { el, box } = productEl(ALTS, { lightbox: ALTS })
  updateThumbnails(el, 'Black')
  updateThumbnails(el, 'Red')
  const visible = box.filter((i) => i.style.display !== 'none').map((i) => i.alt)
  if (visible.length !== 2 || visible.some((a) => !a.includes('Red'))) faults.push(`switching back to Red must show the red photographs again; got ${JSON.stringify(visible)}`)
  else ok('switching colourway shows the newly chosen photographs in the lightbox again')
}

/* A product with no lightbox at all — nothing to open — still filters its
   gallery rather than throwing on the modal it does not have. */
{
  const { el, items } = productEl(ALTS)
  let threw = null
  try { updateThumbnails(el, 'Red') } catch (e) { threw = e }
  if (threw) faults.push(`a page with no lightbox must still filter the gallery; it threw: ${threw.message}`)
  else if (shown(items) !== 2) faults.push('a page with no lightbox no longer filters the gallery')
  else ok('a page with no lightbox still filters its gallery')
}

if (faults.length) {
  console.error('\nvariant images by locale:\n  - ' + faults.join('\n  - '))
  process.exit(1)
}
console.log('\nvariant images: the colourway filter works in every language, never empties the gallery, and narrows the lightbox with it')
