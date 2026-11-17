import math

MATCH_METRES = 50
LATIN_MATCH_METRES = 120
CELL = 0.0016
LATIN_WORDS = ("railway", "station", "street", "square", "mosque", "avenue", "bridge")

GENERIC = {
    "egitim", "park", "market", "eczane", "okul", "hastane", "banka", "cami", "restoran", "kafe", "otel", "bakkal", "firin", "kuafor",
    "berber", "belediye", "akaryakit", "benzinlik", "dershane", "kres", "anaokulu", "universite", "magaza", "ofis", "supermarket",
    "noter", "saglik", "cocuk parki", "spor salonu", "oto yikama", "atm", "kuru temizleme", "tamirci", "kasap", "manav", "pastane",
    "lokanta", "pansiyon", "kutuphane", "mezarlik", "muhtarlik", "karakol", "itfaiye", "postane", "durak", "otopark", "tuvalet",
    "pharmacy", "hospital", "school", "restaurant", "cafe", "bank", "hotel", "education", "store", "shop", "mosque", "parking",
    "barber", "bakery", "gas station", "supermarket", "clinic", "library", "kindergarten",
}

FOLD = str.maketrans({"İ": "i", "I": "ı", "ı": "i", "ç": "c", "Ç": "c", "ğ": "g", "Ğ": "g", "ö": "o", "Ö": "o", "ş": "s", "Ş": "s", "ü": "u", "Ü": "u", "â": "a", "î": "i", "û": "u"})


def fold(text):
    return " ".join("".join(ch if ch.isalnum() else " " for ch in (text or "").translate(FOLD).lower()).split())


def is_generic(name):
    return fold(name) in GENERIC


def latin_pattern(name):
    return any(word in fold(name).split() for word in LATIN_WORDS)


KIND_WORDS = {
    "eczanesi", "hastanesi", "okulu", "lisesi", "ortaokulu", "ilkokulu", "camii", "belediyesi", "restoran", "restorani", "lokantasi",
    "kafesi", "oteli", "marketi", "bankasi", "subesi", "sube", "merkezi", "merkez", "yeni", "eski", "buyuk", "kucuk", "ve", "ltd", "sti",
}


def similar(a, b):
    first, second = fold(a), fold(b)
    if not first or not second:
        return False
    if first == second or first in second or second in first:
        return True
    skip = GENERIC | KIND_WORDS
    return bool({w for w in first.split() if len(w) >= 3 and w not in skip} & {w for w in second.split() if len(w) >= 3 and w not in skip})


def distance(a, b):
    dx = (a[0] - b[0]) * 111320 * math.cos(math.radians(a[1]))
    dy = (a[1] - b[1]) * 110540
    return math.hypot(dx, dy)


def index_osm(items):
    cells = {}
    for item in items:
        cells.setdefault((int(item["lon"] / CELL), int(item["lat"] / CELL)), []).append(item)
    return cells


def nearest(cells, lon, lat, group, limit=MATCH_METRES):
    cx, cy = int(lon / CELL), int(lat / CELL)
    best = None
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for item in cells.get((cx + dx, cy + dy), ()):
                if item["group"] != group:
                    continue
                gap = distance((lon, lat), (item["lon"], item["lat"]))
                if gap <= limit and (best is None or (gap, item["id"]) < (best[0], best[1]["id"])):
                    best = (gap, item)
    return best[1] if best else None


def choose(row, group, cells):
    primary = (row.get("name") or "").strip()
    own = (row.get("name_tr") or "").strip()
    if own and not is_generic(own):
        return {"name": primary, "name_tr": own, "blank": False, "source": "overture-tr"}
    match = nearest(cells, row["lon"], row["lat"], group, LATIN_MATCH_METRES if latin_pattern(primary) else MATCH_METRES) if cells else None
    if match and match["name"] and not is_generic(match["name"]):
        if latin_pattern(primary) or is_generic(primary) or similar(primary, match["name"]):
            return {"name": primary, "name_tr": match["name"], "blank": False, "source": "osm"}
    if is_generic(own or primary):
        return {"name": "", "name_tr": "", "blank": True, "source": "generic"}
    return {"name": primary, "name_tr": own, "blank": False, "source": "overture"}
