"""
Extract shot data from Trackman PDF reports into JSON for the dashboard.

Trackman PDFs draw text as vector outlines (no extractable text layer), so this
script renders each page with PyMuPDF and OCRs it with RapidOCR. Results are
cached per PDF under .cache/ so re-runs only process new/changed files.

Usage:
    python scripts/extract_reports.py            # process everything
    python scripts/extract_reports.py --debug F  # dump OCR lines for one PDF

Inputs:  reports/*.pdf            (range sessions, one table per club)
         reports/Combines/*.pdf   (Trackman Combine tests)
Outputs: data/sessions.json, data/combines.json, dashboard/data.js
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import pymupdf

ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = ROOT / "reports"
COMBINES_DIR = REPORTS_DIR / "Combines"
DATA_DIR = ROOT / "data"
# Raw OCR output per PDF, keyed by file hash. Committed to the repo so the slow
# OCR step never has to be repeated for a PDF that has already been processed.
CACHE_DIR = DATA_DIR / "ocr-cache"
DASHBOARD_DIR = ROOT / "dashboard"

DPI = 200

# ----------------------------------------------------------------------------
# OCR (cached)
# ----------------------------------------------------------------------------

_engine = None


def get_engine():
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR

        _engine = RapidOCR()
    return _engine


def file_hash(path: Path) -> str:
    h = hashlib.sha1()
    h.update(path.read_bytes())
    return h.hexdigest()[:16]


def render_page(doc, pno: int):
    """Render page pno (1-based) as an RGB ndarray, rotated to landscape."""
    page = doc[pno - 1]
    # Reports are landscape content on a portrait page rotated 90 degrees.
    if page.rect.width < page.rect.height and page.rotation == 0:
        page.set_rotation(90)
    pix = page.get_pixmap(dpi=DPI, colorspace=pymupdf.csRGB, alpha=False)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)


class CellReader:
    """Recognition-only OCR of fixed-size cells; results cached per PDF.

    The detection pass occasionally clips a leading digit or misses a cell
    entirely. Reading each cell from a generous fixed crop around the known
    column centre / row centre is far more reliable for tabular numbers.
    """

    def __init__(self, path: Path):
        self.path = path
        self.doc = None
        self.images: dict[int, np.ndarray] = {}
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        self.cache_file = CACHE_DIR / f"{path.stem}_{file_hash(path)}_cells.json"
        self.cache: dict[str, str] = (
            json.loads(self.cache_file.read_text(encoding="utf-8")) if self.cache_file.exists() else {}
        )
        self.dirty = False

    def image(self, pno: int):
        if pno not in self.images:
            if self.doc is None:
                self.doc = pymupdf.open(self.path)
            self.images[pno] = render_page(self.doc, pno)
        return self.images[pno]

    def read(self, pno: int, x: float, y: float, hw: float, hh: float, scale: int = 1) -> str:
        key = f"{pno}:{int(round(x))}:{int(round(y))}:{int(hw)}:{int(hh)}:{scale}"
        if key in self.cache:
            return self.cache[key]
        img = self.image(pno)
        h, w = img.shape[:2]
        x0, x1 = max(0, int(x - hw)), min(w, int(x + hw))
        y0, y1 = max(0, int(y - hh)), min(h, int(y + hh))
        crop = img[y0:y1, x0:x1]
        text = ""
        if crop.size and crop.min() < 200:  # skip blank cells
            if scale != 1:
                import cv2

                crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
            res, _ = get_engine()(crop, use_det=False, use_cls=False, use_rec=True)
            if res:
                text = res[0][0].strip()
        self.cache[key] = text
        self.dirty = True
        return text

    def read_variants(self, pno: int, x: float, y: float, hw: float, hh: float) -> list[str]:
        """Read the same cell with a few crop geometries; recogniser output is
        occasionally sensitive to a few pixels of padding."""
        return [
            self.read(pno, x, y, hw, hh),
            self.read(pno, x, y, hw * 1.2, hh * 1.15, scale=2),
            self.read(pno, x, y - hh * 0.1, hw * 0.9, hh),
        ]

    def save(self):
        if self.dirty:
            self.cache_file.write_text(json.dumps(self.cache), encoding="utf-8")
            self.dirty = False


def ocr_pdf(path: Path) -> list[dict]:
    """Return per-page OCR results: [{"w":..,"h":..,"items":[{"x0","y0","x1","y1","text","conf"}]}]"""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / f"{path.stem}_{file_hash(path)}.json"
    if cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))

    print(f"  OCR {path.relative_to(ROOT)} ...", flush=True)
    engine = get_engine()
    pages = []
    doc = pymupdf.open(path)
    for pno in range(1, len(doc) + 1):
        img = render_page(doc, pno)
        result, _ = engine(img)
        items = []
        for box, text, conf in result or []:
            xs = [p[0] for p in box]
            ys = [p[1] for p in box]
            items.append(
                {
                    "x0": min(xs),
                    "y0": min(ys),
                    "x1": max(xs),
                    "y1": max(ys),
                    "text": text.strip(),
                    "conf": float(conf),
                }
            )
        pages.append({"w": int(img.shape[1]), "h": int(img.shape[0]), "items": items})
    cache_file.write_text(json.dumps(pages), encoding="utf-8")
    return pages


# ----------------------------------------------------------------------------
# Geometry helpers
# ----------------------------------------------------------------------------


def cx(it):
    return (it["x0"] + it["x1"]) / 2


def cy(it):
    return (it["y0"] + it["y1"]) / 2


def group_lines(items, tol):
    """Cluster OCR boxes into lines by vertical centre; each line sorted left->right."""
    items = sorted(items, key=cy)
    lines: list[list[dict]] = []
    for it in items:
        if lines and abs(cy(it) - np.mean([cy(x) for x in lines[-1]])) <= tol:
            lines[-1].append(it)
        else:
            lines.append([it])
    for ln in lines:
        ln.sort(key=cx)
    return lines


def cluster_1d(values, tol):
    values = sorted(values)
    clusters: list[list[float]] = []
    for v in values:
        if clusters and v - clusters[-1][-1] <= tol:
            clusters[-1].append(v)
        else:
            clusters.append([v])
    return [float(np.mean(c)) for c in clusters]


def nearest(centers, x, max_dist):
    best, best_d = None, None
    for i, c in enumerate(centers):
        d = abs(c - x)
        if best_d is None or d < best_d:
            best, best_d = i, d
    if best is not None and best_d <= max_dist:
        return best
    return None


# ----------------------------------------------------------------------------
# Token parsing
# ----------------------------------------------------------------------------

NUM_RE = re.compile(r"^[-+]?\d+(?:[.,]\d+)?\s*[LR]?$")
ROW_NO_RE = re.compile(r"^(\d{1,3})[.\u3002,]?$")
UNIT_TOKENS = {"m/s", "deg", "rpm", "m", "yds", "mph", "ft", "s", "in", "km/h", "%"}

COMBINE_TARGETS = {60, 70, 80, 90, 100, 120, 140, 160, 180}

CLUB_RE = re.compile(
    r"^(driver|\d\s?wood|\d\s?hybrid|\d\s?iron|[pgsla]w|\d{2}\s?(?:wedge|deg)|"
    r"pitching\s?wedge|sand\s?wedge|gap\s?wedge|lob\s?wedge|approach\s?wedge|putter|"
    r"\d\s?utility|\d\s?rescue)$",
    re.I,
)


def norm_text(t: str) -> str:
    t = t.strip()
    # Common OCR confusions in this font
    t = re.sub(r"(?i)^(\d)\s*[l1|]ron$", r"\1Iron", t)
    t = re.sub(r"(?i)^(\d)\s*hybr[il1]d$", r"\1Hybrid", t)
    t = re.sub(r"(?i)^dr[il1]ver$", "Driver", t)
    return t


def clean_numeric(tok: str) -> str:
    """Normalise OCR quirks in a numeric token: O->0, stray spaces, comma decimals."""
    tok = tok.strip().replace(",", ".").replace(" ", "")
    tok = tok.replace("一", "-").replace("—", "-").replace("–", "-")
    if re.match(r"^[-+]?[\dOo]+(?:\.[\dOo]+)?[LR]?$", tok):
        tok = re.sub(r"[Oo]", "0", tok)
    return tok


def parse_value(tok: str):
    """'13.1R' -> 13.1, '14.6L' -> -14.6, '-' -> None, '-1.00' -> -1.0"""
    tok = clean_numeric(tok)
    if tok in {"-", "--", ""}:
        return None
    m = re.match(r"^([-+]?\d+(?:\.\d+)?)\s*([LR])?$", tok)
    if not m:
        return None
    v = float(m.group(1))
    if m.group(2) == "L":
        v = -abs(v)
    elif m.group(2) == "R":
        v = abs(v)
    return v


def is_value_token(tok: str) -> bool:
    tok = clean_numeric(tok)
    return tok in {"-", "--"} or bool(NUM_RE.match(tok))


# Canonical columns: header label (lowercase, spaces removed) -> (key, kind)
# kind decides unit normalisation: speed->mph, dist->yds, short->ft, deg, raw
CANON = {
    "clubspeed": ("club_speed", "speed"),
    "ballspeed": ("ball_speed", "speed"),
    "attackang.": ("attack_angle", "deg"),
    "attackang": ("attack_angle", "deg"),
    "spinrate": ("spin_rate", "raw"),
    "carry": ("carry", "dist"),
    "total": ("total", "dist"),
    "side": ("side", "dist"),
    "sidetot.": ("side_total", "dist"),
    "sidetot": ("side_total", "dist"),
    "curve": ("curve", "dist"),
    "smashfac.": ("smash", "raw"),
    "smashfac": ("smash", "raw"),
    "clubpath": ("club_path", "deg"),
    "facetopath": ("face_to_path", "deg"),
    "faceang.": ("face_angle", "deg"),
    "faceang": ("face_angle", "deg"),
    "launchang.": ("launch_angle", "deg"),
    "launchang": ("launch_angle", "deg"),
    "launchdir.": ("launch_direction", "deg"),
    "launchdir": ("launch_direction", "deg"),
    "height": ("height", "short"),
    "landang.": ("land_angle", "deg"),
    "landang": ("land_angle", "deg"),
    "spinaxis": ("spin_axis", "deg"),
    "dyn.loft": ("dynamic_loft", "deg"),
    "dynloft": ("dynamic_loft", "deg"),
    "hangtime": ("hang_time", "raw"),
    "swingplane": ("swing_plane", "deg"),
    "swingdir.": ("swing_direction", "deg"),
    "swingdir": ("swing_direction", "deg"),
    "lowpoint": ("low_point", "short_in"),
    "frompin": ("from_pin", "short"),
    "score": ("score", "raw"),
}


CANON_PREFIXES = [
    ("clubspeed", "clubspeed"),
    ("ballspeed", "ballspeed"),
    ("attack", "attackang."),
    ("spinrate", "spinrate"),
    ("spinaxis", "spinaxis"),
    ("carry", "carry"),
    ("total", "total"),
    ("sidetot", "sidetot."),
    ("side", "side"),
    ("curve", "curve"),
    ("smash", "smashfac."),
    ("clubpath", "clubpath"),
    ("faceto", "facetopath"),
    ("face", "faceang."),
    ("launchang", "launchang."),
    ("launchdir", "launchdir."),
    ("height", "height"),
    ("land", "landang."),
    ("dyn", "dyn.loft"),
    ("hang", "hangtime"),
    ("swingpl", "swingplane"),
    ("swingdir", "swingdir."),
    ("low", "lowpoint"),
    ("frompin", "frompin"),
    ("score", "score"),
]


def canon_key(label: str):
    k = re.sub(r"\s+", "", label.lower())
    if k in CANON:
        return CANON[k]
    for prefix, canon in CANON_PREFIXES:
        if k.startswith(prefix):
            return CANON[canon]
    return (re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_") or "col", "raw")


INTEGER_KEYS = {"spin_rate"}


def clean_cell_text(txt: str) -> str:
    """Strip recogniser junk from a cell read, keeping only numeric characters."""
    t = txt.replace("一", "-").replace("—", "-").replace("–", "-")
    t = re.sub(r"[^0-9.\-LRO]", "", t)
    t = re.sub(r"O(?=[LR]$)", "", t)  # '24.0OR' -> '24.0R'
    t = re.sub(r"O", "0", t)
    t = re.sub(r"^-+$", "-", t)
    return t


def choose_value(cell_txts: list[str], det_txt: str | None, key: str):
    """Reconcile several cell-crop reads with the detection-pass token for one cell.

    Candidates are scored on: agreement with other reads, having a decimal point
    (every Trackman column except spin rate shows one), and digit count (the
    detector tends to clip leading digits, the recogniser sometimes drops one).
    """
    cands = [clean_cell_text(t) for t in cell_txts]
    d = clean_numeric(det_txt) if det_txt is not None else ""
    if d:
        cands.append(d)
    parsed = [(t, parse_value(t)) for t in cands]
    valid = [(t, v) for t, v in parsed if v is not None]
    if not valid:
        return None
    # A dash in the detection pass means "no data" -- trust it over junk reads
    if d in {"-", "--"}:
        return None
    expects_decimal = key not in INTEGER_KEYS
    if expects_decimal and any("." in t for t, _ in valid):
        # A read without the decimal point is structurally wrong for this column
        valid = [(t, v) for t, v in valid if "." in t]

    def digits(t):
        return re.sub(r"\D", "", t)

    def score(t, v):
        s = 0.0
        # agreement with others (compare magnitudes; sign handled separately)
        s += 2.0 * sum(1 for _, v2 in valid if abs(v2) == abs(v)) - 2.0
        s += 1.0 * sum(1 for _, v2 in valid if v2 == v) - 1.0  # exact agreement (L/R side)
        if expects_decimal and "." in t:
            s += 5.0
        if key == "smash" and re.search(r"\.\d\d$", t):
            s += 1.0
        s += 0.6 * len(digits(t))
        if re.match(r"^0\d", t):  # '00.0' style leading zero junk
            s -= 1.0
        return s

    best_t, best_v = max(valid, key=lambda tv: score(*tv))
    # A thin minus sign is easily dropped by the recogniser but almost never
    # invented, so if any read of the same digits was negative, go negative.
    if best_v > 0 and any(t.startswith("-") and digits(t) == digits(best_t) for t, _ in valid):
        return -best_v
    return best_v


def convert(value, kind, unit):
    if value is None:
        return None
    unit = (unit or "").lower()
    if kind == "speed":
        if unit == "m/s":
            return round(value * 2.236936, 1)
        if unit == "km/h":
            return round(value * 0.621371, 1)
        return value  # mph
    if kind == "dist":  # -> yards
        if unit == "m":
            return round(value * 1.093613, 1)
        if unit == "ft":
            return round(value / 3.0, 1)
        return value  # yds
    if kind == "short":  # -> feet
        if unit == "m":
            return round(value * 3.28084, 1)
        if unit == "yds":
            return round(value * 3.0, 1)
        return value
    if kind == "short_in":  # -> inches
        if unit == "m":
            return round(value * 39.3701, 1)
        return value
    return value


# ----------------------------------------------------------------------------
# Table parsing (shared between session and combine reports)
# ----------------------------------------------------------------------------


class Table:
    def __init__(self, name: str, meta: dict):
        self.name = name
        self.meta = meta
        self.columns: list[dict] = []  # {label, unit, key, kind, x}
        self.shots: list[dict] = []
        self.average: dict = {}
        self.consistency: dict = {}
        self.complete = False


def page_lines(page):
    h = page["h"]
    tol = h * 0.008
    return group_lines(page["items"], tol)


def line_text(line):
    return " ".join(it["text"] for it in line)


def find_data_lines(lines):
    """Return list of (row_no, line) for shot rows and dict for average/consistency lines."""
    rows, avg, cons = [], None, None
    for ln in lines:
        first = ln[0]["text"].strip()
        m = ROW_NO_RE.match(first)
        low = first.lower()
        if m and len(ln) >= 3:
            rows.append((int(m.group(1)), ln))
        elif re.match(r"^a[vy]era", low):
            avg = ln
        elif re.match(r"^c[o0]+ns[il1]st", low):
            cons = ln
    return rows, avg, cons


def value_items(line, skip_first=True):
    items = line[1:] if skip_first else line
    return [it for it in items if is_value_token(it["text"])]


def build_columns(page, lines, rows, avg, cons, title_y, first_row_y):
    """Determine column centres from data rows and label them from header tokens."""
    w = page["w"]
    xs = []
    for _, ln in rows:
        xs += [cx(it) for it in value_items(ln)]
    for ln in (avg, cons):
        if ln:
            xs += [cx(it) for it in value_items(ln)]
    if not xs:
        return []
    centers = cluster_1d(xs, w * 0.03)

    # Header tokens live between the title line and the first data row.
    header_items = [
        it for it in page["items"] if title_y < cy(it) < first_row_y - page["h"] * 0.004
    ]
    labels = defaultdict(list)
    units = {}
    for it in header_items:
        t = it["text"].strip()
        if not t or "," in t or "/" in t and t.lower() not in UNIT_TOKENS:
            continue  # legend like "m, m/s" or "Yds/Ft, Mph"
        if t.lower() in UNIT_TOKENS:
            idx = nearest(centers, cx(it), w * 0.035)
            if idx is not None:
                units[idx] = t
            continue
        # A label box may span several columns when OCR merges adjacent headers
        # (e.g. "Club Path Face Ang."). Split its words evenly across them.
        spanned = [i for i, c in enumerate(centers) if it["x0"] - w * 0.01 <= c <= it["x1"] + w * 0.01]
        if len(spanned) > 1:
            words = re.findall(r"[A-Za-z]+\.?", re.sub(r"(?<=[a-z.])(?=[A-Z])", " ", t))
            per = max(1, round(len(words) / len(spanned)))
            for j, i in enumerate(spanned):
                chunk = words[j * per : (j + 1) * per] if j < len(spanned) - 1 else words[j * per :]
                if chunk:
                    labels[i].append({**it, "text": " ".join(chunk)})
            continue
        idx = nearest(centers, cx(it), w * 0.035)
        if idx is None:
            continue
        labels[idx].append(it)

    columns = []
    for i, c in enumerate(centers):
        lab_items = sorted(labels.get(i, []), key=cy)
        label = " ".join(it["text"].strip() for it in lab_items) or f"col{i+1}"
        key, kind = canon_key(label)
        columns.append({"label": label, "unit": units.get(i), "key": key, "kind": kind, "x": c})
    return columns


def read_row(table: Table, page, pno: int, y: float, reader: CellReader, line=None) -> dict:
    """Read every column value for the row centred at y using cell-level OCR.

    Falls back to the detection-pass token (if any) when the cell read is not
    parseable.
    """
    w = page["w"]
    centers = [c["x"] for c in table.columns]
    if len(centers) > 1:
        spacing = min(b - a for a, b in zip(centers, centers[1:]))
    else:
        spacing = w * 0.06
    hw = min(spacing * 0.46, w * 0.035)
    hh = page["h"] * 0.014

    detected = {}
    if line is not None:
        for it in value_items(line, skip_first=True):
            idx = nearest(centers, cx(it), w * 0.035)
            if idx is not None:
                detected[idx] = it["text"]

    out = {}
    for idx, col in enumerate(table.columns):
        txts = reader.read_variants(pno, col["x"], y, hw, hh)
        val = choose_value(txts, detected.get(idx), col["key"])
        out[col["key"]] = convert(val, col["kind"], col["unit"])
    return out


def fill_missing_rows(rows):
    """rows: list of (no, y). Insert interpolated entries for skipped shot numbers."""
    if len(rows) < 2:
        return [(n, y, ln) for n, y, ln in rows]
    rows = sorted(rows, key=lambda r: r[1])
    gaps = [(b[1] - a[1]) / (b[0] - a[0]) for a, b in zip(rows, rows[1:]) if b[0] > a[0]]
    if not gaps:
        return rows
    step = float(np.median(gaps))
    out = [rows[0]]
    for prev, cur in zip(rows, rows[1:]):
        for k in range(prev[0] + 1, cur[0]):
            out.append((k, prev[1] + step * (k - prev[0]), None))
        out.append(cur)
    return out


def find_title(lines, page, kind):
    """Locate the table title near the top of a page.

    Returns (name, meta, title_y) or None.
    """
    h = page["h"]
    top_lines = [ln for ln in lines if cy(ln[0]) < h * 0.22]
    if kind == "session":
        for ln in top_lines:
            for it in ln:
                t = norm_text(it["text"])
                if CLUB_RE.match(t):
                    return (t.replace(" ", ""), {}, cy(it) + h * 0.01)
    else:  # combine target page: "Target  Score" then "60yds  66.0" / "Drive  57.2"
        for ln in top_lines:
            txt = line_text(ln).lower()
            if "target" in txt and "score" in txt:
                # the value line is the next line below; OCR often merges "60yds66.0"
                y = cy(ln[0])
                below = [l for l in lines if y < cy(l[0]) < y + h * 0.06]
                if below:
                    vals = below[0]
                    joined = "".join(it["text"] for it in vals).replace(" ", "")
                    joined = re.sub(r"(?<=\d)[Oo](?=\d|yds|m\d)", "0", joined)
                    m = re.match(r"^(\d{2,3})(?:yds|m)?(\d+\.\d+)?$", joined, re.I)
                    tgt, score = None, None
                    if m:
                        tgt = int(m.group(1))
                        score = float(m.group(2)) if m.group(2) else None
                        if tgt not in COMBINE_TARGETS:
                            # OCR noise such as "70Oyds" -> 700; snap to a real target
                            alt = int(m.group(1).rstrip("0")) if m.group(1).rstrip("0") else tgt
                            cands = [t for t in COMBINE_TARGETS if t in (alt, tgt // 10)]
                            tgt = cands[0] if cands else tgt
                    else:
                        m = re.match(r"^drive[r]?(\d+\.\d+)?$", joined, re.I)
                        if m:
                            tgt = "Drive"
                            score = float(m.group(1)) if m.group(1) else None
                    if tgt is not None:
                        return (str(tgt), {"target": tgt, "target_score": score}, cy(vals[0]) + h * 0.01)
    return None


def parse_tables(pages, kind: str, reader: CellReader) -> list[Table]:
    tables: list[Table] = []
    current: Table | None = None
    for pno, page in enumerate(pages, start=1):
        lines = page_lines(page)
        rows, avg, cons = find_data_lines(lines)
        title = find_title(lines, page, kind)
        if title:
            name, meta, title_y = title
            current = Table(name, meta)
            current.meta["page"] = pno
            tables.append(current)
            if rows or avg:
                first_row_y = min([cy(ln[0]) for _, ln in rows] + ([cy(avg[0])] if avg else []))
                current.columns = build_columns(page, lines, rows, avg, cons, title_y, first_row_y)
        if current is None or not current.columns:
            continue
        if current.complete and (rows or avg or cons):
            # Data with no title after a completed table -- shouldn't happen; start orphan table
            current = Table(f"{current.name}?", {"page": pno})
            tables.append(current)
            continue
        row_entries = [(no, cy(ln[0]), ln) for no, ln in rows]
        # If the detector missed the first row(s) on a continuation page, extend backwards
        if row_entries and current.shots:
            expected_first = current.shots[-1]["shot"] + 1
            first_no = min(r[0] for r in row_entries)
            if first_no > expected_first and len(row_entries) >= 2:
                srt = sorted(row_entries, key=lambda r: r[1])
                step = (srt[-1][1] - srt[0][1]) / max(1, srt[-1][0] - srt[0][0])
                for k in range(expected_first, first_no):
                    y = srt[0][1] - step * (first_no - k)
                    if y > page["h"] * 0.05:
                        row_entries.append((k, y, None))
        for no, y, ln in fill_missing_rows(row_entries):
            vals = read_row(current, page, pno, y, reader, ln)
            vals["shot"] = no
            current.shots.append(vals)
        if avg:
            current.average = read_row(current, page, pno, cy(avg[0]), reader, avg)
        if cons:
            current.consistency = read_row(current, page, pno, cy(cons[0]), reader, cons)
            current.complete = True
    return tables


# ----------------------------------------------------------------------------
# Report-level parsing
# ----------------------------------------------------------------------------


def date_from_name(stem: str):
    m = re.match(r"^(\d{4})(\d{2})(\d{2})", stem)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return None


def parse_session(path: Path) -> dict:
    pages = ocr_pdf(path)
    reader = CellReader(path)
    tables = parse_tables(pages, "session", reader)
    reader.save()
    clubs = []
    for t in tables:
        if not t.shots:
            continue
        shots = [s for s in t.shots]
        # Trackman marks shots without club data with smash = -1.00
        for s in shots:
            if s.get("smash") is not None and s["smash"] < 0:
                s["smash"] = None
        clubs.append(
            {
                "club": t.name,
                "columns": [{"label": c["label"], "unit": c["unit"], "key": c["key"]} for c in t.columns],
                "shots": shots,
                "average": t.average,
                "consistency": t.consistency,
            }
        )
    return {
        "id": path.stem,
        "date": date_from_name(path.stem),
        "file": str(path.relative_to(ROOT)).replace("\\", "/"),
        "pages": len(pages),
        "clubs": clubs,
    }


def parse_combine(path: Path) -> dict:
    pages = ocr_pdf(path)
    reader = CellReader(path)
    # Page 1: overall score and estimated handicap
    score, handicap = None, None
    if pages:
        p1 = pages[0]
        items = p1["items"]

        def below_label(label_pred, w_tol=0.11):
            lab = [it for it in items if label_pred(it["text"].lower())]
            if not lab:
                return None
            lab = lab[0]
            cands = [
                it
                for it in items
                if cy(it) > cy(lab)
                and abs(cx(it) - cx(lab)) < p1["w"] * w_tol
                and re.match(r"^\d+(\.\d+)?$", clean_numeric(it["text"]))
            ]
            cands.sort(key=lambda it: cy(it) - cy(lab))
            return float(clean_numeric(cands[0]["text"])) if cands else None

        score = below_label(lambda t: "combine score" in t)
        handicap = below_label(lambda t: "estimated handicap" in t)
        # Fallback: the boxes sit at fixed positions on the cover page
        w, h = p1["w"], p1["h"]
        if score is None:
            score = parse_value(clean_cell_text(reader.read(1, w * 0.499, h * 0.574, w * 0.05, h * 0.04)))
        if handicap is None:
            handicap = parse_value(clean_cell_text(reader.read(1, w * 0.753, h * 0.574, w * 0.05, h * 0.04)))
    tables = parse_tables(pages, "combine", reader)
    reader.save()
    targets = []
    for t in tables:
        if not t.shots:
            continue
        # The bold Average row is the most reliable source for the target score
        tscore = t.average.get("score") if t.average.get("score") is not None else t.meta.get("target_score")
        targets.append(
            {
                "target": t.meta.get("target"),
                "target_score": tscore,
                "title_score": t.meta.get("target_score"),
                "columns": [{"label": c["label"], "unit": c["unit"], "key": c["key"]} for c in t.columns],
                "shots": t.shots,
                "average": t.average,
                "consistency": t.consistency,
            }
        )
    return {
        "id": path.stem,
        "date": date_from_name(path.stem),
        "file": str(path.relative_to(ROOT)).replace("\\", "/"),
        "score": score,
        "estimated_handicap": handicap,
        "targets": targets,
    }


# ----------------------------------------------------------------------------
# Validation / reporting
# ----------------------------------------------------------------------------


def validate_session(s: dict) -> list[str]:
    warnings = []
    if not s["clubs"]:
        warnings.append("no club tables found")
    for c in s["clubs"]:
        nums = [x["shot"] for x in c["shots"]]
        expected = list(range(1, len(nums) + 1))
        if nums != expected:
            warnings.append(f"{c['club']}: shot numbers not sequential ({nums[:5]}...)")
        if not c["consistency"]:
            warnings.append(f"{c['club']}: no consistency row (table may be truncated)")
        for col in c["columns"]:
            if col["label"].startswith("col"):
                warnings.append(f"{c['club']}: unlabeled column {col['label']}")
        # Cross-check OCR against the report's own average for every column.
        # Trackman averages exclude shots with missing data, which we drop too.
        for col in c["columns"]:
            key = col["key"]
            vals = [x.get(key) for x in c["shots"] if x.get(key) is not None]
            rep = c["average"].get(key)
            if vals and rep is not None:
                mine = sum(vals) / len(vals)
                tol = 60 if key == "spin_rate" else max(0.6, 0.02 * abs(rep))
                if abs(mine - rep) > tol:
                    warnings.append(
                        f"{c['club']}: {key} mean {mine:.1f} != report avg {rep:.1f} (possible OCR error)"
                    )
    return warnings


def validate_combine(c: dict) -> list[str]:
    warnings = []
    if c["score"] is None:
        warnings.append("no combine score found")
    if len(c["targets"]) != 10:
        warnings.append(f"expected 10 targets, found {len(c['targets'])}")
    for t in c["targets"]:
        scores = [s.get("score") for s in t["shots"] if s.get("score") is not None]
        rep = t.get("target_score")
        if scores and rep is not None and abs(sum(scores) / len(scores) - rep) > 0.6:
            warnings.append(f"target {t['target']}: score mean {sum(scores)/len(scores):.1f} != {rep}")
        if len(t["shots"]) != 6:
            warnings.append(f"target {t['target']}: {len(t['shots'])} shots (expected 6)")
    return warnings


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------


SHOT_COLUMNS = [
    "club_speed", "ball_speed", "smash", "attack_angle", "club_path", "face_angle", "face_to_path",
    "launch_angle", "launch_direction", "spin_rate", "spin_axis", "dynamic_loft", "carry", "total",
    "side", "side_total", "curve", "height", "land_angle", "hang_time",
]
CSV_UNITS = {
    "club_speed": "mph", "ball_speed": "mph", "smash": "", "attack_angle": "deg", "club_path": "deg",
    "face_angle": "deg", "face_to_path": "deg", "launch_angle": "deg", "launch_direction": "deg",
    "spin_rate": "rpm", "spin_axis": "deg", "dynamic_loft": "deg", "carry": "yds", "total": "yds",
    "side": "yds(+R/-L)", "side_total": "yds(+R/-L)", "curve": "yds(+R/-L)", "height": "ft",
    "land_angle": "deg", "hang_time": "s", "score": "", "from_pin": "ft",
}


def write_csvs(sessions, combines):
    """Flat, spreadsheet-friendly exports: one row per shot (all units normalised)."""
    import csv

    def cell(v):
        return "" if v is None else v

    with (DATA_DIR / "shots.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["session_id", "date", "club", "shot", "row_type", "warmup"] + [f"{k}" for k in SHOT_COLUMNS])
        w.writerow(["", "", "", "", "", ""] + [CSV_UNITS.get(k, "") for k in SHOT_COLUMNS])
        for s in sessions:
            for c in s["clubs"]:
                for sh in c["shots"]:
                    w.writerow([s["id"], s["date"], c["club"], sh["shot"], "shot", int(bool(sh.get("warmup")))] + [cell(sh.get(k)) for k in SHOT_COLUMNS])
                if c["average"]:
                    w.writerow([s["id"], s["date"], c["club"], "", "average", ""] + [cell(c["average"].get(k)) for k in SHOT_COLUMNS])
                if c["consistency"]:
                    w.writerow([s["id"], s["date"], c["club"], "", "consistency", ""] + [cell(c["consistency"].get(k)) for k in SHOT_COLUMNS])

    ccols = ["score", "club_speed", "ball_speed", "spin_rate", "attack_angle", "carry", "total", "side", "from_pin"]
    with (DATA_DIR / "combine_shots.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["combine_id", "date", "combine_score", "estimated_handicap", "target", "target_score", "shot", "row_type"] + ccols)
        w.writerow(["", "", "", "", "yds", "", "", ""] + [CSV_UNITS.get(k, "") for k in ccols])
        for c in combines:
            for t in c["targets"]:
                for sh in t["shots"]:
                    w.writerow([c["id"], c["date"], c["score"], c["estimated_handicap"], t["target"], t["target_score"], sh["shot"], "shot"] + [cell(sh.get(k)) for k in ccols])
                if t["average"]:
                    w.writerow([c["id"], c["date"], c["score"], c["estimated_handicap"], t["target"], t["target_score"], "", "average"] + [cell(t["average"].get(k)) for k in ccols])


# Least to most loft. Used to find "the loftiest club of the day" for the warm-up rule.
LOFT_ORDER = [
    "Driver", "3Wood", "5Wood", "7Wood", "2Hybrid", "3Hybrid", "4Hybrid", "5Hybrid",
    "2Iron", "3Iron", "4Iron", "5Iron", "6Iron", "7Iron", "8Iron", "9Iron",
    "PitchingWedge", "PW", "GapWedge", "48Wedge", "50Wedge", "52Wedge", "54Wedge",
    "SandWedge", "56Wedge", "58Wedge", "LobWedge", "60Wedge", "62Wedge",
]
DEFAULT_WARMUP_SHOTS = 4
NOTES_FILE = REPORTS_DIR / "session-notes.csv"


def loft_rank(club: str) -> int:
    try:
        return LOFT_ORDER.index(club)
    except ValueError:
        m = re.match(r"(\d{2})Wedge", club)
        return 100 + int(m.group(1)) if m else -1


def read_session_notes() -> dict:
    """reports/session-notes.csv -> {session_id: {warmup_club, warmup_shots, note}}.

    Columns: session_id, warmup_club, warmup_shots, note.
    warmup_shots may be a number or 'all'; blank warmup_club means 'apply the default rule'.
    """
    import csv

    notes = {}
    if not NOTES_FILE.exists():
        return notes
    with NOTES_FILE.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            sid = (row.get("session_id") or "").strip()
            if not sid or sid.startswith("#"):
                continue
            notes[sid] = {
                "warmup_club": (row.get("warmup_club") or "").strip() or None,
                "warmup_shots": (row.get("warmup_shots") or "").strip() or None,
                "note": (row.get("note") or "").strip() or None,
            }
    return notes


def tag_warmups(sessions: list[dict]) -> None:
    """Mark warm-up shots: by default the first DEFAULT_WARMUP_SHOTS of the loftiest club in
    the session; reports/session-notes.csv can override the club and count ('all' allowed)."""
    notes = read_session_notes()
    for s in sessions:
        if not s["clubs"]:
            continue
        n = notes.get(s["id"], {})
        s["note"] = n.get("note")
        club = n.get("warmup_club") or max((c["club"] for c in s["clubs"]), key=loft_rank)
        shots_spec = n.get("warmup_shots") or str(DEFAULT_WARMUP_SHOTS)
        for c in s["clubs"]:
            is_target = c["club"] == club
            k = len(c["shots"]) if shots_spec.lower() == "all" else int(shots_spec)
            for i, sh in enumerate(c["shots"]):
                sh["warmup"] = bool(is_target and i < k)
        s["warmup_rule"] = f"{club}: {'all' if shots_spec.lower() == 'all' else 'first ' + shots_spec} shots"
        if club not in {c["club"] for c in s["clubs"]}:
            s["warnings"].append(f"session-notes warmup_club {club} not in this session")


def md_to_html(md: str) -> str:
    """Tiny Markdown -> HTML for REPORT.md (headings, paragraphs, lists, tables, bold)."""
    import html as _html

    def inline(t):
        t = _html.escape(t, quote=False)
        t = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)
        t = re.sub(r"`(.+?)`", r"<code>\1</code>", t)
        return t

    out, para, lst, table = [], [], None, []

    def flush_para():
        if para:
            out.append("<p>" + inline(" ".join(para)) + "</p>")
            para.clear()

    def flush_list():
        nonlocal lst
        if lst:
            tag, items = lst
            out.append(f"<{tag}>" + "".join(f"<li>{inline(i)}</li>" for i in items) + f"</{tag}>")
            lst = None

    def flush_table():
        if table:
            head = table[0]
            body = [r for r in table[2:]] if len(table) > 1 and re.match(r"^[\s|:-]+$", table[1]) else table[1:]
            cells = lambda r: [c.strip() for c in r.strip().strip("|").split("|")]
            h = "<tr>" + "".join(f"<th class='l'>{inline(c)}</th>" for c in cells(head)) + "</tr>"
            b = "".join("<tr>" + "".join(f"<td class='l'>{inline(c)}</td>" for c in cells(r)) + "</tr>" for r in body)
            out.append(f"<table><thead>{h}</thead><tbody>{b}</tbody></table>")
            table.clear()

    for line in md.splitlines():
        s = line.rstrip()
        if s.startswith("|"):
            flush_para(); flush_list(); table.append(s); continue
        flush_table()
        m = re.match(r"^(#{1,3})\s+(.*)", s)
        if m:
            flush_para(); flush_list()
            lvl = len(m.group(1))
            out.append(f"<h{lvl}>{inline(m.group(2))}</h{lvl}>" if lvl > 1 else f"<h1 style='font-size:20px'>{inline(m.group(2))}</h1>")
            continue
        m = re.match(r"^(\d+)\.\s+(.*)", s)
        if m:
            flush_para()
            if not lst or lst[0] != "ol": flush_list(); lst = ("ol", [])
            lst[1].append(m.group(2)); continue
        m = re.match(r"^[-*]\s+(.*)", s)
        if m:
            flush_para()
            if not lst or lst[0] != "ul": flush_list(); lst = ("ul", [])
            lst[1].append(m.group(1)); continue
        if not s.strip():
            flush_para(); flush_list(); continue
        para.append(s.strip())
    flush_para(); flush_list(); flush_table()
    return "\n".join(out)


def debug_dump(path: Path):
    pages = ocr_pdf(path)
    for pno, page in enumerate(pages, start=1):
        print(f"\n===== PAGE {pno} ({page['w']}x{page['h']}) =====")
        for ln in page_lines(page):
            y = int(cy(ln[0]))
            print(f"y={y:5d} | " + " | ".join(f"{it['text']}@{int(cx(it))}" for it in ln))


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--debug", metavar="PDF", help="dump OCR lines for one PDF and exit")
    args = ap.parse_args()

    if args.debug:
        debug_dump(Path(args.debug).resolve())
        return

    session_files = sorted(p for p in REPORTS_DIR.glob("*.pdf"))
    combine_files = sorted(p for p in COMBINES_DIR.glob("*.pdf")) if COMBINES_DIR.exists() else []

    sessions, combines = [], []
    problems = []
    print(f"Sessions: {len(session_files)}  Combines: {len(combine_files)}")
    for p in session_files:
        s = parse_session(p)
        w = validate_session(s)
        s["warnings"] = w
        sessions.append(s)
        n = sum(len(c["shots"]) for c in s["clubs"])
        print(f"  {s['id']}: {len(s['clubs'])} clubs, {n} shots" + (f"  WARN: {'; '.join(w)}" if w else ""))
        problems += [f"{s['id']}: {x}" for x in w]
    for p in combine_files:
        c = parse_combine(p)
        w = validate_combine(c)
        c["warnings"] = w
        combines.append(c)
        print(
            f"  combine {c['id']}: score={c['score']} hcp={c['estimated_handicap']} targets={len(c['targets'])}"
            + (f"  WARN: {'; '.join(w)}" if w else "")
        )
        problems += [f"combine {c['id']}: {x}" for x in w]

    tag_warmups(sessions)

    DATA_DIR.mkdir(exist_ok=True)
    DASHBOARD_DIR.mkdir(exist_ok=True)
    (DATA_DIR / "sessions.json").write_text(json.dumps(sessions, indent=1), encoding="utf-8")
    (DATA_DIR / "combines.json").write_text(json.dumps(combines, indent=1), encoding="utf-8")
    write_csvs(sessions, combines)
    payload = {"generated": __import__("datetime").date.today().isoformat(), "sessions": sessions, "combines": combines}
    (DASHBOARD_DIR / "data.js").write_text(
        "// Generated by scripts/extract_reports.py -- do not edit by hand.\n"
        "window.TRACKMAN_DATA = " + json.dumps(payload) + ";\n",
        encoding="utf-8",
    )
    report = ROOT / "REPORT.md"
    if report.exists():
        (DASHBOARD_DIR / "findings.js").write_text(
            "// Generated from REPORT.md by scripts/extract_reports.py -- edit REPORT.md, not this file.\n"
            "window.TRACKMAN_FINDINGS = " + json.dumps(md_to_html(report.read_text(encoding="utf-8"))) + ";\n",
            encoding="utf-8",
        )
    build_single_file()
    print(f"\nWrote {DATA_DIR / 'sessions.json'}, {DATA_DIR / 'combines.json'}, {DASHBOARD_DIR / 'data.js'}, {DASHBOARD_DIR / 'trackman-dashboard.html'}")
    try:
        from build_report_pdf import build as build_pdf
        build_pdf()
    except Exception as e:  # PDF is a convenience; never fail the extraction over it
        print(f"PDF build skipped: {e}")
    if problems:
        print(f"\n{len(problems)} warning(s):")
        for p in problems:
            print("  -", p)


def build_single_file():
    """Inline vendor/chart.umd.js, data.js and findings.js into one shareable HTML file."""
    index = DASHBOARD_DIR / "index.html"
    if not index.exists():
        return
    html = index.read_text(encoding="utf-8")
    for src in ("vendor/chart.umd.js", "data.js", "findings.js"):
        f = DASHBOARD_DIR / src
        if not f.exists():
            continue
        js = f.read_text(encoding="utf-8")
        if src != "vendor/chart.umd.js":
            js = js.replace("</", "<\\/")  # JSON payloads: keep any "</script>" inert
        html = html.replace(f'<script src="{src}"></script>', "<script>\n" + js + "\n</script>", 1)
    (DASHBOARD_DIR / "trackman-dashboard.html").write_text(html, encoding="utf-8")


if __name__ == "__main__":
    main()
