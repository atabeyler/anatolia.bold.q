const REQUIRED_IN_PRODUCTION = ['BCI_DATABASE_URL'];

export function validateEnv(env = process.env) {
  const errors = [];

  if (env.NODE_ENV === 'production') {
    for (const key of REQUIRED_IN_PRODUCTION) {
      if (!env[key]) {
        errors.push(`${key} is required in production`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`BCI configuration invalid:\n  - ${errors.join('\n  - ')}`);
  }
}
