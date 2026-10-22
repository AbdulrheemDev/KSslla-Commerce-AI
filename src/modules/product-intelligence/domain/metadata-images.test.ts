import { describe, expect, it } from "vitest";

import { evaluateImages } from "@/modules/product-intelligence/domain/images";
import { evaluateMetadata } from "@/modules/product-intelligence/domain/metadata";
import { PRODUCT_THRESHOLDS } from "@/modules/product-intelligence/domain/thresholds";
import { catalogProduct } from "@/test/product-intelligence-fixtures";

describe("evaluateMetadata", () => {
  it("awards 50 for each documented metadata field", () => {
    const weights = PRODUCT_THRESHOLDS.METADATA_WEIGHT;

    expect(evaluateMetadata(catalogProduct()).score.value).toBe(100);
    expect(evaluateMetadata(catalogProduct({ metadataTitle: null })).score.value).toBe(
      100 - weights.title,
    );
    expect(evaluateMetadata(catalogProduct({ metadataDescription: "   " })).score.value).toBe(
      100 - weights.description,
    );
    expect(
      evaluateMetadata(catalogProduct({ metadataTitle: null, metadataDescription: null })).score
        .value,
    ).toBe(0);
  });

  it("marks the score partial when the metadata object was never stored", () => {
    const result = evaluateMetadata(catalogProduct({ metadataStored: false }));

    expect(result.stored).toBe(false);
    expect(result.score.availability).toBe("partial");
    expect(result.score.reason).toBe("metadata_not_captured");
  });

  it("keeps the score available when the object was stored but the fields are empty", () => {
    const result = evaluateMetadata(
      catalogProduct({ metadataStored: true, metadataTitle: null, metadataDescription: null }),
    );

    expect(result.score.availability).toBe("available");
    expect(result.titlePresent).toBe(false);
    expect(result.descriptionPresent).toBe(false);
  });
});

describe("evaluateImages", () => {
  it("reports a present image when the stored URL is http(s)", () => {
    const result = evaluateImages(catalogProduct());

    expect(result.status).toBe("present");
    expect(result.urlValid).toBe(true);
  });

  it("reports a missing image when nothing is stored", () => {
    const result = evaluateImages(catalogProduct({ imageUrl: null }));

    expect(result.status).toBe("missing");
    expect(result.urlValid).toBeNull();
  });

  it("reports an invalid URL without trying to fetch it", () => {
    expect(evaluateImages(catalogProduct({ imageUrl: "not a url" })).status).toBe("invalid");
    expect(evaluateImages(catalogProduct({ imageUrl: "   " })).status).toBe("missing");
  });

  it("never claims an image count or alt text", () => {
    const result = evaluateImages(catalogProduct());

    expect(result.count.availability).toBe("unavailable");
    expect(result.count.reason).toBe("images_not_mirrored");
    expect(result.altText.availability).toBe("unavailable");
    expect(result.altText.reason).toBe("image_alt_not_mirrored");
  });
});
