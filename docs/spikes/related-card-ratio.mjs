/**
 * The card shape on "Product: Related items".
 *
 * The row drew a square and nothing else could be asked for. It now carries
 * the same Image aspect ratio toggle as the two collection grids, and this
 * renders the section's style block under every value the toggle can hold —
 * plus the one it cannot be SET to and will nevertheless be read as.
 *
 * That last case is the whole reason this file exists. Every product template
 * already carries this section with no `image_ratio` in its JSON, so the
 * setting arrives unset unless Shopify fills the schema default in. If the
 * condition tested for '1-1' rather than '4-5', an unset value would fall
 * through to the portrait branch and every live product page would change
 * shape — silently, at the moment the section was merely edited. The test is
 * written the other way round and this pins it there.
 *
 * It also checks the placeholder tracks the image. A card whose picture has
 * not been chosen yet still holds a slot in a row of four, and a placeholder
 * left at 1:1 beside three portrait cards is a step in the one line-up this
 * section exists to keep straight.
 *
 * liquidjs, not Shopify's own Liquid — this proves the branching, not the
 * rendering. `{% style %}` and `{% schema %}` are stubbed as Shopify-only tags.
 *
 *   npm i --no-save liquidjs && node docs/spikes/related-card-ratio.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Liquid } from 'liquidjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const src = readFileSync(join(root, 'sections/product-related.liquid'), 'utf8')

const engine = new Liquid({ strictFilters: false, strictVariables: false })
/* Shopify's own tags. `style` renders its body; `schema` swallows it. */
engine.registerTag('style', {
  parse(tok, remain) {
    this.tpls = []
    const stream = this.liquid.parser.parseStream(remain)
    stream.on('tag:endstyle', () => stream.stop()).on('template', (t) => this.tpls.push(t)).on('end', () => stream.stop())
    stream.start()
  },
  *render(ctx, emitter) {
    yield this.liquid.renderer.renderTemplates(this.tpls, ctx, emitter)
  },
})
engine.registerTag('schema', {
  parse(tok, remain) {
    const stream = this.liquid.parser.parseStream(remain)
    stream.on('tag:endschema', () => stream.stop()).on('template', () => {}).on('end', () => stream.stop())
    stream.start()
  },
  *render() {},
})

const faults = []
const ok = (m) => console.log(`  ok  ${m}`)

async function styleOf(settings) {
  const out = await engine.parseAndRender(src, {
    section: { id: 'test', settings: { heading: '', ...settings }, blocks: [] },
    product: null,
  })
  return out
}

/** The ratio each of the two boxes is drawn at, read out of the CSS. */
function ratios(css) {
  const grab = (sel) => {
    const at = css.indexOf(sel)
    if (at < 0) return null
    const m = /aspect-ratio:\s*([^;]+);/.exec(css.slice(at))
    return m ? m[1].trim() : null
  }
  return { img: grab('.prel__card img'), placeholder: grab('.prel__placeholder') }
}

const cases = [
  ['1-1', '1 / 1', 'the square the toggle names'],
  ['4-5', '4 / 5', 'the portrait the toggle names'],
  [undefined, '1 / 1', 'nothing stored — the shape every product page already draws'],
  ['', '1 / 1', 'an empty string'],
  ['square', '1 / 1', "another section's vocabulary (main-list-collections says 'square')"],
]

for (const [value, want, why] of cases) {
  const css = await styleOf(value === undefined ? {} : { image_ratio: value })
  const { img, placeholder } = ratios(css)
  if (img !== want) faults.push(`image_ratio ${JSON.stringify(value)} draws the image at ${img}, wanted ${want} — ${why}`)
  else ok(`image_ratio ${JSON.stringify(value)} → ${want}  (${why})`)
  if (placeholder !== img) faults.push(`image_ratio ${JSON.stringify(value)}: the placeholder is ${placeholder} while the image is ${img}`)
}
ok('the placeholder holds the same shape as the image it stands in for')

/* The toggle is the collection grids', not a second one that reads alike. */
const schema = JSON.parse(/\{%\s*schema\s*%\}([\s\S]*?)\{%\s*endschema\s*%\}/.exec(src)[1])
const mine = schema.settings.find((s) => s.id === 'image_ratio')
if (!mine) faults.push('the section carries no image_ratio setting')
for (const peer of ['curated-product-grid', 'grouped-product-grid']) {
  const theirs = JSON.parse(
    /\{%\s*schema\s*%\}([\s\S]*?)\{%\s*endschema\s*%\}/.exec(readFileSync(join(root, `sections/${peer}.liquid`), 'utf8'))[1],
  ).settings.find((s) => s.id === 'image_ratio')
  if (JSON.stringify(theirs.options) !== JSON.stringify(mine?.options)) {
    faults.push(`the values differ from ${peer}: ${JSON.stringify(mine?.options)} vs ${JSON.stringify(theirs.options)}`)
  }
  if (theirs.label !== mine?.label) faults.push(`the label differs from ${peer}: "${mine?.label}" vs "${theirs.label}"`)
}
ok('it is the collection grids’ toggle — same label, same two values')

/* The default has to be the shape the row already drew, or merging this
   change alone restyles four live product templates. */
if (mine?.default !== '1-1') faults.push(`the default is ${JSON.stringify(mine?.default)}; this row has always been square`)
else ok('and it defaults to 1:1, so merging it changes nothing until somebody asks')

/* No copy left promising a square. */
if (/1:1 \(square\)/.test(src.replace(/\{%\s*schema[\s\S]*/, ''))) {
  faults.push('the section still tells an editor the image is square')
}
const imageInfo = schema.blocks[0].settings.find((s) => s.id === 'image')?.info ?? ''
if (/1:1/.test(imageInfo)) faults.push(`the image override still promises 1:1: "${imageInfo}"`)
else ok('the image override points at the setting rather than naming a shape')

if (faults.length) {
  console.error('\nrelated card ratio:\n  - ' + faults.join('\n  - '))
  process.exit(1)
}
console.log('\nrelated card ratio: the row takes the collection grids’ toggle, and is square until told otherwise')
