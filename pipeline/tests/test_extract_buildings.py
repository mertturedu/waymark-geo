import math
import os
import sys

import osmxml as ox
from worlds import read_lines, write_inputs

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extract"))
from extract_buildings import extract  # noqa: E402


def square(first_node, way_id, west, south, size, tags=None):
    corners = [(south, west), (south, west + size), (south + size, west + size), (south + size, west)]
    ids = list(range(first_node, first_node + 4))
    return [ox.node(i, lat, lon) for i, (lat, lon) in zip(ids, corners)] + [ox.way(way_id, ids + [ids[0]], tags or {"building": "yes"})]


def run(tmp_path, elements, provinces):
    pbf, admin, _ = write_inputs(tmp_path, elements)
    out = tmp_path / "out"
    return extract(pbf, admin, str(out), provinces), out


def test_a_building_gets_a_point_inside_it_its_type_and_its_area_in_square_metres(tmp_path):
    accounting, out = run(tmp_path, square(10, 1, 28.6, 40.6, 0.001, {"building": "apartments"}), {"34"})
    [row] = read_lines(out / "34" / "buildings.jsonl")
    assert row["id"] == "w1" and row["building"] == "apartments"
    assert 28.6 < row["lon"] < 28.601 and 40.6 < row["lat"] < 40.601
    assert abs(row["area_m2"] - 111.32 * 111.32 * math.cos(math.radians(40.6005))) < 150
    assert accounting["provinces"]["34"] == {"source": 1, "accepted": 1, "rejected": {}}


def test_buildings_of_other_provinces_are_left_alone_and_counted_apart(tmp_path):
    elements = square(10, 1, 28.6, 40.6, 0.001) + square(20, 2, 32.5, 40.0, 0.001)
    accounting, out = run(tmp_path, elements, {"34"})
    assert accounting["elsewhere"] == 1
    assert not (out / "06").exists()


def test_a_flat_outline_is_rejected_and_the_books_balance(tmp_path):
    flat = [ox.node(30, 40.6, 28.6), ox.node(31, 40.6, 28.601), ox.node(32, 40.6, 28.602), ox.way(5, [30, 31, 32, 30], {"building": "yes"})]
    accounting, out = run(tmp_path, flat + square(10, 1, 28.6, 40.7, 0.001) + square(40, 6, 48.0, 10.0, 0.001), {"34"})
    entry = accounting["provinces"]["34"]
    assert entry["rejected"] == {"degenerate": 1}
    assert entry["source"] == entry["accepted"] + 1 == 2
    assert accounting["outside"] == 1
    assert [r["id"] for r in read_lines(out / "34" / "buildings.jsonl")] == ["w1"]


def test_open_ways_with_a_building_tag_are_not_buildings(tmp_path):
    elements = [ox.node(1, 40.6, 28.6), ox.node(2, 40.6, 28.7), ox.way(1, [1, 2], {"building": "yes"})]
    accounting, _ = run(tmp_path, elements, {"34"})
    assert accounting["open"] == 1 and accounting["provinces"]["34"]["source"] == 0
