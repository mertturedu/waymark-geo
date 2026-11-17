import json
import os
import sys
from multiprocessing import Pool

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

LIMIT_SECONDS = 10


def solve(instance):
    matrix = instance["matrix"]
    size = instance["size"]
    has_start = instance["hasStart"]
    base = 1 if has_start else 0
    nodes = size + 1
    cost = [[0] * nodes for _ in range(nodes)]
    for i in range(size):
        if has_start:
            cost[0][i + 1] = round(matrix[0][i + 1] * 10)
            cost[i + 1][0] = round(matrix[i + base][0] * 10) if instance["end"] == "return" else 0
        for j in range(size):
            cost[i + 1][j + 1] = round(matrix[i + base][j + base] * 10)
    manager = pywrapcp.RoutingIndexManager(nodes, 1, 0)
    routing = pywrapcp.RoutingModel(manager)

    node_of = {manager.NodeToIndex(n): n for n in range(nodes)}
    node_of[routing.End(0)] = 0

    def price(a, b):
        return cost[node_of[a]][node_of[b]]

    transit = routing.RegisterTransitCallback(price)
    routing.SetArcCostEvaluatorOfAllVehicles(transit)

    def step(a):
        return 0 if node_of[a] == 0 else 1

    counter = routing.RegisterUnaryTransitCallback(step)
    routing.AddDimension(counter, 0, size + 1, True, "Count")
    count = routing.GetDimensionOrDie("Count")
    solver = routing.solver()
    for before, after in instance["precedence"]:
        a, b = manager.NodeToIndex(before + 1), manager.NodeToIndex(after + 1)
        routing.AddPickupAndDelivery(a, b)
        solver.Add(routing.VehicleVar(a) == routing.VehicleVar(b))
        solver.Add(count.CumulVar(a) < count.CumulVar(b))
    for pin in instance["pins"]:
        solver.Add(count.CumulVar(manager.NodeToIndex(pin["node"] + 1)) == pin["position"])
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.seconds = LIMIT_SECONDS
    solution = routing.SolveWithParameters(params)
    if solution is None:
        return {"id": instance["id"], "cost": None}
    index = routing.Start(0)
    order = []
    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        if node != 0:
            order.append(node - 1)
        index = solution.Value(routing.NextVar(index))
    total = 0
    if order:
        total = matrix[0][order[0] + 1] if has_start else 0
        for k in range(1, len(order)):
            total += matrix[order[k - 1] + base][order[k] + base]
        if has_start and instance["end"] == "return":
            total += matrix[order[-1] + base][0]
    return {"id": instance["id"], "cost": total}


def main(path, out, workers):
    with open(path, encoding="utf-8") as f:
        instances = json.load(f)
    with Pool(workers) as pool:
        results = pool.map(solve, instances, chunksize=1)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(results, f)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 8)
