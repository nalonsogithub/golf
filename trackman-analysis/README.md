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
  dashboard/
    index.html           Interactive dashboard (open directly in a browser)
    data.js              Generated data bundle the dashboard loads
```

## Adding a new report

1. Export the PDF from the Trackman app and drop it in `reports/` (or `reports/Combines/`
   for a Combine). Name it `YYYYMMDD.pdf`; add a suffix like `YYYYMMDDb.pdf` for a second
   session on the same day. The date is taken from the file name.
2. Run the extractor:

   ```powershell
   python scripts/extract_reports.py
   ```

   Only PDFs without a cache entry are OCR'd (about 30 seconds each); everything else is
   re-parsed from cache in a second or two. The script rewrites all of `data/` and
   `dashboard/data.js`.
3. Read the warnings at the end of the output. Every table is cross-checked against the
   Average row printed on the report itself, so a `mean != report avg` warning points at a
   specific club and column to eyeball in the PDF.
4. Refresh `dashboard/index.html`.

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
