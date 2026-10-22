import { unavailable } from "@/modules/intelligence/domain/types";

import { isBlank, isHttpUrl } from "./text";
import type { CatalogProductInput, ImageEvaluation } from "./types";

/**
 * Product image health, limited to what the mirror actually holds.
 *
 * `products.image_url` is mapped from the provider `main_image`, falling back to
 * `thumbnail` (Phase 04). The provider also returns an `images[]` array with
 * `alt` text (docs/salla-reference.md §17.1), but Phase 04 never mirrored it — so
 * image **count**, **alt text**, "default image", and duplicate detection are
 * reported as `unavailable` with a reason instead of being guessed from a list
 * we do not have.
 *
 * Nothing here downloads, rewrites, or scores an image. Validity is a URL-shape
 * check only: no request leaves the server.
 */

export function evaluateImages(product: CatalogProductInput): ImageEvaluation {
  const imageUrl = isBlank(product.imageUrl) ? null : product.imageUrl;
  const urlValid = imageUrl === null ? null : isHttpUrl(imageUrl);

  const status = imageUrl === null ? "missing" : urlValid ? "present" : "invalid";

  return {
    status,
    count: unavailable("images_not_mirrored"),
    altText: unavailable("image_alt_not_mirrored"),
    urlValid,
  };
}
