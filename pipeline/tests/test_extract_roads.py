import json
import os
import sys

import osmxml as ox
from worlds import write_inputs

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extract"))
from extract_roads import extract  # noqa: E402


def street(first_node, way_id, lon, lat, tags=None, length=3, node_tags=None):
    ids = list(range(first_node, first_node + length))
    nodes = [ox.node(i, lat, lon + 0.001 * k, (node_tags or {}).get(i)) for k, i in enumerate(ids)]
    return nodes + [ox.way(way_id, ids, tags or {"highway": "residential"})]


def run(tmp_path, elements, provinces=("34",), name="in"):
    pbf, admin, _ = write_inputs(tmp_path, elements, name=name)
    out = tmp_path / (name + "-out")
    accounting = extract(pbf, admin, str(out), set(provinces))
    return accounting, out


def rows(out, plate="34"):
    return [json.loads(line) for line in (out / plate / "roads.jsonl").read_text(encoding="utf-8").splitlines()]


def test_a_street_comes_out_with_its_class_direction_nodes_and_coordinates(tmp_path):
    elements = street(10, 1, 28.9, 41.0, {"highway": "tertiary", "oneway": "yes", "maxspeed": "50"})
    accounting, out = run(tmp_path, elements)
    [row] = rows(out)
    assert row == {"t": "w", "id": 1, "cls": "tertiary", "o": "f", "s": "50", "n": [10, 11, 12], "c": [[28.9, 41.0], [28.901, 41.0], [28.902, 41.0]]}
    assert accounting["provinces"]["34"]["ways"] == {"source": 1, "accepted": 1, "rejected": {}}


def test_footpaths_and_private_roads_are_counted_and_left_out(tmp_path):
    elements = (
        street(10, 1, 28.9, 41.0)
        + street(20, 2, 28.9, 41.1, {"highway": "footway"})
        + street(30, 3, 28.9, 41.2, {"highway": "residential", "access": "private"})
        + street(40, 4, 28.9, 41.3, {"building": "yes"})
    )
    accounting, out = run(tmp_path, elements)
    assert [r["id"] for r in rows(out)] == [1]
    assert accounting["provinces"]["34"]["ways"] == {"source": 3, "accepted": 1, "rejected": {"access": 1, "class": 1}}


def test_roads_up_to_ten_kilometres_beyond_the_border_come_along_and_farther_ones_do_not(tmp_path):
    elements = street(10, 1, 29.45, 41.0, length=4) + street(20, 2, 29.55, 41.0) + street(30, 3, 29.95, 41.0)
    _, out = run(tmp_path, elements)
    assert [r["id"] for r in rows(out)] == [1, 2]


def test_a_road_that_starts_outside_but_reaches_in_is_kept_whole(tmp_path):
    elements = street(10, 1, 29.4, 41.0, length=40)
    _, out = run(tmp_path, elements)
    [row] = rows(out)
    assert len(row["n"]) == 40


def test_a_ferry_with_cars_keeps_its_duration_and_one_without_is_dropped(tmp_path):
    ferry = [ox.node(1, 40.9, 29.0), ox.node(2, 40.95, 29.05), ox.way(1, [1, 2], {"route": "ferry", "motor_vehicle": "yes", "duration": "0:30"})]
    foot = [ox.node(3, 40.8, 29.0), ox.node(4, 40.85, 29.05), ox.way(2, [3, 4], {"route": "ferry", "foot": "yes"})]
    accounting, out = run(tmp_path, ferry + foot)
    [row] = rows(out)
    assert row["cls"] == "ferry" and row["f"] is True and row["d"] == 1800
    assert accounting["provinces"]["34"]["ways"]["rejected"] == {"ferry_no_cars": 1}


def test_blocking_barriers_on_kept_roads_are_listed(tmp_path):
    elements = street(10, 1, 28.9, 41.0, node_tags={11: {"barrier": "bollard"}}) + [ox.node(99, 41.2, 28.9, {"barrier": "bollard"})]
    accounting, out = run(tmp_path, elements)
    assert [r for r in rows(out) if r["t"] == "b"] == [{"t": "b", "id": 11}]
    assert accounting["provinces"]["34"]["blocked"] == 1


