import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extract"))

import chains
import overture_places as op


@pytest.mark.parametrize(
    "name,brand,group,expected",
    [
        ("A-101", None, "market", "a101"), ("A101 Yeni Mahalle", None, "market", "a101"), ("BİM Gaziosmanpaşa", None, "market", "bim"), ("Bim", "", "market", "bim"),
        ("Şok Market", "Şok", "market", "sok"), ("Sokak Market", None, "market", None), ("Fileli Market", None, "market", None), ("Migros Türkiye", "Migros Türkiye", "market", "migros"),
        ("5M Migros", None, "market", "migros"), ("Macrocenter Etiler", None, "market", "macro"), ("Opet", "Opet", "fuel", "opet"), ("Petrol Ofisi", None, "fuel", "po"),
        ("Starbucks Coffee", "Starbucks", "food", "starbucks"), ("Burger King", None, "food", "burgerking"), ("McDonald's", None, "food", "mcdonalds"),
        ("BİM Kuaför", None, "shop", None), ("Pofuduk", None, "food", None),
        ("Aras Kargo Tuzla Şubesi", None, "other", "aras"), ("Yurtiçi Kargo Suadiye Şubesi", None, "public", "yurtici"), ("MNG Kargo Genel Müdürlük", None, "food", "mng"),
        ("PTT Kadıköy Şubesi", None, "public", "ptt"), ("Aras Elektrik Dağıtım", None, "other", None), ("UPS Teknik Servis", None, "other", None), ("HepsiJet Dağıtım", None, "other", "hepsijet"),
    ],
)
def test_chain_of(name, brand, group, expected):
    assert chains.chain_of(name, brand, group) == expected


def row(**extra):
    base = {"id": "a", "name": "BİM", "cat": "grocery_store", "confidence": 0.35, "status": None, "name_tr": None, "lon": 29.0, "lat": 41.0}
    base.update(extra)
    return base


def test_low_confidence_chain_store_is_kept_and_tagged():
    assert op.keep(row())
    feature = op.feature(row())
    assert feature["properties"]["b"] == "bim"
    assert feature["tippecanoe"]["minzoom"] == 14


def test_low_confidence_unknown_store_is_still_dropped():
    assert not op.keep(row(name="Yıldız Market"))


def test_landmark_gets_its_flag_and_early_zoom():
    feature = op.feature(row(name="Dolmabahçe Sarayı", cat="palace", confidence=0.8))
    assert feature["properties"]["lm"] == 1
    assert feature["tippecanoe"]["minzoom"] == 14
    assert "lm" not in op.feature(row(name="Çınar Eczanesi", cat="pharmacy", confidence=0.8))["properties"]


def point(chain, lon, lat, id="osm:n1"):
    return {"id": id, "chain": chain, "group": "market", "name": "BİM", "lon": lon, "lat": lat}


def mapped_bim(lon, lat):
    return op.feature(row(name="BİM", confidence=0.8, lon=lon, lat=lat))


def test_osm_chain_point_next_to_the_same_chain_is_dropped():
    assert op.osm_features([point("bim", 29.00030, 41.0)], [mapped_bim(29.0, 41.0)]) == []


def test_osm_chain_point_far_away_or_of_another_chain_is_kept():
    kept = op.osm_features([point("bim", 29.0100, 41.0), point("a101", 29.00030, 41.0, "osm:n2")], [mapped_bim(29.0, 41.0)])
    assert [f["properties"]["b"] for f in kept] == ["bim", "a101"]
    assert kept[0]["tippecanoe"]["minzoom"] == 14


def test_two_osm_points_of_one_chain_on_one_spot_become_one():
    assert len(op.osm_features([point("bim", 29.0, 41.0), point("bim", 29.00005, 41.0, "osm:n2")], [])) == 1


def test_every_chain_in_the_shared_list_has_a_badge_and_matches_its_own_name():
    for chain in chains.CHAINS:
        assert chain["text"] and len(chain["fill"]) == 6 and len(chain["ink"]) == 6
        assert chains.match(chain["patterns"][0]) == chain["id"]


def test_overture_chain_point_moves_onto_the_nearby_osm_point_of_the_same_chain():
    feature = mapped_bim(29.0, 41.0)
    extra = op.osm_features([point("bim", 29.0006, 41.0)], [feature])
    assert extra == []
    assert feature["geometry"]["coordinates"] == [29.0006, 41.0]
    assert feature["properties"]["s"] == "osm"


def test_overture_chain_point_stays_when_the_osm_point_is_too_far_or_another_chain():
    feature = mapped_bim(29.0, 41.0)
    op.osm_features([point("bim", 29.0030, 41.0), point("a101", 29.00001, 41.0, "osm:n2")], [feature])
    assert feature["geometry"]["coordinates"] == [29.0, 41.0]
    assert "s" not in feature["properties"]


def test_each_osm_point_serves_only_one_overture_point():
    first, second = mapped_bim(29.0, 41.0), mapped_bim(29.0002, 41.0)
    op.osm_features([point("bim", 29.0001, 41.0)], [first, second])
    assert sum(1 for f in (first, second) if f["properties"].get("s") == "osm") == 1


class FakeIndex:
    def __init__(self, gap, centre):
        self.gap, self.centre = gap, centre

    def nearest(self, lon, lat):
        return self.gap, self.centre


def test_chain_point_off_every_building_moves_to_the_nearest_building():
    feature = mapped_bim(29.0, 41.0)
    assert op.snap_to_buildings([feature], FakeIndex(45, (29.0003, 41.0001))) == 1
    assert feature["geometry"]["coordinates"] == [29.0003, 41.0001]
    assert feature["properties"]["s"] == "bina"


def test_chain_point_on_a_building_or_far_from_all_stays():
    near, far = mapped_bim(29.0, 41.0), mapped_bim(29.1, 41.0)
    assert op.snap_to_buildings([near], FakeIndex(12, (29.5, 41.5))) == 0
    assert op.snap_to_buildings([far], FakeIndex(300, (29.5, 41.5))) == 0
    assert near["geometry"]["coordinates"] == [29.0, 41.0] and far["geometry"]["coordinates"] == [29.1, 41.0]


def test_point_already_placed_by_osm_is_not_moved_again():
    feature = mapped_bim(29.0, 41.0)
    feature["properties"]["s"] = "osm"
    assert op.snap_to_buildings([feature], FakeIndex(50, (29.5, 41.5))) == 0


def test_snap_ties_resolve_by_input_order():
    def feat(lon):
        return {"geometry": {"coordinates": [lon, 41.0]}, "properties": {"b": "bim"}}

    points = [{"chain": "bim", "lon": 29.0, "lat": 41.0}]
    for _ in range(20):
        mapped = [feat(29.00005), feat(28.99995)]
        taken, moved = op.snap_to_osm(points, mapped)
        assert moved == 1
        assert mapped[0]["properties"].get("s") == "osm"
        assert "s" not in mapped[1]["properties"]


def test_cargo_chain_overrides_the_category_group():
    feature = op.feature(row(name="Aras Kargo Orhanlı", cat="freight_and_cargo_service", confidence=0.7))
    assert feature["properties"]["b"] == "aras"
    assert feature["properties"]["g"] == "cargo"


def test_courier_and_post_categories_are_cargo():
    assert op.classify("shipping_center") == "cargo"
    assert op.classify("courier_and_delivery_service") == "cargo"
    assert op.classify("post_office") == "cargo"
    assert op.classify("freight_and_cargo_service") != "cargo"
    assert op.classify("vehicle_shipping") != "cargo"
