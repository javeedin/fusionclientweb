-- =============================================================================
-- AR Receipt Reversal (Oracle Receivables "standard reversal" pattern)
--
-- The original receipt and its accounting stay untouched (audit trail). Reversing:
--   1. the app reads the receipt's GL journal lines (REFERENCE2 = receipt id,
--      REFERENCE5 = 'AR_RECEIPTS'), swaps Dr/Cr and posts a NEW journal dated the
--      reversal date, tagged REFERENCE5 = 'AR_RECEIPTS_REVERSAL', REFERENCE2 = id
--   2. POST receipts/:id/reverse then stamps the receipt:
--        STATE = STATUS = 'Reversed', REVERSAL_DATE / _CATEGORY / _REASON / _COMMENTS
--      It refuses unless the reversal journal exists, so a receipt is never marked
--      Reversed without its accounting being reversed.
--
-- Eligibility (both endpoints): receipt exists, not already reversed, accounted,
-- no receipt applications (unapply the invoices first), not a Fusion-synced receipt.
--
--   GET  {base}/ar/receipts/:id/reverse-eligibility
--   POST {base}/ar/receipts/:id/reverse
--        body { reversalDate: 'YYYY-MM-DD', reversalCategory, reversalReason,
--               reversalComments, reversedBy }
--
-- Module: ar. Run in bcldifc (SQL Developer, F5). Both compile checks must return no rows.
-- =============================================================================

CREATE OR REPLACE PROCEDURE RR_AR_RECEIPT_REVERSE_CHECK (
    p_id            IN  NUMBER,
    o_found         OUT BOOLEAN,
    o_receipt_no    OUT VARCHAR2,
    o_state         OUT VARCHAR2,
    o_status        OUT VARCHAR2,
    o_acct_status   OUT VARCHAR2,
    o_sync_status   OUT VARCHAR2,
    o_amount        OUT NUMBER,
    o_currency      OUT VARCHAR2,
    o_business_unit OUT VARCHAR2,
    o_app_count     OUT NUMBER,
    o_gl_lines      OUT NUMBER,
    o_rev_lines     OUT NUMBER,
    o_reasons       OUT VARCHAR2      -- JSON array of blocking reasons ('[]' = eligible)
) AS
    l_first BOOLEAN := TRUE;
    PROCEDURE add_reason(p_code VARCHAR2, p_msg VARCHAR2) IS
    BEGIN
        o_reasons := o_reasons || CASE WHEN l_first THEN '' ELSE ',' END
                  || '{"code":"' || p_code || '","message":"' || REPLACE(p_msg, '"', '\"') || '"}';
        l_first := FALSE;
    END;
