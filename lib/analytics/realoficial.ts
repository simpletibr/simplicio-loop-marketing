import type { RoToolTransport } from "../realoficial/transport";
import { pick, type Metric, type PostMetrics } from "./post-metrics";

const FIELDS: Metric[] = ["views", "likes", "comments", "shares", "saves"];

/**
 * What Real Oficial shows for one published post (`ro_get_social_analytics`,
 * report `post`), read-only. This is the first source to try: it needs no
 * token from the client. The field names are the ones the fixtures use and
 * are to be calibrated against a live answer.
 */
export async function fetchRealOficialPost(transport: RoToolTransport, socialPostId: string): Promise<PostMetrics> {
  const answer = await transport.call("ro_get_social_analytics", { report: "post", social_post_id: socialPostId });
  const metrics = answer.metrics && typeof answer.metrics === "object" ? (answer.metrics as Record<string, unknown>) : {};
  const m: PostMetrics = {};
  for (const f of FIELDS) pick(m, f, metrics[f]);
  return m;
}
