import os
import sys

import numpy
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extract"))

from building_index import Index


def index():
    return Index(numpy.array([29.0, 29.0100]), numpy.array([41.0, 41.0]), numpy.array([20.0, 10.0], dtype=numpy.float32))


def test_distance_is_measured_to_the_edge_of_the_nearest_building():
    gap, centre = index().nearest(29.0004, 41.0)
    assert gap == pytest.approx(33.7 - 20, abs=1)
    assert centre == (29.0, 41.0)


def test_point_inside_a_building_has_zero_gap():
    assert index().nearest(29.00005, 41.0)[0] == 0


def test_nothing_nearby_is_reported_as_infinite():
    gap, centre = index().nearest(30.0, 40.0)
    assert gap == float("inf") and centre is None
