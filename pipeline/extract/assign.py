import math
import re

import numpy as np
import shapely
from shapely.geometry import Point
from shapely.ops import nearest_points

PLATE = re.compile(r"^TR-(\d{2})$")
M_PER_DEGREE = 111_320.0


def meters(lon1, lat1, lon2, lat2):
    dy = (lat2 - lat1) * M_PER_DEGREE
    dx = (lon2 - lon1) * M_PER_DEGREE * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


def order_key(row):
    return (row["level"], int(row["id"][1:]))


class Level:
    def __init__(self, rows):
        self.rows = rows
        self.shapes = np.empty(len(rows), dtype=object)
        for i, row in enumerate(rows):
            shape = shapely.from_wkt(row["wkt"])
            shapely.prepare(shape)
            self.shapes[i] = shape
        self.tree = shapely.STRtree(self.shapes) if len(rows) else None

    def inside(self, xs, ys):
        first = np.full(len(xs), -1, dtype=np.int64)
        if self.tree is None or len(xs) == 0:
            return first
        points = shapely.points(xs, ys)
        point_index, shape_index = self.tree.query(points)
        if len(point_index) == 0:
            return first
        hit = shapely.intersects(self.shapes[shape_index], points[point_index])
        lowest = np.full(len(xs), np.iinfo(np.int64).max, dtype=np.int64)
        np.minimum.at(lowest, point_index[hit], shape_index[hit])
        found = lowest != np.iinfo(np.int64).max
        first[found] = lowest[found]
        return first

    def within(self, lon, lat, limit_m):
        if self.tree is None:
            return []
        pad = limit_m / M_PER_DEGREE * 2
        pad_lon = pad / max(math.cos(math.radians(lat)), 0.2)
        candidates = self.tree.query(shapely.box(lon - pad_lon, lat - pad, lon + pad_lon, lat + pad))
        point = Point(lon, lat)
        near = []
        for index in sorted(int(i) for i in candidates):
            closest = nearest_points(self.shapes[index], point)[0]
            distance = meters(lon, lat, closest.x, closest.y)
            if distance <= limit_m:
                near.append((distance, index))
        return near


class Assigner:
    def __init__(self, rows, places=(), shore_m=200, place_m=1000):
        ordered = sorted(rows, key=order_key)
        self.shore_m = shore_m
        self.place_m = place_m
        provinces = [r for r in ordered if r["level"] == 4 and PLATE.match(r["iso"] or "")]
        self.provinces = Level(provinces)
        self.plates = [PLATE.match(r["iso"]).group(1) for r in provinces]
        self.child_rows = {}
        for row in ordered:
            if row["level"] in (6, 8) and row["parent"]:
                self.child_rows.setdefault(row["parent"], []).append(row)
        self.levels = {}
        self.places_of = {}
        self.place_points = {}
        for place in sorted(places, key=lambda p: (p["id"][0], int(p["id"][1:]))):
            district = self.district_of(place["lon"], place["lat"])
            if district is not None:
                self.places_of.setdefault(district, []).append(place)

    def level_of(self, parent_id):
        if parent_id not in self.levels:
            self.levels[parent_id] = Level(self.child_rows.get(parent_id, []))
        return self.levels[parent_id]

    def province_of_many(self, xs, ys):
        found = self.provinces.inside(xs, ys)
        slack = np.zeros(len(xs), dtype=bool)
        for i in np.flatnonzero(found < 0):
            near = self.provinces.within(float(xs[i]), float(ys[i]), self.shore_m)
            if len(near) == 1:
                found[i] = near[0][1]
                slack[i] = True
        return found, slack

    def district_of(self, lon, lat):
        found, _ = self.province_of_many(np.array([lon]), np.array([lat]))
        if found[0] < 0:
            return None
        districts = self.level_of(self.provinces.rows[found[0]]["id"])
        index = districts.inside(np.array([lon]), np.array([lat]))[0]
        return districts.rows[index]["id"] if index >= 0 else None

    def locate(self, lon, lat, hood_tag=None):
        return self.locate_many([lon], [lat], [hood_tag])[0]

    def locate_many(self, lons, lats, hood_tags=None):
        xs = np.asarray(lons, dtype=float)
        ys = np.asarray(lats, dtype=float)
        tags = list(hood_tags) if hood_tags is not None else [None] * len(xs)
        results = [None] * len(xs)
        province, province_slack = self.province_of_many(xs, ys)
        by_province = {}
        for i, index in enumerate(province):
            if index >= 0:
                by_province.setdefault(int(index), []).append(i)
        for index, members in by_province.items():
            plate = self.plates[index]
            districts = self.level_of(self.provinces.rows[index]["id"])
            found = districts.inside(xs[members], ys[members])
            for position, i in enumerate(members):
                slack = bool(province_slack[i])
                district = int(found[position])
                if district < 0:
                    near = districts.within(float(xs[i]), float(ys[i]), self.shore_m)
                    if near:
                        district = min(near)[1]
                        slack = True
                results[i] = self.finish(plate, districts, district, float(xs[i]), float(ys[i]), tags[i], slack)
        return results

    def finish(self, plate, districts, district, lon, lat, tag, slack):
        result = {"province": plate, "district": None, "neighbourhood": None, "hoodName": None, "hoodNames": None, "hoodSource": "none", "slack": slack}
        if district < 0:
            return result
        district_id = districts.rows[district]["id"]
        result["district"] = district_id
        hoods = self.level_of(district_id)
        found = int(hoods.inside(np.array([lon]), np.array([lat]))[0])
        if found >= 0:
            result["neighbourhood"] = hoods.rows[found]["id"]
            result["hoodSource"] = "polygon"
            return result
        text = (tag or "").strip()
        if text:
            result["hoodName"] = text
            result["hoodSource"] = "tag"
            return result
        best = None
        for place in self.places_of.get(district_id, []):
            distance = meters(lon, lat, place["lon"], place["lat"])
            if distance <= self.place_m and (best is None or distance < best[0]):
                best = (distance, place)
        if best:
            result["hoodName"] = best[1]["name"]
            result["hoodNames"] = best[1]["names"]
            result["hoodSource"] = "place"
        return result
