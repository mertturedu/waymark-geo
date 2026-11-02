import math
import os
import sys

import shapely
from worlds import ADMIN, admin_row

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extract"))
from admin_pack import border_rows  # noqa: E402


def test_one_row_per_turkish_province_sorted_by_plate_with_thin_rings():
    ring = [(29 + 0.3 * math.cos(2 * math.pi * i / 720), 41 + 0.3 * math.sin(2 * math.pi * i / 720)) for i in range(720)]
    dense = shapely.to_wkt(shapely.Polygon(ring + [ring[0]]))
    rows = ADMIN + [admin_row("r5", 4, "Yuvarlak", dense, iso="TR-16"), admin_row("r6", 4, "Dis", "POLYGON ((0 0, 1 0, 1 1, 0 0))", iso="SY-HK")]
    got = border_rows(rows, 0.0009)
    assert [r["plate"] for r in got] == ["06", "16", "34"]
    assert len(got[1]["rings"][0][0]) < 150
    assert got[2]["rings"] == [[[[28.5, 40.5], [29.5, 40.5], [29.5, 41.5], [28.5, 41.5], [28.5, 40.5]]]]
