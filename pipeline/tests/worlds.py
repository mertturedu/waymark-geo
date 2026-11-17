import json

import osmxml as ox


def square(west, south, east, north):
    return "POLYGON ((%s %s, %s %s, %s %s, %s %s, %s %s))" % (west, south, east, south, east, north, west, north, west, south)


def admin_row(id, level, name, wkt, parent=None, iso=None):
    return {"id": id, "level": level, "iso": iso, "names": {"tr": name}, "alt": [], "bbox": [0, 0, 0, 0], "wkt": wkt, "parent": parent}


ADMIN = [
    admin_row("r1", 4, "Istanbul", square(28.5, 40.5, 29.5, 41.5), iso="TR-34"),
    admin_row("r2", 4, "Ankara", square(32.0, 39.5, 33.0, 40.5), iso="TR-06"),
    admin_row("r10", 6, "Kadikoy", square(28.5, 40.5, 29.0, 41.5), parent="r1"),
    admin_row("r11", 6, "Uskudar", square(29.0, 40.5, 29.5, 41.0), parent="r1"),
    admin_row("r12", 6, "Cankaya", square(32.0, 39.5, 33.0, 40.5), parent="r2"),
    admin_row("r20", 8, "Moda Mahallesi", square(28.5, 40.5, 28.72, 41.0), parent="r10"),
]
PLACES = [{"id": "n900", "name": "Fener", "names": {"tr": "Fener"}, "lon": 28.9, "lat": 41.2, "type": "suburb"}]


def write_inputs(tmp_path, elements, admin=ADMIN, places=PLACES, name="in"):
    pbf = ox.write(tmp_path / (name + ".osm"), elements)
    admin_path = tmp_path / (name + "-admin.jsonl")
    admin_path.write_text("".join(json.dumps(r) + "\n" for r in admin), encoding="utf-8")
    places_path = tmp_path / (name + "-places.jsonl")
    places_path.write_text("".join(json.dumps(r) + "\n" for r in places), encoding="utf-8")
    return pbf, str(admin_path), str(places_path)


def read_lines(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
