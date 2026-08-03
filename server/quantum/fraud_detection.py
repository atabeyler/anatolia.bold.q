"""
ANATOLIA-Q Quantum Fraud / AML Anomaly Detector
------------------------------------------------
Encodes each transaction's numeric features into a quantum feature-map
circuit, computes the exact pairwise quantum kernel (state fidelity) between
every pair of transactions, and flags the ones that are least similar to the
rest of the dataset in that quantum feature space. This is a quantum-kernel
outlier detector (the same family as QSVM's kernel step, e.g. Havlicek et
al. 2019 / the qiskit "ZZFeatureMap" pattern), implemented directly on top
of qiskit + qiskit-aer's exact statevector simulation -- no additional
dependency (qiskit-machine-learning, scikit-learn) is required.

This runs on a local SIMULATOR. It is not real quantum hardware, and it does
not have live access to any bank's, BDDK's, or BTK's actual systems -- it
scores whatever transaction records it is given (uploaded by the user, or
synthesized by the LLM from a described scenario), the same way the rest of
ANATOLIA-Q only ever reasons over what it's given.

Input:  JSON via stdin -> {"transactions": [{"id": "...", "amount": 15000,
        "hour": 3, "frequency": 4, "newCounterparty": 1, "crossBorder": 1}, ...]}
Output: JSON via stdout -> {"backend", "qubits", "circuitDepth", "circuitDiagram",
        "transactions": [{..., "riskScore": 0-100, "flagged": bool}, ...]}
"""
import sys
import json
import math

from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector

FEATURES = ["amount", "hour", "frequency", "newCounterparty", "crossBorder"]

# The exact pairwise kernel is O(n^2) statevector inner products. Unlike the
# QAOA optimizer (which caps items via MAX_ITEMS), this had no upper bound,
# so a large LLM-generated transaction table could run past the Node-side
# subprocess timeout on every request. Cap it the same way.
MAX_TRANSACTIONS = 60


def robust_normalize(transactions):
    """Z-score each feature, then squash with tanh into [-1, 1]. Squashing
    (rather than min/max scaling) keeps a single extreme outlier from
    compressing every other point into a sliver of the range."""
    stats = []
    for f in FEATURES:
        vals = [float(t.get(f) or 0) for t in transactions]
        mean = sum(vals) / len(vals)
        var = sum((v - mean) ** 2 for v in vals) / len(vals)
        std = math.sqrt(var) or 1.0
        stats.append((mean, std))

    rows = []
    for t in transactions:
        row = []
        for i, f in enumerate(FEATURES):
            mean, std = stats[i]
            z = (float(t.get(f) or 0) - mean) / std
            row.append(math.tanh(z / 2))
        rows.append(row)
    return rows


def feature_map_circuit(x):
    """RY angle-encodes each (already [-1,1]-bounded) feature, then a CX/RY
    entangling layer mixes in pairwise feature interactions -- genuine
    two-qubit entanglement, not just an independent-qubit encoding."""
    n = len(x)
    qc = QuantumCircuit(n)
    for i in range(n):
        angle = (x[i] + 1) / 2 * math.pi
        qc.ry(angle, i)
    for i in range(n - 1):
        qc.cx(i, i + 1)
        qc.ry((x[i] * x[i + 1]) * 0.5, i + 1)
        qc.cx(i, i + 1)
    return qc


def detect(transactions):
    n = len(transactions)
    if n < 3:
        return None  # too few points for a meaningful outlier comparison

    norm_rows = robust_normalize(transactions)
    circuits = [feature_map_circuit(x) for x in norm_rows]
    states = [Statevector.from_instruction(qc) for qc in circuits]

    # Exact quantum kernel: |<psi_i|psi_j>|^2 for every pair. Cast every value
    # coming out of qiskit/numpy to plain Python types -- numpy scalars
    # (float64, bool_) look like their Python equivalents but json.dumps
    # rejects them.
    kernel = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            kernel[i][j] = float(abs(states[i].inner(states[j])) ** 2)

    raw_scores = []
    for i in range(n):
        others = [kernel[i][j] for j in range(n) if j != i]
        mean_similarity = sum(others) / len(others)
        raw_scores.append(float(1 - mean_similarity))

    lo, hi = min(raw_scores), max(raw_scores)
    span = (hi - lo) or 1.0
    risk_scores = [round(float((s - lo) / span * 100), 1) for s in raw_scores]

    mean_raw = sum(raw_scores) / n
    std_raw = math.sqrt(sum((s - mean_raw) ** 2 for s in raw_scores) / n)
    threshold = mean_raw + std_raw

    out = []
    for i, t in enumerate(transactions):
        out.append({
            **{k: t.get(k) for k in ["id", *FEATURES]},
            "riskScore": risk_scores[i],
            "flagged": bool(raw_scores[i] > threshold),
        })
    out.sort(key=lambda t: -t["riskScore"])

    top_circuit = circuits[raw_scores.index(max(raw_scores))]
    diagram = str(top_circuit.draw(output="text", fold=80))

    return {
        "backend": "qiskit-statevector-kernel",
        "qubits": len(FEATURES),
        "featureNames": FEATURES,
        "transactionCount": n,
        "flaggedCount": sum(1 for t in out if t["flagged"]),
        "circuitDepth": top_circuit.depth(),
        "circuitDiagram": diagram,
        "transactions": out,
    }


def main():
    raw = sys.stdin.read() or "{}"
    payload = json.loads(raw)
    transactions = payload.get("transactions", [])[:MAX_TRANSACTIONS]
    result = detect(transactions)
    print(json.dumps(result if result is not None else {
        "backend": "qiskit-statevector-kernel", "qubits": len(FEATURES),
        "featureNames": FEATURES, "transactionCount": len(transactions),
        "flaggedCount": 0, "circuitDepth": 0, "circuitDiagram": "", "transactions": [],
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 -- the Node side logs stderr and falls back
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
