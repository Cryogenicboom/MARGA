"""CheMin mineral abundances from NASA PDS (MSL CheMin Mineral Abundance RDR, product type MIN).

Source: PDS Geosciences Node, data set MSL-M-CHEMIN-5-RDR-V1.0 (PDS4 bundle msl_chemin_derived,
collection data_chemin_min). Each product is a CSV table (MINERAL, PERCENT = weight %, ERROR = estimated
2-sigma analytical error) with a PDS3 label whose SPREADSHEET DESCRIPTION names the sample and states how
the table was derived, including any modelled clay and X-ray amorphous fractions of the whole sample.

File names follow the CheMin RDR Archive Volume SIS, section 2.2:
    <instr><config><sclk><prod><sol><site><drive><seqid><producer><ver>.<ext>
    instr "CM"; config "A_", "B_" or "__"; sclk 9 digits; prod "MIN"; sol 4 digits; site 3 characters;
    drive 4 characters; then sequence id, producer ("P" = CheMin PI) and a 1-character version.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

BASE = "https://pds-geosciences.wustl.edu/msl/msl-m-chemin-4-rdr-v1/mslcmn_1xxx"
INVENTORY_URL = f"{BASE}/data/collection_data_chemin_min_inventory.csv"
DATA_URL = f"{BASE}/data/rdr5"
DATASET_ID = "MSL-M-CHEMIN-5-RDR-V1.0"
CITATION = ("Vaniman, D., Mars Science Laboratory Chemistry & Mineralogy RDR Data V1.0, MSL-M-CHEMIN-5-RDR-V1.0, "
            "NASA Planetary Data System, 2012.")
ARCHIVE_PAGE = "https://pds-geosciences.wustl.edu/missions/msl/chemin.htm"
NAMING_DOC = f"{BASE}/document/chemin_rdr_avsis.htm"

NAME_RE = re.compile(
    r"^cm(?P<config>[ab]_|__)(?P<sclk>\d{9})(?P<prod>[a-z0-9]{3})(?P<sol>\d{4})(?P<site>[0-9a-z]{3})(?P<drive>[0-9a-z]{4})"
    r"(?P<seqid>[a-z0-9]{7})(?P<producer>[a-z])(?P<ver>[0-9a-z])$",
    re.I,
)


@dataclass(frozen=True)
class ProductName:
    name: str
    config: str
    sclk: int
    prod: str
    sol: int
    site: int
    drive: int
    seqid: str
    producer: str
    ver: str


def parse_product_name(name: str) -> ProductName:
    stem = Path(name).stem
    m = NAME_RE.match(stem)
    if not m:
        raise ValueError(f"not a CheMin RDR product name: {name}")
    g = m.groupdict()
    return ProductName(stem.lower(), g["config"].upper(), int(g["sclk"]), g["prod"].upper(), int(g["sol"]), int(g["site"]),
                       int(g["drive"]), g["seqid"].upper(), g["producer"].upper(), g["ver"].upper())


def inventory_products(text: str) -> list[str]:
    """Product names from the collection inventory (rows 'P,<lidvid>')."""
    out = []
    for row in csv.reader(io.StringIO(text)):
        if len(row) >= 2 and row[0].strip() == "P":
            lid = row[1].split("::")[0]
            out.append(lid.rsplit(":", 1)[-1])
    return out


def parse_table(text: str) -> list[dict[str, Any]]:
    """The MIN table: mineral name, weight percent and 2-sigma error, as given."""
    rows = list(csv.reader(io.StringIO(text.strip())))
    head = [h.strip().upper() for h in rows[0]]
    if head[:3] != ["MINERAL", "PERCENT", "ERROR"]:
        raise ValueError(f"unexpected CheMin MIN columns {head}")
    out = []
    for r in rows[1:]:
        if not r or not r[0].strip():
            continue
        out.append({"mineral": r[0].strip(), "wt_pct": float(r[1]), "err_2sigma": float(r[2])})
    return out


def _label_value(label: str, key: str) -> str | None:
    m = re.search(rf"^\s*{re.escape(key)}\s*=\s*(\"(?:[^\"]*)\"|\S+)", label, re.M)
    return m.group(1).strip('"').strip() if m else None


def label_description(label: str) -> str:
    """The SPREADSHEET object's DESCRIPTION (the HEADER object has its own, generic one)."""
    m = re.search(r"OBJECT\s*=\s*SPREADSHEET(.*?)END_OBJECT\s*=\s*SPREADSHEET", label, re.S)
    block = m.group(1) if m else label
    d = re.search(r"DESCRIPTION\s*=\s*\"(.*?)\"", block, re.S)
    return re.sub(r"\s+", " ", d.group(1)).strip() if d else ""


# The sample is named in the description, e.g. "... data for the Rock Hall drill sample, analyzed ...",
# "... for the first Glen Etive drill sample, ...", "... for the fourth scooped soil sample from the Rocknest target, ...".
_SCOOP_TARGET_RE = re.compile(r"\bscooped (?:soil |sand )?sample from the (?P<name>.+?) target\b")
_SAMPLE_RE = re.compile(
    r"\bdata for (?:the |a )?(?:(?:first|second|third|fourth|fifth|sixth) )?(?P<name>.+?) "
    r"(?P<kind>drill sample|scooped (?:soil |sand )?sample|scoop sample|sample)\b"
)
_NUM = r"~?\s*(?P<v>\d+(?:\.\d+)?)\s*(?:(?:\+/-|±)\s*(?P<e>\d+(?:\.\d+)?)\s*)?(?:wt|weight)\s*%"
# Stated fractions of the whole sample, e.g. "clay minerals was modeled ... at ~13 +/- 6 weight% of the total sample",
# "... ~34 +/- 15 weight% of the total sample consists of X-ray amorphous material".
_FRACTION_RE = {
    "clay": re.compile(r"\bclay minerals?\b[^.]*?" + _NUM, re.I),
    "amorphous": re.compile(_NUM + r"[^.]*?\bamorphous\b", re.I),
}


