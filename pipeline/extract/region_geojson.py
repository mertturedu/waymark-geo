import argparse
import json
import math
import os
import re

import shapely
from shapely import affinity
from shapely.geometry import mapping
from shapely.geometry.polygon import orient

PLATE = re.compile(r"^TR-(\d{2})$")
M_PER_DEGREE = 111_320.0


def province_rows(rows):
    found = {}
    for row in sorted(rows, key=lambda r: (r["level"], int(r["id"][1:]))):
        match = PLATE.match(row["iso"] or "")
        if row["level"] == 4 and match and match.group(1) not in found:
            found[match.group(1)] = row
    return found


def region_geojson(rows, plate, pad_m=2000, simplify_m=50):
    row = province_rows(rows)[plate]
    outline = shapely.from_wkt(row["wkt"])
    factor = math.cos(math.radians(outline.centroid.y))
    squeezed = affinity.scale(outline, xfact=factor, yfact=1, origin=(0, 0))
    padded = squeezed.buffer(pad_m / M_PER_DEGREE)
    padded = padded.simplify(simplify_m / M_PER_DEGREE, preserve_topology=True)
    padded = affinity.scale(padded, xfact=1 / factor, yfact=1, origin=(0, 0))
    padded = shapely.set_precision(padded, 1e-5)
    parts = [orient(part, 1.0) for part in (padded.geoms if padded.geom_type == "MultiPolygon" else [padded])]
    geometry = shapely.MultiPolygon(parts) if len(parts) > 1 else parts[0]
    return {"type": "Feature", "properties": {"plate": plate}, "geometry": mapping(geometry)}


def write_regions(admin_path, out_dir, pad_m=2000):
    with open(admin_path, encoding="utf-8") as f:
        rows = [json.loads(line) for line in f if line.strip()]
    os.makedirs(out_dir, exist_ok=True)
    plates = sorted(province_rows(rows))
    for plate in plates:
        target = os.path.join(out_dir, plate + ".geojson")
        with open(target + ".tmp", "w", encoding="utf-8") as f:
            f.write(json.dumps(region_geojson(rows, plate, pad_m), sort_keys=True, separators=(",", ":")) + "\n")
        os.replace(target + ".tmp", target)
    return plates


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("admin")
    parser.add_argument("out_dir")
    parser.add_argument("--pad", type=int, default=2000)
    args = parser.parse_args()
    print(len(write_regions(args.admin, args.out_dir, args.pad)))


if __name__ == "__main__":
    main()
