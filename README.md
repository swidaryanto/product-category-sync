# Product Category Sync

Monitors the `Product Category` sheet against the `Cat Tree RM` sheet (the raw
material category tree maintained by Retail Ops) and can write missing rows
on demand.

- **Check** (`.github/workflows/check.yml`) — runs daily and on demand. Read-only:
  computes the diff and commits `docs/status.json`.
- **Sync** (`.github/workflows/sync.yml`) — manual only (Actions tab → Run workflow).
  Writes any missing rows into the `Product Category` sheet, matching the
  existing formatting (Calibri 10pt, non-bold, white background), then updates
  `docs/status.json`.
- **Dashboard** — `docs/index.html`, served via GitHub Pages, reads `status.json`.

## Setup

1. Repo secrets (`Settings > Secrets and variables > Actions > Secrets`):
   - `COMPOSIO_API_KEY` — Composio API key (Settings > API Keys on app.composio.dev).
2. Repo variables (same page, `Variables` tab):
   - `COMPOSIO_CONNECTED_ACCOUNT_ID` — the Google Sheets connected account ID
     used by both scripts (not secret — just an identifier, doesn't grant
     access without the API key).
3. Enable Pages: `Settings > Pages > Source: Deploy from a branch > main / docs`.

## How the tree maps to sheet rows

Cat Tree RM columns are `Lv0 (Product Group)` .. `Lv5 (Description)`. Lv0-Lv4
are treated as category nodes (Lv5 is SKU-level detail, not a category).
Each unique `(Lv0..Lv4)` prefix becomes one row in `Product Category` as
`{ name, parent }`, where `parent` is the ancestor chain joined with `" / "`.
Cat Tree RM has heavy row-level duplication (it's a per-leaf list, not a
deduped tree) — `scripts/lib/cattree.js` dedupes on the full tuple.
