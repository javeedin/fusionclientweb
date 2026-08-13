-- =============================================================================
-- 01_FA_BULK_ORDS_HANDLERS.SQL
--
-- Registers the ORDS module + one POST handler per procedure in RR_FA_BULK_PKG.
--
-- Module  : reerp   (already defined by GL handlers — skip if exists)
-- Base URL: reerp/fa/<entity>
--
-- All handlers follow the same pattern:
--   1. Call the package procedure with :body_text (CLOB)
--   2. Return 200 + success JSON on commit
--   3. Return 500 + error JSON on exception
--
-- Endpoints created:
--   POST  reerp/fa/additions                (1)
--   POST  reerp/fa/additions-tl             (2)
--   POST  reerp/fa/asset-history            (3)
--   POST  reerp/fa/books                    (4)
--   POST  reerp/fa/deprn-summary            (5)
--   POST  reerp/fa/deprn-periods            (6)
--   POST  reerp/fa/deprn-detail             (7)
--   POST  reerp/fa/distribution-history     (8)
--   POST  reerp/fa/retirements              (9)
--   POST  reerp/fa/transaction-headers      (10)
--   POST  reerp/fa/adjustments              (11)
--   POST  reerp/fa/asset-invoices           (12)
--   POST  reerp/fa/locations                (13)
--   POST  reerp/fa/methods                  (14)
--   POST  reerp/fa/calendar-periods         (15)
--   POST  reerp/fa/convention-types         (16)
--   POST  reerp/fa/categories-b             (17)
--   POST  reerp/fa/categories-tl            (18)
--   POST  reerp/fa/category-books           (19)
--   POST  reerp/fa/book-controls            (20)
--   POST  reerp/fa/books-summary            (21)
-- =============================================================================


-- =============================================================================
-- MODULE: reerp  (skip creation if it already exists from GL setup)
-- =============================================================================
BEGIN
    ORDS.DEFINE_MODULE(
        p_module_name    => 'reerp',
        p_base_path      => '/reerp/',
        p_items_per_page => 0,
        p_status         => 'PUBLISHED',
        p_comments       => 'ReactERP REST APIs'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN NULL;   -- module already exists, continue
END;
/


-- =============================================================================
-- HELPER MACRO (used inline in each handler's source):
--
--   DECLARE
--       v_rows PLS_INTEGER;
--   BEGIN
--       RR_FA_BULK_PKG.<PROC>(:body_text);
--       :status := 200;
--       HTP.P('{"success":true,"message":"<n> rows inserted"}');
--   EXCEPTION
--       WHEN OTHERS THEN
--           :status := 500;
--           HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
--   END;
-- =============================================================================


-- ============================================================
-- 1. POST reerp/fa/additions  →  INSERT_ADDITIONS
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/additions',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_ADDITIONS'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/additions',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_ADDITIONS(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA additions inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 2. POST reerp/fa/additions-tl  →  INSERT_ADDITIONS_TL
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/additions-tl',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_ADDITIONS_TL'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/additions-tl',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_ADDITIONS_TL(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA additions TL inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 3. POST reerp/fa/asset-history  →  INSERT_ASSET_HISTORY
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/asset-history',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_ASSET_HISTORY'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/asset-history',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_ASSET_HISTORY(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA asset history inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 4. POST reerp/fa/books  →  INSERT_BOOKS
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/books',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_BOOKS'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/books',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_BOOKS(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA books inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 5. POST reerp/fa/deprn-summary  →  INSERT_DEPRN_SUMMARY
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/deprn-summary',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_DEPRN_SUMMARY'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/deprn-summary',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_DEPRN_SUMMARY(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA depreciation summary inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 6. POST reerp/fa/deprn-periods  →  INSERT_DEPRN_PERIODS
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/deprn-periods',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_DEPRN_PERIODS'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/deprn-periods',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_DEPRN_PERIODS(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA depreciation periods inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 7. POST reerp/fa/deprn-detail  →  INSERT_DEPRN_DETAIL
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/deprn-detail',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_DEPRN_DETAIL'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/deprn-detail',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_DEPRN_DETAIL(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA depreciation detail inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 8. POST reerp/fa/distribution-history  →  INSERT_DISTRIBUTION_HIST
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/distribution-history',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_DISTRIBUTION_HISTORY'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/distribution-history',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_DISTRIBUTION_HIST(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA distribution history inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 9. POST reerp/fa/retirements  →  INSERT_RETIREMENTS
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/retirements',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_RETIREMENTS'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/retirements',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_RETIREMENTS(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA retirements inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 10. POST reerp/fa/transaction-headers  →  INSERT_TRANSACTION_HEADERS
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/transaction-headers',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_TRANSACTION_HEADERS'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/transaction-headers',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_TRANSACTION_HEADERS(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA transaction headers inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 11. POST reerp/fa/adjustments  →  INSERT_ADJUSTMENTS
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/adjustments',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_ADJUSTMENTS'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/adjustments',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_ADJUSTMENTS(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA adjustments inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 12. POST reerp/fa/asset-invoices  →  INSERT_ASSET_INVOICES
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/asset-invoices',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_ASSET_INVOICES'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/asset-invoices',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_ASSET_INVOICES(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA asset invoices inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 13. POST reerp/fa/locations  →  INSERT_LOCATIONS
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/locations',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_LOCATIONS'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/locations',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_LOCATIONS(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA locations inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 14. POST reerp/fa/methods  →  INSERT_METHODS
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/methods',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_METHODS'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/methods',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_METHODS(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA methods inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 15. POST reerp/fa/calendar-periods  →  INSERT_CALENDAR_PERIODS
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/calendar-periods',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_CALENDAR_PERIODS'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/calendar-periods',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_CALENDAR_PERIODS(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA calendar periods inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 16. POST reerp/fa/convention-types  →  INSERT_CONVENTION_TYPES
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/convention-types',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_CONVENTION_TYPES'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/convention-types',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_CONVENTION_TYPES(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA convention types inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 17. POST reerp/fa/categories-b  →  INSERT_CATEGORIES_B
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/categories-b',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_CATEGORIES_B'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/categories-b',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_CATEGORIES_B(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA categories (base) inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 18. POST reerp/fa/categories-tl  →  INSERT_CATEGORIES_TL
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/categories-tl',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_CATEGORIES_TL'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/categories-tl',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_CATEGORIES_TL(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA categories (TL) inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 19. POST reerp/fa/category-books  →  INSERT_CATEGORY_BOOKS
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/category-books',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_CATEGORY_BOOKS'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/category-books',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_CATEGORY_BOOKS(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA category books inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 20. POST reerp/fa/book-controls  →  INSERT_BOOK_CONTROLS
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/book-controls',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_BOOK_CONTROLS'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/book-controls',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_BOOK_CONTROLS(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA book controls inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/


-- ============================================================
-- 21. POST reerp/fa/books-summary  →  INSERT_BOOKS_SUMMARY
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'fa/books-summary',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'FA: bulk-insert RR_FA_BOOKS_SUMMARY'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'fa/books-summary',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
            BEGIN
                RR_FA_BULK_PKG.INSERT_BOOKS_SUMMARY(:body_text);
                :status := 200;
                HTP.P('{"success":true,"message":"FA books summary inserted successfully"}');
            EXCEPTION
                WHEN OTHERS THEN
                    :status := 500;
                    HTP.P('{"success":false,"error":"' || REPLACE(SQLERRM,'"','\"') || '","errorCode":' || SQLCODE || '}');
            END;
        ]'
    );
    COMMIT;
END;
/
