import argparse
import subprocess
import tempfile

import osmium
import shapely
import shapely.wkt

from common import read_json_lines, write_lines

OSMIUM = "/opt/homebrew/bin/osmium"
PLACES = ("neighbourhood", "suburb", "quarter", "village", "hamlet", "locality", "town", "city")
TAGS = ("old_name", "alt_name", "old_name:tr", "alt_name:tr", "official_name", "short_name")


def split(raw):
    return [part.strip() for part in (raw or "").replace(",", ";").split(";") if part.strip()]


def aliases_of(tags):
    found = []
    for key in TAGS:
        found.extend(split(tags.get(key)))
    return found


def relation_aliases(pbf):
    with tempfile.TemporaryDirectory() as tmp:
        filtered = tmp + "/adm.osm.pbf"
        subprocess.run([OSMIUM, "tags-filter", "--overwrite", "-o", filtered, pbf, "r/boundary=administrative"], check=True, capture_output=True)
        found = {}
        for obj in osmium.FileProcessor(filtered, osmium.osm.RELATION):
            names = aliases_of(obj.tags)
            if names:
                found["r%d" % obj.id] = names
        return found


def place_nodes(pbf):
    rows = []
    for node in osmium.FileProcessor(pbf, osmium.osm.NODE).with_filter(osmium.filter.KeyFilter("place")):
        if node.tags.get("place") not in PLACES or not node.location.valid():
            continue
        names = aliases_of(node.tags)
        name = node.tags.get("name")
        if not names and not name:
            continue
        rows.append({"name": name, "aliases": names, "lon": node.location.lon, "lat": node.location.lat})
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pbf")
    parser.add_argument("admin")
    parser.add_argument("out")
    args = parser.parse_args()
    rows = read_json_lines(args.admin)
    by_id = {row["id"]: row for row in rows}
    plate_of = {}
    for row in rows:
        if row["level"] == 4 and row.get("iso"):
            plate_of[row["id"]] = row["iso"].split("-")[1]

    def province_plate(row):
        while row is not None and row["level"] != 4:
            row = by_id.get(row["parent"])
        return plate_of.get(row["id"]) if row else None

    def district_name(row):
        while row is not None and row["level"] != 6:
            row = by_id.get(row["parent"])
        return row["names"].get("tr") if row else None

    related = relation_aliases(args.pbf)
    out = []
    for row in rows:
        names = [n for n in related.get(row["id"], []) + row["alt"] if n != row["names"].get("tr")]
        if not names:
            continue
        plate = province_plate(row)
        if plate is None:
            continue
        kind = {4: "province", 6: "district", 8: "hood"}[row["level"]]
        out.append({"kind": kind, "plate": plate, "district": district_name(row) if kind == "hood" else None, "name": row["names"].get("tr"), "aliases": sorted(set(names))})

    hoods = [row for row in rows if row["level"] == 8]
    shapes = [shapely.wkt.loads(row["wkt"]) for row in hoods]
    tree = shapely.STRtree(shapes)
    for node in place_nodes(args.pbf):
        point = shapely.Point(node["lon"], node["lat"])
        hits = tree.query(point, predicate="within")
        if len(hits) == 0:
            continue
        row = hoods[int(sorted(hits)[0])]
        official = row["names"].get("tr")
        names = [n for n in ([node["name"]] if node["name"] else []) + node["aliases"] if n and n != official]
        if not names:
            continue
        plate = province_plate(row)
        if plate is None:
            continue
        out.append({"kind": "hood", "plate": plate, "district": district_name(row), "name": official, "aliases": sorted(set(names))})
    write_lines(args.out, out)
    print(len(out))


if __name__ == "__main__":
    main()
