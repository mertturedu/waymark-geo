import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extract"))
from extract_admin import extract  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "admin-mini.osm")


def run(tmp_path, name="out.jsonl"):
    out = tmp_path / name
    count = extract(FIXTURE, str(out))
    rows = [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines()]
    return count, rows, out


def test_keeps_only_administrative_levels_four_six_eight(tmp_path):
    count, rows, _ = run(tmp_path)
    assert count == len(rows) == 6
    assert [(r["level"], r["id"]) for r in rows] == [(4, "r101"), (4, "r102"), (4, "r103"), (6, "r201"), (6, "r202"), (8, "r301")]


def test_reads_names_in_every_language_and_the_iso_code(tmp_path):
    _, rows, _ = run(tmp_path)
    istanbul = rows[0]
    assert istanbul["names"] == {"tr": "İstanbul", "en": "Istanbul", "ru": "Стамбул", "ar": "إسطنبول"}
    assert istanbul["iso"] == "TR-34"
    assert rows[1]["names"] == {"tr": "Ankara", "en": "Ankara"}
    assert rows[1]["iso"] == "TR-06"
    assert rows[3]["iso"] is None


def test_splits_alternative_names(tmp_path):
    _, rows, _ = run(tmp_path)
    uskudar = next(r for r in rows if r["id"] == "r202")
    assert uskudar["alt"] == ["Scutari", "Uskudar"]
    assert next(r for r in rows if r["id"] == "r201")["alt"] == []


def test_writes_a_polygon_that_covers_the_square(tmp_path):
    from shapely import wkt

    _, rows, _ = run(tmp_path)
    shape = wkt.loads(rows[0]["wkt"])
    assert shape.geom_type in ("Polygon", "MultiPolygon")
    assert shape.bounds == (0.0, 0.0, 4.0, 4.0)
    assert round(shape.area, 6) == 16.0
    assert rows[0]["bbox"] == [0.0, 0.0, 4.0, 4.0]


def test_two_runs_write_identical_bytes(tmp_path):
    _, _, first = run(tmp_path, "a.jsonl")
    _, _, second = run(tmp_path, "b.jsonl")
    assert first.read_bytes() == second.read_bytes()


def test_links_every_unit_to_the_unit_one_level_up_that_contains_it(tmp_path):
    _, rows, _ = run(tmp_path)
    parent = {r["id"]: r["parent"] for r in rows}
    assert parent == {"r101": None, "r102": None, "r103": None, "r201": "r101", "r202": "r101", "r301": "r201"}


def test_lists_boundaries_that_could_not_be_built_instead_of_failing(tmp_path):
    count, _, out = run(tmp_path)
    skipped = json.loads((tmp_path / (out.name + ".skipped.json")).read_text(encoding="utf-8"))
    assert count == 6
    assert skipped == [{"id": "r403", "level": 6, "name": "Bozuk"}]