BEGIN
    o_reasons := '';
    BEGIN
        SELECT RECEIPT_NUMBER, STATE, STATUS, ACCOUNTING_STATUS, SYNC_STATUS,
               AMOUNT, CURRENCY, BUSINESS_UNIT
        INTO   o_receipt_no, o_state, o_status, o_acct_status, o_sync_status,
               o_amount, o_currency, o_business_unit
        FROM   RR_AR_RECEIPTS
        WHERE  STANDARD_RECEIPT_ID = p_id;
        o_found := TRUE;
    EXCEPTION WHEN NO_DATA_FOUND THEN
        o_found := FALSE;
        o_reasons := '[{"code":"NOT_FOUND","message":"Receipt not found"}]';
        RETURN;
    END;

    SELECT COUNT(*) INTO o_app_count
    FROM   RR_AR_RECEIPT_APPLICATIONS WHERE STANDARD_RECEIPT_ID = p_id;

    SELECT COUNT(*) INTO o_gl_lines
    FROM   RR_GL_JE_LINES_ALL WHERE REFERENCE2 = TO_CHAR(p_id) AND REFERENCE5 = 'AR_RECEIPTS';

    SELECT COUNT(*) INTO o_rev_lines
    FROM   RR_GL_JE_LINES_ALL WHERE REFERENCE2 = TO_CHAR(p_id) AND REFERENCE5 = 'AR_RECEIPTS_REVERSAL';

    IF UPPER(NVL(o_state, 'x')) = 'REVERSED' OR UPPER(NVL(o_status, 'x')) = 'REVERSED' THEN
        add_reason('ALREADY_REVERSED', 'This receipt is already reversed');
    END IF;
    IF UPPER(NVL(o_sync_status, 'NEW')) = 'FUSION SYNC' THEN
        add_reason('FUSION_RECEIPT', 'Fusion-synced receipt: reverse it in Oracle Fusion');
    END IF;
    IF UPPER(NVL(o_acct_status, 'x')) != 'ACCOUNTED' THEN
        add_reason('NOT_ACCOUNTED', 'Receipt is not accounted: delete it instead of reversing');
    END IF;
    IF o_app_count > 0 THEN
        add_reason('HAS_APPLICATIONS', o_app_count || ' invoice application(s): unapply them before reversing');
    END IF;
    IF UPPER(NVL(o_acct_status, 'x')) = 'ACCOUNTED' AND o_gl_lines = 0 THEN
        add_reason('NO_GL_JOURNAL', 'Accounted, but no GL journal found (REFERENCE2 = ' || p_id || ', REFERENCE5 = AR_RECEIPTS)');
    END IF;
    o_reasons := '[' || o_reasons || ']';
END;
/

SELECT line, position, text FROM user_errors WHERE name = 'RR_AR_RECEIPT_REVERSE_CHECK' ORDER BY sequence;

-- ── GET receipts/:id/reverse-eligibility ────────────────────────────────────
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'receipts/:id/reverse-eligibility');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'receipts/:id/reverse-eligibility',
        p_comments    => 'Can this receipt be reversed? (accounted, no applications, not reversed)'
    );
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'receipts/:id/reverse-eligibility',
        p_method         => 'GET',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_comments       => 'Eligibility checks for a receipt reversal',
        p_source         => q'[
DECLARE
    l_found BOOLEAN; l_no VARCHAR2(100); l_state VARCHAR2(60); l_status VARCHAR2(60);
    l_acct VARCHAR2(60); l_sync VARCHAR2(60); l_amt NUMBER; l_ccy VARCHAR2(15); l_bu VARCHAR2(240);
    l_apps NUMBER; l_gl NUMBER; l_rev NUMBER; l_reasons VARCHAR2(4000);
    FUNCTION js(p VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        RETURN CASE WHEN p IS NULL THEN 'null' ELSE '"' || REPLACE(REPLACE(p, '\', '\\'), '"', '\"') || '"' END;
    END;
BEGIN
    RR_AR_RECEIPT_REVERSE_CHECK(:id, l_found, l_no, l_state, l_status, l_acct, l_sync, l_amt, l_ccy, l_bu,
                                l_apps, l_gl, l_rev, l_reasons);
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":true,"eligible":' || CASE WHEN l_reasons = '[]' THEN 'true' ELSE 'false' END
         || ',"receiptId":' || NVL(TO_CHAR(:id), 'null')
         || ',"receiptNumber":' || js(l_no)
         || ',"state":' || js(l_state) || ',"status":' || js(l_status)
         || ',"accountingStatus":' || js(l_acct) || ',"syncStatus":' || js(l_sync)
         || ',"amount":' || NVL(TO_CHAR(l_amt, 'TM9', 'NLS_NUMERIC_CHARACTERS=''.,'''), 'null')
         || ',"currency":' || js(l_ccy) || ',"businessUnit":' || js(l_bu)
         || ',"applicationCount":' || NVL(TO_CHAR(l_apps), '0')
         || ',"glLineCount":' || NVL(TO_CHAR(l_gl), '0')
         || ',"reversalLineCount":' || NVL(TO_CHAR(l_rev), '0')
         || ',"reasons":' || l_reasons || '}');
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
    );
    COMMIT;
END;
/

-- ── POST receipts/:id/reverse ───────────────────────────────────────────────
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'receipts/:id/reverse');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'receipts/:id/reverse',
        p_comments    => 'Mark a receipt Reversed after its reversal journal is posted'
    );
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'receipts/:id/reverse',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Stamp STATE/STATUS = Reversed and REVERSAL_* (requires the AR_RECEIPTS_REVERSAL journal)',
        p_source         => q'[
