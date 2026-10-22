import { appDatabaseUrl } from "@/test/db/config";

/**
 * Runs before every integration test file: points the application at the test
 * database and supplies deterministic test-only secrets.
 */
Object.assign(process.env, { NODE_ENV: "test" });
process.env.DATABASE_URL = appDatabaseUrl();
process.env.AUTH_SECRET = "integration-test-auth-secret-value-32b";
process.env.APP_URL = "http://localhost:3000";
process.env.LOG_LEVEL = "silent";
// Test-only encryption key. Tokens stored during tests are therefore decryptable
// only with this key and never with a production secret.
process.env.ENCRYPTION_KEY = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
// Simulator-only webhook signing secret. Real deployments set their own; the
// value never leaves the test process.
process.env.SALLA_WEBHOOK_SECRET = "integration-test-webhook-secret-value";
