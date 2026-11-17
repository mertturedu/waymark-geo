import json
import os
import sqlite3
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "validate"))
from check_pack import check_pack  # noqa: E402

TYPE = {"n": 0, "w": 1, "r": 2}


def code(identifier):
    return int(identifier[1:]) * 4 + TYPE[identifier[0]]


def write_lines(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")


def world(tmp_path, addresses, streets=(), places=(), districts=("r10",), hoods=()):
    work = tmp_path / "work"
    write_lines(str(work / "admin-pack" / "34.jsonl"), [{"id": d, "level": 6, "parent": "r1"} for d in districts] + [{"id": h, "level": 8, "parent": p} for h, p in hoods])
    write_lines(str(work / "addresses" / "34" / "addresses.jsonl"), addresses)
    write_lines(str(work / "streets" / "34" / "streets.jsonl"), streets)
    write_lines(str(work / "places" / "34" / "places.jsonl"), places)
    return work


def cell_of(lon_e6, lat_e6):
    return (lat_e6 * 500 // 1000000) * 65536 + (lon_e6 * 500 // 1000000)


def pack(tmp_path, rows, parts=0, pois=0, dropped=0, cell_shift=0):
    path = tmp_path / ("pack-%d.sqlite" % len(list(tmp_path.glob("pack-*.sqlite"))))
    db = sqlite3.connect(path)
    db.executescript("CREATE TABLE address (id INTEGER PRIMARY KEY, number TEXT, lon INTEGER, lat INTEGER, osm INTEGER, district_id INTEGER, hood_id INTEGER, cell INTEGER); CREATE TABLE street_part (id INTEGER PRIMARY KEY); CREATE TABLE poi (id INTEGER PRIMARY KEY); CREATE TABLE meta (k TEXT, v TEXT);")
    db.execute("INSERT INTO meta VALUES ('dropped_parts', ?)", (str(dropped),))
    for i, row in enumerate(rows, 1):
        identifier, number, lon, lat = row[:4]
        district_id, hood_id = (row[4], row[5]) if len(row) > 4 else (1, None)
        db.execute("INSERT INTO address VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (i, number, round(lon * 1e6), round(lat * 1e6), code(identifier), district_id, hood_id, cell_of(round(lon * 1e6), round(lat * 1e6)) + (cell_shift if i == 1 else 0)))
    for i in range(parts):
        db.execute("INSERT INTO street_part VALUES (?)", (i + 1,))
    for i in range(pois):
        db.execute("INSERT INTO poi VALUES (?)", (i + 1,))
    db.commit()
    db.close()
    return str(path)


def addr(identifier, number, lon, lat, district="r10"):
    return {"id": identifier, "number": number, "lon": lon, "lat": lat, "district": district}


ROWS = [addr("n1", "5", 28.6, 40.7), addr("w2", "7", 28.61, 40.71), addr("n3", "9/A", 28.62, 40.72)]


def test_a_matching_pack_has_no_problems(tmp_path):
    work = world(tmp_path, ROWS, streets=[{"name": "A", "district": "r10"}], places=[{"id": "n9", "kind": "hospital", "district": "r10"}])
    result = check_pack(pack(tmp_path, [("n1", "5", 28.6, 40.7), ("w2", "7", 28.61, 40.71), ("n3", "9/A", 28.62, 40.72)], parts=1, pois=1), str(work), "34")
    assert result["ok"] is True and result["problems"] == []
    assert result["counts"]["addresses"] == {"source": 3, "expected": 3, "pack": 3}


def test_a_missing_row_is_found_by_the_count_and_by_the_sample(tmp_path):
    work = world(tmp_path, ROWS)
    result = check_pack(pack(tmp_path, [("n1", "5", 28.6, 40.7), ("w2", "7", 28.61, 40.71)]), str(work), "34")
    assert result["ok"] is False
    assert any("adres sayısı" in p for p in result["problems"])
    assert any("n3" in p for p in result["problems"])


def test_a_moved_point_is_found_by_the_sample(tmp_path):
    work = world(tmp_path, ROWS)
    result = check_pack(pack(tmp_path, [("n1", "5", 28.6, 40.7), ("w2", "7", 28.7, 40.71), ("n3", "9/A", 28.62, 40.72)]), str(work), "34")
    assert result["ok"] is False
    assert any("w2" in p and "koordinat" in p for p in result["problems"])


def test_rows_of_a_district_the_pack_does_not_have_are_a_problem(tmp_path):
    rows = ROWS + [addr("n4", "11", 28.6, 40.7, district="r99")]
    work = world(tmp_path, rows)
    result = check_pack(pack(tmp_path, [("n1", "5", 28.6, 40.7), ("w2", "7", 28.61, 40.71), ("n3", "9/A", 28.62, 40.72)]), str(work), "34")
    assert result["ok"] is False
    assert any("ilçesi pakette olmayan" in p and "1" in p for p in result["problems"])
    assert result["counts"]["addresses"] == {"source": 4, "expected": 3, "pack": 3}


def test_a_wrong_district_or_neighbourhood_id_is_found_by_the_sample(tmp_path):
    rows = [addr("n1", "5", 28.6, 40.7) | {"neighbourhood": "r20"}, addr("w2", "7", 28.61, 40.71, district="r11") | {"neighbourhood": "r21"}, addr("n3", "9", 28.62, 40.72) | {"neighbourhood": None}]
    work = world(tmp_path, rows, districts=("r10", "r11"), hoods=(("r20", "r10"), ("r21", "r11")))
    good = [("n1", "5", 28.6, 40.7, 1, 1), ("w2", "7", 28.61, 40.71, 2, 2), ("n3", "9", 28.62, 40.72, 1, None)]
    assert check_pack(pack(tmp_path, good), str(work), "34")["ok"] is True
    bad_district = [good[0], ("w2", "7", 28.61, 40.71, 1, 2), good[2]]
    result = check_pack(pack(tmp_path, bad_district), str(work), "34")
    assert any("w2" in p and "ilçe" in p for p in result["problems"])
    bad_hood = [("n1", "5", 28.6, 40.7, 1, 2), good[1], good[2]]
    result = check_pack(pack(tmp_path, bad_hood), str(work), "34")
    assert any("n1" in p and "mahalle" in p for p in result["problems"])


def test_part_and_place_counts_are_compared(tmp_path):
    work = world(tmp_path, ROWS, streets=[{"name": "A", "district": "r10"}, {"name": "B", "district": "r10"}], places=[{"id": "n9", "kind": "hospital", "district": "r10"}, {"id": "n8", "kind": "no_such_kind", "district": "r10"}])
    result = check_pack(pack(tmp_path, [("n1", "5", 28.6, 40.7), ("w2", "7", 28.61, 40.71), ("n3", "9/A", 28.62, 40.72)], parts=1, pois=2), str(work), "34")
    assert result["ok"] is False
    assert any("sokak parçası" in p for p in result["problems"])
    assert any("yer" in p for p in result["problems"])


def test_the_sample_is_the_same_every_time(tmp_path):
    many = [addr("n%d" % i, str(i), 28.6 + i / 1e4, 40.7) for i in range(1, 300)]
    work = world(tmp_path, many)
    db = [("n%d" % i, str(i), 28.6 + i / 1e4, 40.7) for i in range(1, 300)]
    db[10] = ("n11", "11", 0.0, 0.0)
    path = pack(tmp_path, db)
    first = check_pack(path, str(work), "34", sample=50, seed=3)
    second = check_pack(path, str(work), "34", sample=50, seed=3)
    assert first == second


def test_street_rows_the_builder_reported_as_dropped_are_accounted_for_exactly(tmp_path):
    streets = [{"name": "A", "district": "r10"}, {"name": "B", "district": "r10"}, {"name": "C", "district": "r10"}]
    work = world(tmp_path, ROWS, streets=streets)
    rows = [("n1", "5", 28.6, 40.7), ("w2", "7", 28.61, 40.71), ("n3", "9/A", 28.62, 40.72)]
    assert check_pack(pack(tmp_path, rows, parts=2, dropped=1), str(work), "34")["ok"] is True
    lost = check_pack(pack(tmp_path, rows, parts=2, dropped=0), str(work), "34")
    assert lost["ok"] is False and any("sokak parçası" in p for p in lost["problems"])
    extra = check_pack(pack(tmp_path, rows, parts=3, dropped=1), str(work), "34")
    assert extra["ok"] is False


def test_a_wrong_grid_cell_is_found_by_the_sample(tmp_path):
    work = world(tmp_path, ROWS)
    rows = [("n1", "5", 28.6, 40.7), ("w2", "7", 28.61, 40.71), ("n3", "9/A", 28.62, 40.72)]
    assert check_pack(pack(tmp_path, rows), str(work), "34")["ok"] is True
    result = check_pack(pack(tmp_path, rows, cell_shift=1), str(work), "34")
    assert result["ok"] is False and any("hücre" in p and "n1" in p for p in result["problems"])
