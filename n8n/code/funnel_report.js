// n8n Code node: "Funnel report"  (runs once, after Stage 3)
// Gathers how many user-product pairs survived each stage. This is the evidence for the
// optimisation: naive pairs vs pairs actually kept. No LLM runs in this workflow.
const first = (n) => $(n).first().json;
const num = (v) => Number(v) || 0;

const collect = first('Collect canonical product ids');
const s1 = first('Stage 1: SQL envelope pre-filter');
const s3 = first('Stage 3: rank and keep top lenders');

const users = num(s1.users_in_batch);
const stats = {
  users_in_batch: users,
  products_fresh: collect.products_fresh,
  products_after_reconcile: collect.products_canonical,
  lenders_merged_groups: collect.merged_groups,
  pairs_naive: users * collect.products_fresh,
  pairs_after_reconcile: users * collect.products_canonical,
  pairs_after_stage1_envelope: num(s1.stage1_pairs),
  pairs_after_stage2_exact_rules: num(s3.stage2_pairs),
  users_with_a_qualifying_lender: num(s3.users_with_a_match),
  top_n_per_user: __TOP_N__,
  matches_written: num(s3.matches_written),
  users_matched: num(s3.users_matched),
  llm_calls_in_this_workflow: 0,
  finished_at: new Date().toISOString(),
};
return [{ json: { batch_id: collect.batch_id, stats, stats_json: JSON.stringify(stats) } }];
