import json
import math
import os
import sys

import pytest
import shapely
from shapely.geometry import shape

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extract"))
from region_geojson import region_geojson, write_regions  # noqa: E402

ISTANBUL = "POLYGON ((28.0 40.8, 29.0 40.8, 29.0 41.2, 28.0 41.2, 28.0 40.8))"


def circle_wkt(lon, lat, radius_deg, points=720):
    ring = [(lon + radius_deg * math.cos(2 * math.pi * i / points), lat + radius_deg * math.sin(2 * math.pi * i / points)) for i in range(points)]
    return shapely.to_wkt(shapely.Polygon(ring + [ring[0]]))


def province(plate, wkt, id="r1", level=4):
    return {"id": id, "level": level, "iso": "TR-" + plate, "names": {"tr": "Il"}, "alt": [], "bbox": [0, 0, 0, 0], "wkt": wkt, "parent": None}


def test_the_pad_widens_the_province_by_about_two_kilometres_on_every_side():
    feature = region_geojson([province("34", ISTANBUL)], "34", pad_m=2000)
    west, south, east, north = shape(feature["geometry"]).bounds
    assert south == pytest.approx(40.8 - 2000 / 111320, abs=0.002)
    assert north == pytest.approx(41.2 + 2000 / 111320, abs=0.002)
    km_east = (east - 29.0) * 111320 * math.cos(math.radians(41.0))
    assert km_east == pytest.approx(2000, abs=150)
    assert (28.0 - west) * 111320 * math.cos(math.radians(41.0)) == pytest.approx(2000, abs=150)


def test_the_region_covers_the_province_and_has_a_counter_clockwise_outer_ring():
    feature = region_geojson([province("34", ISTANBUL)], "34", pad_m=2000)
    geometry = shape(feature["geometry"])
    assert geometry.covers(shapely.from_wkt(ISTANBUL))
    ring = geometry.geoms[0].exterior if geometry.geom_type == "MultiPolygon" else geometry.exterior
    assert ring.is_ccw


def test_dense_outlines_are_thinned_but_never_by_more_than_the_tolerance():
    dense = circle_wkt(29.0, 41.0, 0.3)
    feature = region_geojson([province("34", dense)], "34", pad_m=2000, simplify_m=50)
    geometry = shape(feature["geometry"])
    ring = geometry.geoms[0].exterior if geometry.geom_type == "MultiPolygon" else geometry.exterior
    assert len(ring.coords) < 200
    assert geometry.covers(shapely.from_wkt(dense))


def test_other_provinces_and_levels_are_ignored_and_a_missing_plate_is_an_error():
    rows = [province("34", ISTANBUL, "r1"), province("06", ISTANBUL, "r2"), province("34", ISTANBUL, "r3", level=6)]
    assert region_geojson(rows, "06")["properties"] == {"plate": "06"}
    with pytest.raises(KeyError):
        region_geojson(rows, "99")


def test_two_runs_write_identical_files_whatever_the_row_order(tmp_path):
    rows = [province("34", ISTANBUL, "r1"), province("06", circle_wkt(32.8, 39.9, 0.2), "r2")]
    admin = tmp_path / "admin.jsonl"
    admin.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
    a, b = tmp_path / "a", tmp_path / "b"
    assert write_regions(str(admin), str(a), 2000) == ["06", "34"]
    admin.write_text("\n".join(json.dumps(r) for r in reversed(rows)) + "\n", encoding="utf-8")
    write_regions(str(admin), str(b), 2000)
    for plate in ("06", "34"):
        assert (a / (plate + ".geojson")).read_bytes() == (b / (plate + ".geojson")).read_bytes()
