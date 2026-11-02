import json
import math
import os
import sys

import shapely
from worlds import ADMIN, admin_row, square

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extract"))
from admin_pack import pack_rows, write_admin_pack  # noqa: E402


def circle(lon, lat, radius, points=720):
    ring = [(lon + radius * math.cos(2 * math.pi * i / points), lat + radius * math.sin(2 * math.pi * i / points)) for i in range(points)]
    return shapely.to_wkt(shapely.Polygon(ring + [ring[0]]))


def test_districts_and_neighbourhoods_of_one_province_come_with_centre_and_rings():
    rows = pack_rows(ADMIN, "34", 0.0001)
    assert [(r["id"], r["level"], r["parent"]) for r in rows] == [("r10", 6, "r1"), ("r11", 6, "r1"), ("r20", 8, "r10")]
    moda = rows[2]
    assert moda["names"] == {"tr": "Moda Mahallesi"}
    assert moda["rings"] == [[[[28.5, 40.5], [28.72, 40.5], [28.72, 41.0], [28.5, 41.0], [28.5, 40.5]]]]
    assert 28.5 < moda["center"][0] < 28.72 and 40.5 < moda["center"][1] < 41.0


def test_the_other_province_is_not_included():
    assert [r["id"] for r in pack_rows(ADMIN, "06", 0.0001)] == ["r12"]
    assert pack_rows(ADMIN, "99", 0.0001) == []


def test_holes_are_kept_as_second_rings():
    donut = "POLYGON ((28.5 40.5, 29.5 40.5, 29.5 41.5, 28.5 41.5, 28.5 40.5), (28.9 40.9, 29.1 40.9, 29.1 41.1, 28.9 41.1, 28.9 40.9))"
    rows = [ADMIN[0], admin_row("r10", 6, "Halka", donut, parent="r1")]
    [row] = pack_rows(rows, "34", 0.0001)
    assert len(row["rings"]) == 1 and len(row["rings"][0]) == 2


def test_dense_outlines_are_thinned_and_still_cover_the_original_to_the_tolerance():
    dense = circle(29.0, 41.0, 0.1)
    rows = [ADMIN[0], admin_row("r10", 6, "Yuvarlak", dense, parent="r1")]
    [row] = pack_rows(rows, "34", 0.0005)
    ring = row["rings"][0][0]
    assert 8 < len(ring) < 200
    thin = shapely.Polygon(ring)
    assert shapely.from_wkt(dense).hausdorff_distance(thin) < 0.0006


def test_a_unit_with_alternative_names_keeps_them_and_output_bytes_do_not_depend_on_input_order(tmp_path):
    rows = [dict(r) for r in ADMIN]
    rows[3]["alt"] = ["Scutari"]
    a, b = tmp_path / "a.jsonl", tmp_path / "b.jsonl"
    a.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    b.write_text("".join(json.dumps(r) + "\n" for r in reversed(rows)), encoding="utf-8")
    write_admin_pack(str(a), str(tmp_path / "outa"), 0.0001)
    write_admin_pack(str(b), str(tmp_path / "outb"), 0.0001)
    assert (tmp_path / "outa" / "34.jsonl").read_bytes() == (tmp_path / "outb" / "34.jsonl").read_bytes()
    assert json.loads((tmp_path / "outa" / "34.jsonl").read_text().splitlines()[1])["alt"] == ["Scutari"]
    assert sorted(os.listdir(tmp_path / "outa")) == ["06.jsonl", "34.jsonl"]
