"""ANATOLIA-Q 13-qubit behavioral fraud/AML kernel experiment.
Keeps production fraud_detection.py untouched while validating the expanded feature map.
"""
import sys, json, math
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector

FEATURES = [
    "amount", "hour", "frequency", "newCounterparty", "crossBorder",
    "txCount10m", "txCount1h", "amountSum1h", "amountSum24h",
    "timeSinceLastTx", "newCounterpartyCount24h", "uniqueCounterparty7d",
    "amountDeviation",
]
MAX_INPUT_TRANSACTIONS = 3000
THRESHOLD_K = 1.07


def normalize(transactions):
    stats=[]
    for f in FEATURES:
        vals=[float(t.get(f) or 0) for t in transactions]
        mean=sum(vals)/len(vals)
        std=math.sqrt(sum((v-mean)**2 for v in vals)/len(vals)) or 1.0
        stats.append((mean,std))
    return [[math.tanh(((float(t.get(f) or 0)-stats[i][0])/stats[i][1])/2.0)
             for i,f in enumerate(FEATURES)] for t in transactions]


def feature_map(x):
    qc=QuantumCircuit(len(x))
    for i,v in enumerate(x):
        qc.ry((v+1.0)*0.5*math.pi,i)
    for i in range(len(x)-1):
        qc.cx(i,i+1)
        qc.ry(x[i]*x[i+1]*0.5,i+1)
        qc.cx(i,i+1)
    return qc


def classical(rows):
    n=len(rows); d=len(rows[0])
    centroid=[sum(r[j] for r in rows)/n for j in range(d)]
    dist=[math.sqrt(sum((r[j]-centroid[j])**2 for j in range(d))) for r in rows]
    mean=sum(dist)/n; std=math.sqrt(sum((x-mean)**2 for x in dist)/n); threshold=mean+std
    lo,hi=min(dist),max(dist); span=(hi-lo) or 1.0
    return [round((x-lo)/span*100,1) for x in dist],[bool(x>threshold) for x in dist]


def detect(transactions):
    transactions=transactions[:MAX_INPUT_TRANSACTIONS]
    n=len(transactions)
    if n<3:
        return {"backend":"qiskit-statevector-kernel-13q","qubits":13,"featureNames":FEATURES,"thresholdK":THRESHOLD_K,"transactionCount":n,"flaggedCount":0,"transactions":[]}
    rows=normalize(transactions)
    circuits=[feature_map(r) for r in rows]
    states=[Statevector.from_instruction(qc) for qc in circuits]
    # Each unordered pair is evaluated once. We only need row sums, not an n*n matrix.
    similarity_sums=[0.0]*n
    for i in range(n):
        si=states[i]
        for j in range(i+1,n):
            fid=float(abs(si.inner(states[j]))**2)
            similarity_sums[i]+=fid
            similarity_sums[j]+=fid
    raw=[1.0-(similarity_sums[i]/(n-1)) for i in range(n)]
    mean=sum(raw)/n; std=math.sqrt(sum((x-mean)**2 for x in raw)/n)
    threshold=mean+THRESHOLD_K*std
    lo,hi=min(raw),max(raw); span=(hi-lo) or 1.0
    risks=[round((x-lo)/span*100,1) for x in raw]
    cs,cf=classical(rows)
    out=[]
    for i,t in enumerate(transactions):
        row={k:t.get(k) for k in ["id",*FEATURES]}
        row.update({"riskScore":risks[i],"flagged":bool(raw[i]>threshold),"classicalScore":cs[i],"classicalFlagged":cf[i]})
        out.append(row)
    out.sort(key=lambda x:-x["riskScore"])
    agreement=sum(1 for t in out if t["flagged"]==t["classicalFlagged"])
    return {
        "backend":"qiskit-statevector-kernel-13q",
        "qubits":len(FEATURES),
        "featureNames":FEATURES,
        "thresholdK":THRESHOLD_K,
        "transactionCount":n,
        "flaggedCount":sum(1 for t in out if t["flagged"]),
        "circuitDepth":circuits[0].depth(),
        "transactions":out,
        "classicalBenchmark":{"flaggedCount":sum(1 for t in out if t["classicalFlagged"]),"agreementCount":agreement,"agreementPercent":round(agreement/n*100,1)},
        "optimizedPairCount":n*(n-1)//2,
    }


def main():
    payload=json.loads(sys.stdin.read() or "{}")
    print(json.dumps(detect(payload.get("transactions",[]))))

if __name__=="__main__":
    try: main()
    except Exception as exc:
        print(json.dumps({"error":str(exc)}),file=sys.stderr); sys.exit(1)
