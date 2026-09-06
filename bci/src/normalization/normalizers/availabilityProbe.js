export function normalizeAvailabilityProbe(rawPayload) {
  return (Array.isArray(rawPayload?.raw) ? rawPayload.raw : []).filter((p) => p?.anomalous).map((p) => ({
    category: 'AVAILABILITY_RESILIENCE', capabilityId: 'DOS', ruleId: 'BCI-AVAILABILITY-DEGRADATION', title: 'Availability degradation observed',
    description: 'A bounded availability sample observed an error or excessive response latency.', engineSeverity: 'MEDIUM',
    cveIds: [], cweIds: [], location: 'HTTP service',
    evidence: { capability: 'DOS', sample: p.sample, httpStatus: p.status, latencyMs: p.latencyMs, error: p.error || null }, references: [],
  }));
}
