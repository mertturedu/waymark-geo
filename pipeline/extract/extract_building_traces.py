import argparse
import glob
import math
import os

import duckdb
import numpy as np
import shapely

from assign import Assigner, M_PER_DEGREE
from common import read_json_lines, write_lines

SIMPLIFY = 0.000008
MAX_VERTICES = 14
PAD = 0.01


def ring_of(polygon):
    simple = polygon.simplify(SIMPLIFY, preserve_topology=True)
    if simple.geom_type != "Polygon" or simple.is_empty:
        simple = polygon
    coords = list(simple.exterior.coords)
    step = max(1, math.ceil(len(coords) / MAX_VERTICES))
    return [[round(x, 6), round(y, 6)] for x, y in coords[::step]]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("parquet_dir")
    parser.add_argument("admin")
    parser.add_argument("out_dir")
    parser.add_argument("--provinces", required=True)
    args = parser.parse_args()
    plates = args.provinces.split(",")
    admin = read_json_lines(args.admin)
    assigner = Assigner(admin, [])
    bounds = {row["iso"].split("-")[1]: row["bbox"] for row in admin if row["level"] == 4 and row.get("iso") and row["iso"].split("-")[1] in plates}
    files = sorted(glob.glob(os.path.join(args.parquet_dir, "buildings-*.parquet")))
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial;")
    for plate in plates:
        west, south, east, north = bounds[plate]
        frames = []
        for file in files:
            frames.append(
                con.execute(
                    f"""SELECT id, ST_AsWKB(geometry) AS wkb, height, num_floors, name, class, subtype, source, record
                        FROM read_parquet('{file}')
                        WHERE ST_XMin(geometry) BETWEEN {west - PAD} AND {east + PAD} AND ST_YMin(geometry) BETWEEN {south - PAD} AND {north + PAD}"""
                ).fetchall()
            )
        rows = [r for f in frames for r in f]
        geometries = shapely.from_wkb([bytes(r[1]) for r in rows])
        centroids = shapely.centroid(geometries)
        xs = shapely.get_x(centroids)
        ys = shapely.get_y(centroids)
        found, _ = assigner.province_of_many(xs, ys)
        keep = [i for i, index in enumerate(found) if index >= 0 and assigner.plates[index] == plate]
        out = []
        for i in keep:
            geometry = geometries[i]
            if geometry.geom_type == "MultiPolygon":
                geometry = max(geometry.geoms, key=lambda g: g.area)
            if geometry.geom_type != "Polygon" or geometry.is_empty:
                continue
            area = geometry.area * M_PER_DEGREE * M_PER_DEGREE * math.cos(math.radians(ys[i]))
            r = rows[i]
            out.append(
                {"id": r[0], "lon": round(float(xs[i]), 6), "lat": round(float(ys[i]), 6), "area": round(area, 1), "ring": ring_of(geometry), "height": r[2], "floors": r[3], "name": r[4], "cls": r[5], "sub": r[6], "src": r[7], "rec": r[8]}
            )
        write_lines(os.path.join(args.out_dir, plate + ".jsonl"), out)
        print(plate, len(rows), len(out), flush=True)


if __name__ == "__main__":
    main()
