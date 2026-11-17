import json
import os
import sys

import osmxml as ox

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extract"))
from assign import Assigner  # noqa: E402
from extract_admin import extract, extract_places  # noqa: E402


def square(west, south, east, north):
    return "POLYGON ((%s %s, %s %s, %s %s, %s %s, %s %s))" % (west, south, east, south, east, north, west, north, west, south)


def row(id, level, name, wkt, parent=None, iso=None):
    return {"id": id, "level": level, "iso": iso, "names": {"tr": name}, "alt": [], "bbox": [0, 0, 0, 0], "wkt": wkt, "parent": parent}


# Two provinces side by side near Istanbul latitude; 0.01 degree is about 840 m of longitude here.
ROWS = [
    row("r1", 4, "Birinci", square(29.0, 40.9, 29.2, 41.1), iso="TR-34"),
    row("r2", 4, "Ikinci", square(29.2, 40.9, 29.4, 41.1), iso="TR-41"),
    row("r10", 6, "Kadikoy", square(29.0, 40.9, 29.1, 41.1), parent="r1"),
    row("r11", 6, "Uskudar", square(29.1, 40.9, 29.2, 41.1), parent="r1"),
    row("r12", 6, "Gebze", square(29.2, 40.9, 29.4, 41.1), parent="r2"),
    row("r20", 8, "Moda Mahallesi", square(29.0, 40.9, 29.05, 41.0), parent="r10"),
    row("r21", 8, "Fener Mahallesi", square(29.05, 40.9, 29.1, 41.0), parent="r10"),
    row("r90", 4, "Suriye", square(40.0, 36.0, 41.0, 37.0), iso="SY-HK"),
]
PLACES = [
    {"id": "n1", "name": "Bahariye", "names": {"tr": "Bahariye"}, "lon": 29.03, "lat": 41.05, "type": "neighbourhood"},
    {"id": "n2", "name": "Uzak", "names": {"tr": "Uzak"}, "lon": 29.03, "lat": 41.095, "type": "suburb"},
    {"id": "n3", "name": "Usk Yeri", "names": {"tr": "Usk Yeri"}, "lon": 29.15, "lat": 41.05, "type": "quarter"},
]


def locate(lon, lat, tag=None, places=PLACES):
    return Assigner(ROWS, places).locate(lon, lat, tag)


def test_point_inside_province_district_and_neighbourhood():
    got = locate(29.02, 40.95)
    assert got["province"] == "34"
    assert got["district"] == "r10"
    assert got["neighbourhood"] == "r20"
    assert got["hoodSource"] == "polygon"
    assert got["slack"] is False


def test_point_in_district_but_no_neighbourhood_uses_the_tag_first():
    got = locate(29.02, 41.05, "Bahariye Mah")
    assert got["neighbourhood"] is None
    assert got["hoodSource"] == "tag"
    assert got["hoodName"] == "Bahariye Mah"


def test_without_a_tag_a_place_point_within_one_kilometre_names_the_neighbourhood():
    got = locate(29.02, 41.05)
    assert got["hoodSource"] == "place"
    assert got["hoodName"] == "Bahariye"
    assert got["hoodNames"] == {"tr": "Bahariye"}


def test_a_place_point_in_another_district_is_ignored():
    other = [{"id": "n7", "name": "Yan", "names": {}, "lon": 29.1005, "lat": 41.05, "type": "suburb"}]
    got = locate(29.0995, 41.05, None, other)
    assert got["hoodSource"] == "none"
    assert got["neighbourhood"] is None and got["hoodName"] is None


def test_a_place_point_beyond_one_kilometre_is_ignored():
    got = locate(29.095, 41.095, None, [PLACES[0]])
    assert got["hoodSource"] == "none"


def test_a_blank_tag_counts_as_no_tag():
    assert locate(29.02, 41.05, "   ", [])["hoodSource"] == "none"


def test_the_nearest_of_two_place_points_wins_and_ties_take_the_smaller_id():
    places = [
        {"id": "n9", "name": "Dokuz", "names": {}, "lon": 29.04, "lat": 41.05, "type": "suburb"},
        {"id": "n3", "name": "Uc", "names": {}, "lon": 29.04, "lat": 41.05, "type": "suburb"},
        {"id": "n5", "name": "Bes", "names": {}, "lon": 29.02, "lat": 41.049, "type": "suburb"},
    ]
    assert locate(29.02, 41.05, None, places)["hoodName"] == "Bes"
    assert locate(29.04, 41.05, None, places)["hoodName"] == "Uc"


def test_a_point_just_outside_the_only_province_is_assigned_with_slack():
    got = locate(28.9985, 41.0)
    assert got["province"] == "34"
    assert got["district"] == "r10"
    assert got["slack"] is True


def test_a_point_far_outside_every_province_has_no_assignment():
    assert locate(28.99, 41.0) is None
    assert locate(35.0, 45.0) is None


