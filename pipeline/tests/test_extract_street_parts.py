import json
import os
import random
import subprocess
import sys

import osmxml as ox
from worlds import read_lines, write_inputs

EXTRACT = os.path.join(os.path.dirname(__file__), "..", "extract")
sys.path.insert(0, EXTRACT)
from extract_street_parts import extract  # noqa: E402


def road(first_node, way_id, lat, lons, tags):
    ids = list(range(first_node, first_node + len(lons)))
    nodes = [ox.node(i, lat, lon) for i, lon in zip(ids, lons)]
    return nodes + [ox.way(way_id, ids, tags)]


def run(tmp_path, elements, name="in", **kwargs):
    pbf, admin, places = write_inputs(tmp_path, elements, name=name)
    out = tmp_path / ("out-" + name)
    return extract(pbf, admin, places, str(out), **kwargs), out


def streets(out, plate="34"):
    return read_lines(out / plate / "streets.jsonl")


def test_a_street_crossing_a_neighbourhood_edge_becomes_two_parts(tmp_path):
    elements = road(100, 1, 40.9, [28.6, 28.7, 28.8, 28.9], {"highway": "residential", "name": "Bahariye Caddesi"})
    accounting, out = run(tmp_path, elements)
    parts = streets(out)
    assert [(p["neighbourhood"], p["hoodSource"]) for p in parts] == [(None, "none"), ("r20", "polygon")]
    assert parts[1]["lines"] == [[[28.6, 40.9], [28.7, 40.9]]]
    assert parts[0]["lines"] == [[[28.7, 40.9], [28.9, 40.9]]]
    assert all(p["name"] == "Bahariye Caddesi" and p["district"] == "r10" and p["ways"] == ["w1"] for p in parts)
    assert accounting["ways"] == 1 and accounting["written"] == 1


def test_one_name_in_one_neighbourhood_is_one_part_with_every_line_and_way(tmp_path):
    elements = road(100, 7, 40.6, [28.55, 28.6], {"highway": "tertiary", "name": "Ortak Sokak"}) + road(110, 3, 40.7, [28.55, 28.6], {"highway": "residential", "name": "Ortak Sokak"})
    _, out = run(tmp_path, elements)
    [part] = streets(out)
    assert part["ways"] == ["w3", "w7"]
    assert len(part["lines"]) == 2
    assert part["highway"] == "tertiary"


def test_the_same_name_in_two_neighbourhoods_stays_two_parts(tmp_path):
    elements = road(100, 1, 40.6, [28.55, 28.6], {"highway": "residential", "name": "Ortak Sokak"}) + road(110, 2, 40.6, [28.8, 28.85], {"highway": "residential", "name": "Ortak Sokak"})
    _, out = run(tmp_path, elements)
    assert sorted((p["neighbourhood"] or "") for p in streets(out)) == ["", "r20"]


def test_only_named_roads_of_the_listed_classes_qualify(tmp_path):
    elements = (
        road(100, 1, 40.6, [28.55, 28.6], {"highway": "footway", "name": "Yaya Yolu"})
        + road(110, 2, 40.6, [28.55, 28.6], {"highway": "residential"})
        + road(120, 3, 40.6, [28.55, 28.6], {"highway": "service", "name": "Servis Yolu"})
        + road(130, 4, 40.6, [28.55, 28.6], {"highway": "pedestrian", "name": "Istiklal Caddesi"})
        + road(140, 5, 40.6, [28.55, 28.6], {"highway": "track", "name": "Patika"})
        + road(150, 6, 40.6, [28.55, 28.6], {"highway": "residential", "name": "  "})
    )
    accounting, out = run(tmp_path, elements)
    assert sorted(p["name"] for p in streets(out)) == ["Istiklal Caddesi", "Servis Yolu"]
    assert accounting["ways"] == 2


def test_other_language_names_and_alternative_names_are_kept(tmp_path):
    tags = {"highway": "residential", "name": "Ataturk Caddesi", "name:ru": "улица Ататюрк", "name:en": "Ataturk Street", "alt_name": "Cumhuriyet Cd; Eski Yol;"}
    _, out = run(tmp_path, road(100, 1, 40.6, [28.55, 28.6], tags))
    [part] = streets(out)
    assert part["names"] == {"en": "Ataturk Street", "ru": "улица Ататюрк", "tr": "Ataturk Caddesi"}
    assert part["alt"] == ["Cumhuriyet Cd", "Eski Yol"]


def test_dense_lines_are_thinned_and_keep_their_ends(tmp_path):
    lons = [28.55 + i * 0.0001 for i in range(40)]
    _, out = run(tmp_path, road(100, 1, 40.6, [round(x, 6) for x in lons], {"highway": "residential", "name": "Duz Sokak"}))
    [line] = streets(out)[0]["lines"]
    assert line[0] == [28.55, 40.6] and line[-1] == [round(lons[-1], 6), 40.6]
    assert len(line) == 2


def test_a_road_outside_every_province_and_one_in_no_district_are_rejected_and_counted(tmp_path):
    elements = road(100, 1, 48.0, [10.0, 10.1], {"highway": "residential", "name": "Uzak Sokak"}) + road(110, 2, 41.3, [29.2, 29.3], {"highway": "residential", "name": "Bos Sokak"}) + road(120, 3, 40.6, [28.55, 28.6], {"highway": "residential", "name": "Iyi Sokak"})
    accounting, out = run(tmp_path, elements)
    assert accounting["ways"] == 3 and accounting["written"] == 1
    assert accounting["rejected"] == {"no_district": 1, "outside": 1, "unlocatable": 0}
    assert accounting["ways"] == accounting["written"] + sum(accounting["rejected"].values())


def test_a_road_that_ends_on_the_province_edge_stays_in_the_province(tmp_path):
    elements = road(100, 1, 40.0, [32.9, 33.1], {"highway": "residential", "name": "Sinir Yolu"}) + road(110, 2, 40.0, [32.3, 32.6], {"highway": "residential", "name": "Ic Yol"})
    accounting, out = run(tmp_path, elements)
    assert [p["name"] for p in streets(out, "06")] == ["Ic Yol", "Sinir Yolu"]
    assert accounting["written"] == 2


def test_the_hash_seed_does_not_change_a_single_byte(tmp_path):
    rng = random.Random(5)
    elements = []
    for i in range(1, 30):
        lat = round(40.55 + rng.random() * 0.4, 4)
        elements += road(1000 + i * 10, i, lat, [28.55, round(28.55 + rng.random() * 0.4, 4)], {"highway": "residential", "name": rng.choice(["A Sokak", "B Sokak", "C Sokak"])})
    pbf, admin, places = write_inputs(tmp_path, elements, name="seed")
    results = []
    for seed in ("1", "2"):
        out = tmp_path / ("proc-" + seed)
        subprocess.run([sys.executable, os.path.join(EXTRACT, "extract_street_parts.py"), pbf, admin, places, str(out)], check=True, env=dict(os.environ, PYTHONHASHSEED=seed), capture_output=True)
        results.append({p: (out / p).read_bytes() for p in ("34/streets.jsonl", "streets-accounting.json", "06/streets.jsonl")})
    assert results[0] == results[1]
    assert len(results[0]["34/streets.jsonl"]) > 500
