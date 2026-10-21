/**
 * Connection settings for the integration test database.
 *
 * Locally an embedded PostgreSQL cluster is started on a fixed port; in CI the
 * `TEST_DATABASE_URL` of the service container is used instead. Tests connect
 * as an unprivileged role so row-level security is actually enforced (the
 * migration owner would otherwise bypass it).
 */

export const TEST_DATABASE = {
  host: "127.0.0.1",
  port: 55432,
  adminUser: "postgres",
  adminPassword: "postgres",
  appUser: "ksh_app",
  appPassword: "ksh_app_test_password",
  name: "kshakha_test",
  dataDir: ".pgdata-test",
} as const;

export function usingExternalDatabase(): boolean {
  return Boolean(process.env.TEST_DATABASE_URL);
}

/** Superuser connection used only to create the database, role, and grants. */
export function adminDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ??
    `postgresql://${TEST_DATABASE.adminUser}:${TEST_DATABASE.adminPassword}@${TEST_DATABASE.host}:${TEST_DATABASE.port}/postgres`
  );
}

/** Connection string the application code and tests actually use. */
export function appDatabaseUrl(): string {
  const url = new URL(adminDatabaseUrl());
  url.username = TEST_DATABASE.appUser;
  url.password = TEST_DATABASE.appPassword;
  url.pathname = `/${TEST_DATABASE.name}`;
  return url.toString();
}
