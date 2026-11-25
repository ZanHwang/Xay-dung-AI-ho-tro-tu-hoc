import re
import unicodedata

# Aliases (diacritic-free) -> canonical subject key. Mirrors the frontend
# sample-bank matching so both agree on "the same subject".
_ALIASES = {
    "information_theory": "information_theory",
    "ly_thuyet_thong_tin": "information_theory",
    "machine_learning": "machine_learning",
    "hoc_may": "machine_learning",
    "nlp": "nlp",
    "natural_language_processing": "nlp",
    "xu_ly_ngon_ngu_tu_nhien": "nlp",
}


def _normalize(name: str) -> str:
    """Lowercase, strip diacritics, keep alnum + underscore, single spaces->_."""
    s = unicodedata.normalize("NFKD", name or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace("đ", "d").strip()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_")


def subject_key_for(name: str) -> str:
    """Canonical shared-bank key for a subject name.

    "Học máy" / "Machine Learning" -> "machine_learning"; an unknown name
    falls back to its normalized form so each distinct subject still has its
    own pool.
    """
    key = _normalize(name)
    if key in _ALIASES:
        return _ALIASES[key]
    return key


# Canonical subject keys that have a curated seed question bank.
SEED_SUBJECT_KEYS = {"machine_learning", "information_theory", "nlp"}
