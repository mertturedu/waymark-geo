import argparse
import os
import tempfile

import osmium

from common import run_osmium, write_lines


def levels_of(tags):
    for key in ("building:levels", "building:levels:aboveground"):
        raw = (tags.get(key) or "").replace(",", ".").strip()
        try:
            value = float(raw.split(";")[0])
        except ValueError:
            continue
        if 0 < value < 200:
            return int(round(value))
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pbf")
    parser.add_argument("out_dir")
    args = parser.parse_args()
    buildings, entrances, settlements = [], [], []
    with tempfile.TemporaryDirectory() as tmp:
        way_file = os.path.join(tmp, "b.osm.pbf")
        run_osmium("tags-filter", "--overwrite", "-o", way_file, args.pbf, "w/building")
        for obj in osmium.FileProcessor(way_file, osmium.osm.WAY):
            tags = obj.tags
            levels = levels_of(tags)
            if levels is None and not tags.get("name") and not tags.get("addr:housenumber"):
                continue
            buildings.append({"id": "w%d" % obj.id, "levels": levels, "name": tags.get("name"), "street": tags.get("addr:street"), "number": tags.get("addr:housenumber")})
        node_file = os.path.join(tmp, "e.osm.pbf")
        run_osmium("tags-filter", "--overwrite", "-o", node_file, args.pbf, "n/entrance")
        for node in osmium.FileProcessor(node_file, osmium.osm.NODE):
            if not node.location.valid():
                continue
            tags = node.tags
            entrances.append({"id": "n%d" % node.id, "lon": node.location.lon, "lat": node.location.lat, "kind": tags.get("entrance"), "ref": tags.get("ref"), "flats": tags.get("addr:flats"), "unit": tags.get("addr:unit"), "number": tags.get("addr:housenumber"), "street": tags.get("addr:street")})
        place_file = os.path.join(tmp, "p.osm.pbf")
        run_osmium("tags-filter", "--overwrite", "-o", place_file, args.pbf, "n/place=village,hamlet,isolated_dwelling,locality")
        for node in osmium.FileProcessor(place_file, osmium.osm.NODE):
            name = (node.tags.get("name") or "").strip()
            if name and node.location.valid():
                settlements.append({"id": "n%d" % node.id, "name": name, "kind": node.tags.get("place"), "lon": node.location.lon, "lat": node.location.lat})
    write_lines(os.path.join(args.out_dir, "settlements.jsonl"), settlements)
    write_lines(os.path.join(args.out_dir, "osm-buildings.jsonl"), buildings)
    write_lines(os.path.join(args.out_dir, "entrances.jsonl"), entrances)
    print(len(buildings), len(entrances), len(settlements))


if __name__ == "__main__":
    main()
