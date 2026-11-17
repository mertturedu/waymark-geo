import json
import os
import sys

import osmxml as ox
from worlds import write_inputs

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extract"))
from extract_transit import extract  # noqa: E402


def track(first_node, way_id, lon, lat, tags=None, length=3):
    ids = list(range(first_node, first_node + length))
    return [ox.node(i, lat, lon + 0.001 * k) for k, i in enumerate(ids)] + [ox.way(way_id, ids, tags or {"railway": "subway"})]


def route(id, ways, tags):
    return ox.relation(id, [("way", w, "") for w in ways], {"type": "route", **tags})


def station(id, lon, lat, name, tags):
    return ox.node(id, lat, lon, {"name": name, **tags})


def run(tmp_path, elements):
    pbf, _, _ = write_inputs(tmp_path, elements)
    out = tmp_path / "transit.jsonl"
    summary = extract(pbf, str(out))
    rows = [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines()]
    return summary, rows


def lines(rows):
    return [r for r in rows if r["properties"]["kind"] == "line"]


def stations(rows):
    return [r for r in rows if r["properties"]["kind"] == "station"]


def world():
    return (
        track(10, 100, 28.95, 41.00)
        + track(20, 101, 28.95, 41.01)
        + track(30, 102, 29.00, 41.02, {"railway": "tram"})
        + track(40, 103, 29.05, 41.03, {"railway": "disused"})
        + [ox.node(60, 41.00, 28.90), ox.node(61, 41.00, 28.91), ox.way(104, [60, 61], {"route": "ferry"})]
        + [
            route(500, [100], {"route": "subway", "colour": "#e53935", "ref": "M2", "name": "M2 Yenikapı - Hacıosman"}),
            route(501, [101], {"route": "subway", "ref": "M1", "name": "M1 Yenikapı - Atatürk Havalimanı"}),
            route(502, [102], {"route": "tram", "colour": "turquoise", "ref": "T1"}),
            route(503, [103], {"route": "subway", "disused": "yes", "ref": "M9"}),
            route(504, [100], {"route": "light_rail", "state": "proposed", "ref": "M10"}),
            route(505, [104], {"route": "ferry", "name": "Kadıköy - Eminönü"}),
            route(506, [100], {"route": "bus", "ref": "34"}),
        ]
        + [
            station(70, 28.95, 41.00, "Yenikapı", {"railway": "station", "station": "subway"}),
            station(71, 28.951, 41.00, "Vezneciler", {"railway": "station", "subway": "yes"}),
            station(72, 29.00, 41.02, "Sultanahmet", {"railway": "tram_stop"}),
            station(73, 28.90, 41.00, "Kadıköy İskele", {"amenity": "ferry_terminal"}),
            station(74, 28.96, 41.01, "Haydarpaşa", {"railway": "station"}),
            station(75, 28.97, 41.01, "", {"railway": "station"}),
            ox.node(76, 41.01, 28.98, {"railway": "station", "station": "subway"}),
        ]
    )


def test_each_live_route_becomes_one_line_with_its_colour_ref_and_name(tmp_path):
    summary, rows = run(tmp_path, world())
    by_ref = {r["properties"]["ref"] or r["properties"]["name"]: r["properties"] for r in lines(rows)}
    assert by_ref["M2"] == {"kind": "line", "mode": "subway", "colour": "#E53935", "ref": "M2", "name": "M2 Yenikapı - Hacıosman"}
    assert summary["lines"] == len(lines(rows))


def test_a_route_without_a_usable_colour_takes_the_colour_of_its_mode(tmp_path):
    _, rows = run(tmp_path, world())
    colours = {r["properties"]["ref"]: r["properties"]["colour"] for r in lines(rows)}
    assert colours["M1"] == "#D32F2F"
    assert colours["T1"] == "#F57C00"


def test_two_subway_lines_one_tram_and_one_ferry_come_out(tmp_path):
    _, rows = run(tmp_path, world())
    modes = sorted(r["properties"]["mode"] for r in lines(rows))
    assert modes == ["ferry", "subway", "subway", "tram"]


def test_disused_proposed_and_bus_routes_stay_out(tmp_path):
    _, rows = run(tmp_path, world())
    refs = {r["properties"]["ref"] for r in lines(rows)}
    assert refs.isdisjoint({"M9", "M10", "34"})


def test_a_line_keeps_the_coordinates_of_its_ways(tmp_path):
    _, rows = run(tmp_path, world())
    m2 = next(r for r in lines(rows) if r["properties"]["ref"] == "M2")
    assert m2["geometry"] == {"type": "MultiLineString", "coordinates": [[[28.95, 41.0], [28.951, 41.0], [28.952, 41.0]]]}


def test_five_named_stations_come_out_with_their_mode(tmp_path):
    _, rows = run(tmp_path, world())
    found = {r["properties"]["name"]: r["properties"]["mode"] for r in stations(rows)}
    assert found == {"Yenikapı": "subway", "Vezneciler": "subway", "Sultanahmet": "tram", "Kadıköy İskele": "ferry", "Haydarpaşa": "train"}


def test_a_station_without_a_name_is_left_out(tmp_path):
    summary, rows = run(tmp_path, world())
    assert summary["stations"] == 5
    assert all(r["properties"]["name"] for r in stations(rows))


def test_an_empty_world_gives_an_empty_file(tmp_path):
    summary, rows = run(tmp_path, track(10, 100, 28.95, 41.0))
    assert rows == []
    assert summary == {"lines": 0, "stations": 0, "routes_seen": 0}


def test_the_output_is_the_same_on_every_run(tmp_path):
    pbf, _, _ = write_inputs(tmp_path, world())
    first, second = tmp_path / "a.jsonl", tmp_path / "b.jsonl"
    extract(pbf, str(first))
    extract(pbf, str(second))
    assert first.read_bytes() == second.read_bytes()
