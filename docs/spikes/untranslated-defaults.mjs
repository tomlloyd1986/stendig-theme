/**
 * English baked into the Liquid never reaches a translation.
 *
 * The owner, 8 Sep 2026, having found the menu bar's new copy missing from
 * Website › Translations, asked whether there were other examples. There
 * were, of a kind no translation screen can reach: a theme-editor label
 * falling back to an English literal — `section.settings.pinned_label |
 * default: 'Pinned'` — which is right while somebody has typed a value and
 * English in every language the moment one is cleared. The journal's
 * "Pinned" and "Older articles" had been exactly that since they shipped,
 * and the header's five labels were one empty field away from it. Beside
 * them, four screen-reader labels typed straight in: Breadcrumb, Pagination,
 * Previous, Next.
 *
 * Every such fallback reads the locale file now (`| default: x` where `x`
 * was assigned from `t`), which is what Translations reads as Theme text.
 *
 * THE SWEEP (the fault is a literal in the source, so the proof is a read
 * of the source): no `| default: 'English…'` and no `aria-label="English"`
 * anywhere in sections/, snippets/ or layout/ — except the pop-up and the
 * waitlist, whose copy comes per language from the popup register and whose
 * literals are the fallback behind THAT, said here so nobody sweeps them by
 * mistake. And every key a `t` names is in `locales/en.default.json`: a key
 * the file lacks prints as "Translation missing" on the live site, which
 * is worse than the English it replaced. Keys under `shopify.` are the one
 * exception: Shopify's own system translations, in every language, which
 * the theme reads and must never define.
 *
 * THE LIQUID (liquidjs, not Shopify's): the Instagram strip rendered with
 * `t` answering in another language, and both arrows' labels reading that
 * language — the markup reaches the filter, not a literal.
 *
 * Before the change this reported twenty-three literals; it must.
 *
 *   npm i --no-save liquidjs && node docs/spikes/untranslated-defaults.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { Liquid } from 'liquidjs'

const root = new URL('../../', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const failures = []
const check = (ok, msg) => { if (!ok) failures.push(msg) }

// ---------- the sweep ----------
const OWN_COPY = new Set(['sections/popup-signup.liquid', 'sections/waitlist-modal.liquid'])
const files = []
for (const dir of ['sections', 'snippets', 'layout']) for (const f of readdirSync(new URL(dir + '/', root))) if (f.endsWith('.liquid')) files.push(`${dir}/${f}`)
/* A region that is not markup cannot hold copy. A CSS comment naming
   `<button>` would otherwise open a match that runs to the next REAL
   `</button>` and report the prose between the two as baked-in English —
   which is what the first run of this sweep did. Each such region is blanked
   rather than removed, so every offset after it still names its own line. */
const blank = (m) => m.replace(/[^\n]/g, ' ')
const markupOnly = (src) => src
  .replace(/\{%-?\s*(comment|schema|javascript|style|stylesheet)\s*-?%\}[\s\S]*?\{%-?\s*end\1\s*-?%\}/g, blank)
  .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, blank)
  .replace(/<!--[\s\S]*?-->/g, blank)

const literals = []
const keys = new Set()
for (const f of files) {
  const src = read(f)
  /* A BUTTON'S OWN TEXT. The product page's "Buy it now" was a bare text node
     inside a <button> — not a `| default:` fallback and not an aria-label, so
     neither sweep below could see it. It read English on every storefront
     while a translation app patched it in the browser afterwards, which is
     exactly the arrangement that makes a literal survive unnoticed. Whatever
     is left once the Liquid and the tags are taken out is copy no translation
     can reach. */
  if (!OWN_COPY.has(f)) {
    for (const m of markupOnly(src).matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)) {
      const text = m[1]
        .replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, '')
        .replace(/<[^>]*>/g, '')
        .replace(/&[a-z#0-9]+;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (/[A-Za-z]{3,}/.test(text)) literals.push(`${f}:${src.slice(0, m.index).split('\n').length} button text ${JSON.stringify(text.slice(0, 40))}`)
    }
  }
  src.split('\n').forEach((line, i) => {
    if (!OWN_COPY.has(f)) {
      for (const m of line.matchAll(/\|\s*default:\s*'([A-Z][^']{2,60})'/g)) literals.push(`${f}:${i + 1} default '${m[1]}'`)
      for (const m of line.matchAll(/aria-label="([A-Z][A-Za-z ]{2,40})"/g)) literals.push(`${f}:${i + 1} aria-label "${m[1]}"`)
    }
    for (const m of line.matchAll(/'([a-z0-9_]+(?:\.[a-z0-9_]+)+)'\s*\|\s*t\b/g)) keys.add(m[1])
  })
}
check(literals.length === 0, `English baked into the Liquid, where no translation can reach it:\n    ${literals.join('\n    ')}`)

const locale = JSON.parse(read('locales/en.default.json').replace(/^\s*\/\*[\s\S]*?\*\//, ''))
const has = (key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), locale) !== undefined
/* Keys under `shopify.` are Shopify's own system translations — the checkout's
   "Sold out", in every language the store publishes — which a theme reads with
   `t` and never carries itself; one written into this file would override
   Shopify's German with our English. */
const missing = [...keys].filter((k) => !k.startsWith('shopify.') && !has(k)).sort()
check(missing.length === 0, `keys the theme asks \`t\` for that locales/en.default.json does not carry (these print "Translation missing" on the site):\n    ${missing.join('\n    ')}`)

// ---------- the Liquid ----------
const engine = new Liquid({ root: [new URL('snippets/', root).pathname], extname: '.liquid', strictFilters: false, strictVariables: false })
engine.registerFilter('t', (k) => ({ 'accessibility.previous_slide': 'Nach links', 'accessibility.next_slide': 'Nach rechts' })[k] ?? `[${k}]`)
engine.registerFilter('image_url', (v) => 'x.jpg')
engine.registerFilter('image_tag', () => '<img>')
// Shopify's own block tags: the schema and the section's script are swallowed, the style block is kept.
for (const name of ['schema', 'javascript'])
  engine.registerTag(name, { parse(token, remain) { const s = this.liquid.parser.parseStream(remain).on(`tag:end${name}`, () => s.stop()).on('template', () => {}).on('end', () => { throw new Error(`${name} not closed`) }); s.start() }, render() { return '' } })
engine.registerTag('style', { parse(token, remain) { this.t = []; const s = this.liquid.parser.parseStream(remain).on('tag:endstyle', () => s.stop()).on('template', (t) => this.t.push(t)).on('end', () => { throw new Error('style not closed') }); s.start() }, * render(ctx, em) { em.write('<style>'); yield this.liquid.renderer.renderTemplates(this.t, ctx, em); em.write('</style>') } })
try {
  const html = await engine.parseAndRender(read('sections/home-instagram-strip.liquid'), { section: { id: 'igs', settings: {}, blocks: [{ settings: {} }, { settings: {} }] } })
  check(html.includes('aria-label="Nach links"'), 'the previous arrow does not read the locale file')
  check(html.includes('aria-label="Nach rechts"'), 'the next arrow does not read the locale file')
  check(!/aria-label="(Previous|Next)"/.test(html), 'an arrow still carries its English literal')
} catch (e) {
  check(false, `the Instagram strip could not be rendered under liquidjs: ${e.message}`)
}

if (failures.length) {
  console.error('untranslated-defaults: FAIL\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log(`untranslated-defaults: no English baked into the Liquid outside the pop-up and the waitlist; every key \`t\` names is in the locale file (${keys.size} keys); the arrows read the locale file`)
