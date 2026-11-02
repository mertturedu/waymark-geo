import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extract"))
from road_rules import blocked_node, classify_way, parse_restriction  # noqa: E402


def ok(tags):
    result = classify_way(tags)
    assert result["ok"], result
    return result


def reason(tags):
    result = classify_way(tags)
    assert not result["ok"], result
    return result["reason"]


def test_ordinary_streets_are_kept_with_their_class_and_two_way_travel():
    assert ok({"highway": "residential"}) == {"ok": True, "cls": "residential", "oneway": "", "ferry": False, "speed": None, "duration": None}
    assert ok({"highway": "tertiary_link", "maxspeed": "50"})["speed"] == "50"
    for kind in ["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "living_street", "service", "primary_link"]:
        assert ok({"highway": kind})["cls"] == kind


def test_paths_tracks_and_unfinished_roads_are_left_out():
    for kind in ["footway", "track", "path", "cycleway", "steps", "construction", "proposed", "pedestrian", "bridleway", "road", "corridor"]:
        assert reason({"highway": kind}) == "class"
    assert reason({"name": "Fener"}) == "class"


def test_parking_aisles_driveways_and_emergency_access_are_not_public_roads():
    for sub in ["parking_aisle", "driveway", "emergency_access"]:
        assert reason({"highway": "service", "service": sub}) == "service"
    assert ok({"highway": "service", "service": "alley"})["cls"] == "service"


def test_the_most_specific_access_tag_decides():
    assert reason({"highway": "residential", "access": "private"}) == "access"
    assert reason({"highway": "residential", "motor_vehicle": "no"}) == "access"
    assert reason({"highway": "residential", "vehicle": "no"}) == "access"
    assert ok({"highway": "residential", "access": "private", "motor_vehicle": "yes"})
    assert ok({"highway": "residential", "access": "no", "motorcar": "yes"})
    assert reason({"highway": "residential", "access": "yes", "motorcar": "no"}) == "access"
    for allowed in ["destination", "customers", "delivery", "permissive", "designated"]:
        assert ok({"highway": "residential", "access": allowed})


def test_one_way_values_and_their_direction():
    assert ok({"highway": "residential", "oneway": "yes"})["oneway"] == "f"
    assert ok({"highway": "residential", "oneway": "1"})["oneway"] == "f"
    assert ok({"highway": "residential", "oneway": "true"})["oneway"] == "f"
    assert ok({"highway": "residential", "oneway": "-1"})["oneway"] == "b"
    assert ok({"highway": "residential", "oneway": "reverse"})["oneway"] == "b"
    assert ok({"highway": "residential", "oneway": "no"})["oneway"] == ""
    assert ok({"highway": "residential", "oneway": "garbage"})["oneway"] == ""


def test_roundabouts_and_motorways_are_one_way_unless_stated_otherwise():
    assert ok({"highway": "residential", "junction": "roundabout"})["oneway"] == "f"
    assert ok({"highway": "residential", "junction": "circular"})["oneway"] == "f"
    assert ok({"highway": "residential", "junction": "roundabout", "oneway": "no"})["oneway"] == ""
    assert ok({"highway": "motorway"})["oneway"] == "f"
    assert ok({"highway": "motorway_link"})["oneway"] == "f"
    assert ok({"highway": "motorway", "oneway": "no"})["oneway"] == ""
    assert ok({"highway": "trunk"})["oneway"] == ""


def test_a_vehicle_specific_one_way_tag_beats_the_general_one():
    assert ok({"highway": "residential", "oneway": "yes", "oneway:motor_vehicle": "no"})["oneway"] == ""
    assert ok({"highway": "residential", "oneway": "no", "oneway:motorcar": "yes"})["oneway"] == "f"
    assert ok({"highway": "residential", "oneway": "yes", "oneway:bicycle": "no"})["oneway"] == "f"


def test_car_ferries_are_kept_and_other_ferries_are_not():
    assert ok({"route": "ferry", "motor_vehicle": "yes"})["ferry"] is True
    assert ok({"route": "ferry", "vehicle": "yes"})["ferry"] is True
    assert ok({"route": "ferry", "motorcar": "yes", "highway": "unclassified"})["cls"] == "ferry"
    assert reason({"route": "ferry"}) == "ferry_no_cars"
    assert reason({"route": "ferry", "foot": "yes"}) == "ferry_no_cars"
    assert reason({"route": "ferry", "motor_vehicle": "no"}) == "ferry_no_cars"


@pytest.mark.parametrize("text,seconds", [("0:30", 1800), ("30", 1800), ("01:30:00", 5400), ("1:05", 3900), ("48:00", 172800), ("48:01", None), ("99999999", None), ("0", None), ("0:00", None), ("1²", None), ("PT30M", None), ("", None), ("abc", None), ("-5", None)])
def test_ferry_durations(text, seconds):
    assert ok({"route": "ferry", "motor_vehicle": "yes", "duration": text})["duration"] == seconds


def test_barriers_block_cars_unless_they_are_the_harmless_kind_or_explicitly_open():
    assert blocked_node({"barrier": "bollard"})
    assert blocked_node({"barrier": "block"})
    assert not blocked_node({"barrier": "gate"})
    assert not blocked_node({"barrier": "lift_gate"})
    assert not blocked_node({"barrier": "toll_booth"})
    assert not blocked_node({"barrier": "bollard", "motor_vehicle": "yes"})
    assert not blocked_node({"barrier": "bollard", "access": "permissive"})
    assert blocked_node({"barrier": "gate", "access": "no"})
    assert blocked_node({"barrier": "gate", "access": "private"})
    assert not blocked_node({"barrier": "gate", "access": "private", "motor_vehicle": "yes"})
    assert not blocked_node({})
    assert not blocked_node({"highway": "traffic_signals"})


def members(*items):
    return list(items)


def restriction(kind, *parts, extra=None):
    tags = {"type": "restriction", "restriction": kind}
    tags.update(extra or {})
    return parse_restriction(tags, list(parts))


def test_a_turn_ban_through_a_node_names_both_roads_and_the_node():
    got = restriction("no_left_turn", ("w", 1, "from"), ("n", 5, "via"), ("w", 2, "to"))
    assert got == {"ok": True, "kind": "no", "restriction": "no_left_turn", "from": 1, "to": 2, "via": [{"n": 5}]}


def test_mandatory_turns_are_kind_only_and_entry_exit_bans_are_plain_bans():
    assert restriction("only_straight_on", ("w", 1, "from"), ("n", 5, "via"), ("w", 2, "to"))["kind"] == "only"
    assert restriction("no_entry", ("w", 1, "from"), ("n", 5, "via"), ("w", 2, "to"))["kind"] == "no"
    assert restriction("no_exit", ("w", 1, "from"), ("n", 5, "via"), ("w", 2, "to"))["kind"] == "no"


def test_a_ban_through_one_or_more_roads_lists_them_in_order():
    got = restriction("no_u_turn", ("w", 1, "from"), ("w", 7, "via"), ("w", 8, "via"), ("w", 2, "to"))
    assert got["via"] == [{"w": 7}, {"w": 8}]


def test_bans_that_do_not_apply_to_cars_are_dropped_with_a_reason():
    node_member = [("w", 1, "from"), ("n", 5, "via"), ("w", 2, "to")]
    assert parse_restriction({"type": "restriction", "restriction": "no_left_turn", "except": "motorcar"}, node_member) == {"ok": False, "reason": "exception"}
    assert parse_restriction({"type": "restriction", "restriction": "no_left_turn", "except": "bicycle;motor_vehicle"}, node_member)["reason"] == "exception"
    assert parse_restriction({"type": "restriction", "restriction": "no_left_turn", "except": "bicycle"}, node_member)["ok"]
    assert parse_restriction({"type": "restriction", "restriction": "no_left_turn", "hour_on": "07:00"}, node_member)["reason"] == "conditional"
    assert parse_restriction({"type": "restriction", "restriction": "no_left_turn", "day_on": "Mo-Fr"}, node_member)["reason"] == "conditional"
    assert parse_restriction({"type": "restriction", "restriction": "no_left_turn", "restriction:conditional": "no_left_turn @ (Mo-Fr 07:00-09:00)"}, node_member)["reason"] == "conditional"
    assert parse_restriction({"type": "restriction:hgv", "restriction": "no_left_turn"}, node_member)["reason"] == "not_cars"
    assert parse_restriction({"type": "restriction", "restriction": "no_weight"}, node_member)["reason"] == "unknown"
    assert parse_restriction({"type": "restriction"}, node_member)["reason"] == "unknown"


def test_a_ban_missing_a_road_or_a_via_is_dropped():
    assert restriction("no_left_turn", ("n", 5, "via"), ("w", 2, "to"))["reason"] == "members"
    assert restriction("no_left_turn", ("w", 1, "from"), ("n", 5, "via"))["reason"] == "members"
    assert restriction("no_left_turn", ("w", 1, "from"), ("w", 2, "to"))["reason"] == "members"
    assert restriction("no_left_turn", ("w", 1, "from"), ("n", 5, "via"), ("n", 6, "via"), ("w", 2, "to"))["reason"] == "members"
    assert restriction("no_left_turn", ("r", 1, "from"), ("n", 5, "via"), ("w", 2, "to"))["reason"] == "members"


def test_unusual_barriers_and_one_way_words():
    for barrier in ["swing_gate", "sliding_gate", "kerb"]:
        assert not blocked_node({"barrier": barrier})
    assert ok({"highway": "motorway", "oneway": "reversible"})["oneway"] == ""
    assert ok({"highway": "residential", "oneway": "alternating"})["oneway"] == ""


def test_area_ways_are_not_roads():
    assert reason({"highway": "primary", "area": "yes"}) == "area"
    assert ok({"highway": "primary", "area": "no"})["cls"] == "primary"


def test_a_car_specific_restriction_value_wins():
    node_member = [("w", 1, "from"), ("n", 5, "via"), ("w", 2, "to")]
    got = parse_restriction({"type": "restriction", "restriction:motorcar": "no_left_turn"}, node_member)
    assert got["ok"] and got["restriction"] == "no_left_turn"
    got = parse_restriction({"type": "restriction", "restriction": "no_right_turn", "restriction:motorcar": "no_left_turn"}, node_member)
    assert got["restriction"] == "no_left_turn"
