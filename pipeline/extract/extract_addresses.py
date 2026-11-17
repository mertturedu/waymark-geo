import argparse
import json
import os
import re
import tempfile

import osmium
import shapely
import shapely.wkb

from assign import Assigner, meters
from common import id_key, inside_point, is_closed, read_json_lines, run_osmium, way_coords, write_json, write_lines

MAX_NUMBER = 100
DUPLICATE_M = 5
TAG_FIELDS = (("city", "addr:city"), ("province", "addr:province"), ("district", "addr:district"), ("neighbourhood", "addr:neighbourhood"), ("suburb", "addr:suburb"))


DIGIT = re.compile("[0-9\u0660-\u0669\u06f0-\u06f9]")


def utf16_length(text):
    return len(text.encode("utf-16-le")) // 2


def number_parts(raw):
    parts = [part.strip() for part in re.split("[;,]", raw) if part.strip()]
    good, reason = [], None
    for part in parts:
        if utf16_length(part) > MAX_NUMBER:
            reason = reason or "too_long"
        elif not DIGIT.search(part):
            reason = reason or "no_digit"
        else:
            good.append(part)
    return good, (reason or "empty")


def way_point(obj):
    coords = way_coords(obj)
    if coords is None:
        return None
    if is_closed(coords):
        point = inside_point(coords)
        if point is not None:
            return point
    return coords[len(coords) // 2]


def describe(key, point, tags):
    return {
        "id": key,
        "point": point,
        "raw": tags.get("addr:housenumber"),
        "street": tags.get("addr:street") or None,
        "place": tags.get("addr:place") or None,
        "postcode": tags.get("addr:postcode") or None,
        "hoodTag": tags.get("addr:neighbourhood") or tags.get("addr:suburb") or None,
        "tags": {short: tags.get(full) for short, full in TAG_FIELDS if tags.get(full)},
    }


def relation_count(path):
    return int(run_osmium("fileinfo", "-e", "-g", "data.count.relations", path).strip() or 0)


def read_objects(pbf):
    factory = osmium.geom.WKBFactory()
    objects = {}
    with tempfile.TemporaryDirectory() as tmp:
        tagged = os.path.join(tmp, "addresses.osm.pbf")
        relations = os.path.join(tmp, "relations.osm.pbf")
        complete = os.path.join(tmp, "complete.osm.pbf")
        run_osmium("tags-filter", "--overwrite", "-o", tagged, pbf, "nwr/addr:housenumber")
        run_osmium("tags-filter", "-R", "--overwrite", "-o", relations, tagged, "r/addr:housenumber")
        has_relations = relation_count(relations) > 0
        if has_relations:
            run_osmium("getid", "-r", "--overwrite", "-o", complete, "-I", relations, pbf)
        for obj in osmium.FileProcessor(tagged, osmium.osm.NODE | osmium.osm.WAY).with_locations():
            if "addr:housenumber" not in obj.tags:
                continue
            if obj.is_node():
                key, point = "n%d" % obj.id, ((obj.location.lon, obj.location.lat) if obj.location.valid() else None)
            else:
                key, point = "w%d" % obj.id, way_point(obj)
            objects[key] = describe(key, point, obj.tags)
        for obj in osmium.FileProcessor(complete).with_locations().with_areas() if has_relations else []:
            if "addr:housenumber" not in obj.tags:
                continue
            if obj.is_relation():
                objects["r%d" % obj.id] = describe("r%d" % obj.id, None, obj.tags)
            elif obj.is_area() and not obj.from_way():
                key = "r%d" % obj.orig_id()
                try:
                    point = shapely.wkb.loads(factory.create_multipolygon(obj), hex=True).representative_point()
                except RuntimeError:
                    continue
                if key in objects:
                    objects[key]["point"] = (point.x, point.y)
    return objects


def drop_duplicates(rows):
    kept, dropped = [], []
    groups = {}
    for row in sorted(rows, key=lambda r: id_key(r["id"])):
        groups.setdefault((row["district"], row["street"], row["place"], row["number"]), []).append(row)
    for group in groups.values():
        survivors = []
        for row in group:
            if any(meters(row["lon"], row["lat"], other["lon"], other["lat"]) <= DUPLICATE_M for other in survivors):
                dropped.append(row)
            else:
                survivors.append(row)
        kept.extend(survivors)
    return kept, dropped


def row_order(row):
    return (row["district"] or "", row["neighbourhood"] or "", row["hoodName"] or "", row["street"] or "", row["place"] or "", row["number"], id_key(row["id"]))


def extract(pbf, admin_path, places_path, out_dir, provinces=None):
    assigner = Assigner(read_json_lines(admin_path), read_json_lines(places_path))
    objects = read_objects(pbf)
    plates = sorted(p for p in assigner.plates if provinces is None or p in provinces)
    ordered = sorted(objects.values(), key=lambda o: id_key(o["id"]))
    located = [o for o in ordered if o["point"] is not None]
    unlocatable = [o["id"] for o in ordered if o["point"] is None]
    results = assigner.locate_many([o["point"][0] for o in located], [o["point"][1] for o in located], [o["hoodTag"] for o in located])
    accepted = {p: [] for p in plates}
    rejects = {p: [] for p in plates}
    counts = {p: {"source": 0, "accepted": 0, "rows": 0, "rejected": {}} for p in plates}
    outside, skipped = [], 0
    for obj, place in zip(located, results):
        lon, lat = round(obj["point"][0], 6), round(obj["point"][1], 6)
        if place is None:
            outside.append({"id": obj["id"], "lat": lat, "lon": lon})
            continue
        plate = place["province"]
        if plate not in counts:
            skipped += 1
            continue
        counts[plate]["source"] += 1
        parts, reason = number_parts(obj["raw"])
        if not parts:
            rejects[plate].append({"id": obj["id"], "lat": lat, "lon": lon, "number": obj["raw"], "reason": reason})
            continue
        if place["district"] is None:
            rejects[plate].append({"id": obj["id"], "lat": lat, "lon": lon, "number": obj["raw"], "reason": "no_district"})
            continue
        for part in parts:
            accepted[plate].append(
                {
                    "id": obj["id"], "street": obj["street"], "place": obj["place"], "number": part, "postcode": obj["postcode"],
                    "lon": lon, "lat": lat, "district": place["district"], "neighbourhood": place["neighbourhood"],
                    "hoodName": place["hoodName"], "hoodNames": place["hoodNames"], "hoodSource": place["hoodSource"],
                    "slack": place["slack"], "tags": obj["tags"],
                }
            )
    for plate in plates:
        kept, dropped = drop_duplicates(accepted[plate])
        survivors = {row["id"] for row in kept}
        repeated = {}
        for row in dropped:
            if row["id"] not in survivors:
                repeated.setdefault(row["id"], row)
        for identifier, row in repeated.items():
            rejects[plate].append({"id": identifier, "lat": row["lat"], "lon": row["lon"], "number": row["number"], "reason": "duplicate"})
        rejects[plate].sort(key=lambda r: id_key(r["id"]))
        kept.sort(key=row_order)
        entry = counts[plate]
        entry["accepted"] = len(survivors)
        entry["rows"] = len(kept)
        for r in rejects[plate]:
            entry["rejected"][r["reason"]] = entry["rejected"].get(r["reason"], 0) + 1
        entry["rejected"] = dict(sorted(entry["rejected"].items()))
        write_lines(os.path.join(out_dir, plate, "addresses.jsonl"), kept)
        write_lines(os.path.join(out_dir, plate, "rejects.jsonl"), rejects[plate])
    write_lines(os.path.join(out_dir, "outside.jsonl"), outside)
    accounting = {
        "filtered": provinces is not None,
        "outside": len(outside),
        "provinces": counts,
        "skipped": skipped,
        "source": len(ordered),
        "unlocatable": len(unlocatable),
    }
    write_json(os.path.join(out_dir, "accounting.json"), accounting)
    write_lines(os.path.join(out_dir, "unlocatable.jsonl"), [{"id": i} for i in unlocatable])
    return accounting


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pbf")
    parser.add_argument("admin")
    parser.add_argument("places")
    parser.add_argument("out_dir")
    parser.add_argument("--provinces")
    args = parser.parse_args()
    wanted = set(args.provinces.split(",")) if args.provinces else None
    accounting = extract(args.pbf, args.admin, args.places, args.out_dir, wanted)
    print(json.dumps({k: v for k, v in accounting.items() if k != "provinces"}, sort_keys=True))


if __name__ == "__main__":
    main()
