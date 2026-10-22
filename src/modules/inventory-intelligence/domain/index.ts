/**
 * Public surface of the inventory-intelligence domain.
 *
 * Re-exported so the application layer imports one path and cannot reach into a
 * private module by accident. Everything here is pure: no I/O, no framework, no
 * provider client, no model.
 */

export * from "./types";
export { INVENTORY_THRESHOLDS, INVENTORY_THRESHOLD_LABELS_AR } from "./thresholds";
export {
  classifyStock,
  isHighQuantity,
  isNegativeQuantity,
  stockMetric,
  unknownStockMetric,
} from "./stock";
export { DEMAND_UNAVAILABLE_REASON, daysOfStockFrom, resolveDemand } from "./demand";
export { riskFromDaysOfStock } from "./stockout";
export { evaluateExcess, EXCESS_UNAVAILABLE_REASON } from "./excess";
export { computeReorder, resolveReorder, REORDER_MISSING_INPUTS } from "./reorder";
export {
  INVENTORY_ISSUE_DEFINITIONS,
  INVENTORY_ISSUE_IDS,
  detectIssues,
  highestSeverity,
  summariseIssues,
  type InventoryIssueId,
} from "./issues";
export { analyseInventoryProduct } from "./products";
export {
  buildConfidence,
  buildCoverage,
  buildHealthScore,
  buildInventoryReport,
  buildOverview,
  type InventoryReport,
} from "./catalog";
export { buildCategoryInventoryHealth, type CategoryInventoryHealth } from "./categories";
export { buildRecommendations } from "./recommendations";
