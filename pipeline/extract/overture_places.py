import argparse
import json
import os
import sys
import time

import math

from chains import CHAIN_GROUP, chain_of
import place_names

GROUPS = [
    ("pharmacy", ("pharmacy", "drugstore")),
    ("health", ("hospital", "clinic", "dentist", "doctor", "medical", "physician", "health", "veterinarian", "veterinary", "optometrist", "laboratory")),
    ("safety", ("police", "fire_station", "fire_department", "courthouse", "law_enforcement", "prison")),
    ("cargo", ("courier", "shipping_center", "shipping_or_delivery", "post_office", "postal", "mailing")),
    ("money", ("bank", "atm", "credit_union", "currency_exchange", "financial_service", "money_transfer")),
    ("fuel", ("gas_station", "fuel", "car_wash", "automotive_repair", "auto_repair", "ev_charging", "tire", "car_dealer", "auto_dealer", "auto_parts")),
    ("worship", ("place_of_worship", "mosque", "church", "synagogue", "temple")),
    ("lodging", ("hotel", "motel", "hostel", "guest_house", "lodging", "bed_and_breakfast", "resort", "campground")),
    ("market", ("grocery", "supermarket", "convenience_store", "shopping_center", "shopping_mall", "department_store", "marketplace", "bazaar", "butcher", "greengrocer", "fruits_and_vegetables")),
    ("food", ("restaurant", "cafe", "coffee", "bakery", "fast_food", "bar", "pub", "pastry", "dessert", "ice_cream", "tea_room", "kebab", "pizza", "burger", "food", "gastropub", "cafeteria")),
    ("public", ("government", "school", "kindergarten", "university", "college", "library", "public_service", "community_center", "bus_station", "train_station", "municipal", "cemetery", "public_bath", "turkish_bath")),
    ("shop", ("store", "shop", "boutique", "salon", "clothing", "furniture", "electronics", "jewelry", "mobile_phone", "retail", "shopping", "florist", "optician", "hairdresser", "barber", "beauty")),
]

IMPORTANT = ("hospital", "university", "shopping_center", "shopping_mall", "airport", "stadium")
LANDMARKS = ("historic_site", "museum", "monument", "castle", "palace", "stadium", "airport", "mall", "shopping_center", "national_park", "amusement_park", "bridge")
CHAIN_MIN_CONFIDENCE = 0.3
MIN_CONFIDENCE = 0.5
DIRECTORY_MIN_CONFIDENCE = 0.3
CLOSED = ("permanently_closed", "temporarily_closed")
MAX_NAME = 80


SHORT_WORD = 4


def has_word(category, tokens, word):
    if len(word) > SHORT_WORD:
        return word in category
    return any(token == word or token == word + "s" for token in tokens)


def classify(category):
    if not category:
        return "other"
    tokens = category.split("_")
    for group, words in GROUPS:
        if any(has_word(category, tokens, word) for word in words):
            return group
    return "other"


def landmark(category):
    return bool(category) and any(word in category for word in LANDMARKS)


def min_zoom(group, category, confidence, chain=None):
    if category and any(word in category for word in IMPORTANT):
        return 13
    if landmark(category) and confidence >= 0.6:
        return 14
    if chain:
        return 14
    if group in ("health", "pharmacy", "safety", "money", "fuel", "worship", "lodging", "market", "public", "cargo"):
        return 14 if confidence >= 0.8 else 15
    if group in ("food", "shop"):
        return 15 if confidence >= 0.85 else 16
    return 16


def chain_for(row):
    return chain_of(row.get("name"), row.get("brand"), classify(row.get("cat")))


def keep(row, minimum=MIN_CONFIDENCE):
    if minimum == MIN_CONFIDENCE and chain_for(row):
        minimum = CHAIN_MIN_CONFIDENCE
    name = (row.get("name") or "").strip()
    if len(name) < 2 or len(name) > MAX_NAME:
        return False
    if row.get("confidence") is None or row["confidence"] < minimum:
        return False
    if row.get("status") in CLOSED:
        return False
    return bool(row.get("cat"))


