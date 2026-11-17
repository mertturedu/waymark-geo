import argparse
import os
import tempfile

import numpy as np
import osmium
import shapely
from shapely.geometry import LineString

from assign import Assigner
from common import id_key, read_json_lines, run_osmium, way_coords, write_json, write_lines
from extract_admin import alt_names_of, names_of

HIGHWAYS = [
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
    "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "pedestrian", "road", "service",
]
SIMPLIFY = 0.00003
CHUNK = 400_000


def read_ways(pbf):
    ways = []
    unlocatable = 0
    with tempfile.TemporaryDirectory() as tmp:
        filtered = os.path.join(tmp, "highways.osm.pbf")
        run_osmium("tags-filter", "--overwrite", "-o", filtered, pbf, "w/highway")
        for obj in osmium.FileProcessor(filtered, osmium.osm.NODE | osmium.osm.WAY).with_locations():
            if not obj.is_way():
                continue
            highway = obj.tags.get("highway")
            name = (obj.tags.get("name") or "").strip()
            if highway not in HIGHWAYS or not name:
                continue
            coords = way_coords(obj)
            if coords is None or len(coords) < 2:
                unlocatable += 1
                continue
            ways.append({"id": "w%d" % obj.id, "name": name, "names": names_of(obj.tags), "alt": alt_names_of(obj.tags), "highway": highway, "coords": coords})
    ways.sort(key=lambda w: id_key(w["id"]))
    return ways, unlocatable


def assign_segments(assigner, ways):
    keys = []
    for start in range(0, len(ways), 20_000):
        batch = ways[start:start + 20_000]
        xs, ys, owners = [], [], []
        for index, way in enumerate(batch):
            coords = way["coords"]
            for a, b in zip(coords, coords[1:]):
                xs.append((a[0] + b[0]) / 2)
                ys.append((a[1] + b[1]) / 2)
                owners.append(index)
        results = []
        for offset in range(0, len(xs), CHUNK):
            results.extend(assigner.locate_many(xs[offset:offset + CHUNK], ys[offset:offset + CHUNK]))
        per_way = [[] for _ in batch]
        for owner, result in zip(owners, results):
            per_way[owner].append(result)
        keys.extend(per_way)
    return keys


def simplify(coords):
    line = LineString(coords).simplify(SIMPLIFY, preserve_topology=False)
    return [[round(x, 6), round(y, 6)] for x, y in line.coords]


def runs_of(way, results):
    runs = []
    for index, result in enumerate(results):
        key = None if result is None else (result["province"], result["district"], result["neighbourhood"], result["hoodName"], result["hoodSource"])
        if runs and runs[-1]["key"] == key:
            runs[-1]["end"] = index + 1
        else:
            runs.append({"key": key, "start": index, "end": index + 1, "result": result})
    return runs


def extract(pbf, admin_path, places_path, out_dir, provinces=None):
    assigner = Assigner(read_json_lines(admin_path), read_json_lines(places_path))
    ways, unlocatable = read_ways(pbf)
    results = assign_segments(assigner, ways)
    parts = {}
    rejected = {"no_district": 0, "outside": 0, "unlocatable": unlocatable}
    written = 0
    for way, segment_results in zip(ways, results):
        kept = 0
        saw_province = False
        for run in runs_of(way, segment_results):
            if run["key"] is None:
                continue
            result = run["result"]
            saw_province = True
            if result["district"] is None:
                continue
            if provinces is not None and result["province"] not in provinces:
                kept += 1
                continue
            kept += 1
            group = (result["province"], result["district"], result["neighbourhood"] or "", result["hoodName"] or "", way["name"])
            part = parts.setdefault(group, {"result": result, "lines": [], "ways": set(), "alt": set(), "names": {}, "highway": way["highway"]})
            part["lines"].append(simplify(way["coords"][run["start"]:run["end"] + 1]))
            part["ways"].add(way["id"])
            part["alt"].update(way["alt"])
            for lang, value in way["names"].items():
                part["names"].setdefault(lang, value)
            if HIGHWAYS.index(way["highway"]) < HIGHWAYS.index(part["highway"]):
                part["highway"] = way["highway"]
        if kept:
            written += 1
        else:
            rejected["no_district" if saw_province else "outside"] += 1
    by_plate = {}
    for (plate, district, hood, hood_name, name), part in parts.items():
        result = part["result"]
        by_plate.setdefault(plate, []).append(
            {
                "name": name, "names": dict(sorted(part["names"].items())), "alt": sorted(part["alt"]), "highway": part["highway"],
                "district": district, "neighbourhood": result["neighbourhood"], "hoodName": result["hoodName"], "hoodNames": result["hoodNames"],
                "hoodSource": result["hoodSource"], "lines": part["lines"], "ways": sorted(part["ways"], key=id_key),
            }
        )
    plates = sorted(p for p in assigner.plates if provinces is None or p in provinces)
    summary = {}
    for plate in plates:
        rows = sorted(by_plate.get(plate, []), key=lambda r: (r["district"], r["neighbourhood"] or "", r["hoodName"] or "", r["name"]))
        write_lines(os.path.join(out_dir, plate, "streets.jsonl"), rows)
        summary[plate] = {"parts": len(rows), "lines": sum(len(r["lines"]) for r in rows)}
    accounting = {"filtered": provinces is not None, "provinces": summary, "rejected": dict(sorted(rejected.items())), "ways": len(ways) + unlocatable, "written": written}
    write_json(os.path.join(out_dir, "streets-accounting.json"), accounting)
    return accounting


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pbf")
    parser.add_argument("admin")
    parser.add_argument("places")
    parser.add_argument("out_dir")
    parser.add_argument("--provinces")
    args = parser.parse_args()
    accounting = extract(args.pbf, args.admin, args.places, args.out_dir, set(args.provinces.split(",")) if args.provinces else None)
    print(accounting["ways"], accounting["written"], accounting["rejected"])


if __name__ == "__main__":
    main()
