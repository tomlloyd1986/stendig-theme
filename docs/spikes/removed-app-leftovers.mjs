/**
 * An uninstalled app leaves its files behind, and the theme goes on running
 * them.
 *
 * The owner, 10 Sep 2026, asked whether the T Lab translation app could go.
 * Reading the theme to answer it turned up two apps that had already gone
 * and left their luggage in the repository:
 *
 *   - LANGIFY, a translation app from before Shopify's own translations.
 *     Twenty-two files — a flag icon per language and a right-to-left
 *     stylesheet in two forms — that nothing has referenced for years. Dead
 *     weight only: an asset nobody names is never served.
 *
 *   - CUSTOMERLABS, a customer-data platform. Its event helper was still
 *     INCLUDED by layout/theme.liquid, so every page load ran a thousand
 *     lines of tracking and pinged io.v2.customerlabs.co for an id, for an
 *     app with no script and no app embed left anywhere on the live site.
 *     That is the worse of the two: a removed app whose theme half was left
 *     wired in goes on collecting and goes on costing every visitor.
 *
 * THE SWEEP: no file named for either app, and neither app named anywhere in
 * the Liquid, the JSON or the assets.
 *
 * AND THE FAULT A REMOVAL ITSELF CAUSES, which is the reason the other half
 * of this file exists: every `render` and `include` names a snippet that is
 * there, and every `asset_url` names a file that is there. Deleting a snippet
 * something still includes is a Liquid error on the live storefront, and
 * deleting an asset something still asks for is a 404 per page load — and
 * neither shows up in a diff.
 *
 * Before the change this reported twenty-one files and three mentions of an
 * app no longer installed; it must.
 *
 *   node docs/spikes/removed-app-leftovers.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'

const root = new URL('../../', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const dir = (p) => (existsSync(new URL(p, root)) ? readdirSync(new URL(p, root)) : [])
const failures = []
const check = (ok, msg) => { if (!ok) failures.push(msg) }

/* Each app names itself two ways: the files it wrote carry its prefix, and
   its own code says its name. A prefix alone would miss a snippet somebody
   renamed; a name alone would miss the silent flag icons. */
const APPS = [
  { app: 'langify', prefix: /^ly-/, says: /langify/i },
  { app: 'CustomerLabs', prefix: /^cl_/, says: /customerlabs|CLabsgbVar/i },
]

// ---------- the files each app left ----------
const owned = []
for (const d of ['assets', 'snippets', 'sections', 'layout', 'config', 'templates']) {
  for (const f of dir(d + '/')) {
    const app = APPS.find((a) => a.prefix.test(f))
    if (app) owned.push(`${d}/${f} (${app.app})`)
  }
}
check(owned.length === 0, `files left behind by an app that is no longer installed:\n    ${owned.join('\n    ')}`)

// ---------- and its name anywhere in the theme ----------
const theme = []
for (const d of ['assets', 'snippets', 'sections', 'layout', 'config', 'templates', 'locales']) {
  for (const f of dir(d + '/')) if (/\.(liquid|js|css|json)$/.test(f)) theme.push(`${d}/${f}`)
}
const named = []
for (const f of theme) {
  const src = read(f)
  for (const a of APPS) if (a.says.test(src)) named.push(`${f} names ${a.app}`)
}
check(named.length === 0, `an app that is no longer installed is still named in the theme:\n    ${named.join('\n    ')}`)

// ---------- every render and include REACHABLE from the storefront resolves ----------
/* A doc comment carries a usage example — `{% render 'buy-buttons', … %}` sits
   inside one — so a region that is not markup is blanked before the walk, or
   the example counts as a render. Blanked, not removed: every line after it
   still names itself. */
const blank = (m) => m.replace(/[^\n]/g, ' ')
const markupOnly = (src) => src
  .replace(/\{%-?\s*(comment|schema|javascript|style|stylesheet)\s*-?%\}[\s\S]*?\{%-?\s*end\1\s*-?%\}/g, blank)
  .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, blank)

/* Only a snippet named by a LITERAL can be resolved: `{% render block.type %}`
   names one the section's own blocks decide, which no read of the source can
   settle. */
const rendersIn = (path) => {
  const src = markupOnly(read(path))
  return [...src.matchAll(/\{%-?\s*(?:render|include)\s+'([^']+)'/g)].map((m) => ({ name: m[1], line: src.slice(0, m.index).split('\n').length }))
}

/* REACHABILITY is the point. A dangling render inside a snippet nothing
   renders cannot error on the storefront, and reporting it would be this
   check crying wolf about code that never runs — snippets/buy-buttons.liquid
   is Dawn's own, orphaned here, and asks for a gift-card form this theme
   does not carry. What matters is a render reached from a layout, a section
   or a template, which is what a deletion breaks. Start there and walk. */
const snippets = new Set(dir('snippets/').filter((f) => f.endsWith('.liquid')).map((f) => f.replace(/\.liquid$/, '')))
const roots = []
for (const d of ['layout', 'sections', 'templates']) for (const f of dir(d + '/')) if (f.endsWith('.liquid')) roots.push(`${d}/${f}`)

const dangling = []
const reached = new Set(roots)
const queue = [...roots]
while (queue.length) {
  const path = queue.shift()
  for (const r of rendersIn(path)) {
    if (!snippets.has(r.name)) { dangling.push(`${path}:${r.line} renders '${r.name}', which is not in snippets/`); continue }
    const target = `snippets/${r.name}.liquid`
    if (!reached.has(target)) { reached.add(target); queue.push(target) }
  }
}
check(dangling.length === 0, `a render or include reached from the storefront names a snippet that is not there (a Liquid error on the live page):\n    ${dangling.join('\n    ')}`)

// ---------- every asset_url on a reachable file resolves ----------
const assets = new Set(dir('assets/'))
const missing = []
for (const f of [...reached]) {
  const src = read(f)
  for (const m of src.matchAll(/'([A-Za-z0-9_.-]+\.(?:css|js|svg|png|jpg|jpeg|gif|woff2?))'\s*\|\s*asset_url/g)) {
    /* A `.css.liquid` in the repository is served as the `.css` the theme asks
       for, so either spelling answers the ask. */
    if (!assets.has(m[1]) && !assets.has(m[1] + '.liquid')) missing.push(`${f}:${src.slice(0, m.index).split('\n').length} asks for '${m[1]}', which is not in assets/`)
  }
}
check(missing.length === 0, `an asset_url names a file that is not there (a 404 on every page load):\n    ${missing.join('\n    ')}`)

if (failures.length) {
  console.error('removed-app-leftovers: FAIL\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
console.log(`removed-app-leftovers: no file or mention left by langify or CustomerLabs; every render and include resolves, and every asset_url names a file that is there (${theme.length} files read, ${reached.size} reached from the storefront)`)
