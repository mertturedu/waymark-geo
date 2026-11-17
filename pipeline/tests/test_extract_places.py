import os
import sys

import osmxml as ox
from worlds import read_lines, write_inputs

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extract"))
from extract_places import extract  # noqa: E402


def run(tmp_path, elements):
    pbf, admin, hoods = write_inputs(tmp_path, elements)
    out = tmp_path / "out"
    return extract(pbf, admin, hoods, str(out)), out


def test_listed_kinds_with_a_name_are_kept_and_everything_else_is_ignored(tmp_path):
    elements = [
        ox.node(1, 40.6, 28.55, {"amenity": "hospital", "name": "Devlet Hastanesi", "name:en": "State Hospital"}),
        ox.node(2, 40.61, 28.55, {"amenity": "pharmacy", "name": "Gul Eczanesi"}),
        ox.node(3, 40.62, 28.55, {"amenity": "bench", "name": "Bank"}),
        ox.node(4, 40.63, 28.55, {"amenity": "hospital"}),
        ox.node(5, 40.64, 28.55, {"amenity": "place_of_worship", "religion": "muslim", "name": "Merkez Camii"}),
        ox.node(6, 40.65, 28.55, {"amenity": "place_of_worship", "religion": "christian", "name": "Kilise"}),
        ox.node(7, 40.66, 28.55, {"building": "mosque", "name": "Kucuk Cami"}),
        ox.node(8, 40.67, 28.55, {"shop": "mall", "name": "Buyuk AVM"}),
    ]
    accounting, out = run(tmp_path, elements)
    rows = read_lines(out / "34" / "places.jsonl")
    assert [(r["id"], r["kind"], r["name"]) for r in rows] == [
        ("n1", "hospital", "Devlet Hastanesi"), ("n2", "pharmacy", "Gul Eczanesi"), ("n5", "mosque", "Merkez Camii"), ("n7", "mosque", "Kucuk Cami"), ("n8", "mall", "Buyuk AVM"),
    ]
    assert rows[0]["names"] == {"en": "State Hospital", "tr": "Devlet Hastanesi"}
    assert rows[0]["district"] == "r10" and rows[0]["neighbourhood"] == "r20" and rows[0]["hoodSource"] == "polygon"
    assert accounting["source"] == 5 and accounting["provinces"]["34"]["accepted"] == 5


def test_a_closed_outline_gets_a_point_inside_it_and_an_open_way_is_skipped(tmp_path):
    nodes = [ox.node(i, lat, lon) for i, (lat, lon) in zip(range(10, 14), [(40.60, 28.60), (40.60, 28.62), (40.62, 28.62), (40.62, 28.60)])]
    closed = ox.way(1, [10, 11, 12, 13, 10], {"amenity": "school", "name": "Okul"})
    opened = ox.way(2, [10, 11, 12], {"amenity": "school", "name": "Yarim Okul"})
    accounting, out = run(tmp_path, nodes + [closed, opened])
    [row] = read_lines(out / "34" / "places.jsonl")
    assert row["id"] == "w1" and 28.60 < row["lon"] < 28.62 and 40.60 < row["lat"] < 40.62
    assert accounting["rejected"]["not_closed"] == 1
    assert accounting["rejected"]["no_point"] == 0
    accepted = sum(e["accepted"] for e in accounting["provinces"].values())
    assert accounting["source"] == accepted + sum(accounting["rejected"].values()) == 2


def test_places_outside_the_provinces_or_in_no_district_are_rejected_and_the_books_balance(tmp_path):
    elements = [
        ox.node(1, 48.0, 10.0, {"amenity": "bank", "name": "Uzak Banka"}),
        ox.node(2, 41.3, 29.3, {"amenity": "bank", "name": "Bos Banka"}),
        ox.node(3, 40.6, 28.55, {"amenity": "bank", "name": "Iyi Banka"}),
    ]
    accounting, out = run(tmp_path, elements)
    assert accounting["source"] == 3
    assert accounting["rejected"] == {"no_district": 1, "no_point": 0, "not_closed": 0, "outside": 1}
    accepted = sum(e["accepted"] for e in accounting["provinces"].values())
    assert accounting["source"] == accepted + sum(accounting["rejected"].values())


def test_a_flat_outline_has_no_point_and_is_counted_as_rejected(tmp_path):
    nodes = [ox.node(10, 40.6, 28.60), ox.node(11, 40.6, 28.61), ox.node(12, 40.6, 28.62)]
    flat = ox.way(1, [10, 11, 12, 10], {"amenity": "school", "name": "Duz Okul"})
    good = ox.node(2, 40.6, 28.55, {"amenity": "bank", "name": "Iyi Banka"})
    accounting, out = run(tmp_path, nodes + [flat, good])
    assert accounting["source"] == 2
    assert accounting["rejected"]["no_point"] == 1
    accepted = sum(e["accepted"] for e in accounting["provinces"].values())
    assert accounting["source"] == accepted + sum(accounting["rejected"].values())
