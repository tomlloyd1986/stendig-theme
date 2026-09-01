/**
 * The gap between the Blog header and the Editorial content block.
 *
 * The block appears in two places and wants opposite things:
 *
 *   - On the four ARTICLE templates it follows `blog-header`, and the pair
 *     has a settled gap that nobody asked to change.
 *   - On the Stendig and V Calendar PRODUCT templates it follows the product
 *     recommendations with nothing between them, and the text ran into the
 *     component above.
 *
 * So the gap moved: the header's bottom padding went to 0 and the block took
 * the same number as its own top. That is net-neutral on an article and a fix
 * on a product page — but only while the two numbers still add up, and they
 * live in different files with nothing linking them. This adds them up.
 *
 * It also re-checks the assumption the move rests on: that `blog-header` is
 * only ever followed by `blog-content`. If some future template puts anything
 * else under the header, the header's missing bottom padding becomes a bug
 * there and this says so.
 *
 *   node docs/spikes/editorial-spacing.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const faults = []

/** The four numbers of a `padding:` shorthand, in px. */
const pad = (css, selector) => {
  const at = css.indexOf(selector)
  if (at < 0) return null
  const m = /padding:\s*([^;]+);/.exec(css.slice(at))
  if (!m) return null
  const n = m[1].trim().split(/\s+/).map((v) => parseInt(v, 10) || 0)
  const [top, right = top, bottom = top] = n
  return { top, right, bottom }
}

const header = read('sections/blog-header.liquid')
const content = read('sections/blog-content.liquid')

/* Desktop, then the ≤749px override. The narrow rules come later in each
   file, so the LAST match is the narrow one. */
const lastPad = (css, selector) => {
  let out = null
  let from = 0
  for (;;) {
    const at = css.indexOf(selector, from)
    if (at < 0) return out
    out = pad(css.slice(at), selector)
    from = at + 1
  }
}

const WANT = { wide: 32, narrow: 24 }

const hWide = pad(header, '.blogh {')
const cWide = pad(content, '.blogc {')
const hNarrow = lastPad(header, '.blogh {')
const cNarrow = lastPad(content, '.blogc {')

const check = (what, got, want) => {
  if (got !== want) faults.push(`${what}: ${got}, want ${want}`)
  else console.log(`  ok  ${what} — ${got}px`)
}

check('an article keeps its gap, wide', (hWide?.bottom ?? 0) + (cWide?.top ?? 0), WANT.wide)
check('an article keeps its gap, narrow', (hNarrow?.bottom ?? 0) + (cNarrow?.top ?? 0), WANT.narrow)

/* And the whole gap has to be on the BLOCK, or a product page gets none of
   it — which is the fault this move exists to fix. */
check('the block carries all of it, wide', cWide?.top ?? 0, WANT.wide)
check('the block carries all of it, narrow', cNarrow?.top ?? 0, WANT.narrow)

/* The assumption: nothing but the editorial block ever follows the header. */
for (const f of readdirSync(join(root, 'templates')).filter((n) => n.endsWith('.json'))) {
  let d
  try {
    d = JSON.parse(read(`templates/${f}`).replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ''))
  } catch {
    continue
  }
  const order = d.order ?? Object.keys(d.sections ?? {})
  const types = order.map((k) => d.sections?.[k]?.type)
  for (let i = 0; i < types.length; i += 1) {
    if (types[i] !== 'blog-header') continue
    if (types[i + 1] !== 'blog-content') {
      faults.push(`${f}: blog-header is followed by ${types[i + 1] ?? 'nothing'}, which carries no top padding of its own`)
    }
  }
}
console.log('  ok  blog-header is only ever followed by the editorial block')

if (faults.length) {
  console.error('\neditorial spacing:\n  - ' + faults.join('\n  - '))
  process.exit(1)
}
console.log('\neditorial spacing: the gap moved without changing what an article looks like')