DECLARE
    l_body  CLOB := :body_text;
    l_found BOOLEAN; l_no VARCHAR2(100); l_state VARCHAR2(60); l_status VARCHAR2(60);
    l_acct VARCHAR2(60); l_sync VARCHAR2(60); l_amt NUMBER; l_ccy VARCHAR2(15); l_bu VARCHAR2(240);
    l_apps NUMBER; l_gl NUMBER; l_rev NUMBER; l_reasons VARCHAR2(4000);
    l_date  DATE;
BEGIN
    RR_AR_RECEIPT_REVERSE_CHECK(:id, l_found, l_no, l_state, l_status, l_acct, l_sync, l_amt, l_ccy, l_bu,
                                l_apps, l_gl, l_rev, l_reasons);
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    IF NOT l_found THEN
        :status_code := 404;
        HTP.PRN('{"success":false,"error":"Receipt not found"}');
        RETURN;
    END IF;
    IF l_reasons != '[]' THEN
        :status_code := 409;
        HTP.PRN('{"success":false,"error":"Receipt cannot be reversed","reasons":' || l_reasons || '}');
        RETURN;
    END IF;
    IF l_rev = 0 THEN
        :status_code := 409;
        HTP.PRN('{"success":false,"error":"Post the reversal journal first (REFERENCE5 = AR_RECEIPTS_REVERSAL, REFERENCE2 = '
             || :id || ') — the receipt is not marked Reversed without it"}');
        RETURN;
    END IF;

    l_date := NVL(TO_DATE(JSON_VALUE(l_body, '$.reversalDate') DEFAULT NULL ON CONVERSION ERROR, 'YYYY-MM-DD'), TRUNC(SYSDATE));
    UPDATE RR_AR_RECEIPTS
    SET    STATE             = 'Reversed',
           STATUS            = 'Reversed',
           REVERSAL_DATE     = l_date,
           REVERSAL_CATEGORY = SUBSTR(JSON_VALUE(l_body, '$.reversalCategory'), 1, 20),
           REVERSAL_REASON   = SUBSTR(JSON_VALUE(l_body, '$.reversalReason'), 1, 240),
           REVERSAL_COMMENTS = SUBSTR(
                                 NVL(JSON_VALUE(l_body, '$.reversalComments' RETURNING VARCHAR2(4000)), '')
                                 || CASE WHEN JSON_VALUE(l_body, '$.reversedBy') IS NOT NULL
                                         THEN ' [reversed by ' || JSON_VALUE(l_body, '$.reversedBy') || ']' END,
                                 1, 4000)
    WHERE  STANDARD_RECEIPT_ID = :id;
    COMMIT;
    HTP.PRN('{"success":true,"receiptId":' || :id || ',"receiptNumber":"' || REPLACE(l_no, '"', '\"')
         || '","state":"Reversed","reversalDate":"' || TO_CHAR(l_date, 'YYYY-MM-DD') || '"}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    OWA_UTIL.MIME_HEADER('application/json', TRUE);
    HTP.PRN('{"success":false,"error":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
    );
    COMMIT;
END;
/

-- Verify
SELECT t.uri_template, h.method
FROM   user_ords_modules m
JOIN   user_ords_templates t ON t.module_id = m.id
JOIN   user_ords_handlers  h ON h.template_id = t.id
WHERE  m.name = 'ar' AND t.uri_template LIKE 'receipts/:id/reverse%';
