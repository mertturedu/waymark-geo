import json
import os
import sys

import osmium
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extract"))
from extract_streets import extract  # noqa: E402


def write_fixture(path):
    writer = osmium.SimpleWriter(path)
    nodes = {
        1: (29.00, 41.00), 2: (29.02, 41.00), 3: (29.04, 41.00),
        4: (29.00, 41.02), 5: (29.02, 41.02),
        6: (35.00, 38.00), 7: (35.02, 38.00),
        8: (29.01, 41.01), 9: (29.03, 41.01),
    }
    for node_id, (lon, lat) in nodes.items():
        writer.add_node(osmium.osm.mutable.Node(id=node_id, location=(lon, lat)))
    ways = [
        (10, [1, 2, 3], {"highway": "residential", "name": "İstiklal Caddesi"}),
        (11, [4, 5], {"highway": "residential"}),
        (12, [8, 9], {"highway": "footway", "name": "Yaya Yolu"}),
        (13, [6, 7], {"highway": "residential", "name": "Uzak Sokak"}),
        (14, [1, 4], {"highway": "tertiary", "name": "Çiçek Sokağı"}),
        (15, [2, 5], {"building": "yes", "name": "Bina"}),
    ]
    for way_id, refs, tags in ways:
        writer.add_way(osmium.osm.mutable.Way(id=way_id, nodes=refs, tags=tags))
    writer.close()


@pytest.fixture()
def rows(tmp_path):
    pbf = str(tmp_path / "in.osm.pbf")
    out = str(tmp_path / "streets.jsonl")
    write_fixture(pbf)
    count = extract(pbf, (28.9, 40.9, 29.1, 41.1), out)
    with open(out, encoding="utf-8") as f:
        return count, [json.loads(line) for line in f]


def test_keeps_named_drivable_ways_inside_the_box(rows):
    count, items = rows
    assert sorted(r["name"] for r in items) == ["Çiçek Sokağı", "İstiklal Caddesi"]
    assert count == 2


def test_uses_the_middle_node_as_location(rows):
    _, items = rows
    istiklal = next(r for r in items if r["name"] == "İstiklal Caddesi")
    assert (istiklal["lon"], istiklal["lat"]) == (29.02, 41.0)


def test_output_is_sorted_and_stable(rows):
    _, items = rows
    assert [r["name"] for r in items] == sorted(r["name"] for r in items)


def test_empty_box_writes_an_empty_file(tmp_path):
    pbf = str(tmp_path / "in.osm.pbf")
    out = str(tmp_path / "streets.jsonl")
    write_fixture(pbf)
    assert extract(pbf, (10.0, 10.0, 10.1, 10.1), out) == 0
    assert open(out).read() == ""
