import argparse
import json
import os
import re
import subprocess
import tempfile

import osmium
import shapely
from shapely.geometry import Point

OSMIUM = "/opt/homebrew/bin/osmium"
PLATE = re.compile(r"^TR-(\d{2})$")
SUFFIX = re.compile(r"\s+(Mahallesi|Mah\.?|Mh\.?)$", re.IGNORECASE)
TWELVE = {"16", "10", "35", "38", "20", "42", "06", "34", "58", "45", "41", "59"}


def load_admin(path):
    with open(path, encoding="utf-8") as f:
        rows = [json.loads(line) for line in f if line.strip()]
    by_id = {row["id"]: row for row in rows}
    levels = {}
    for level in (6, 8):
        members = [row for row in rows if row["level"] == level]
        shapes = [shapely.from_wkt(row["wkt"]) for row in members]
        levels[level] = (members, shapely.STRtree(shapes))
    return by_id, levels


def locate(levels, point):
    for level in (8, 6):
        members, tree = levels[level]
        hits = tree.query(point, predicate="within")
        if len(hits) > 0:
            return members[int(min(hits))]
    return None


def chain(by_id, unit):
    neighbourhood = unit if unit["level"] == 8 else None
    district = by_id.get(unit["parent"]) if neighbourhood else unit
    if district is None or district["level"] != 6:
        return None
    province = by_id.get(district["parent"]) if district["parent"] else None
    match = PLATE.match(province["iso"] or "") if province else None
    if not match:
        return None
    return match.group(1), province, district, neighbourhood


def extract(pbf, admin_path, out_path, provinces=TWELVE):
    by_id, levels = load_admin(admin_path)
    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        filtered = os.path.join(tmp, "addresses.osm.pbf")
        subprocess.run([OSMIUM, "tags-filter", "--overwrite", "-o", filtered, pbf, "nw/addr:housenumber"], check=True, capture_output=True)
        for obj in osmium.FileProcessor(filtered, osmium.osm.NODE | osmium.osm.WAY).with_locations():
            tags = obj.tags
            street = tags.get("addr:street")
            number = tags.get("addr:housenumber")
            if not street or not number:
                continue
            if obj.is_node():
                location = obj.location
            elif obj.is_way() and len(obj.nodes) > 0:
                location = obj.nodes[len(obj.nodes) // 2].location
            else:
                continue
            if not location.valid():
                continue
            unit = locate(levels, Point(location.lon, location.lat))
            found = chain(by_id, unit) if unit else None
            if not found or found[0] not in provinces:
                continue
            plate, province, district, neighbourhood = found
            rows.append(
                {
                    "province": plate,
                    "provinceName": province["names"]["tr"],
                    "district": district["names"]["tr"],
                    "districtNames": district["names"],
                    "neighbourhood": SUFFIX.sub("", neighbourhood["names"]["tr"]) if neighbourhood else None,
                    "neighbourhoodNames": ({**neighbourhood["names"], "tr": SUFFIX.sub("", neighbourhood["names"]["tr"])} if neighbourhood else {}),
                    "street": street,
                    "houseNumber": number,
                    "lon": round(location.lon, 6),
                    "lat": round(location.lat, 6),
                }
            )
    rows.sort(key=lambda r: (r["province"], r["district"], r["neighbourhood"] or "", r["street"], r["houseNumber"], r["lon"], r["lat"]))
    with open(out_path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    return len(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pbf")
    parser.add_argument("admin")
    parser.add_argument("out")
    args = parser.parse_args()
    print(extract(args.pbf, args.admin, args.out))


if __name__ == "__main__":
    main()