def other_addresses(text):
    try:
        values = json.loads(text) if text else []
    except ValueError:
        return []
    if not isinstance(values, list):
        return []
    seen = set()
    out = []
    for index, value in enumerate(values):
        cleaned = " ".join(value.split()) if isinstance(value, str) else ""
        key = cleaned.lower()
        if cleaned == "" or key in seen:
            continue
        seen.add(key)
        if index > 0:
            out.append(cleaned)
    first = " ".join(values[0].split()).lower() if values and isinstance(values[0], str) else None
    return [o for o in out if o.lower() != first]


def download(release, cache):
    path = os.path.join(cache, release, "tr-places-v2.parquet")
    if os.path.exists(path):
        return path
    import duckdb

    os.makedirs(os.path.dirname(path), exist_ok=True)
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    base = f"s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*"
    con.execute(
        f"""
        COPY (
          select id, names.primary as name, names.common['tr'] as name_tr, taxonomy.primary as cat, round(confidence,3) as confidence,
                 addresses[1].freeform as addr, to_json(list_transform(addresses, lambda a: a.freeform)) as addrs, brand.names.primary as brand, array_to_string(taxonomy.hierarchy, '>') as tax, addresses[1].locality as locality, addresses[1].postcode as postcode,
                 sources[1].dataset as src, sources[1].license as license, operating_status as status,
                 (bbox.xmin+bbox.xmax)/2 as lon, (bbox.ymin+bbox.ymax)/2 as lat
          from read_parquet('{base}', hive_partitioning=1)
          where bbox.xmin between 25.6 and 44.9 and bbox.ymin between 35.7 and 42.2
        ) TO '{path}.tmp' (FORMAT parquet, COMPRESSION zstd)
        """
    )
    os.replace(path + ".tmp", path)
    return path


def load_borders(path, wanted):
    from shapely.geometry import MultiPolygon, Polygon

    borders = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            if wanted and row["plate"] not in wanted:
                continue
            polygons = [Polygon(p[0], p[1:]) for p in row["rings"]]
            borders[row["plate"]] = MultiPolygon(polygons) if len(polygons) > 1 else polygons[0]
    return borders


def assign(lon, lat, borders):
    import numpy
    import shapely

    plate = numpy.full(len(lon), "", dtype="U2")
    for key in sorted(borders):
        geom = borders[key]
        minx, miny, maxx, maxy = geom.bounds
        candidates = numpy.where((lon >= minx) & (lon <= maxx) & (lat >= miny) & (lat <= maxy) & (plate == ""))[0]
        if len(candidates) == 0:
            continue
        inside = shapely.contains_xy(geom, lon[candidates], lat[candidates])
        plate[candidates[inside]] = key
    return plate


def feature(row):
    group = classify(row["cat"])
    confidence = float(row["confidence"])
    chain = chain_for(row)
    if chain:
        group = CHAIN_GROUP[chain]
    properties = {"name": row["name"].strip(), "cat": row["cat"], "g": group, "c": int(round(confidence * 100))}
    if chain:
        properties["b"] = chain
    elif landmark(row["cat"]) and confidence >= 0.6:
        properties["lm"] = 1
    local = (row.get("name_tr") or "").strip()
    if row.get("blank"):
        properties["name"] = ""
        local = ""
    if local and local != properties["name"]:
        properties["name:tr"] = local
    return {
        "type": "Feature",
        "properties": properties,
        "geometry": {"type": "Point", "coordinates": [round(float(row["lon"]), 6), round(float(row["lat"]), 6)]},
        "tippecanoe": {"minzoom": min_zoom(group, row["cat"], confidence, chain), "maxzoom": 16},
    }


DEDUPE_METRES = 60
SNAP_METRES = 100
CELL = 0.0014


