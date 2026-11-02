import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extract"))
from extract_address_records import extract  # noqa: E402
from extract_admin import extract as extract_admin  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "addr-mini.osm")


def run(tmp_path, name="records.jsonl", provinces=("34", "06")):
    admin = tmp_path / "admin.jsonl"
    extract_admin(FIXTURE, str(admin))
    out = tmp_path / name
    count = extract(FIXTURE, str(admin), str(out), set(provinces))
    rows = [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines()]
    return count, rows, out


def test_assigns_province_district_and_neighbourhood_from_the_polygons(tmp_path):
    count, rows, _ = run(tmp_path)
    assert count == len(rows) == 4
    moda = [r for r in rows if r["street"] == "Bahariye Caddesi"][0]
    assert moda["province"] == "34"
    assert moda["provinceName"] == "İstanbul"
    assert moda["district"] == "Kadıköy"
    assert moda["neighbourhood"] == "Moda"
    assert moda["houseNumber"] == "14"
    assert moda["districtNames"] == {"tr": "Kadıköy", "ru": "Кадыкёй"}


def test_keeps_records_that_lie_in_a_district_but_in_no_neighbourhood(tmp_path):
    _, rows, _ = run(tmp_path)
    gul = [r for r in rows if r["street"] == "Gül Sokak"][0]
    assert gul["district"] == "Kadıköy"
    assert gul["neighbourhood"] is None
    assert gul["houseNumber"] == "3/A"


def test_takes_the_middle_of_a_way_for_buildings(tmp_path):
    _, rows, _ = run(tmp_path)
    building = [r for r in rows if r["street"] == "Moda Caddesi"][0]
    assert building["neighbourhood"] == "Moda"
    assert building["houseNumber"] == "21"


def test_skips_records_without_street_without_district_or_outside_the_wanted_provinces(tmp_path):
    _, rows, _ = run(tmp_path)
    streets = {r["street"] for r in rows}
    assert "Kızılay Sokak" not in streets
    assert "İstiklal Caddesi" not in streets
    assert not any(r["houseNumber"] == "99" for r in rows)
    _, all_rows, _ = run(tmp_path, "all.jsonl", provinces=("34", "06", "27"))
    assert "İstiklal Caddesi" in {r["street"] for r in all_rows}


def test_two_runs_write_identical_bytes(tmp_path):
    _, _, first = run(tmp_path, "a.jsonl")
    _, _, second = run(tmp_path, "b.jsonl")
    assert first.read_bytes() == second.read_bytes()
