-- ============================================================
-- APEX REST Handler: GET /gl/journals/headers
-- Returns journal header data with aggregated line totals
-- for a given JE_HEADER_ID
-- ============================================================
-- Route: journals/headers
-- Param: jeHeaderId (mandatory)
-- Tables: RR_GL_HEADERS, RR_GL_JOURNAL_BATCHES, RR_GL_LINES_ALL
-- ============================================================

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name    => 'gl',
        p_pattern        => 'journals/headers',
        p_priority       => 0,
        p_etag_type      => 'HASH',
        p_etag_query     => NULL,
        p_comments       => 'Get GL journal header(s) by JE_HEADER_ID with line totals'
    );
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'gl',
        p_pattern        => 'journals/headers',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 0,
        p_mimes_allowed  => NULL,
        p_comments       => 'Fetch GL journal header(s) with aggregated line totals, filtered by JE_HEADER_ID',
        p_source         => '
            SELECT
                h.JE_HEADER_ID                      AS "jeHeaderId",
                h.BATCH_ID                          AS "batchId",
                b.JE_BATCH_ID                       AS "jeBatchId",
                b.BATCH_NAME                        AS "batchName",
                h.JOURNAL_NAME                      AS "journalName",
                h.JOURNAL_DESCRIPTION               AS "journalDescription",
                h.PERIOD_NAME                       AS "periodName",
                h.DEFAULT_EFFECTIVE_DATE            AS "effectiveDate",
                h.LEDGER_NAME                       AS "ledgerName",
                h.CURRENCY_CODE                     AS "currencyCode",
                h.USER_JE_CATEGORY_NAME             AS "category",
                b.USER_JE_SOURCE_NAME               AS "source",
                b.STATUS                            AS "postingStatus",
                b.STATUS_MEANING                    AS "statusMeaning",
                -- Header running totals
                h.RUNNING_TOTAL_DR                  AS "enteredDebit",
                h.RUNNING_TOTAL_CR                  AS "enteredCredit",
                h.RUNNING_TOTAL_ACCOUNTED_DR        AS "accountedDebit",
                h.RUNNING_TOTAL_ACCOUNTED_CR        AS "accountedCredit",
                -- Aggregated totals from lines
                NVL(SUM(l.ENTERED_DR),   0)         AS "lineEnteredDebit",
                NVL(SUM(l.ENTERED_CR),   0)         AS "lineEnteredCredit",
                NVL(SUM(l.ACCOUNTED_DR), 0)         AS "lineAccountedDebit",
                NVL(SUM(l.ACCOUNTED_CR), 0)         AS "lineAccountedCredit",
                COUNT(l.LINE_ID)                    AS "lineCount"
            FROM RR_GL_HEADERS h
            JOIN RR_GL_JOURNAL_BATCHES b
              ON b.JE_BATCH_ID = h.BATCH_ID
            LEFT JOIN RR_GL_LINES_ALL l
              ON l.JE_HEADER_ID = h.JE_HEADER_ID
            WHERE (:jeHeaderId IS NULL OR h.JE_HEADER_ID = :jeHeaderId)
            GROUP BY
                h.JE_HEADER_ID,
                h.BATCH_ID,
                b.JE_BATCH_ID,
                b.BATCH_NAME,
                h.JOURNAL_NAME,
                h.JOURNAL_DESCRIPTION,
                h.PERIOD_NAME,
                h.DEFAULT_EFFECTIVE_DATE,
                h.LEDGER_NAME,
                h.CURRENCY_CODE,
                h.USER_JE_CATEGORY_NAME,
                b.USER_JE_SOURCE_NAME,
                b.STATUS,
                b.STATUS_MEANING,
                h.RUNNING_TOTAL_DR,
                h.RUNNING_TOTAL_CR,
                h.RUNNING_TOTAL_ACCOUNTED_DR,
                h.RUNNING_TOTAL_ACCOUNTED_CR
            ORDER BY h.JE_HEADER_ID
        '
    );
    COMMIT;
END;
/

COMMIT;