def distance(a, b):
    dx = (a[0] - b[0]) * 111320 * math.cos(math.radians(a[1]))
    dy = (a[1] - b[1]) * 110540
    return math.hypot(dx, dy)


def index_points(items):
    cells = {}
    for item in items:
        cells.setdefault((item[0], int(item[1] / CELL), int(item[2] / CELL)), []).append(item)
    return cells


def around(cells, chain, lon, lat):
    cx, cy = int(lon / CELL), int(lat / CELL)
    return [item for dx in (-1, 0, 1) for dy in (-1, 0, 1) for item in cells.get((chain, cx + dx, cy + dy), ())]


def snap_to_osm(points, mapped):
    cells = index_points([(p["chain"], p["lon"], p["lat"], i) for i, p in enumerate(points)])
    taken = set()
    moved = 0
    candidates = []
    for order, f in enumerate(mapped):
        chain = f["properties"].get("b")
        if not chain:
            continue
        lon, lat = f["geometry"]["coordinates"]
        for _, olon, olat, index in around(cells, chain, lon, lat):
            d = distance((lon, lat), (olon, olat))
            if d <= SNAP_METRES:
                candidates.append((d, order, index, f))
    candidates.sort(key=lambda c: (c[0], c[1], c[2]))
    done = set()
    for d, key, index, f in candidates:
        if key in done or index in taken:
            continue
        done.add(key)
        taken.add(index)
        f["geometry"]["coordinates"] = [points[index]["lon"], points[index]["lat"]]
        f["properties"]["s"] = "osm"
        moved += 1
    return taken, moved


ON_BUILDING_METRES = 30
SNAP_BUILDING_METRES = 80


def snap_to_buildings(mapped, index):
    moved = 0
    for f in mapped:
        props = f["properties"]
        if not props.get("b") or props.get("s"):
            continue
        lon, lat = f["geometry"]["coordinates"]
        gap, centre = index.nearest(lon, lat)
        if ON_BUILDING_METRES < gap <= SNAP_BUILDING_METRES and centre is not None:
            f["geometry"]["coordinates"] = [round(centre[0], 6), round(centre[1], 6)]
            props["s"] = "bina"
            moved += 1
    return moved


def osm_features(points, mapped):
    taken, _ = snap_to_osm(points, mapped)
    placed = index_points([(f["properties"]["b"], f["geometry"]["coordinates"][0], f["geometry"]["coordinates"][1], 0) for f in mapped if f["properties"].get("b")])
    out = []
    for index, p in enumerate(points):
        if index in taken:
            continue
        if any(distance((p["lon"], p["lat"]), (o[1], o[2])) <= DEDUPE_METRES for o in around(placed, p["chain"], p["lon"], p["lat"])):
            continue
        placed.setdefault((p["chain"], int(p["lon"] / CELL), int(p["lat"] / CELL)), []).append((p["chain"], p["lon"], p["lat"], 0))
        out.append(
            {
                "type": "Feature",
                "properties": {"name": p["name"], "cat": "osm_chain", "g": p["group"], "c": 90, "b": p["chain"], "s": "osm"},
                "geometry": {"type": "Point", "coordinates": [p["lon"], p["lat"]]},
                "tippecanoe": {"minzoom": 14, "maxzoom": 16},
            }
        )
    return out


def write_lines(path, rows):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    os.replace(path + ".tmp", path)


def choose_names(rows, osm_cells):
    counts = {"overture-tr": 0, "osm": 0, "generic": 0, "overture": 0}
    for r in rows:
        chosen = place_names.choose(r, classify(r["cat"]), osm_cells)
        counts[chosen["source"]] += 1
        r["name_tr"] = chosen["name_tr"] or None
        r["blank"] = chosen["blank"]
    return counts


