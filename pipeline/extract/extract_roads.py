import argparse
import json
import math
import os
import shutil
import tempfile

import osmium
from shapely import wkt
from shapely.affinity import scale
from shapely.geometry import mapping

from assign import M_PER_DEGREE
from common import read_json_lines, run_osmium, write_json, write_lines
from road_rules import blocked_node, classify_way, parse_restriction

BUFFER_M = 10000
SIMPLIFY = 0.0005
ROW_ORDER = {"w": 0, "b": 1, "r": 2}
CHUNK = 6


def tag_dict(obj):
    return {tag.k: tag.v for tag in obj.tags}


def buffered(text, meters=BUFFER_M):
    shape = wkt.loads(text)
    factor = math.cos(math.radians(shape.centroid.y))
    flat = scale(shape, factor, 1, origin=(0, 0))
    grown = scale(flat.buffer(meters / M_PER_DEGREE), 1 / factor, 1, origin=(0, 0))
    return grown.simplify(SIMPLIFY)


def province_shapes(admin_path, provinces):
    shapes = {}
    for row in read_json_lines(admin_path):
        if row["level"] == 4 and row.get("iso"):
            plate = row["iso"].split("-")[1]
            if not provinces or plate in provinces:
                shapes[plate] = buffered(row["wkt"])
    return dict(sorted(shapes.items()))


def clip_all(pbf, shapes, directory):
    extracts = []
    for plate, shape in shapes.items():
        path = os.path.join(directory, plate + ".geojson")
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"type": "Feature", "properties": {}, "geometry": mapping(shape)}, f)
        extracts.append({"output": plate + ".osm.pbf", "polygon": {"file_name": path, "file_type": "geojson"}})
    config = os.path.join(directory, "extracts.json")
    with open(config, "w", encoding="utf-8") as f:
        json.dump({"directory": directory, "extracts": extracts}, f)
    run_osmium("extract", "--overwrite", "--strategy", "complete_ways", "-c", config, pbf)


def way_row(obj, verdict):
    coords = []
    for ref in obj.nodes:
        if not ref.location.valid():
            return None
        coords.append([round(ref.location.lon, 7), round(ref.location.lat, 7)])
    if len(coords) < 2:
        return None
    row = {"t": "w", "id": obj.id, "cls": verdict["cls"], "o": verdict["oneway"], "n": [ref.ref for ref in obj.nodes], "c": coords}
    if verdict["speed"] is not None:
        row["s"] = verdict["speed"]
    if verdict["ferry"]:
        row["f"] = True
    if verdict["duration"] is not None:
        row["d"] = verdict["duration"]
    return row


def holds(rule, kept):
    start, end = kept.get(rule["from"]), kept.get(rule["to"])
    if start is None or end is None:
        return False
    if "n" in rule["via"][0]:
        node = rule["via"][0]["n"]
        return node in start["n"] and node in end["n"]
    return all(step["w"] in kept for step in rule["via"])


def bump(table, reason):
    table[reason] = table.get(reason, 0) + 1


def read_plate(path):
    blocked, kept, pending = set(), {}, []
    ways = {"source": 0, "accepted": 0, "rejected": {}}
    rules = {"source": 0, "accepted": 0, "rejected": {}}
    for obj in osmium.FileProcessor(path, osmium.osm.NODE | osmium.osm.WAY | osmium.osm.RELATION).with_locations():
        if obj.is_node():
            if len(obj.tags) and blocked_node(tag_dict(obj)):
                blocked.add(obj.id)
        elif obj.is_way():
            tags = tag_dict(obj)
            if "highway" not in tags and tags.get("route") != "ferry":
                continue
            ways["source"] += 1
            verdict = classify_way(tags)
            row = way_row(obj, verdict) if verdict["ok"] else None
            if not verdict["ok"]:
                bump(ways["rejected"], verdict["reason"])
            elif row is None:
                bump(ways["rejected"], "geometry")
            else:
                kept[obj.id] = row
                ways["accepted"] += 1
        elif obj.is_relation():
            tags = tag_dict(obj)
            if not tags.get("type", "").startswith("restriction"):
                continue
            rules["source"] += 1
            verdict = parse_restriction(tags, [(m.type, m.ref, m.role) for m in obj.members])
            if verdict["ok"]:
                pending.append((obj.id, verdict))
            else:
                bump(rules["rejected"], verdict["reason"])
    rows = list(kept.values())
    for id, verdict in pending:
        if holds(verdict, kept):
            rows.append({"t": "r", "id": id, **{k: v for k, v in verdict.items() if k != "ok"}})
            rules["accepted"] += 1
        else:
            bump(rules["rejected"], "off_network")
    used = sorted({n for row in kept.values() for n in row["n"]} & blocked)
    rows.extend({"t": "b", "id": n} for n in used)
    rows.sort(key=lambda r: (ROW_ORDER[r["t"]], r["id"]))
    return rows, {"ways": ways, "restrictions": rules, "blocked": len(used)}


def extract(pbf, admin_path, out_dir, provinces, chunk=CHUNK, clip_dir=None):
    shapes = province_shapes(admin_path, provinces)
    plates = list(shapes)
    accounting = {}
    for start in range(0, len(plates), chunk):
        group = {plate: shapes[plate] for plate in plates[start:start + chunk]}
        with tempfile.TemporaryDirectory() as tmp:
            clip_all(pbf, group, tmp)
            if clip_dir:
                os.makedirs(clip_dir, exist_ok=True)
                for plate in group:
                    shutil.copy(os.path.join(tmp, plate + ".osm.pbf"), os.path.join(clip_dir, plate + ".osm.pbf"))
            for plate in group:
                rows, counts = read_plate(os.path.join(tmp, plate + ".osm.pbf"))
                write_lines(os.path.join(out_dir, plate, "roads.jsonl"), rows)
                accounting[plate] = counts
    result = {"provinces": accounting}
    write_json(os.path.join(out_dir, "roads-accounting.json"), result)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pbf")
    parser.add_argument("admin")
    parser.add_argument("out_dir")
    parser.add_argument("--provinces")
    parser.add_argument("--keep-clips")
    args = parser.parse_args()
    result = extract(args.pbf, args.admin, args.out_dir, set(args.provinces.split(",")) if args.provinces else set(), clip_dir=args.keep_clips)
    print({p: e["ways"]["accepted"] for p, e in result["provinces"].items()})


if __name__ == "__main__":
    main()
