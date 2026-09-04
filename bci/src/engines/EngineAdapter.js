// The contract every engine adapter implements. Not an enforced base class
// (duck typing keeps adapters simple) -- registry.js validates that a
// registered object has these shape at minimum. Today's engine can be
// swapped for tomorrow's without touching BCI Core: nothing outside an
// adapter module knows what binary it runs or how it parses that binary's
// output.
//
//   {
//     id: string,                     // stable engine id, e.g. 'trivy'
//     name: string,                   // display name
//     license: string,                // SPDX id or short description
//     intrusiveness: 'PASSIVE' | 'SAFE_ACTIVE' | 'AUTHENTICATED' | 'RESTRICTED',
//     supportedTargetTypes: string[], // e.g. ['REPOSITORY', 'CONTAINER']
//     supportedAnalysisTypes: string[],
//
//     async healthCheck(): { status: 'HEALTHY'|'DEGRADED'|'OFFLINE', version?: string, detail?: string }
//       -- must never throw; an unavailable binary is OFFLINE, not a crash.
//
//     async execute({ target, workDir, timeoutMs }): { raw: unknown }
//       -- runs the underlying tool via execFile (argv array, never a shell
//          string) and returns its raw, engine-native output untouched.
//          Turning that into BCI's common Observation schema is
//          Normalization's job (M6), not the adapter's.
//   }
export const INTRUSIVENESS_LEVELS = ['PASSIVE', 'SAFE_ACTIVE', 'AUTHENTICATED', 'RESTRICTED'];

export function assertValidAdapter(adapter) {
  const required = ['id', 'name', 'license', 'intrusiveness', 'supportedTargetTypes', 'supportedAnalysisTypes', 'healthCheck', 'execute'];
  const missing = required.filter((key) => adapter[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`Invalid engine adapter "${adapter.id ?? '?'}": missing ${missing.join(', ')}`);
  }
  if (!INTRUSIVENESS_LEVELS.includes(adapter.intrusiveness)) {
    throw new Error(`Invalid engine adapter "${adapter.id}": bad intrusiveness "${adapter.intrusiveness}"`);
  }
}
