-- Only products crawled in the last 7 days: a lender that vanished from every site stops matching.
SELECT product_id, source_site, product_name, interest_rate, min_income, min_credit_score,
       min_age, max_age, allowed_employment_types, eligibility_rules, qualitative_criteria_text,
       raw_criteria_text, last_crawled_at
FROM loan_products
WHERE last_crawled_at > now() - interval '7 days'
ORDER BY product_id
