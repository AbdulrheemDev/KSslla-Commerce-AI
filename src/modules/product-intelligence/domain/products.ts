import { evaluateCommercial } from "./commercial";
import { evaluateContent } from "./content";
import { evaluateImages } from "./images";
import { detectIssues, highestSeverity } from "./issues";
import { evaluateLifecycle } from "./lifecycle";
import { evaluateMetadata } from "./metadata";
import { evaluatePerformance } from "./performance";
import type { CatalogProductInput, ProductAnalysis } from "./types";

/**
 * One product, fully analysed.
 *
 * This is the only place the engines are composed, so a product's score, its
 * issue list, and its severity always come from the same evaluation of the same
 * row.
 *
 * `needsAttention` is true when the product's **highest** issue is high or
 * medium. A product whose only finding is `hidden_product` or
 * `hidden_category_link` (both low) is reported but does not join the work
 * queue: hiding a product can be a deliberate seasonal decision, and this phase
 * does not second-guess it.
 */
export function analyseProduct(input: CatalogProductInput, now: Date): ProductAnalysis {
  const content = evaluateContent(input);
  const metadata = evaluateMetadata(input);
  const images = evaluateImages(input);
  const lifecycle = evaluateLifecycle(input, now);
  const commercial = evaluateCommercial(input);
  const performance = evaluatePerformance(input);

  const issues = detectIssues({ product: input, content, metadata, images, lifecycle, commercial });
  const severity = highestSeverity(issues);

  return {
    id: input.id,
    name: input.name,
    sku: input.sku,
    status: input.status,
    categories: input.categories.map((category) => category.name),
    categoryRefs: input.categories,
    content,
    metadata,
    images,
    lifecycle,
    commercial,
    performance,
    issues,
    severity,
    needsAttention: severity === "high" || severity === "medium",
  };
}
