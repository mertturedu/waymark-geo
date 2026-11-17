import json
import os
import sys

import osmxml as ox

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "test", "reference"))
from route_reference import build, limit, solve  # noqa: E402

TABLE = {
    "class": {"motorway": 100, "motorway_link": 50, "trunk": 80, "trunk_link": 45, "primary": 60, "primary_link": 40, "secondary": 50, "secondary_link": 35, "tertiary": 45, "tertiary_link": 30, "unclassified": 40, "residential": 30, "living_street": 15, "service": 20},
    "named": {"TR:urban": 50, "TR:rural": 90, "TR:motorway": 120, "walk": 7},
    "posted": 0.9,
    "min": 5,
    "max": 140,
    "mph": 1.609344,
    "streets": {"classes": ["residential", "service", "unclassified"], "factor": 0.65},
}


def world(tmp_path, *parts):
    return ox.write(tmp_path / "w.osm", *parts)


def line(first, count, lat, tags=None, way_id=1, step=0.001):
    ids = list(range(first, first + count))
    return [ox.node(i, lat, 29 + step * k) for k, i in enumerate(ids)] + [ox.way(way_id, ids, tags or {"highway": "residential"})]


def seconds(tmp_path, elements, pairs):
    graph, junctions = build(world(tmp_path, elements), TABLE)
    return solve(graph, junctions, pairs)


def test_a_straight_street_costs_its_length_over_the_class_speed(tmp_path):
    [got] = seconds(tmp_path, line(1, 3, 41.0), [(1, 3)])
    metres = 2 * 0.001 * 111195.0 * 0.7547
    assert abs(got["seconds"] - metres / (19.5 / 3.6)) < 0.2
    assert got["edges"] == 1


def test_side_streets_are_slower_than_main_roads_of_the_same_limit(tmp_path):
    street = seconds(tmp_path, line(1, 3, 41.0, {"highway": "residential", "maxspeed": "40"}), [(1, 3)])[0]["seconds"]
    main = seconds(tmp_path, line(1, 3, 41.0, {"highway": "tertiary", "maxspeed": "40"}), [(1, 3)])[0]["seconds"]
    assert abs(street / main - 1 / 0.65) < 0.01


def test_one_way_streets_work_in_one_direction_only(tmp_path):
    elements = line(1, 3, 41.0, {"highway": "residential", "oneway": "yes"})
    assert seconds(tmp_path, elements, [(1, 3), (3, 1)])[1] is None
    assert seconds(tmp_path, elements, [(1, 3)])[0] is not None


def test_private_streets_and_blocked_nodes_cannot_be_crossed(tmp_path):
    assert seconds(tmp_path, line(1, 3, 41.0, {"highway": "residential", "access": "private"}), [(1, 3)]) == [None]
    elements = line(1, 3, 41.0)
    elements[1] = ox.node(2, 41.0, 29.001, {"barrier": "bollard"})
    assert seconds(tmp_path, elements, [(1, 3)]) == [None]


def test_a_posted_limit_changes_the_time(tmp_path):
    slow = seconds(tmp_path, line(1, 3, 41.0, {"highway": "residential", "maxspeed": "10"}), [(1, 3)])[0]["seconds"]
    fast = seconds(tmp_path, line(1, 3, 41.0, {"highway": "residential", "maxspeed": "60"}), [(1, 3)])[0]["seconds"]
    assert slow > 5 * fast


def test_limits_are_read_like_the_sdk_reads_them():
    assert limit("50", TABLE) == 50
    assert abs(limit("30 mph", TABLE) - 48.28032) < 1e-6
    assert limit("TR:urban", TABLE) == 50
    assert limit("50km/h", TABLE) == 50
    assert limit("50 kmh", TABLE) == 50
    assert limit("walk", TABLE) == 7
    for text in [None, "", "none", "signals", "0", "300", "50;60", "30 knots", "abc"]:
        assert limit(text, TABLE) is None


def test_the_edge_count_follows_the_junctions_on_the_way(tmp_path):
    elements = line(1, 5, 41.0) + [ox.node(10, 41.001, 29.002), ox.way(2, [3, 10], {"highway": "residential"})]
    [got] = seconds(tmp_path, elements, [(1, 5)])
    assert got["edges"] == 2


def test_unknown_nodes_give_none(tmp_path):
    assert seconds(tmp_path, line(1, 3, 41.0), [(99, 3)]) == [None]
