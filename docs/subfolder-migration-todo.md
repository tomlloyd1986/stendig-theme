# Outstanding: host-based logic left over from the subdomain era

The store moved from market subdomains (`us.stendigcalendars.com`) to market
subfolders (`/en-us/`). Every market now shares one hostname, so **any code
that identifies a market from `request.host` is dead** — it either resolves to
the primary market for everyone, or matches nothing at all.

Already fixed (market now derived from `routes.root_url`, e.g. `/de-de` → `de`,
bare domain → `main`):

- `sections/main-product.liquid` — `window.currentWarehouse`, which drives
  warehouse availability and the waitlist buttons.
- `snippets/product-card.liquid` — stock pills (built subfolder-aware).
- `snippets/delivery-date-buttons.liquid` — per-market date hiding.

## Still to do

### 1. Product offer boxes — ~20 dead subdomain branches

`sections/main-product.liquid`, roughly lines 658–1560. The `productOfferBoxe`
block repeats near-identical markup once per subdomain:

```liquid
{% if request.host == 'stendigcalendars.com' or request.host == 'stendig-new.myshopify.com' %}
...
{% elsif request.host == 'eu.stendigcalendars.com' %}
...
{% elsif request.host == 'fr.stendigcalendars.com' %}
```

Only the first branch can match now, so **every market is served the primary
market's offer box** and the remaining ~900 lines are unreachable.

Live on two PageFly product templates: `product.pf-504a95d4`,
`product.pf-9ce2ad58`.

Two ways to resolve it, to be decided:

- **Rewrite** to resolve the market code once (as the warehouse code does) and
  drive the box from a single parameterised template — collapses ~900 lines to
  a few dozen.
- **Delete** as part of retiring the PageFly product templates, if the offer
  box isn't carried into the native product page.

### 2. Announcement bar

`sections/announcement-bar.liquid` line 1 hides the bar on
`us.stendigcalendars.com`. That condition can never be true now, so the US
market sees a bar that was meant to be hidden. Needs the same market-code
check — or removal, if the rule is obsolete.

## When touching market rules, remember the `main` → `gb` trap

Under subdomains, the UK was served from the bare domain, so UK rules were
written as `main`. Under subfolders, `main` is the **International/primary**
market and the UK is `gb`. Any rule meant for the UK — warehouse `domains`
lists, delivery-date `hide_on` lists, per-product `delivery_domain_rule`
metafields — needs `gb` adding. The same applies to markets that never had a
subdomain (e.g. `ie`, `jp`, `pl`).
