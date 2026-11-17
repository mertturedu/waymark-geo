import argparse
import os
import tempfile

import osmium
import shapely
import shapely.wkt

from assign import Assigner
from common import read_json_lines, run_osmium, way_coords, write_lines

HIGHWAYS = ("residential", "living_street", "tertiary", "unclassified", "pedestrian", "road")
MIN_POINTS = 2
SIMPLIFY = 0.00003


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pbf")
    parser.add_argument("admin")
    parser.add_argument("places")
    parser.add_argument("out_dir")
    parser.add_argument("--provinces", required=True)
    args = parser.parse_args()
    plates = set(args.provinces.split(","))
    assigner = Assigner(read_json_lines(args.admin), read_json_lines(args.places))
    rows = {plate: [] for plate in plates}
    found = []
    with tempfile.TemporaryDirectory() as tmp:
        filtered = os.path.join(tmp, "highways.osm.pbf")
        run_osmium("tags-filter", "--overwrite", "-o", filtered, args.pbf, "w/highway")
        for obj in osmium.FileProcessor(filtered, osmium.osm.NODE | osmium.osm.WAY).with_locations():
            if not obj.is_way() or obj.tags.get("highway") not in HIGHWAYS:
                continue
            if (obj.tags.get("name") or "").strip():
                continue
            coords = way_coords(obj)
            if coords is None or len(coords) < MIN_POINTS:
                continue
            found.append((obj.id, obj.tags.get("highway"), coords))
    middles = [c[len(c) // 2] for _, _, c in found]
    results = assigner.locate_many([m[0] for m in middles], [m[1] for m in middles])
    for (way_id, highway, coords), result in zip(found, results):
        if result is None or result["district"] is None or result["province"] not in plates:
            continue
        line = shapely.LineString(coords).simplify(SIMPLIFY, preserve_topology=False)
        rows[result["province"]].append({"id": "w%d" % way_id, "highway": highway, "district": result["district"], "neighbourhood": result["neighbourhood"], "hoodName": result["hoodName"], "hoodNames": result.get("hoodNames"), "hoodSource": result["hoodSource"], "lines": [[[round(x, 6), round(y, 6)] for x, y in line.coords]]})
    for plate, items in rows.items():
        write_lines(os.path.join(args.out_dir, plate + ".jsonl"), sorted(items, key=lambda r: int(r["id"][1:])))
        print(plate, len(items))


if __name__ == "__main__":
    main()