def extract(release, borders_path, out_dir, cache, wanted, pbf=None, buildings=None):
    import duckdb
    import numpy

    source = download(release, cache)
    borders = load_borders(borders_path, wanted)
    con = duckdb.connect()
    columns = "id, name, name_tr, cat, confidence, addr, addrs, brand, tax, locality, postcode, src, license, status, lon, lat"
    data = con.execute(f"select {columns} from '{source}' order by id").fetchnumpy()
    plate = assign(data["lon"], data["lat"], borders)
    summary = {}
    chain_points = []
    chain_plate = []
    if pbf:
        from osm_chains import read

        chain_points = read(pbf)
        chain_plate = assign(numpy.array([p["lon"] for p in chain_points]), numpy.array([p["lat"] for p in chain_points]), borders)
    osm_by_plate = {}
    if pbf:
        from osm_names import read as read_osm_names

        named = read_osm_names(pbf, classify)
        named_plate = assign(numpy.array([p["lon"] for p in named]), numpy.array([p["lat"] for p in named]), borders) if named else []
        for p, plate_of in zip(named, named_plate):
            osm_by_plate.setdefault(plate_of, []).append(p)
    building_index = None
    if pbf and buildings:
        from building_index import ensure

        building_index = ensure(pbf, buildings)
    names = columns.split(", ")
    for key in sorted(borders):
        indexes = [i for i in range(len(plate)) if plate[i] == key]
        rows = []
        for i in indexes:
            row = {n: (None if hasattr(data[n], "mask") and data[n].mask[i] else data[n][i]) for n in names}
            row = {n: (v.item() if hasattr(v, "item") else v) for n, v in row.items()}
            if keep(row, DIRECTORY_MIN_CONFIDENCE):
                rows.append(row)
        rows.sort(key=lambda r: r["id"])
        name_sources = choose_names(rows, place_names.index_osm(osm_by_plate.get(key, [])))
        mapped = [r for r in rows if keep(r)]
        features = [feature(r) for r in mapped]
        features.extend(osm_features([p for p, plate_of in zip(chain_points, chain_plate) if plate_of == key], features))
        if building_index is not None:
            snap_to_buildings(features, building_index)
        write_lines(os.path.join(out_dir, f"{key}.geojsonl"), features)
        write_lines(
            os.path.join(out_dir, f"{key}.rows.jsonl"),
            (
                {"id": r["id"], "name": r["name"].strip(), "name_tr": (r.get("name_tr") or "").strip() or None, "cat": r["cat"], "g": classify(r["cat"]), "conf": round(float(r["confidence"]), 3), "addr": r["addr"], "more": other_addresses(r.get("addrs")), "brand": (r.get("brand") or "").strip() or None, "tax": r.get("tax") or None, "locality": r["locality"], "postcode": r["postcode"], "lon": round(float(r["lon"]), 6), "lat": round(float(r["lat"]), 6)}
                for r in rows
            ),
        )
        summary[key] = {"all": len(indexes), "kept": len(features), "listed": len(rows), "minzoom": min((f["tippecanoe"]["minzoom"] for f in features), default=None)}
        if pbf:
            summary[key]["names"] = name_sources
    with open(os.path.join(out_dir, "summary.json"), "w", encoding="utf-8") as f:
        json.dump({"release": release, "plates": summary}, f, sort_keys=True, indent=1)
        f.write("\n")
    return summary


def main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--release", required=True)
    parser.add_argument("--borders", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--cache", required=True)
    parser.add_argument("--plates", default="all")
    parser.add_argument("--pbf")
    parser.add_argument("--buildings")
    args = parser.parse_args(argv)
    wanted = None if args.plates == "all" else set(args.plates.split(","))
    started = time.time()
    summary = extract(args.release, args.borders, args.out, args.cache, wanted, args.pbf, args.buildings)
    print(json.dumps({"plates": len(summary), "kept": sum(v["kept"] for v in summary.values()), "seconds": round(time.time() - started)}))


if __name__ == "__main__":
    main(sys.argv[1:])
