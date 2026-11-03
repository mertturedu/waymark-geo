import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "verify"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extract"))

import chain_positions as cp  # noqa: E402


class Index:
    def __init__(self, gap):
        self.gap = gap

    def nearest(self, lon, lat):
        return self.gap, None


def feature(lon=29.0, lat=41.0, **props):
    return {"properties": {"name": "A101", "b": "a101", **props}, "geometry": {"type": "Point", "coordinates": [lon, lat]}}


def address_file(tmp_path, points):
    path = tmp_path / "addresses.jsonl"
    path.write_text("\n".join(json.dumps({"lon": lon, "lat": lat}) for lon, lat in points) + "\n", encoding="utf-8")
    return str(path)


def test_a_point_moved_to_an_osm_point_has_osm_evidence_before_anything_else():
    assert cp.evidence(feature(s="osm"), Index(500)) == "osm"


def test_a_point_on_a_building_has_building_evidence():
    assert cp.evidence(feature(), Index(10)) == "bina"
    assert cp.evidence(feature(), Index(cp.ON_BUILDING_METRES)) == "bina"


def test_an_address_point_within_thirty_metres_is_independent_evidence(tmp_path):
    cells = cp.address_cells(address_file(tmp_path, [(29.0001, 41.0)]))
    assert cp.evidence(feature(), Index(500), cells) == "adres"


def test_an_address_point_that_is_too_far_or_missing_gives_no_evidence(tmp_path):
    far = cp.address_cells(address_file(tmp_path, [(29.001, 41.0)]))
    assert cp.evidence(feature(), Index(500), far) == "yok"
    assert cp.evidence(feature(), Index(500), {}) == "yok"
    assert cp.evidence(feature(), Index(500)) == "yok"


def test_a_building_beats_an_address(tmp_path):
    cells = cp.address_cells(address_file(tmp_path, [(29.0001, 41.0)]))
    assert cp.evidence(feature(), Index(5), cells) == "bina"


def test_address_cells_skip_blank_lines_and_a_missing_file(tmp_path):
    path = tmp_path / "a.jsonl"
    path.write_text('{"lon": 29.0, "lat": 41.0}\n\n', encoding="utf-8")
    assert sum(len(v) for v in cp.address_cells(str(path)).values()) == 1
    assert cp.address_cells(str(tmp_path / "none.jsonl")) == {}


def test_an_address_in_the_next_cell_is_found(tmp_path):
    edge = 29.0004 - 1e-7
    cells = cp.address_cells(address_file(tmp_path, [(edge + 0.00008, 41.0)]))
    assert cp.near_address(cells, edge, 41.0)


def test_the_report_counts_address_evidence_in_the_share_and_shows_it_separately():
    from collections import Counter

    text, passed, share = cp.render([("20", 100, Counter(osm=50, bina=30, yok=10, adres=10), Counter(bina=5))], Counter(osm=50, bina=30, yok=10, adres=10), 0.5, 0, 100)
    assert "| 20 | 100 | 50 | 30 | 10 | 5 | 10 |" in text
    assert share == 90.0
    assert "adres kanıtı olmadan %80.0" in text
    assert "GEÇMEDİ" in text
