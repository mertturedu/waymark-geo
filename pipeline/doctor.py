import argparse
import importlib
import json
import os
import sys
import tempfile
from importlib import metadata


def version_of(name):
    try:
        return metadata.version(name)
    except metadata.PackageNotFoundError:
        return None


def check_osmium():
    import osmium

    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "t.osm.pbf")
        writer = osmium.SimpleWriter(path)
        writer.add_node(osmium.osm.mutable.Node(id=1, location=(29.0, 41.0), tags={"name": "Atatürk"}))
        writer.close()
        names = [o.tags["name"] for o in osmium.FileProcessor(path)]
    assert names == ["Atatürk"], names


def check_shapely():
    from shapely.geometry import Point, box

    assert box(0, 0, 2, 2).contains(Point(1, 1))


def check_networkx():
    import networkx as nx

    g = nx.DiGraph()
    g.add_weighted_edges_from([(0, 1, 5), (1, 2, 5), (0, 2, 20)])
    assert nx.shortest_path(g, 0, 2, weight="weight") == [0, 1, 2]


def check_ortools():
    from ortools.constraint_solver import pywrapcp, routing_enums_pb2

    dist = [[0, 4, 9, 7, 3], [4, 0, 5, 8, 6], [9, 5, 0, 2, 7], [7, 8, 2, 0, 4], [3, 6, 7, 4, 0]]
    manager = pywrapcp.RoutingIndexManager(5, 1, 0)
    routing = pywrapcp.RoutingModel(manager)
    cb = routing.RegisterTransitCallback(lambda i, j: dist[manager.IndexToNode(i)][manager.IndexToNode(j)])
    routing.SetArcCostEvaluatorOfAllVehicles(cb)
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    assert routing.SolveWithParameters(params) is not None


CHECKS = {
    "osmium": check_osmium,
    "shapely": check_shapely,
    "networkx": check_networkx,
    "ortools": check_ortools,
}


def run(name, fn):
    try:
        fn()
        return {"name": name, "ok": True, "version": version_of(name)}
    except Exception as error:
        return {"name": name, "ok": False, "detail": f"{type(error).__name__}: {error}"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--require", action="append", default=[])
    args = parser.parse_args()
    checks = [run(name, fn) for name, fn in CHECKS.items()]
    for name in args.require:
        checks.append(run(name, lambda n=name: importlib.import_module(n)))
    print(json.dumps({"checks": checks}))
    sys.exit(0 if all(c["ok"] for c in checks) else 1)


main()