def sample_from_description(desc: str) -> tuple[str | None, str | None]:
    """(sample name, 'drill' | 'scoop' | None) as worded in the label, or (None, None) if it does not say."""
    m = _SCOOP_TARGET_RE.search(desc)
    if m:
        return m.group("name").strip(), "scoop"
    m = _SAMPLE_RE.search(desc)
    if not m:
        return None, None
    kind = m.group("kind")
    k = "drill" if kind.startswith("drill") else "scoop" if kind.startswith("scoop") else None
    return m.group("name").strip(), k


def sample_phrase(desc: str) -> str | None:
    """The label's own words for the sample, e.g. 'the first Glen Etive drill sample'."""
    m = re.search(r"\bdata for (the (?:\w+ )?(?:scooped (?:soil |sand )?sample from the .+? target|.+? (?:drill |scoop |scooped )?sample))\b", desc)
    return m.group(1) if m else None


def fractions_from_description(desc: str) -> dict[str, dict[str, Any]]:
    """Clay and X-ray amorphous fractions of the whole sample where the label states them, with the sentence quoted."""
    out: dict[str, dict[str, Any]] = {}
    sentences = re.split(r"(?<=[a-z0-9%)])\.\s+(?=[A-Z])", desc)
    for key, rx in _FRACTION_RE.items():
        for sentence in sentences:
            # Skip sentences about earlier label versions ("The label for the P1 version had reported ...").
            if re.search(r"\b(?:version|revision|had reported)\b", sentence, re.I):
                continue
            if key == "clay" and re.search(r"other than clay minerals", sentence) and not re.search(r"clay minerals?\b[^.]*?(?:at|was|were)\s*~", sentence):
                continue
            m = rx.search(sentence)
            if m:
                out[key] = {"wt_pct": float(m.group("v")), "plus_minus": float(m.group("e")) if m.group("e") else None,
                            "statement": sentence.strip().rstrip(".") + "."}
                break
    return out


def parse_label(label: str) -> dict[str, Any]:
    desc = label_description(label)
    name, kind = sample_from_description(desc)
    return {
        "product_id": _label_value(label, "PRODUCT_ID"),
        "source_product_id": _label_value(label, "SOURCE_PRODUCT_ID"),
        "release_id": _label_value(label, "RELEASE_ID"),
        "start_time": _label_value(label, "START_TIME"),
        "product_creation_time": _label_value(label, "PRODUCT_CREATION_TIME"),
        "sample": name,
        "sample_kind": kind,
        "sample_phrase": sample_phrase(desc),
        "fractions": fractions_from_description(desc),
        # A later analysis of a stored sample (not a revised table of the same analysis).
        "reanalysis": bool(re.search(r"\breanalysis of this sample\b", desc, re.I)),
        "description": desc,
    }


def latest_versions(names: list[str]) -> tuple[list[str], dict[str, list[str]]]:
    """Keep the highest version of each product (P1 < P2 < P3: later versions supersede earlier ones)."""
    best: dict[str, str] = {}
    for n in names:
        key = n[:-1].lower()
        if key not in best or n[-1].lower() > best[key][-1].lower():
            best[key] = n
    superseded = {b: sorted(n for n in names if n[:-1].lower() == k and n != b) for k, b in best.items()}
    return sorted(best.values()), {k: v for k, v in superseded.items() if v}


_UPPER_KEEP = {"OPAL-CT": "Opal-CT"}


def display_mineral(name: str) -> str:
    """'PLAGIOCLASE' -> 'Plagioclase'; names already in mixed case are kept as published."""
    n = name.strip()
    if n in _UPPER_KEEP:
        return _UPPER_KEEP[n]
    if n.upper() != n:
        return n
    return n[:1] + n[1:].lower()


# Display grouping by mineral family (standard mineralogy), used only to colour the charts.
FAMILIES: list[tuple[str, tuple[str, ...]]] = [
    ("feldspar", ("plagioclase", "andesine", "albite", "sanidine", "k-feldspar", "alkali feldspar", "feldspar")),
    ("pyroxene", ("augite", "pigeonite", "orthopyroxene", "enstatite", "pyroxene")),
    ("olivine", ("forsterite", "fe-forsterite", "olivine")),
    ("oxide", ("hematite", "magnetite", "ilmenite", "goethite", "akaganeite")),
    ("sulfate", ("anhydrite", "bassanite", "gypsum", "jarosite", "natrojarosite", "kieserite", "starkeyite", "mg-sulfate.4h2o")),
    ("silica", ("quartz", "cristobalite", "tridymite", "opal-ct")),
    ("carbonate", ("siderite", "ankerite", "fe-carbonate", "fe carbonate", "femgca carbonate")),
]


def mineral_family(name: str) -> str:
    n = name.strip().lower()
    for fam, members in FAMILIES:
        if n in members:
            return fam
    return "other"
