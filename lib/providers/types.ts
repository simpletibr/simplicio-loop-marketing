export type LLMTask =
  | "orchestration"
  | "code"
  | "caption"
  | "script"
  | "compliance"
  | "translation"
  | "humanization";

export type ImageTask =
  | "quote-card"
  | "ugc-ad"
  | "cinematic"
  | "carousel"
  | "batch-ab"
  | "inpaint"
  | "face-swap"
  | "before-after";

export type VideoTask =
  | "cinematic-reel"
  | "motion-control"
  | "ugc-product"
  | "product-demo"
  | "talking-head"
  | "batch-hooks"
  | "motion-typography"
  | "data-viz-reel"
  | "programmatic-short";

export interface GenerationResult<T = string> {
  ok: boolean;
  provider: string;
  task: string;
  output?: T;
  error?: string;
  tokens?: number;
  tokens_in?: number;
  tokens_out?: number;
  used_estimate?: boolean;
  source?: "provider" | "tokenizer" | "unavailable";
  encoding?: string;
  prompt_format?: "toon" | "json";
  savings_tokens_est?: number;
  cache_status?: "hit" | "enabled" | "not_requested" | "unsupported";
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  fallback_reason?: string;
  cost_usd?: number;
  latency_ms?: number;
  attempt?: number;
  /** Set by providers that return a render manifest with the output hash. */
  render_manifest_path?: string;
  output_sha256?: string;
}

export interface ProviderConstraint {
  brand_strict?: boolean;
  budget_cap_usd?: number;
  max_latency_ms?: number;
  quality_min?: "low" | "medium" | "high";
}
