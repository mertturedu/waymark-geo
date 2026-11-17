import argparse
import json
import os

import shapely
from shapely.geometry.polygon import orient

from assign import PLATE, order_key
from common import read_json_lines, write_lines


def province_ids(rows):
    found = {}
    for row in rows:
        match = PLATE.match(row["iso"] or "")
        if row["level"] == 4 and match:
            found[row["id"]] = match.group(1)
    return found


def rings_of(shape):
    parts = shape.geoms if shape.geom_type == "MultiPolygon" else [shape]
    out = []
    for part in parts:
        part = orient(part, 1.0)
        if part.is_empty:
            continue
        out.append([[[round(x, 6), round(y, 6)] for x, y in ring.coords] for ring in [part.exterior, *part.interiors]])
    return out


def pack_rows(rows, plate, tolerance):
    ordered = sorted(rows, key=order_key)
    provinces = province_ids(ordered)
    districts = {r["id"] for r in ordered if r["level"] == 6 and provinces.get(r["parent"]) == plate}
    members = [r for r in ordered if r["id"] in districts or (r["level"] == 8 and r["parent"] in districts)]
    out = []
    for row in members:
        shape = shapely.from_wkt(row["wkt"])
        thin = shape.simplify(tolerance, preserve_topology=True)
        point = shape.representative_point()
        out.append(
            {
                "id": row["id"], "level": row["level"], "parent": row["parent"], "names": row["names"], "alt": row["alt"],
                "center": [round(point.x, 6), round(point.y, 6)], "rings": rings_of(thin),
            }
        )
    return out


def border_rows(rows, tolerance):
    found = {}
    for row in sorted(rows, key=order_key):
        match = PLATE.match(row["iso"] or "")
        if row["level"] == 4 and match and match.group(1) not in found:
            found[match.group(1)] = row
    out = []
    for plate in sorted(found):
        thin = shapely.from_wkt(found[plate]["wkt"]).simplify(tolerance, preserve_topology=True)
        out.append({"plate": plate, "rings": rings_of(thin)})
    return out


def write_admin_pack(admin_path, out_dir, tolerance):
    rows = read_json_lines(admin_path)
    plates = sorted(set(province_ids(rows).values()))
    for plate in plates:
        write_lines(os.path.join(out_dir, plate + ".jsonl"), pack_rows(rows, plate, tolerance))
    return plates


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("admin")
    parser.add_argument("out_dir")
    parser.add_argument("--tolerance", type=float, default=0.0001)
    parser.add_argument("--borders")
    parser.add_argument("--border-tolerance", type=float, default=0.0009)
    args = parser.parse_args()
    print(len(write_admin_pack(args.admin, args.out_dir, args.tolerance)))
    if args.borders:
        write_lines(args.borders, border_rows(read_json_lines(args.admin), args.border_tolerance))


if __name__ == "__main__":
    main()
