-- ============================================================================
-- 161_fix_setup_ledgers_get.sql
-- Fix HTTP 555 on GET gl/setup/ledgers (Manage Business Units > Ledgers tab).
--
-- Root cause: the handler SQL from script 129 referenced a bind :search that
-- was never declared with ORDS.DEFINE_PARAMETER. The app calls the endpoint
-- with no ?search= query parameter (it filters client-side), so ORDS cannot
-- bind :search and the dispatcher fails with HTTP 555.
--
-- Fix: redefine the GET handler without any bind. DEFINE_HANDLER replaces the
-- existing handler in place; the template and the POST gl/ledgers/create are
-- untouched.
--
-- Run in APEX SQL Workshop -> SQL Scripts (single block).
-- ============================================================================

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name => 'reerp',
        p_pattern     => 'gl/setup/ledgers',
        p_method      => 'GET',
        p_source_type => 'json/collection',
        p_comments    => 'List ledgers (no binds; the app filters client-side)',
        p_source      => '
SELECT l.ledger_id                                   AS "ledgerId",
       l.ledger_name                                 AS "ledgerName",
       l.description                                 AS "description",
       l.ledger_category_code                        AS "ledgerCategoryCode",
       l.currency_code                               AS "currencyCode",
       l.created_by                                  AS "createdBy",
       TO_CHAR(l.creation_date, ''YYYY-MM-DD HH24:MI'') AS "creationDate"
FROM   rr_ledgers l
ORDER  BY l.ledger_name'
    );
    COMMIT;
END;
/

-- ── Verification ────────────────────────────────────────────────────────────
-- GET {base}/gl/setup/ledgers  → should now return {"items":[...]} with the
-- ledgers (BUIMERC LEDGER, EIDOS LEDGER, SB LEDGER, ...).
