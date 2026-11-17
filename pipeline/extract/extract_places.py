import argparse
import json
import os
import tempfile

import osmium

from assign import Assigner
from common import id_key, inside_point, is_closed, read_json_lines, run_osmium, way_coords, write_json, write_lines
from extract_admin import alt_names_of, names_of

CONFIG = os.path.join(os.path.dirname(__file__), "..", "config", "poi-kinds.json")


def load_kinds(path=CONFIG):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def kind_of(tags, kinds):
    for kind in sorted(kinds):
        for condition in kinds[kind]:
            if all(tags.get(key) == value for key, value in condition.items()):
                return kind
    return None


def filter_expressions(kinds):
    seen = []
    for kind in sorted(kinds):
        for condition in kinds[kind]:
            key, value = next(iter(condition.items()))
            expression = "nw/%s=%s" % (key, value)
            if expression not in seen:
                seen.append(expression)
    return seen


def read_places(pbf, kinds):
    found, not_closed = {}, 0
    with tempfile.TemporaryDirectory() as tmp:
        filtered = os.path.join(tmp, "places.osm.pbf")
        run_osmium("tags-filter", "--overwrite", "-o", filtered, pbf, *filter_expressions(kinds))
        for obj in osmium.FileProcessor(filtered, osmium.osm.NODE | osmium.osm.WAY).with_locations():
            name = (obj.tags.get("name") or "").strip()
            kind = kind_of(obj.tags, kinds)
            if kind is None or not name:
                continue
            if obj.is_node():
                key = "n%d" % obj.id
                point = (obj.location.lon, obj.location.lat) if obj.location.valid() else None
            else:
                key = "w%d" % obj.id
                coords = way_coords(obj)
                if coords is None or not is_closed(coords):
                    not_closed += 1
                    continue
                point = inside_point(coords)
            found[key] = {"id": key, "kind": kind, "name": name, "names": names_of(obj.tags), "alt": alt_names_of(obj.tags), "point": point}
    return sorted(found.values(), key=lambda p: id_key(p["id"])), not_closed


def extract(pbf, admin_path, hoods_path, out_dir, provinces=None, kinds=None):
    assigner = Assigner(read_json_lines(admin_path), read_json_lines(hoods_path))
    items, not_closed = read_places(pbf, kinds or load_kinds())
    located = [p for p in items if p["point"] is not None]
    no_point = len(items) - len(located)
    results = assigner.locate_many([p["point"][0] for p in located], [p["point"][1] for p in located])
    plates = sorted(p for p in assigner.plates if provinces is None or p in provinces)
    rows = {p: [] for p in plates}
    counts = {p: {"accepted": 0} for p in plates}
    rejected = {"no_district": 0, "no_point": no_point, "not_closed": not_closed, "outside": 0}
    for item, result in zip(located, results):
        if result is None:
            rejected["outside"] += 1
            continue
        if result["province"] not in rows:
            continue
        if result["district"] is None:
            rejected["no_district"] += 1
            continue
        rows[result["province"]].append(
            {
                "id": item["id"], "kind": item["kind"], "name": item["name"], "names": item["names"], "alt": item["alt"],
                "lon": round(item["point"][0], 6), "lat": round(item["point"][1], 6), "district": result["district"],
                "neighbourhood": result["neighbourhood"], "hoodName": result["hoodName"], "hoodNames": result["hoodNames"],
                "hoodSource": result["hoodSource"], "slack": result["slack"],
            }
        )
    for plate in plates:
        counts[plate]["accepted"] = len(rows[plate])
        write_lines(os.path.join(out_dir, plate, "places.jsonl"), rows[plate])
    accounting = {"filtered": provinces is not None, "provinces": counts, "rejected": dict(sorted(rejected.items())), "source": len(items) + not_closed}
    write_json(os.path.join(out_dir, "places-accounting.json"), accounting)
    return accounting


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pbf")
    parser.add_argument("admin")
    parser.add_argument("hoods")
    parser.add_argument("out_dir")
    parser.add_argument("--provinces")
    args = parser.parse_args()
    accounting = extract(args.pbf, args.admin, args.hoods, args.out_dir, set(args.provinces.split(",")) if args.provinces else None)
    print(accounting["source"], accounting["rejected"])


if __name__ == "__main__":
    main()
