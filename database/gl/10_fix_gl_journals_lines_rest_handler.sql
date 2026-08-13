-- ============================================================
-- FIX: APEX REST Handler for GET /gl/journals/:id/lines
-- Correct table: RR_GL_JE_LINES_ALL
-- ============================================================
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'gl',
        p_pattern     => 'journals/:id/lines',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'Get journal lines by header ID'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'gl',
        p_pattern        => 'journals/:id/lines',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Get journal lines for a specific GL header',
        p_source         => '
            SELECT
                l.LINE_ID                    AS "lineId",
                l.JE_LINE_NUMBER             AS "lineNum",
                l.JE_HEADER_ID               AS "jeHeaderId",
                l.BATCH_ID                   AS "batchId",
                l.ACCOUNT_COMBINATION        AS "account",
                l.CHART_OF_ACCOUNTS_NAME     AS "chartOfAccountsName",
                l.DESCRIPTION                AS "description",
                l.ENTERED_DR                 AS "enteredDr",
                l.ENTERED_CR                 AS "enteredCr",
                l.ACCOUNTED_DR               AS "accountedDr",
                l.ACCOUNTED_CR               AS "accountedCr",
                l.CURRENCY_CODE              AS "currency",
                l.STAT_AMOUNT                AS "statAmount",
                l.RECONCILIATION_REFERENCE   AS "reconciliationReference",
                vsv.DESCRIPTION              AS "accountDescription"
            FROM RR_GL_JE_LINES_ALL l
            LEFT JOIN RR_VALUE_SET_VALUES vsv
                ON  vsv.VALUE_SET_CODE = ''BUIMERC_FIN_GLB_COA_ACCOUNT''
                AND vsv.VALUE          = TRIM(REGEXP_SUBSTR(l.ACCOUNT_COMBINATION, ''[^-]+'', 1, 4))
            WHERE l.JE_HEADER_ID = :id
            ORDER BY l.JE_LINE_NUMBER
        '
    );
    COMMIT;
END;
/
