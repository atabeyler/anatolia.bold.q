// raw_observations.engine_id has a real FK into engine_registry -- the
// production system always has real rows there (the API/worker calls
// runHealthChecks() on startup and periodically), but a from-scratch test
// database starts with an EMPTY engine_registry. Several tests that
// exercise the real pipeline (storeRawObservation -> raw_observations)
// never explicitly seed the engines they use, and relied entirely on
// resetDatabase() never truncating engine_registry -- so once ANY earlier
// test in the same run happened to populate it, it silently stayed
// populated for the rest of that run. That's fragile: it depends on file
// execution order, and a from-scratch CI database (no prior test-run
// history) exposed it as a real FK-violation failure the very first time
// this suite ran against a genuinely fresh database. Seeding all five
// engines here, once, up front, makes the guarantee explicit and
// order-independent instead of accidental.
const KNOWN_ENGINES = [
  { id: 'trivy', intrusiveness: 'PASSIVE', license: 'Apache-2.0' },
  { id: 'osv-scanner', intrusiveness: 'PASSIVE', license: 'Apache-2.0' },
  { id: 'semgrep', intrusiveness: 'PASSIVE', license: 'LGPL-2.1' },
  { id: 'nuclei', intrusiveness: 'SAFE_ACTIVE', license: 'MIT' },
  { id: 'naabu', intrusiveness: 'SAFE_ACTIVE', license: 'MIT' },
];

export async function setup() {
  const { runMigrations } = await import('../src/db/migrate.js');
  const { query, pool } = await import('../src/db/client.js');
  await runMigrations();
  for (const engine of KNOWN_ENGINES) {
    await query(
      `INSERT INTO engine_registry (id, name, intrusiveness, license) VALUES ($1, $1, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [engine.id, engine.intrusiveness, engine.license]
    );
  }
  await pool.end();
}
