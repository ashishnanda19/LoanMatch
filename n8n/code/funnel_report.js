// n8n Code node: "Funnel report"  (runs once, after Stage 4)
// Gathers how many user-product pairs survived each stage. This is the evidence for the
// optimisation: naive pairs vs how many reached an LLM.
const first = (n) => $(n).first().json;
const num = (v) => Number(v) || 0;

const collect = first('Collect canonical product ids');
const s1 = first('Stage 1: SQL envelope pre-filter');
let s3 = { llm_review_calls: 0, reviewed_by_groq: 0, reviewed_by_gemini: 0, review_failed: 0, reviews_saved: 0 };
try { s3 = first('Stage 3 summary'); } catch (e) { /* branch not executed: nothing needed review */ }
const s4 = first('Stage 4: write matches');

const users = num(s1.users_in_batch);
const stats = {
  users_in_batch: users,
  products_fresh: collect.products_fresh,
  products_after_reconcile: collect.products_canonical,
  lenders_merged_groups: collect.merged_groups,
  pairs_naive: users * collect.products_fresh,
  pairs_after_reconcile: users * collect.products_canonical,
  pairs_after_stage1_envelope: num(s1.stage1_pairs),
  pairs_after_stage2_exact_rules: num(s4.stage2_pairs),
  llm_segments_total: num(s4.segments_total),
  llm_review_calls: num(s3.llm_review_calls),
  llm_cached_segments: Math.max(num(s4.segments_total) - num(s3.llm_review_calls), 0),
  llm_by_groq: num(s3.reviewed_by_groq),
  llm_by_gemini: num(s3.reviewed_by_gemini),
  llm_failed: num(s3.review_failed),
  pairs_dropped_by_llm: num(s4.dropped_by_llm),
  matches_written: num(s4.matches_written),
  finished_at: new Date().toISOString(),
};
return [{ json: { batch_id: collect.batch_id, stats, stats_json: JSON.stringify(stats) } }];
