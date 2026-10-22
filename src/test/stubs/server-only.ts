/**
 * Test-only stand-in for the `server-only` package.
 *
 * Next.js resolves `server-only` to a module that throws when imported from a
 * client component. Vitest runs outside the React Server Component graph, so
 * the alias in vitest.config.ts points to this empty module.
 */
export {};
