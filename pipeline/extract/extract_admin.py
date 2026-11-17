import argparse
import json
import os
import subprocess
import tempfile

import osmium
import shapely
import shapely.wkb

from common import write_json, write_lines

OSMIUM = "/opt/homebrew/bin/osmium"
LEVELS = {"4": 4, "6": 6, "8": 8}
LANGS = ("tr", "en", "de", "ru", "el", "ar")
SIMPLIFY = 0.0003
PLACE_KINDS = ("neighbourhood", "suburb", "quarter")


def filter_boundaries(pbf, out):
    subprocess.run([OSMIUM, "tags-filter", "--overwrite", "-o", out, pbf, "r/boundary=administrative"], check=True, capture_output=True)


def names_of(tags):
    names = {}
    for lang in LANGS:
        value = tags.get("name:" + lang) or (tags.get("name") if lang == "tr" else None)
        if value:
            names[lang] = value
    return names


def alt_names_of(tags):
    raw = tags.get("alt_name") or ""
    return [part.strip() for part in raw.split(";") if part.strip()]


def link_parents(rows):
    shapes = [shapely.from_wkt(row["wkt"]) for row in rows]
    trees = {}
    for level in (4, 6):
        members = [i for i, row in enumerate(rows) if row["level"] == level]
        trees[level] = (members, shapely.STRtree([shapes[i] for i in members]))
    for i, row in enumerate(rows):
        row["parent"] = None
        if row["level"] == 4:
            continue
        members, tree = trees[4 if row["level"] == 6 else 6]
        hits = tree.query(shapes[i].representative_point(), predicate="within")
        if len(hits) > 0:
            row["parent"] = rows[members[int(min(hits))]]["id"]


def extract(pbf, out_path, full=False):
    factory = osmium.geom.WKBFactory()
    rows = []
    wanted = {}
    with tempfile.TemporaryDirectory() as tmp:
        filtered = os.path.join(tmp, "boundaries.osm.pbf")
        filter_boundaries(pbf, filtered)
        for obj in osmium.FileProcessor(filtered).with_areas(osmium.filter.KeyFilter("boundary")):
            if obj.is_relation():
                level = LEVELS.get(obj.tags.get("admin_level"))
                if obj.tags.get("boundary") == "administrative" and level is not None and obj.tags.get("name"):
                    wanted["r%d" % obj.id] = {"id": "r%d" % obj.id, "level": level, "name": obj.tags["name"]}
                continue
            if not obj.is_area() or obj.from_way():
                continue
            tags = obj.tags
            level = LEVELS.get(tags.get("admin_level"))
            if tags.get("boundary") != "administrative" or level is None or not tags.get("name"):
                continue
            try:
                geometry = shapely.wkb.loads(factory.create_multipolygon(obj), hex=True)
            except RuntimeError:
                continue
            if full:
                simple = shapely.set_precision(geometry, 1e-6)
            else:
                simple = shapely.simplify(geometry, SIMPLIFY, preserve_topology=True)
                simple = shapely.set_precision(simple, 1e-5)
            if simple.is_empty:
                continue
            rows.append(
                {
                    "id": "r%d" % obj.orig_id(),
                    "level": level,
                    "iso": tags.get("ISO3166-2"),
                    "names": names_of(tags),
                    "alt": alt_names_of(tags),
                    "bbox": [round(v, 5) for v in simple.bounds],
                    "wkt": shapely.to_wkt(simple, rounding_precision=6 if full else 5),
                }
            )
    rows.sort(key=lambda r: (r["level"], int(r["id"][1:])))
    built = {row["id"] for row in rows}
    skipped = sorted((v for k, v in wanted.items() if k not in built), key=lambda r: (r["level"], int(r["id"][1:])))
    write_json(out_path + ".skipped.json", skipped)
    link_parents(rows)
    write_lines(out_path, rows)
    return len(rows)


def extract_places(pbf, out_path):
    rows = []
    for node in osmium.FileProcessor(pbf, osmium.osm.NODE).with_filter(osmium.filter.KeyFilter("place")):
        kind = node.tags.get("place")
        if kind not in PLACE_KINDS or not node.tags.get("name") or not node.location.valid():
            continue
        rows.append(
            {
                "id": "n%d" % node.id,
                "type": kind,
                "name": node.tags["name"],
                "names": names_of(node.tags),
                "lon": round(node.location.lon, 7),
                "lat": round(node.location.lat, 7),
            }
        )
    rows.sort(key=lambda r: int(r["id"][1:]))
    write_lines(out_path, rows)
    return len(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pbf")
    parser.add_argument("out")
    parser.add_argument("--full", action="store_true")
    parser.add_argument("--places")
    args = parser.parse_args()
    print(extract(args.pbf, args.out, full=args.full))
    if args.places:
        print(extract_places(args.pbf, args.places))


if __name__ == "__main__":
    main()
