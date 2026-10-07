import { test, expect } from "@playwright/test";
import { fanOutCaptions } from "../lib/content/captions";
import { getImageProvider } from "../lib/providers/image";
import { getVideoProvider } from "../lib/providers/video";

test("creative routing and four-platform caption fan-out stay constraint-safe end to end", () => {
  const image = getImageProvider("batch-ab", { constraints: { brand_strict: true, quality_min: "high" } });
  const video = getVideoProvider("batch-hooks", { constraints: { brand_strict: true, budget_cap_usd: 0.01 } });
  const variants = fanOutCaptions("Construímos o loop com receipts e revisão humana. ☀️", [
    "instagram", "tiktok", "linkedin", "x", "instagram",
  ]);

  expect(image.name).toBe("gpt-image");
  expect(video.name).toBe("simplicio-video");
  expect(variants.map(({ platform }) => platform)).toEqual(["instagram", "tiktok", "linkedin", "x"]);
  expect(variants.every(({ text, cta }) => text.endsWith(cta))).toBe(true);
});
