import argparse
import math
import os
import tempfile

import numpy as np
import osmium
from shapely.geometry import Polygon

from assign import Assigner, M_PER_DEGREE
from common import id_key, inside_point, is_closed, read_json_lines, run_osmium, way_coords, write_json, write_lines


def read_buildings(pbf):
    rows, opened = [], 0
    with tempfile.TemporaryDirectory() as tmp:
        filtered = os.path.join(tmp, "buildings.osm.pbf")
        run_osmium("tags-filter", "--overwrite", "-o", filtered, pbf, "w/building")
        for obj in osmium.FileProcessor(filtered, osmium.osm.NODE | osmium.osm.WAY).with_locations():
            if not obj.is_way() or not obj.tags.get("building") or obj.tags.get("building") == "no":
                continue
            coords = way_coords(obj)
            if coords is None or not is_closed(coords):
                opened += 1
                continue
            polygon = Polygon(coords)
            if not polygon.is_valid:
                polygon = polygon.buffer(0)
            area = polygon.area * M_PER_DEGREE * M_PER_DEGREE * math.cos(math.radians(coords[0][1])) if not polygon.is_empty else 0
            point = inside_point(coords) if area > 0 else None
            rows.append({"id": "w%d" % obj.id, "building": obj.tags["building"], "point": point if point else (coords[0][0], coords[0][1]), "area": area})
    rows.sort(key=lambda r: id_key(r["id"]))
    return rows, opened


def extract(pbf, admin_path, out_dir, provinces):
    assigner = Assigner(read_json_lines(admin_path), [])
    items, opened = read_buildings(pbf)
    found, _ = assigner.province_of_many(np.array([i["point"][0] for i in items]), np.array([i["point"][1] for i in items]))
    counts = {p: {"source": 0, "accepted": 0, "rejected": {}} for p in sorted(provinces)}
    rows = {p: [] for p in counts}
    outside = elsewhere = 0
    for item, index in zip(items, found):
        if index < 0:
            outside += 1
            continue
        plate = assigner.plates[index]
        if plate not in counts:
            elsewhere += 1
            continue
        counts[plate]["source"] += 1
        if item["area"] <= 0:
            counts[plate]["rejected"]["degenerate"] = counts[plate]["rejected"].get("degenerate", 0) + 1
            continue
        counts[plate]["accepted"] += 1
        rows[plate].append({"id": item["id"], "lon": round(item["point"][0], 6), "lat": round(item["point"][1], 6), "building": item["building"], "area_m2": int(round(item["area"]))})
    for plate in counts:
        write_lines(os.path.join(out_dir, plate, "buildings.jsonl"), rows[plate])
    accounting = {"elsewhere": elsewhere, "open": opened, "outside": outside, "provinces": counts}
    write_json(os.path.join(out_dir, "buildings-accounting.json"), accounting)
    return accounting


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pbf")
    parser.add_argument("admin")
    parser.add_argument("out_dir")
    parser.add_argument("--provinces", required=True)
    args = parser.parse_args()
    accounting = extract(args.pbf, args.admin, args.out_dir, set(args.provinces.split(",")))
    print({p: e["source"] for p, e in accounting["provinces"].items()}, accounting["elsewhere"], accounting["outside"], accounting["open"])


if __name__ == "__main__":
    main()
