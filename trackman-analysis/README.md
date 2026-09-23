# Trackman Analysis

Tracking progress across clubs using Trackman session reports and Trackman Combine tests.

## Layout

```
trackman-analysis/
  reports/               Trackman PDF exports, one per range session (YYYYMMDD.pdf)
  reports/Combines/      Trackman Combine PDFs (YYYYMMDD.pdf)
  scripts/
    extract_reports.py   PDF -> data (OCR, parsing, validation)
  data/
    sessions.json        Parsed range sessions: every shot, plus report Average/Consistency rows
    combines.json        Parsed Combines: score, est. handicap, every target and shot
    shots.csv            Flat one-row-per-shot export of sessions.json (units normalised)
    combine_shots.csv    Flat one-row-per-shot export of combines.json
    ocr-cache/           Raw OCR output per PDF (keyed by file hash). Keep this: it means
                         a PDF is only ever OCR'd once, even on a fresh clone.
  dashboard/             React + TypeScript app (Vite, Recharts). Deployed by Vercel.
    src/data/trackman.json   Generated data bundle (sessions + combines), baked into the build
    src/data/report.md   Copy of REPORT.md, rendered in the Report view
    src/lib/changes.ts   The "what changed" engine: baselines, deltas, records, narrative
    src/views/           ReportView, DailyView (what changed), ExploreView (trends etc.)
    trackman-dashboard.html  Generated single-file build for emailing or opening on a phone
  REPORT.md              Written analysis: findings, progress over time, implications for the
                         workout program, practice and mental game, baseline scorecard values
  REPORT.pdf             Generated from REPORT.md by scripts/build_report_pdf.py (headless Edge);
                         opens with a plain-prose "Summary for listening" for text-to-speech
```

## Dashboard

The dashboard is a React app in `dashboard/`. Three views, switchable with the keys 1, 2, 3:

| View | URL | What it shows |
| --- | --- | --- |
| Report | `#/report` | Live headline numbers (latest Combine, 8-iron side SD, 7-iron carry, driver ball speed) with sparklines, the Combine trend, lateral spread per session, then `REPORT.md` rendered with a table of contents |
| What changed | `#/daily` or `#/daily/2026-09-23` | One day at a time (defaults to the newest). For each club hit: today versus a baseline of the previous 5 sessions with that club, warm-ups excluded. Delta chips coloured only when they clear a noise threshold, "on record" badges, today's shots plotted over the baseline ghost cloud, carry shot by shot against the baseline band, and auto-written bullets explaining what moved and why (strike versus speed, bias flip, blow-up share). Combine days get the same treatment against the previous Combine. |
| Explore | `#/explore/trends` etc. | Trends (any metric, mean or SD, first three versus last three sessions), Dispersion (one club coloured oldest to newest, or all clubs), Path & face (delivery scatter and attack angle trend), Combine (score trend, blow-up table, target heat map, shot detail), All sessions (table; click a row to open that day in What changed) |

Development:

```powershell
cd dashboard
npm install
npm run dev          # http://localhost:5173
npm run build        # dist/ (what Vercel serves)
npm run build:single # trackman-dashboard.html, one self-contained file for email
```

Adding a feature means adding a component under `src/views/` or `src/components/` and,
for new comparisons, extending `src/lib/changes.ts`. Data types live in `src/types.ts`.

### Warm-up shots

Warm-up shots are tagged in the data by `scripts/extract_reports.py`:

- Default rule: the first 4 shots of the loftiest club in the session.
- Overrides: `reports/session-notes.csv`, one row per session that differs, columns
  `session_id, warmup_club, warmup_shots, note`. `warmup_shots` is a number or `all`.
  The `note` column is free text and shows up at the top of that day's What changed view,
  so it is also the place to record what you were working on.

Every shot in `sessions.json` and `shots.csv` carries a `warmup` flag. The Warm-ups control
in the top bar excludes tagged warm-ups by default; it can switch to "keep everything" or
"first N shots of every club". Charts always draw warm-ups as hollow dashed points. URL
forms: `?warmup=none`, `?warmup=tagged`, `?warmup=3` (first 3 per club), placed before the
`#/...` part.

### Hosting on Vercel

1. In Vercel, import the GitHub repo `nalonsogithub/golf`.
2. Set **Root Directory** to `trackman-analysis/dashboard`. `dashboard/vercel.json` sets
   the framework (Vite), install, build and output settings, so the rest of the project
   settings can stay at their defaults.
3. Deploy. Every `git push` that changes `dashboard/src/data/trackman.json` redeploys
   automatically, so the routine stays: drop PDF, run the extractor, commit, push.
4. Under Settings > Deployment Protection, turn on Vercel Authentication (or Password
   Protection on paid plans). The dashboard has no login of its own and contains your
   personal data; `vercel.json` already sets `noindex` so search engines skip it, but that
   is not access control.

## Adding a new report

1. Export the PDF from the Trackman app and drop it in `reports/` (or `reports/Combines/`
   for a Combine). Name it `YYYYMMDD.pdf`; add a suffix like `YYYYMMDDb.pdf` for a second
   session on the same day. The date is taken from the file name.
2. Run the extractor:

   ```powershell
   python scripts/extract_reports.py
   ```

   Only PDFs without a cache entry are OCR'd (about 30 seconds each); everything else is
   re-parsed from cache in a second or two. The script rewrites all of `data/`,
   `dashboard/src/data/trackman.json`, `dashboard/src/data/report.md` and `REPORT.pdf`,
   and, if `dashboard/node_modules` exists, rebuilds `dashboard/trackman-dashboard.html`.
   The report text itself lives in `REPORT.md`; edit that and re-run to refresh the PDF and
   the Report view.
3. Read the warnings at the end of the output. Every table is cross-checked against the
   Average row printed on the report itself, so a `mean != report avg` warning points at a
   specific club and column to eyeball in the PDF.
4. Commit and push; Vercel rebuilds the site. Locally, `npm run dev` in `dashboard/`
   shows the same thing.

First-time setup: `pip install -r requirements.txt`.

## Units

Trackman reports switch between yards/mph and metres/m/s depending on the app settings at
export time. Everything in `data/` is normalised to:

| Quantity | Unit |
| --- | --- |
| Speeds | mph |
| Carry, total, side, curve | yards; side and curve are signed, positive = right, negative = left |
| Height, Combine "from pin" | feet |
| Angles | degrees |
| Spin | rpm |

Shots where Trackman printed `-` (no measurement) are stored as `null` / blank. A smash
factor of `-1.00` in the PDF (club not tracked) is also stored as `null`.

## How the extraction works

Trackman PDFs draw text as vector outlines, so there is no text layer to read. The script
renders each page with PyMuPDF and runs RapidOCR twice: a detection pass to find the table
structure (club title, header labels, row positions, column centres), then a
recognition-only pass on a fixed crop around every cell, using three slightly different crop
geometries. The candidates from all passes are reconciled with a few structural rules (every
column except spin rate has a decimal point; a minus sign is easily dropped but never
invented; the detector tends to clip leading digits). Results are then validated against the
report's own Average row.

`python scripts/extract_reports.py --debug reports/20250226.pdf` dumps the raw OCR lines for
one PDF when something needs investigating.
