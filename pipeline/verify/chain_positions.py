import argparse
import json
import math
import os
import random
import subprocess
import sys
import tempfile
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extract"))

from building_index import ensure
from overture_places import ON_BUILDING_METRES, distance

TILE_ERROR_MAX_M = 1.0
EVIDENCE_MIN = 97.0
BORDER_SLACK_M = 150
SAMPLE_TILES = 300
ZOOM = 16


def tile_of(lon, lat):
    n = 2**ZOOM
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def read_features(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip() and "\"b\"" in line]


ADDRESS_CELL = 0.0004


def address_cells(path):
    cells = {}
    if not os.path.exists(path):
        return cells
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            cells.setdefault((int(row["lon"] / ADDRESS_CELL), int(row["lat"] / ADDRESS_CELL)), []).append((row["lon"], row["lat"]))
    return cells


def near_address(cells, lon, lat):
    cx, cy = int(lon / ADDRESS_CELL), int(lat / ADDRESS_CELL)
    return any(distance((lon, lat), point) <= ON_BUILDING_METRES for dx in (-1, 0, 1) for dy in (-1, 0, 1) for point in cells.get((cx + dx, cy + dy), ()))


def evidence(feature, index, addresses=None):
    props = feature["properties"]
    if props.get("s") == "osm":
        return "osm"
    lon, lat = feature["geometry"]["coordinates"]
    gap, _ = index.nearest(lon, lat)
    if gap <= ON_BUILDING_METRES:
        return "bina"
    if addresses and near_address(addresses, lon, lat):
        return "adres"
    return "yok"


def tile_roundtrip(pmtiles, features, seed=7):
    rng = random.Random(seed)
    sample = rng.sample(features, min(SAMPLE_TILES, len(features)))
    worst = 0.0
    missing = 0
    for feature in sample:
        lon, lat = feature["geometry"]["coordinates"]
        x, y = tile_of(lon, lat)
        out = subprocess.run(["tippecanoe-decode", pmtiles, str(ZOOM), str(x), str(y)], capture_output=True, text=True).stdout
        found = None
        for line in out.splitlines():
            line = line.strip().rstrip(",")
            if not line.startswith('{ "type": "Feature"'):
                continue
            decoded = json.loads(line)
            if decoded["properties"].get("name") == feature["properties"]["name"] and decoded["properties"].get("b") == feature["properties"]["b"]:
                d = distance((lon, lat), tuple(decoded["geometry"]["coordinates"]))
                found = d if found is None else min(found, d)
        if found is None:
            missing += 1
        else:
            worst = max(worst, found)
    return worst, missing, len(sample)


def verify(work, pbf, plates, packs):
    index = ensure(pbf, os.path.join(work, "building-index.npz"))
    rows = []
    totals = Counter()
    worst_tile = 0.0
    tile_missing = 0
    tile_checked = 0
    for plate in plates:
        features = read_features(os.path.join(work, "overture", f"{plate}.geojsonl"))
        addresses = address_cells(os.path.join(work, "addresses", plate, "addresses.jsonl"))
        counts = Counter(evidence(f, index, addresses) for f in features)
        moved = Counter(f["properties"].get("s", "") for f in features)
        rows.append((plate, len(features), counts, moved))
        totals.update(counts)
        pmtiles = next((os.path.join(packs, plate, n) for n in sorted(os.listdir(os.path.join(packs, plate))) if n.startswith("places-")), None) if os.path.isdir(os.path.join(packs, plate)) else None
        if pmtiles and features:
            worst, missing, checked = tile_roundtrip(pmtiles, features)
            worst_tile = max(worst_tile, worst)
            tile_missing += missing
            tile_checked += checked
    return rows, totals, worst_tile, tile_missing, tile_checked


def render(rows, totals, worst_tile, tile_missing, tile_checked):
    total = sum(totals.values())
    share = 100 * (totals["osm"] + totals["bina"] + totals["adres"]) / total if total else 0
    without_address = 100 * (totals["osm"] + totals["bina"]) / total if total else 0
    lines = [
        "# Zincir simgelerinin konum denetimi",
        "",
        f"Her zincir noktası için bağımsız kanıt aranır: aynı zincirin OSM noktasına oturmuş (`osm`), bir binanın {ON_BUILDING_METRES} m içinde (`bina`) ya da bir OSM adres noktasının {ON_BUILDING_METRES} m içinde (`adres`). Hiçbiri yoksa `yok` (şüpheli).",
        "",
        "| İl | Nokta | OSM'e oturmuş | Binada | Kanıtsız | Binaya çekilen | Adreste |",
        "|---|---|---|---|---|---|---|",
    ]
    for plate, count, counts, moved in rows:
        lines.append(f"| {plate} | {count} | {counts['osm']} | {counts['bina']} | {counts['yok']} | {moved['bina']} | {counts['adres']} |")
    lines += [
        "",
        f"Toplam {total} nokta; kanıtlı pay %{share:.1f} (adres kanıtı olmadan %{without_address:.1f}; eşik en az %{EVIDENCE_MIN}).",
        f"Karo gidiş-dönüş: {tile_checked} örnekte en büyük sapma {worst_tile:.2f} m (eşik en çok {TILE_ERROR_MAX_M} m), karoda bulunamayan {tile_missing}.",
    ]
    passed = share >= EVIDENCE_MIN and worst_tile <= TILE_ERROR_MAX_M and tile_missing == 0
    lines.append("")
    lines.append("SONUÇ: " + ("GEÇTİ" if passed else "GEÇMEDİ"))
    return "\n".join(lines) + "\n", passed, share


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--work", required=True)
    parser.add_argument("--pbf", required=True)
    parser.add_argument("--packs", required=True)
    parser.add_argument("--plates", default="all")
    parser.add_argument("--report")
    args = parser.parse_args(argv)
    available = sorted(n[:-9] for n in os.listdir(os.path.join(args.work, "overture")) if n.endswith(".geojsonl"))
    plates = available if args.plates == "all" else args.plates.split(",")
    text, passed, share = render(*verify(args.work, args.pbf, plates, args.packs))
    if args.report:
        os.makedirs(os.path.dirname(args.report), exist_ok=True)
        with open(args.report, "w", encoding="utf-8") as f:
            f.write(text)
    print(text)
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