def test_a_point_close_to_two_provinces_outside_both_has_no_assignment():
    rows = ROWS[:2] + [row("r3", 4, "Ucuncu", square(29.2, 41.1, 29.4, 41.3), iso="TR-16")]
    assert Assigner(rows, []).locate(29.2, 41.1005) is not None
    gap_rows = [row("r1", 4, "A", square(29.0, 40.9, 29.1, 41.0), iso="TR-34"), row("r2", 4, "B", square(29.1008, 40.9, 29.2, 41.0), iso="TR-41")]
    assert Assigner(gap_rows, []).locate(29.1004, 40.95) is None


def test_a_foreign_province_never_matches():
    assert locate(40.5, 36.5) is None


def test_a_point_in_the_province_but_in_no_district_is_assigned_to_a_district_within_the_shore():
    rows = [
        row("r1", 4, "Bir", square(29.0, 40.9, 29.2, 41.1), iso="TR-34"),
        row("r10", 6, "Kadikoy", square(29.0, 40.9, 29.1, 41.1), parent="r1"),
    ]
    near = Assigner(rows, []).locate(29.1008, 41.0)
    assert near["district"] == "r10" and near["slack"] is True
    far = Assigner(rows, []).locate(29.15, 41.0)
    assert far["province"] == "34" and far["district"] is None


def test_neighbourhood_is_taken_only_from_the_chosen_district():
    rows = ROWS + [row("r30", 8, "Yanlis Mahallesi", square(29.0, 40.9, 29.05, 41.0), parent="r11")]
    got = Assigner(rows, []).locate(29.02, 40.95)
    assert got["neighbourhood"] == "r20"


def test_a_point_on_a_shared_border_goes_to_the_smaller_id_every_time():
    runs = {Assigner(ROWS, []).locate(29.1, 40.95)["district"] for _ in range(5)}
    assert runs == {"r10"}
    assert Assigner(list(reversed(ROWS)), []).locate(29.1, 40.95)["district"] == "r10"


def test_locate_many_gives_the_same_answers_as_locate():
    assigner = Assigner(ROWS, PLACES)
    points = [(29.02, 40.95), (29.02, 41.05), (28.9985, 41.0), (35.0, 45.0), (29.3, 41.0)]
    many = assigner.locate_many([p[0] for p in points], [p[1] for p in points], ["", "Bahariye", None, None, None])
    one = [assigner.locate(p[0], p[1], t) for p, t in zip(points, ["", "Bahariye", None, None, None])]
    assert many == one


def test_extract_admin_full_keeps_a_notch_the_default_run_drops(tmp_path):
    nodes = [
        ox.node(1, 40.9, 29.0), ox.node(2, 40.9, 29.2), ox.node(3, 41.1, 29.2), ox.node(4, 41.1, 29.0),
        ox.node(5, 41.02, 29.0), ox.node(6, 41.02, 29.0002), ox.node(7, 41.01, 29.0002), ox.node(8, 41.01, 29.0),
    ]
    notch = ox.way(1, [1, 2, 3, 4, 5, 6, 7, 8, 1])
    rel = ox.admin_relation(1, 1, 4, "Birinci", {"ISO3166-2": "TR-34"})
    pbf = ox.write(tmp_path / "notch.osm", nodes, notch, rel)
    default = tmp_path / "default.jsonl"
    full = tmp_path / "full.jsonl"
    extract(pbf, str(default))
    extract(pbf, str(full), full=True)
    from shapely import wkt
    plain = wkt.loads(json.loads(default.read_text())["wkt"])
    detailed = wkt.loads(json.loads(full.read_text())["wkt"])
    plain_ring = (plain.geoms[0] if hasattr(plain, "geoms") else plain).exterior.coords
    detailed_ring = (detailed.geoms[0] if hasattr(detailed, "geoms") else detailed).exterior.coords
    assert len(detailed_ring) > len(plain_ring)
    assert (29.0002, 41.02) in list(detailed_ring)
    assert (29.0002, 41.02) not in list(plain_ring)


def test_extract_places_reads_neighbourhood_suburb_and_quarter_nodes_only(tmp_path):
    nodes = [
        ox.node(1, 41.0, 29.0, {"place": "neighbourhood", "name": "Moda", "name:ru": "Мода"}),
        ox.node(2, 41.1, 29.1, {"place": "suburb", "name": "Bahariye"}),
        ox.node(3, 41.2, 29.2, {"place": "quarter", "name": "Fener"}),
        ox.node(4, 41.3, 29.3, {"place": "village", "name": "Koy"}),
        ox.node(5, 41.4, 29.4, {"place": "suburb"}),
    ]
    pbf = ox.write(tmp_path / "places.osm", nodes)
    out = tmp_path / "places.jsonl"
    assert extract_places(pbf, str(out)) == 3
    rows = [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines()]
    assert [r["name"] for r in rows] == ["Moda", "Bahariye", "Fener"]
    assert rows[0] == {"id": "n1", "lat": 41.0, "lon": 29.0, "name": "Moda", "names": {"tr": "Moda", "ru": "Мода"}, "type": "neighbourhood"}
