Quantum Parameters feature (dos/fuzz/intrusive)

This patch adds:
- DB migration: db/migrations/20260906_add_quantum_params.sql
- Server service: server/services/quantumParamsService.js
- Feature list: server/lib/features.js
- Runtime guard: server/lib/featureGuard.js
- API route: server/routes/quantumParams.js
- Frontend page (React): frontend/src/pages/QuantumParameters.jsx

Integration steps (manual):
1) Run the SQL migration in your DB (psql/knex/db-migrate) to create the tables.
2) Adapt server/services/quantumParamsService.js to your DB client (import path `../db`).
3) Mount the API route in your Express app (e.g. in server/index.js or routes/index.js):

   const quantumParamsRouter = require('./routes/quantumParams');
   app.use('/api/quantum-params', quantumParamsRouter);

   Ensure `requireAdmin` middleware exists and is used to protect the routes. Replace the import if your project has a different auth middleware.

4) Protect runtime usages: in any worker or analysis runner that performs DOS/FUZZ/INTRUSIVE operations, call the guard before executing:

   const { ensureFeatureEnabled } = require('./lib/featureGuard');
   const { FEATURES } = require('./lib/features');
   await ensureFeatureEnabled(FEATURES.FUZZ);

   If the guard throws, abort the job gracefully and surface a clear error to the user.

5) Add the frontend page to your admin/ops UI and ensure API requests include credentials / CSRF tokens as required.

6) Tests: add unit tests around the service and guard. Consider end-to-end tests that simulate toggling and job execution.

Notes / Security:
- The migration and services are intentionally minimal; adapt to your project's DB and error handling conventions.
- The API enforces a maximum expiry (24 hours) but adjust as needed.
- Ensure only authorized users can toggle these settings.

If you'd like, I can open a PR from this branch or expand integration to automatically register the route if you point me to the entry file (e.g. server/index.js).