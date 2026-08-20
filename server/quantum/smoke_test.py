"""
CI smoke test for the three Qiskit worker scripts.

py_compile (see ci.yml) only proves the files parse -- it can't catch a
broken import, an API that changed between Qiskit versions, or a genuine
logic error (e.g. probabilities that don't sum to ~100%). This actually
runs each worker's stdin/stdout contract against a small, fixed input and
sanity-checks the shape and a few invariants of the result, the way a real
request would exercise it -- without needing a live IBM Quantum account
(each call passes skipHardware/omits IBM credentials, so this only exercises
the local Aer simulator path).

Run directly: python3 quantum/smoke_test.py
"""
import json
import subprocess
import sys
from pathlib import Path

QUANTUM_DIR = Path(__file__).parent


def run_worker(script, payload):
    proc = subprocess.run(
        [sys.executable, str(QUANTUM_DIR / script)],
        input=json.dumps(payload),
        capture_output=True, text=True, timeout=60,
    )
    if proc.returncode != 0:
        raise AssertionError(f"{script} exited {proc.returncode}\nstderr: {proc.stderr}")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise AssertionError(f"{script} did not print valid JSON on stdout\nstdout: {proc.stdout}\nstderr: {proc.stderr}") from exc


def check_scenario_quantum():
    result = run_worker("scenario_quantum.py", {
        "shots": 512,
        "scenarios": [{"id": "A", "weight": 0.4}, {"id": "B", "weight": 0.35}, {"id": "C", "weight": 0.25}],
    })
    assert result["backend"] == "qiskit-aer-simulator", result
    assert result["qubits"] > 0, result
    assert len(result["scenarios"]) == 3, result
    total = sum(s["quantumProbability"] for s in result["scenarios"])
    assert 95 <= total <= 105, f"scenario probabilities should sum to ~100%, got {total}"
    assert "environmentFingerprint" in result and result["environmentFingerprint"]["qiskitVersion"], result
    print("[smoke] scenario_quantum.py OK")


def check_fraud_detection():
    transactions = [
        {"id": f"T{i}", "amount": 1000 + i * 500, "hour": i % 24, "frequency": 1, "newCounterparty": i % 2, "crossBorder": 0}
        for i in range(6)
    ]
    result = run_worker("fraud_detection.py", {"transactions": transactions})
    assert result["backend"] == "qiskit-statevector-kernel", result
    assert len(result["transactions"]) == len(transactions), result
    assert all("riskScore" in t and "flagged" in t for t in result["transactions"]), result
    print("[smoke] fraud_detection.py OK")


def check_portfolio_optimizer():
    items = [
        {"id": "I1", "value": 40, "cost": 30}, {"id": "I2", "value": 35, "cost": 25},
        {"id": "I3", "value": 20, "cost": 15}, {"id": "I4", "value": 25, "cost": 20},
    ]
    budget = 60
    result = run_worker("portfolio_optimizer.py", {"items": items, "budgetPercent": budget})
    assert result["backend"] == "qiskit-aer-simulator", result
    # despite the field's name, the worker treats "budgetPercent" as an absolute
    # budget value (see portfolio_optimizer.py's main()), not a percentage of
    # total item cost -- the only hard constraint is totalCost <= budget.
    assert result["totalCost"] <= budget, result
    assert result["classicalBenchmark"]["totalValue"] >= result["totalValue"], (
        "the classical exact optimum must never score lower than QAOA's result", result
    )
    print("[smoke] portfolio_optimizer.py OK")


if __name__ == "__main__":
    check_scenario_quantum()
    check_fraud_detection()
    check_portfolio_optimizer()
    print("[smoke] all quantum workers OK")
