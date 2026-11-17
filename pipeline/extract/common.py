import json
import os
import subprocess

from shapely.geometry import Polygon

OSMIUM = "/opt/homebrew/bin/osmium"


def run_osmium(*args):
    return subprocess.run([OSMIUM, *args], check=True, capture_output=True, text=True).stdout


def id_key(identifier):
    return (int(identifier[1:]), identifier[0])


def read_json_lines(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def write_lines(path, rows):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    os.replace(path + ".tmp", path)


def write_json(path, value):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path + ".tmp", "w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False, sort_keys=True, indent=1)
        f.write("\n")
    os.replace(path + ".tmp", path)


def way_coords(obj):
    coords = []
    for node in obj.nodes:
        if not node.location.valid():
            return None
        coords.append((node.location.lon, node.location.lat))
    return coords or None


def is_closed(coords):
    return len(coords) >= 4 and coords[0] == coords[-1]


def inside_point(coords):
    polygon = Polygon(coords)
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
    if polygon.is_empty or polygon.area == 0:
        return None
    point = polygon.representative_point()
    return point.x, point.y
