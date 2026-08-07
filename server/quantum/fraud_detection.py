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

The riskScore/flagged decision always comes from this exact simulation --
never from real hardware. A regulatory anomaly flag needs to be
deterministic and reproducible (same input, same output, every time);
real quantum hardware's readout/decoherence noise would make the same
transaction flip between flagged/clear from one run to the next, which is
not an acceptable property for a compliance-facing risk score.

Real IBM Quantum hardware is used only as an OPTIONAL, separate
verification data point (when IBM_QUANTUM_TOKEN/IBM_QUANTUM_INSTANCE are
configured): a swap test estimates |<psi_i|psi_j>|^2 for the single most
informative pair (the top-risk transaction vs. the most "typical" one) via
real measurement, and is reported alongside the exact value for comparison
-- mirroring how scenario_quantum.py runs its circuit on real hardware as
a verification lane that never feeds back into the reported result. It
does not have live access to any bank's, BDDK's, or BTK's actual systems --
it scores whatever transaction records it is given (uploaded by the user,
or synthesized by the LLM from a described scenario), the same way the
rest of ANATOLIA-Q only ever reasons over what it's given.

Input:  JSON via stdin -> {"transactions": [{"id": "...", "amount": 15000,
        "hour": 3, "frequency": 4, "newCounterparty": 1, "crossBorder": 1}, ...]}
Output: JSON via stdout -> {"backend", "qubits", "circuitDepth", "circuitDiagram",
        "transactions": [{..., "riskScore": 0-100, "flagged": bool}, ...],
        "hardwareVerification", "ibmDiagnostic"}
"""
import sys
import json
import math

from qiskit import QuantumCircuit, QuantumRegister, ClassicalRegister
from qiskit.quantum_info import Statevector

from _ibm_backend import run_on_ibm_hardware, is_ibm_configured, LAST_IBM_ERROR

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


def build_swap_test_circuit(circuit_a, circuit_b):
    """Standard swap test: H on an ancilla, controlled-swap every
    corresponding qubit of the two feature-map registers, H again, measure
    the ancilla. P(ancilla=0) = 1/2 + 1/2*|<psi_a|psi_b>|^2, so the fidelity
    is recovered as 2*P(0) - 1. The classical register is named "meas" to
    match what _ibm_backend.py's result reader looks up."""
    n = circuit_a.num_qubits
    anc = QuantumRegister(1, 'anc')
    reg_a = QuantumRegister(n, 'a')
    reg_b = QuantumRegister(n, 'b')
    creg = ClassicalRegister(1, 'meas')
    qc = QuantumCircuit(anc, reg_a, reg_b, creg)
    qc.compose(circuit_a, qubits=reg_a, inplace=True)
    qc.compose(circuit_b, qubits=reg_b, inplace=True)
    qc.h(anc[0])
    for k in range(n):
        qc.cswap(anc[0], reg_a[k], reg_b[k])
    qc.h(anc[0])
    qc.measure(anc[0], creg[0])
    return qc


def detect(transactions, skip_hardware=False):
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

    top_idx = raw_scores.index(max(raw_scores))
    typical_idx = raw_scores.index(min(raw_scores))
    top_circuit = circuits[top_idx]
    diagram = str(top_circuit.draw(output="text", fold=80))

    # Optional: verify the exact kernel value for the single most
    # informative pair (highest-risk vs. most-typical transaction) via a
    # swap test on real IBM Quantum hardware. Kept fully separate from the
    # riskScore/flagged decision above -- see the module docstring for why
    # that decision must stay deterministic.
    hardware_verification = None
    ibm_diagnostic = "not configured (IBM_QUANTUM_TOKEN/IBM_QUANTUM_INSTANCE unset)"
    if skip_hardware:
        ibm_diagnostic = "skipped (fast simulator-only response; hardware verification runs separately)"
    elif top_idx != typical_idx and is_ibm_configured():
        ibm_diagnostic = "configured, attempting hardware run..."
        swap_qc = build_swap_test_circuit(circuits[top_idx], circuits[typical_idx])
        ibm_result = run_on_ibm_hardware(swap_qc, 2048)
        if ibm_result:
            counts, backend_name = ibm_result
            zero_count = sum(c for bitstring, c in counts.items() if bitstring.replace(' ', '') == '0')
            total = sum(counts.values()) or 1
            measured_fidelity = max(0.0, min(1.0, 2 * (zero_count / total) - 1))
            hardware_verification = {
                "backend": backend_name,
                "shots": total,
                "pair": {"a": transactions[top_idx].get("id"), "b": transactions[typical_idx].get("id")},
                "exactFidelity": round(kernel[top_idx][typical_idx], 4),
                "measuredFidelity": round(measured_fidelity, 4),
            }
            ibm_diagnostic = f"succeeded on {backend_name}"
        else:
            ibm_diagnostic = f"configured but failed: {LAST_IBM_ERROR['message'] or 'unknown error'}"

    return {
        "backend": "qiskit-statevector-kernel",
        "qubits": len(FEATURES),
        "featureNames": FEATURES,
        "transactionCount": n,
        "flaggedCount": sum(1 for t in out if t["flagged"]),
        "circuitDepth": top_circuit.depth(),
        "circuitDiagram": diagram,
        "transactions": out,
        "hardwareVerification": hardware_verification,
        "ibmDiagnostic": ibm_diagnostic,
    }


def main():
    raw = sys.stdin.read() or "{}"
    payload = json.loads(raw)
    transactions = payload.get("transactions", [])[:MAX_TRANSACTIONS]
    skip_hardware = bool(payload.get("skipHardware"))
    result = detect(transactions, skip_hardware)
    print(json.dumps(result if result is not None else {
        "backend": "qiskit-statevector-kernel", "qubits": len(FEATURES),
        "featureNames": FEATURES, "transactionCount": len(transactions),
        "flaggedCount": 0, "circuitDepth": 0, "circuitDiagram": "", "transactions": [],
        "hardwareVerification": None, "ibmDiagnostic": None,
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 -- the Node side logs stderr and falls back
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