def crossing():
    return (
        street(10, 1, 28.9, 41.0)
        + [ox.node(20, 41.001, 28.901), ox.node(21, 41.0, 28.901)]
        + [ox.way(2, [11, 20], {"highway": "residential"})]
    )


def test_a_turn_ban_between_kept_roads_is_written_with_its_via_node(tmp_path):
    ban = ox.relation(1, [("way", 1, "from"), ("node", 11, "via"), ("way", 2, "to")], {"type": "restriction", "restriction": "no_left_turn"})
    accounting, out = run(tmp_path, crossing() + [ban])
    [rule] = [r for r in rows(out) if r["t"] == "r"]
    assert rule == {"t": "r", "id": 1, "kind": "no", "restriction": "no_left_turn", "from": 1, "to": 2, "via": [{"n": 11}]}
    assert accounting["provinces"]["34"]["restrictions"] == {"source": 1, "accepted": 1, "rejected": {}}


def test_bans_naming_a_dropped_road_or_a_node_off_the_roads_are_refused(tmp_path):
    footpath = street(30, 3, 28.9, 41.1, {"highway": "footway"})
    to_foot = ox.relation(1, [("way", 1, "from"), ("node", 11, "via"), ("way", 3, "to")], {"type": "restriction", "restriction": "no_left_turn"})
    off_node = ox.relation(2, [("way", 1, "from"), ("node", 12, "via"), ("way", 2, "to")], {"type": "restriction", "restriction": "no_right_turn"})
    hours = ox.relation(3, [("way", 1, "from"), ("node", 11, "via"), ("way", 2, "to")], {"type": "restriction", "restriction": "no_u_turn", "hour_on": "07:00-09:00"})
    accounting, out = run(tmp_path, crossing() + footpath + [to_foot, off_node, hours])
    assert [r for r in rows(out) if r["t"] == "r"] == []
    assert accounting["provinces"]["34"]["restrictions"] == {"source": 3, "accepted": 0, "rejected": {"conditional": 1, "off_network": 2}}


def test_a_ban_through_a_road_needs_that_road_kept(tmp_path):
    middle = [ox.node(40, 41.0005, 28.901), ox.node(41, 41.0008, 28.901), ox.way(4, [11, 40], {"highway": "residential"})]
    ban = ox.relation(1, [("way", 1, "from"), ("way", 4, "via"), ("way", 2, "to")], {"type": "restriction", "restriction": "no_u_turn"})
    _, out = run(tmp_path, crossing() + middle + [ban])
    [rule] = [r for r in rows(out) if r["t"] == "r"]
    assert rule["via"] == [{"w": 4}]


def test_only_the_asked_provinces_are_written_and_a_rerun_is_identical(tmp_path):
    elements = street(10, 1, 28.9, 41.0) + street(20, 2, 32.5, 40.0)
    _, out = run(tmp_path, elements, ("34", "06"))
    first = {p: (out / p / "roads.jsonl").read_bytes() for p in ("34", "06")}
    assert [r["id"] for r in rows(out, "06")] == [2]
    _, again = run(tmp_path, elements, ("34", "06"), name="second")
    assert {p: (again / p / "roads.jsonl").read_bytes() for p in ("34", "06")} == first
    assert not (out / "35").exists()


def test_working_through_the_provinces_in_small_groups_gives_the_same_files(tmp_path):
    elements = street(10, 1, 28.9, 41.0) + street(20, 2, 32.5, 40.0)
    pbf, admin, _ = write_inputs(tmp_path, elements)
    whole = extract(pbf, admin, str(tmp_path / "whole"), {"34", "06"})
    split = extract(pbf, admin, str(tmp_path / "split"), {"34", "06"}, chunk=1)
    assert whole == split
    for plate in ("34", "06"):
        assert (tmp_path / "whole" / plate / "roads.jsonl").read_bytes() == (tmp_path / "split" / plate / "roads.jsonl").read_bytes()


def test_the_clipped_copies_can_be_kept_for_other_tools(tmp_path):
    pbf, admin, _ = write_inputs(tmp_path, street(10, 1, 28.9, 41.0))
    keep = tmp_path / "clips"
    extract(pbf, admin, str(tmp_path / "out"), {"34"}, clip_dir=str(keep))
    assert (keep / "34.osm.pbf").stat().st_size > 0
    assert not (keep / "06.osm.pbf").exists()
