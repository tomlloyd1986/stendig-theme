/**
 * Which video an Editorial content block shows.
 *
 * A slot lists either a LANGUAGE ('en', 'da, sv') or a whole LOCALE
 * ('en-us'). The locale exists because two markets can share a language:
 * /en-us and /en-ca are both English, so `localization.language.iso_code` is
 * `en` on both and a US-only cut had nowhere to go.
 *
 * Three things are easy to get wrong here and none of them would raise
 * anything — the page would just quietly show the wrong film:
 *
 *   - a locale slot losing to a language slot that sits above it,
 *   - an EMPTY market slot swallowing the language slot's video,
 *   - the root domain, where there is no country in the path at all.
 *
 *   node docs/spikes/editorial-video-locale.mjs
 *
 * Needs liquidjs:  npm i --no-save liquidjs
 */
import { Liquid } from 'liquidjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const section = readFileSync(join(root, 'sections/blog-content.liquid'), 'utf8')

/* Just the video block's liquid, lifted out of the section: the whole file
   wants a section context this spike has no business building. The marker is
   the assign that starts it, so an edit that moves the block still finds it. */
const from = section.indexOf('assign v_video = block.settings.video')
const to = section.indexOf('-%}', from)
const LOGIC = section.slice(from, to)

const engine = new Liquid({ strictFilters: false, strictVariables: false })

/** Renders the logic and reports which video it settled on. */
const pick = async (rootUrl, iso, settings) => {
  const out = await engine.parseAndRender(
    `{%- liquid\n${LOGIC}\n-%}{{ v_video }}|{{ v_url }}`,
    { routes: { root_url: rootUrl }, localization: { language: { iso_code: iso } }, block: { settings } },
  )
  const [video, url] = out.split('|')
  return video || url || '(default)'
}

const faults = []
const check = async (what, got, want) => {
  const g = await got
  if (g !== want) faults.push(`${what}\n      got  ${g}\n      want ${want}`)
  else console.log(`  ok  ${what}`)
}

/* Eight language slots as the section ships them, then the two markets. */
const S = (over = {}) => ({
  video: 'DEFAULT', video_url: '',
  lang_a: 'en', video_a: 'EN', video_url_a: '',
  lang_b: 'fr', video_b: 'FR', video_url_b: '',
  lang_f: 'zh-tw', video_f: 'ZH', video_url_f: '',
  lang_i: 'en-us', video_i: '', video_url_i: '',
  lang_j: 'en-ca', video_j: '', video_url_j: '',
  ...over,
})

/* 1. What shipped before: a language still picks its own slot. */
await check('a language still picks its own slot', pick('/fr-fr', 'fr', S()), 'FR')
await check('an unlisted language falls to the default', pick('/da-dk', 'da', S()), 'DEFAULT')

/* 2. The gap this closes. Both are English; only the locale separates them. */
await check('the US market takes its own cut', pick('/en-us', 'en', S({ video_i: 'US' })), 'US')
await check('Canada takes its own cut', pick('/en-ca', 'en', S({ video_j: 'CA' })), 'CA')
await check('every other English market keeps the English one', pick('/en-gb', 'en', S({ video_i: 'US', video_j: 'CA' })), 'EN')

/* 3. The market slot must win even though 'en' sits above it in slot order.
      Single-pass, slot A would take /en-us and the person who filled in the
      US slot would have no way to see why. */
await check('a market beats the language above it', pick('/en-us', 'en', S({ video_i: 'US' })), 'US')

/* 4. An EMPTY market slot falls through to the language, not past it to the
      default — the fallback the settings promise, one step at a time. */
await check('an empty market slot falls through to the language', pick('/en-us', 'en', S()), 'EN')

/* 5. A market slot filled by URL rather than upload counts as filled. */
await check('a URL fills a market slot too', pick('/en-us', 'en', S({ video_url_i: 'US-URL' })), 'US-URL')

/* 6. The root domain has no country in the path, so the locale IS the
      language and nothing special happens. */
await check('the root domain matches on language alone', pick('/', 'en', S({ video_i: 'US' })), 'EN')

/* 7. A hyphenated LANGUAGE code still works — zh-tw was matching as a
      language long before locales existed, and must not become a locale. */
await check('a hyphenated language code still matches', pick('/zh-tw', 'zh-TW', S()), 'ZH')

if (faults.length) {
  console.error('\neditorial video:\n  - ' + faults.join('\n  - '))
  process.exit(1)
}
console.log('\neditorial video: a market beats its language, an empty slot falls through')
