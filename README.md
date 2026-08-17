# ANATOLIA-Q

![Version](https://img.shields.io/badge/version-2.1.190-blue) ![License](https://img.shields.io/badge/license-Proprietary-lightgrey)

**Quantum-Based National Decision Support System**  
Bold Askeri Teknoloji ve Savunma Sanayi A.Ş.

ANATOLIA-Q generates structured decision-support reports across 10 domains, combining a multi-provider AI layer with deterministic quantum analysis and optional real IBM Quantum hardware verification. The platform is designed so users receive one clear decision-support result while provenance, auditability, verification, and institutional integration remain managed by the system.

---

## Research Context

This project sits at the intersection of applied AI and near-term quantum computing.

- **AI layer:** Claude (Anthropic) → Gemini → GPT-4o automatic fallback for report generation and consultation workflows.
- **Quantum layer:** scenario probability analysis, QAOA-based resource allocation, and quantum-kernel fraud/AML anomaly detection.
- **Deterministic decision path:** reported decisions come from the deterministic local computation path. Real IBM Quantum hardware, when configured, is used as an independent verification lane so NISQ hardware noise cannot alter the authoritative result.
- **Live IBM Quantum validation:** authentication, Qiskit Runtime service connection, real-backend selection, transpilation, hardware job submission, and result retrieval have been exercised against a real IBM Quantum Platform account through the production integration path.
- **Institutional integration:** the current deployment is not connected to any live bank, telecom, or government system. The data-source layer is intentionally pluggable: authorized institutional APIs, core-banking feeds, BDDK/BTK exports, or other structured sources can be normalized into the existing analysis pipeline without redesigning the core system.

## Research Benchmark

The Elliptic benchmark in this repository is a research harness for graph-aware AML experiments, not a production bank validation workflow.

- **Dataset:** official Elliptic Bitcoin transaction features, labels, and transaction-edge list.
- **Temporal protocol:** train `1-29`, validation `30-39`, development `40-44`, holdout `45-49`.
- **Leakage policy:** the final holdout is never used for fit, orientation, thresholding, gate selection, or model selection. Graph features are built from historical structure only, with known labels restricted to train rows.
- **Metrics:** TP, TN, FP, FN, recall, precision, specificity, FPR, F1, balanced accuracy, MCC, PR-AUC, and ROC-AUC are reported per split when available.
- **Interpretation:** these numbers measure benchmark behavior on a public dataset. They are useful for research and regression tracking, but they are not a statement about live banking performance.
