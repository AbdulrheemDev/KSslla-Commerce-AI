#!/usr/bin/env node
/**
 * Local webhook simulator (development only).
 *
 * Posts a signed Salla-shaped webhook to a running instance of this app, so the
 * endpoint can be exercised without a Salla account. It is a *simulator*: the
 * payloads are the documented envelope with fake merchant ids, and nothing here
 * contacts Salla.
 *
 * Usage:
 *   node scripts/simulate-webhook.mjs --scenario valid
 *   node scripts/simulate-webhook.mjs --scenario invalid-signature
 *   node scripts/simulate-webhook.mjs --scenario duplicate
 *   node scripts/simulate-webhook.mjs --scenario malformed
 *   node scripts/simulate-webhook.mjs --scenario unknown-event
 *   node scripts/simulate-webhook.mjs --scenario uninstalled
 *
 * Environment:
 *   APP_URL              target base URL (default http://127.0.0.1:4010)
 *   SALLA_WEBHOOK_SECRET the secret the target was started with
 *   SIMULATED_MERCHANT   merchant/store id (default 4011999001)
 */

import { createHmac } from "node:crypto";

const args = process.argv.slice(2);
const scenarioArg = args.indexOf("--scenario");
const scenario = scenarioArg >= 0 ? args[scenarioArg + 1] : "valid";

const baseUrl = process.env.APP_URL ?? "http://127.0.0.1:4010";
const secret = process.env.SALLA_WEBHOOK_SECRET ?? "";
const merchant = Number(process.env.SIMULATED_MERCHANT ?? "4011999001");

if (!secret) {
  console.error("SALLA_WEBHOOK_SECRET is not set; refusing to simulate.");
  process.exit(1);
}

const envelope = (event, data = { id: 1 }) =>
  JSON.stringify({
    event,
    merchant,
    created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    data,
  });

const scenarios = {
  valid: () => ({ body: envelope("product.created", { id: 9001 }), sign: true }),
  "invalid-signature": () => ({ body: envelope("product.created", { id: 9002 }), sign: false }),
  duplicate: () => ({ body: envelope("order.created", { id: 777001 }), sign: true, repeat: 2 }),
  malformed: () => ({ body: "{ this is not json", sign: true }),
  "unknown-event": () => ({ body: envelope("store.something.new", { id: 5 }), sign: true }),
  uninstalled: () => ({ body: envelope("app.uninstalled", { id: 12 }), sign: true }),
};

const build = scenarios[scenario];
if (!build) {
  console.error(`Unknown scenario "${scenario}". Known: ${Object.keys(scenarios).join(", ")}`);
  process.exit(1);
}

const plan = build();
const repeats = plan.repeat ?? 1;

function sign(body) {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

async function post(body, signed) {
  const headers = {
    "content-type": "application/json",
    "x-salla-security-strategy": "Signature",
    "x-salla-webhook-version": "2",
  };

  if (signed) headers["x-salla-signature"] = sign(body);
  else headers["x-salla-signature"] = sign(`${body} `); // deliberately wrong

  const response = await fetch(`${baseUrl}/api/webhooks/salla`, { method: "POST", headers, body });
  const text = await response.text();

  return `${response.status} ${text}`;
}

console.log(`[simulator] scenario=${scenario} merchant=${merchant} target=${baseUrl}`);

for (let attempt = 1; attempt <= repeats; attempt += 1) {
  console.log(`[simulator] delivery ${attempt}/${repeats}: ${await post(plan.body, plan.sign)}`);
}
