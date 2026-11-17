import argparse
import json
import os
import subprocess
import tempfile

import osmium

OSMIUM = "/opt/homebrew/bin/osmium"
DRIVABLE = {
    "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "road",
    "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
}


def clip(pbf, bbox, out):
    box = ",".join(str(v) for v in bbox)
    subprocess.run([OSMIUM, "extract", "-b", box, "--strategy=complete_ways", "--overwrite", "-o", out, pbf], check=True, capture_output=True)


def extract(pbf, bbox, out_path):
    min_lon, min_lat, max_lon, max_lat = bbox
    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        clipped = os.path.join(tmp, "clip.osm.pbf")
        clip(pbf, bbox, clipped)
        for obj in osmium.FileProcessor(clipped, osmium.osm.NODE | osmium.osm.WAY).with_locations():
            if not obj.is_way():
                continue
            tags = obj.tags
            name = tags.get("name")
            if not name or tags.get("highway") not in DRIVABLE or len(obj.nodes) == 0:
                continue
            middle = obj.nodes[len(obj.nodes) // 2].location
            if not (min_lon <= middle.lon <= max_lon and min_lat <= middle.lat <= max_lat):
                continue
            rows.append({"name": name, "lon": round(middle.lon, 7), "lat": round(middle.lat, 7)})
    rows.sort(key=lambda r: (r["name"], r["lon"], r["lat"]))
    with open(out_path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return len(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pbf", required=True)
    parser.add_argument("--bbox", required=True, help="min_lon,min_lat,max_lon,max_lat")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    bbox = tuple(float(v) for v in args.bbox.split(","))
    print(extract(args.pbf, bbox, args.out))


if __name__ == "__main__":
    main()
