import math
import os
import tempfile

import numpy
import osmium

from common import run_osmium

CELL = 0.002
MAX_RADIUS = 250


def build(pbf, out):
    xs, ys, radii = [], [], []
    with tempfile.TemporaryDirectory() as tmp:
        filtered = os.path.join(tmp, "buildings.osm.pbf")
        run_osmium("tags-filter", "--overwrite", "-o", filtered, pbf, "w/building")
        for obj in osmium.FileProcessor(filtered, osmium.osm.NODE | osmium.osm.WAY).with_locations():
            if not obj.is_way():
                continue
            points = [(n.lon, n.lat) for n in obj.nodes if n.location.valid()]
            if len(points) < 4:
                continue
            mx = sum(p[0] for p in points) / len(points)
            my = sum(p[1] for p in points) / len(points)
            scale = math.cos(math.radians(my))
            radius = max(math.hypot((x - mx) * 111320 * scale, (y - my) * 110540) for x, y in points)
            if radius > MAX_RADIUS:
                continue
            xs.append(mx)
            ys.append(my)
            radii.append(radius)
    numpy.savez(out + ".tmp.npz", x=numpy.array(xs, dtype=numpy.float64), y=numpy.array(ys, dtype=numpy.float64), r=numpy.array(radii, dtype=numpy.float32))
    os.replace(out + ".tmp.npz", out)


class Index:
    def __init__(self, x, y, r):
        self.x, self.y, self.r = x, y, r
        keys = self.key(numpy.floor(x / CELL).astype(numpy.int64), numpy.floor(y / CELL).astype(numpy.int64))
        order = numpy.argsort(keys, kind="stable")
        self.order = order
        self.keys = keys[order]

    @staticmethod
    def key(ix, iy):
        return ix * 4_000_000 + iy

    def nearest(self, lon, lat):
        ix, iy = int(math.floor(lon / CELL)), int(math.floor(lat / CELL))
        scale = math.cos(math.radians(lat))
        best = (math.inf, None)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                k = self.key(ix + dx, iy + dy)
                lo = numpy.searchsorted(self.keys, k, "left")
                hi = numpy.searchsorted(self.keys, k, "right")
                for i in self.order[lo:hi]:
                    d = math.hypot((lon - self.x[i]) * 111320 * scale, (lat - self.y[i]) * 110540) - float(self.r[i])
                    if d < best[0]:
                        best = (d, i)
        if best[1] is None:
            return math.inf, None
        return max(best[0], 0.0), (float(self.x[best[1]]), float(self.y[best[1]]))


def load(path):
    data = numpy.load(path)
    return Index(data["x"], data["y"], data["r"])


def ensure(pbf, path):
    if not os.path.exists(path) or os.path.getmtime(path) < os.path.getmtime(pbf):
        build(pbf, path)
    return load(path)
