import os
import tempfile

import osmium

from chains import chain_of
from common import inside_point, is_closed, run_osmium, way_coords

FILTERS = [
    "nw/shop=supermarket", "nw/shop=convenience", "nw/shop=department_store", "nw/shop=wholesale", "nw/shop=chemist", "nw/shop=mobile_phone",
    "nw/shop=electronics", "nw/shop=doityourself", "nw/shop=clothes", "nw/shop=shoes", "nw/shop=cosmetics",
    "nw/amenity=fuel", "nw/amenity=bank", "nw/amenity=fast_food", "nw/amenity=cafe", "nw/amenity=restaurant",
    "nw/office=courier", "nw/amenity=post_office", "nw/amenity=parcel_locker",
]
MARKET_SHOPS = ("supermarket", "convenience", "department_store", "wholesale")
FOOD_AMENITIES = ("fast_food", "cafe", "restaurant")
MAX_NAME = 80


def group_of(tags):
    shop = tags.get("shop")
    amenity = tags.get("amenity")
    if shop in MARKET_SHOPS:
        return "market"
    if tags.get("office") == "courier" or amenity in ("post_office", "parcel_locker"):
        return "cargo"
    if amenity == "fuel":
        return "fuel"
    if amenity == "bank":
        return "money"
    if amenity in FOOD_AMENITIES:
        return "food"
    return "shop" if shop else None


def read(pbf):
    found = []
    with tempfile.TemporaryDirectory() as tmp:
        filtered = os.path.join(tmp, "chains.osm.pbf")
        run_osmium("tags-filter", "--overwrite", "-o", filtered, pbf, *FILTERS)
        for obj in osmium.FileProcessor(filtered, osmium.osm.NODE | osmium.osm.WAY).with_locations():
            tags = obj.tags
            group = group_of(tags)
            if group is None:
                continue
            name = (tags.get("name") or "").strip()
            brand = (tags.get("brand") or "").strip()
            chain = chain_of(name, brand, group) or chain_of(brand, name, group)
            if chain is None:
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
            found.append({"id": "osm:" + key, "chain": chain, "group": group, "name": (name or brand)[:MAX_NAME], "lon": round(point[0], 6), "lat": round(point[1], 6)})
    return found
