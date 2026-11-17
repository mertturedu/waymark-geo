import os
import tempfile

import osmium

from common import inside_point, is_closed, run_osmium, way_coords

FILTERS = [
    "nw/amenity", "nw/shop", "nw/tourism", "nw/leisure", "nw/office", "nw/historic",
    "nw/railway=station", "nw/railway=halt", "nw/railway=tram_stop", "nw/public_transport=station",
]
MAX_NAME = 80


def category_of(tags):
    for key in ("amenity", "tourism", "leisure", "office", "historic"):
        if tags.get(key):
            return tags[key]
    if tags.get("shop"):
        return "shop_" + tags["shop"]
    if tags.get("railway") in ("station", "halt", "tram_stop") or tags.get("public_transport") == "station":
        return "train_station"
    return None


def read(pbf, classify):
    found = []
    with tempfile.TemporaryDirectory() as tmp:
        filtered = os.path.join(tmp, "names.osm.pbf")
        run_osmium("tags-filter", "--overwrite", "-o", filtered, pbf, *FILTERS)
        for obj in osmium.FileProcessor(filtered, osmium.osm.NODE | osmium.osm.WAY).with_locations():
            tags = obj.tags
            name = (tags.get("name:tr") or tags.get("name") or "").strip()
            category = category_of(tags)
            if not name or not category or len(name) > MAX_NAME:
                continue
            if obj.is_node():
                if not obj.location.valid():
                    continue
                point = (obj.location.lon, obj.location.lat)
                key = "n%d" % obj.id
            else:
                coords = way_coords(obj)
                point = inside_point(coords) if coords and is_closed(coords) else None
                if point is None:
                    continue
                key = "w%d" % obj.id
            found.append({"id": key, "name": name, "group": classify(category), "lon": round(point[0], 6), "lat": round(point[1], 6)})
    return found
