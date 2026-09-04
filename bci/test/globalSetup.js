export async function setup() {
  const { runMigrations } = await import('../src/db/migrate.js');
  const { pool } = await import('../src/db/client.js');
  await runMigrations();
  await pool.end();
}
