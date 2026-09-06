export function normalizeIntrusiveValidation(rawPayload) {
  return (Array.isArray(rawPayload?.raw) ? rawPayload.raw : []).filter((p) => p?.anomalous).map((p) => ({
    category: 'ACTIVE_VALIDATION', ruleId: 'BCI-ACTIVE-TRACE', title: 'HTTP TRACE method accepted',
    description: 'Advanced active validation observed the target accepting HTTP TRACE.', engineSeverity: 'LOW',
    cveIds: [], cweIds: [], location: 'HTTP method',
    evidence: { capability: 'INTRUSIVE', method: p.method, httpStatus: p.status }, references: [],
  }));
}
