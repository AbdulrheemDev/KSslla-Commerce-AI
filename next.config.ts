import type { NextConfig } from "next";

/**
 * Baseline security headers.
 *
 * A strict Content-Security-Policy is intentionally deferred: Next.js requires
 * nonce-aware middleware for inline runtime scripts. CSP is scheduled for
 * Phase 24 (Security hardening) and tracked in docs/roadmap.md.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Development previews are served from a proxied host; production builds are
  // unaffected by this list.
  allowedDevOrigins: ["*.e2b.app"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
