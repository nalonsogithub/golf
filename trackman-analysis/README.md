# Trackman Analysis

Tracking progress across clubs using Trackman session reports.

## Layout

```
trackman-analysis/
  reports/    Trackman PDF exports, one per session
```

## Adding a report

Drop the Trackman PDF into `reports/`. Suggested file name so sessions sort chronologically and are easy to filter by club:

```
YYYY-MM-DD_<club>.pdf
```

Examples:

```
reports/2026-09-21_7-iron.pdf
reports/2026-09-21_driver.pdf
reports/2026-09-28_pitching-wedge.pdf
```

For a full-bag session that covers several clubs in one PDF, use `YYYY-MM-DD_full-bag.pdf`.
