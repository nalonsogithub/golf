"""Render REPORT.md to REPORT.pdf using headless Microsoft Edge (no extra Python deps).

Usage: python scripts/build_report_pdf.py
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from extract_reports import md_to_html  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
REPORT_MD = ROOT / "REPORT.md"
REPORT_PDF = ROOT / "REPORT.pdf"

EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]

CSS = """
@page { size: Letter; margin: 22mm 20mm; }
body { font-family: Georgia, 'Times New Roman', serif; font-size: 11pt; line-height: 1.5; color: #111; max-width: 100%; }
h1 { font-family: 'Segoe UI', Arial, sans-serif; font-size: 20pt; margin: 0 0 8pt; }
h2 { font-family: 'Segoe UI', Arial, sans-serif; font-size: 15pt; margin: 22pt 0 6pt; border-bottom: 1px solid #999; padding-bottom: 2pt; page-break-after: avoid; }
h3 { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12pt; margin: 16pt 0 4pt; page-break-after: avoid; }
p { margin: 0 0 8pt; }
li { margin-bottom: 4pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-family: 'Segoe UI', Arial, sans-serif; font-size: 9pt; page-break-inside: avoid; }
th, td { border-bottom: 1px solid #ccc; padding: 3pt 5pt; text-align: left; vertical-align: top; }
th { background: #f0f0f0; font-weight: 600; }
code { font-family: Consolas, monospace; font-size: 9.5pt; }
.meta { color: #555; font-size: 9.5pt; font-family: 'Segoe UI', Arial, sans-serif; margin-bottom: 14pt; }
"""


def find_browser() -> str | None:
    for p in EDGE_CANDIDATES:
        if Path(p).exists():
            return p
    return None


def build() -> bool:
    browser = find_browser()
    if not browser:
        print("No Edge/Chrome found; skipping PDF.")
        return False
    body = md_to_html(REPORT_MD.read_text(encoding="utf-8"))
    html = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Trackman Progress Report</title>"
        f"<style>{CSS}</style></head><body>"
        f"<div class='meta'>Generated {time.strftime('%Y-%m-%d')} from REPORT.md. Interactive dashboard: dashboard/trackman-dashboard.html</div>"
        f"{body}</body></html>"
    )
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / "report.html"
        src.write_text(html, encoding="utf-8")
        cmd = [
            browser, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
            f"--print-to-pdf={REPORT_PDF}", src.as_uri(),
        ]
        subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    ok = REPORT_PDF.exists() and REPORT_PDF.stat().st_size > 10_000
    print(f"{'Wrote' if ok else 'FAILED to write'} {REPORT_PDF}")
    return ok


if __name__ == "__main__":
    os.chdir(ROOT)
    sys.exit(0 if build() else 1)
