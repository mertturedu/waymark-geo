import json
import math
import re
import sys

import networkx as nx
import osmium

M_PER_DEGREE = 111195.0
CLASSES = {
    "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
    "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "service",
}
PRIVATE_SERVICE = {"parking_aisle", "driveway", "emergency_access"}
ALLOWED = {"yes", "permissive", "designated", "destination", "delivery", "customers"}
DENIED = {"no", "private", "military", "agricultural", "forestry", "emergency", "permit"}
SPECIFIC = ("motorcar", "motor_vehicle", "vehicle", "access")
ONEWAY_KEYS = ("oneway:motorcar", "oneway:motor_vehicle", "oneway:vehicle", "oneway")
HARMLESS = {"gate", "lift_gate", "swing_gate", "sliding_gate", "kerb", "toll_booth", "cattle_grid", "border_control", "sally_port", "entrance", "height_restrictor", "arch", "no"}


def distance(a, b):
    dy = (b[1] - a[1]) * M_PER_DEGREE
    dx = (b[0] - a[0]) * M_PER_DEGREE * math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot(dx, dy)


def access(tags):
    for key in SPECIFIC:
        value = tags.get(key)
        if value in ALLOWED:
            return True
        if value in DENIED:
            return False
    return None


def direction(tags, cls):
    for key in ONEWAY_KEYS:
        value = tags.get(key)
        if value in ("yes", "true", "1"):
            return "f"
        if value in ("-1", "reverse"):
            return "b"
        if value in ("no", "false", "0", "reversible", "alternating"):
            return ""
    if tags.get("junction") in ("roundabout", "circular") or cls in ("motorway", "motorway_link"):
        return "f"
    return ""


def limit(text, table):
    if text is None:
        return None
    text = text.strip()
    if text in table["named"]:
        return table["named"][text]
    found = re.fullmatch(r"(\d{1,3})(?:\s?(mph|km/h|kmh))?", text)
    if not found:
        return None
    value = int(found.group(1)) * (table["mph"] if found.group(2) == "mph" else 1)
    return value if table["min"] <= value <= table["max"] else None


def kmh(cls, maxspeed, table):
    posted = limit(maxspeed, table)
    speed = table["class"][cls] if posted is None else posted * table["posted"]
    if cls in table["streets"]["classes"]:
        speed *= table["streets"]["factor"]
    return max(table["min"], speed)


def build(path, table):
    coords = {}
    blocked = set()
    ways = []
    for obj in osmium.FileProcessor(path, osmium.osm.NODE | osmium.osm.WAY).with_locations():
        if obj.is_node():
            tags = {t.k: t.v for t in obj.tags}
            barrier = tags.get("barrier")
            allowed = access(tags)
            if allowed is False or (allowed is None and barrier is not None and barrier not in HARMLESS):
                blocked.add(obj.id)
        elif obj.is_way():
            tags = {t.k: t.v for t in obj.tags}
            cls = tags.get("highway")
            if tags.get("route") == "ferry" or cls not in CLASSES:
                continue
            if cls == "service" and tags.get("service") in PRIVATE_SERVICE:
                continue
            if tags.get("area") == "yes":
                continue
            if access(tags) is False:
                continue
            ids = [n.ref for n in obj.nodes]
            points = [(n.location.lon, n.location.lat) for n in obj.nodes]
            for i, n in enumerate(obj.nodes):
                coords[n.ref] = points[i]
            ways.append((ids, direction(tags, cls), kmh(cls, tags.get("maxspeed"), table)))
    uses = {}
    for ids, _, _ in ways:
        for node in ids:
            uses[node] = uses.get(node, 0) + 1
        for end in (ids[0], ids[-1]):
            uses[end] += 1
    graph = nx.DiGraph()
    for ids, way_direction, speed in ways:
        for u, v in zip(ids, ids[1:]):
            if u in blocked or v in blocked or u == v:
                continue
            seconds = distance(coords[u], coords[v]) / (speed / 3.6)
            for a, b, ok in ((u, v, way_direction != "b"), (v, u, way_direction != "f")):
                if ok and (not graph.has_edge(a, b) or graph[a][b]["w"] > seconds):
                    graph.add_edge(a, b, w=seconds)
    junctions = {node for node, count in uses.items() if count >= 2 and node not in blocked}
    return graph, junctions


def solve(graph, junctions, pairs):
    by_source = {}
    for index, (source, target) in enumerate(pairs):
        by_source.setdefault(source, []).append((index, target))
    results = [None] * len(pairs)
    for source, wanted in by_source.items():
        if source not in graph:
            continue
        pred, distances = nx.dijkstra_predecessor_and_distance(graph, source, weight="w")
        for index, target in wanted:
            if target not in distances:
                continue
            edges = 0
            node = target
            while node != source:
                if node in junctions:
                    edges += 1
                node = pred[node][0]
            results[index] = {"seconds": distances[target], "edges": edges}
    return results


def main(argv):
    clip, pairs_path, out_path, speeds_path = argv
    table = json.load(open(speeds_path))
    pairs = json.load(open(pairs_path))
    graph, junctions = build(clip, table)
    results = solve(graph, junctions, [(a, b) for a, b in pairs])
    with open(out_path, "w") as f:
        json.dump(results, f)


if __name__ == "__main__":
    main(sys.argv[1:])
