import json
import os

FOLD = str.maketrans({"ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g", "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c", "â": "a", "î": "i", "û": "u"})

with open(os.path.join(os.path.dirname(__file__), "..", "..", "src", "native", "map", "chains.json"), encoding="utf-8") as f:
    CHAINS = json.load(f)

CHAIN_GROUP = {chain["id"]: chain["group"] for chain in CHAINS}


def fold(text):
    cleaned = "".join(ch if ch.isalnum() else " " for ch in (text or "").translate(FOLD).lower())
    return " ".join(cleaned.split())


LOOKUP = {fold(pattern): chain["id"] for chain in CHAINS for pattern in chain["patterns"]}
LONGEST = max(len(p.split()) for p in LOOKUP)


def match(text):
    words = fold(text).split()
    for size in range(min(LONGEST, len(words)), 0, -1):
        found = LOOKUP.get(" ".join(words[:size]))
        if found:
            return found
    return None


def chain_of(name, brand, group):
    found = match(brand) or match(name)
    if found and (CHAIN_GROUP[found] == group or CHAIN_GROUP[found] == "cargo"):
        return found
    return None
