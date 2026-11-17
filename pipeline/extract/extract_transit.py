import argparse
import json
import os

import osmium

from common import write_lines

MODES = ("subway", "light_rail", "tram", "train", "ferry")
MODE_COLOUR = {
    "subway": "#D32F2F",
    "light_rail": "#7B1FA2",
    "tram": "#F57C00",
    "train": "#546E7A",
    "ferry": "#1E88E5",
}
DEAD_STATES = ("proposed", "construction", "abandoned", "disused", "razed")
STATION_MODES = {"subway": "subway", "light_rail": "light_rail", "tram": "tram", "train": "train"}


def tag_dict(obj):
    return {tag.k: tag.v for tag in obj.tags}


def clean_colour(value, mode):
    text = (value or "").strip()
    if len(text) == 7 and text[0] == "#" and all(c in "0123456789abcdefABCDEF" for c in text[1:]):
        return text.upper()
    return MODE_COLOUR[mode]


def route_alive(tags):
    if tags.get("disused") == "yes" or tags.get("abandoned") == "yes":
        return False
    return tags.get("state", "") not in DEAD_STATES


def way_alive(tags):
    railway = tags.get("railway", "")
    return railway not in ("disused", "abandoned", "construction", "proposed", "razed") and tags.get("disused") != "yes"


def station_mode(tags):
    if tags.get("amenity") == "ferry_terminal":
        return "ferry"
    if tags.get("railway") == "tram_stop":
        return "tram"
    if tags.get("railway") in ("station", "halt") or tags.get("public_transport") == "station":
        for key in ("station", "subway"):
            if tags.get(key) in STATION_MODES:
                return STATION_MODES[tags[key]]
        if tags.get("subway") == "yes":
            return "subway"
        if tags.get("light_rail") == "yes":
            return "light_rail"
        if tags.get("railway") in ("station", "halt"):
            return "train"
    return None


def read_routes(pbf):
    routes = {}
    for obj in osmium.FileProcessor(pbf, osmium.osm.RELATION):
        tags = tag_dict(obj)
        if tags.get("type") != "route" or tags.get("route") not in MODES or not route_alive(tags):
            continue
        ways = [m.ref for m in obj.members if m.type == "w"]
        if ways:
            routes[obj.id] = {"mode": tags["route"], "colour": clean_colour(tags.get("colour"), tags["route"]), "ref": tags.get("ref", ""), "name": tags.get("name", ""), "ways": ways}
    return routes


def extract(pbf, out_path):
    routes = read_routes(pbf)
    wanted = {}
    for route_id, route in routes.items():
        for way_id in route["ways"]:
            wanted.setdefault(way_id, []).append(route_id)
    geometry = {}
    stations = {}
    processor = osmium.FileProcessor(pbf, osmium.osm.WAY | osmium.osm.NODE).with_locations()
    for obj in processor:
        tags = tag_dict(obj)
        if obj.is_way() and obj.id in wanted and way_alive(tags):
            coords = [[round(n.lon, 6), round(n.lat, 6)] for n in obj.nodes if n.location.valid()]
            if len(coords) >= 2:
                geometry[obj.id] = coords
        elif obj.is_node() and obj.tags:
            mode = station_mode(tags)
            if mode and tags.get("name") and obj.location.valid():
                stations[obj.id] = {"mode": mode, "name": tags["name"], "at": [round(obj.location.lon, 6), round(obj.location.lat, 6)]}
    rows = []
    lines = 0
    for route_id in sorted(routes):
        route = routes[route_id]
        parts = [geometry[w] for w in route["ways"] if w in geometry]
        if not parts:
            continue
        lines += 1
        rows.append({"type": "Feature", "properties": {"kind": "line", "mode": route["mode"], "colour": route["colour"], "ref": route["ref"], "name": route["name"]}, "geometry": {"type": "MultiLineString", "coordinates": parts}})
    for station_id in sorted(stations):
        station = stations[station_id]
        rows.append({"type": "Feature", "properties": {"kind": "station", "mode": station["mode"], "name": station["name"]}, "geometry": {"type": "Point", "coordinates": station["at"]}})
    write_lines(out_path, rows)
    return {"lines": lines, "stations": len(stations), "routes_seen": len(routes)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pbf")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    print(json.dumps(extract(args.pbf, args.out), sort_keys=True))


if __name__ == "__main__":
    main()
