# Product Category Sync

Monitors the `Product Category` sheet against the `Cat Tree RM` sheet (the raw
material category tree maintained by Retail Ops) and can write missing rows
on demand.

Runs entirely as **Google Apps Script**, bound to the "Master Data Import
Templates" spreadsheet, using your own Google identity — no Google Cloud
project, no service account, no third-party API keys. GitHub Pages just
hosts a static dashboard that talks to your Apps Script Web App deployment.

## Setup

1. Open the "Master Data Import Templates" spreadsheet → **Extensions → Apps Script**.
2. Delete the default empty `Code.gs` content, paste in this repo's
   [`apps-script/Code.gs`](apps-script/Code.gs).
3. **Deploy → New deployment → type: Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Deploy → authorize the requested Sheets scopes when prompted.
   - Copy the resulting Web App URL.
4. Open [`docs/index.html`](docs/index.html) in this repo, replace
   `PASTE_APPS_SCRIPT_WEB_APP_URL_HERE` with that URL, commit and push.
5. Back in the Apps Script editor: **Triggers** (clock icon) → **Add Trigger**
   → function `dailyCheck`, event source "Time-driven", pick a daily interval.
   This keeps the dashboard's cached status fresh even if nobody opens it.

The spreadsheet itself also gets a custom menu — **Product Category Sync →
Run Check Now / Run Sync Now** — for anyone with the sheet open.

## How the tree maps to sheet rows

Cat Tree RM columns are `Lv0 (Product Group)` .. `Lv5 (Description)`. Lv0-Lv4
are treated as category nodes (Lv5 is SKU-level detail, not a category).
Each unique `(Lv0..Lv4)` prefix becomes one row in `Product Category` as
`{ name, parent }`, where `parent` is the ancestor chain joined with `" / "`.
Cat Tree RM has heavy row-level duplication (it's a per-leaf list, not a
deduped tree) — `apps-script/Code.gs`'s `getCategoryNodes_()` dedupes on the
full tuple.

## Dashboard

The actual dashboard is served by Apps Script itself (`doGet()` in
`Code.gs` returns a full HTML page when hit with no query params) — this is
necessary because Google's Workspace policy on this account forces sign-in
on every request to the Web App and doesn't return CORS headers, so a
separate page can't `fetch()` it in the background; it only works as a
direct, logged-in page visit.

`docs/index.html`, served via GitHub Pages
(`https://swidaryanto.github.io/product-category-sync/`), is just a
redirect to that Apps Script URL, so the GitHub Pages link still works as a
stable bookmark.

On the dashboard itself:
- Loading the page (or clicking **Run Check Now**) hits `?action=check` —
  read-only, recomputes the diff, doesn't write anything.
- **Run Sync Now** hits `?action=sync` — writes any missing rows into
  `Product Category` (Calibri 10pt, non-bold, white background, matching the
  existing formatting), then reports the new state.

## Why Apps Script instead of GitHub Actions calling the Sheets API directly

Two more "standard" options were tried first and ruled out:

- **Composio API** — needs a project-tier API key for headless calls; the
  account here is individual-tier and only has a consumer key, which is
  rejected by every headless path (REST, MCP, CLI login) — a known open bug
  upstream.
- **Google Cloud service account** — needs creating a new GCP project, which
  this Google Workspace's admin policy blocks.

Apps Script sidesteps both: it runs under the user's own already-authorized
Google identity, no extra credential of any kind.
