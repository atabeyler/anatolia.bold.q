export function normalizeHttpFuzz(rawPayload) {
  const probes = Array.isArray(rawPayload?.raw) ? rawPayload.raw : [];
  return probes
    .filter((probe) => probe?.anomalous === true)
    .map((probe) => ({
      category: 'INPUT_ROBUSTNESS',
      capabilityId: 'FUZZ',
      ruleId: 'BCI-HTTP-FUZZ-5XX',
      title: 'Boundary input triggered a server error',
      description: 'A bounded BCI HTTP fuzz probe caused the target to return a 5xx response.',
      engineSeverity: 'MEDIUM',
      cveIds: [],
      cweIds: [],
      location: probe.parameter || 'query',
      evidence: {
        capability: 'FUZZ',
        parameter: probe.parameter,
        case: probe.case,
        httpStatus: probe.status,
      },
      references: [],
    }));
}
