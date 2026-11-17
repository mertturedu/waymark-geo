import argparse
import os
import time

import duckdb

STRIPS = [(25.6, 27.5), (27.5, 28.8), (28.8, 29.6), (29.6, 30.8), (30.8, 32.4), (32.4, 34.2), (34.2, 36.5), (36.5, 39.0), (39.0, 41.5), (41.5, 45.0)]
LAT = (35.7, 42.3)


def fetch(release, out_dir, only=None):
    os.makedirs(out_dir, exist_ok=True)
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2'; SET threads=8;")
    base = f"s3://overturemaps-us-west-2/release/{release}/theme=buildings/type=building/*"
    for index, (west, east) in enumerate(STRIPS):
        if only is not None and index not in only:
            continue
        path = os.path.join(out_dir, f"buildings-{index:02d}.parquet")
        if os.path.exists(path):
            continue
        started = time.time()
        con.execute(
            f"""COPY (SELECT id, geometry, height, num_floors, names.primary AS name, class, subtype, sources[1].dataset AS source, sources[1].record_id AS record, has_parts
                 FROM read_parquet('{base}', hive_partitioning=1)
                 WHERE bbox.xmin >= {west} AND bbox.xmin < {east} AND bbox.ymin BETWEEN {LAT[0]} AND {LAT[1]})
                 TO '{path}.tmp' (FORMAT PARQUET, COMPRESSION ZSTD)"""
        )
        os.replace(path + ".tmp", path)
        print(index, west, east, round(time.time() - started), "sn", os.path.getsize(path) // 1_000_000, "MB", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("release")
    parser.add_argument("out_dir")
    parser.add_argument("--only")
    args = parser.parse_args()
    fetch(args.release, args.out_dir, None if not args.only else {int(i) for i in args.only.split(",")})
