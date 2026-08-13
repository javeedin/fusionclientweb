-- =============================================================================
-- 11_FIX_GL_SYNC_REST_HANDLERS.SQL
-- Fixes GL sync POST endpoints under the 'reerp' module:
--   POST reerp/gl/journalbatches  → MERGE into RR_GL_JOURNAL_BATCHES
--   POST reerp/gl/journals/headers → MERGE into RR_GL_HEADERS
--   POST reerp/gl/journals/lines   → MERGE into RR_GL_LINES_ALL
--
-- Root causes fixed:
--   1. Old handler called REERP_GL_JOURNAL_PKG which reads wrong JSON field names
--      (JournalName vs BatchName, PeriodName vs DefaultPeriodName, etc.)
--   2. No POST handlers existed for headers or lines under the reerp module
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. POST reerp/gl/journalbatches
--    Body: { "items": [{ "JeBatchId": ..., "BatchName": ..., ... }] }
--    MERGE into RR_GL_JOURNAL_BATCHES on JE_BATCH_ID
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journalbatches',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body    CLOB;
    v_success NUMBER := 0;
    v_errors  NUMBER := 0;
BEGIN
    v_body := :body_text;

    FOR rec IN (
        SELECT jt.*
        FROM JSON_TABLE(v_body, '$.items[*]' COLUMNS (
            JE_BATCH_ID               NUMBER         PATH '$.JeBatchId',
            ACCOUNTED_PERIOD_TYPE     VARCHAR2(30)   PATH '$.AccountedPeriodType',
            DEFAULT_PERIOD_NAME       VARCHAR2(15)   PATH '$.DefaultPeriodName',
            BATCH_NAME                VARCHAR2(240)  PATH '$.BatchName',
            STATUS                    VARCHAR2(30)   PATH '$.Status',
            CONTROL_TOTAL             NUMBER         PATH '$.ControlTotal',
            BATCH_DESCRIPTION         VARCHAR2(4000) PATH '$.BatchDescription',
            ERROR_MESSAGE             VARCHAR2(4000) PATH '$.ErrorMessage',
            POSTED_DATE               VARCHAR2(50)   PATH '$.PostedDate',
            POSTING_RUN_ID            NUMBER         PATH '$.PostingRunId',
            REQUEST_ID                NUMBER         PATH '$.RequestId',
            RUNNING_TOTAL_ACCT_CR     NUMBER         PATH '$.RunningTotalAccountedCr',
            RUNNING_TOTAL_ACCT_DR     NUMBER         PATH '$.RunningTotalAccountedDr',
            RUNNING_TOTAL_CR          NUMBER         PATH '$.RunningTotalCr',
            RUNNING_TOTAL_DR          NUMBER         PATH '$.RunningTotalDr',
            ORACLE_CREATED_BY         VARCHAR2(64)   PATH '$.CreatedBy',
            ORACLE_CREATION_DATE      VARCHAR2(50)   PATH '$.CreationDate',
            ORACLE_LAST_UPDATE_DATE   VARCHAR2(50)   PATH '$.LastUpdateDate',
            ORACLE_LAST_UPDATED_BY    VARCHAR2(64)   PATH '$.LastUpdatedBy',
            ACTUAL_FLAG_MEANING       VARCHAR2(80)   PATH '$.ActualFlagMeaning',
            APPROVAL_STATUS_MEANING   VARCHAR2(80)   PATH '$.ApprovalStatusMeaning',
            APPROVER_EMPLOYEE_NAME    VARCHAR2(240)  PATH '$.ApproverEmployeeName',
            FUNDS_STATUS_MEANING      VARCHAR2(80)   PATH '$.FundsStatusMeaning',
            PARENT_JE_BATCH_NAME      VARCHAR2(240)  PATH '$.ParentJeBatchName',
            CHART_OF_ACCOUNTS_NAME    VARCHAR2(240)  PATH '$.ChartOfAccountsName',
            STATUS_MEANING            VARCHAR2(80)   PATH '$.StatusMeaning',
            COMPLETION_STATUS_MEANING VARCHAR2(80)   PATH '$.CompletionStatusMeaning',
            USER_PERIOD_SET_NAME      VARCHAR2(80)   PATH '$.UserPeriodSetName',
            USER_JE_SOURCE_NAME       VARCHAR2(80)   PATH '$.UserJeSourceName',
            REVERSAL_DATE             VARCHAR2(50)   PATH '$.ReversalDate',
            REVERSAL_PERIOD           VARCHAR2(15)   PATH '$.ReversalPeriod',
            REVERSAL_FLAG             VARCHAR2(1)    PATH '$.ReversalFlag',
            REVERSAL_METHOD_MEANING   VARCHAR2(80)   PATH '$.ReversalMethodMeaning'
        )) jt
        WHERE jt.JE_BATCH_ID IS NOT NULL
    ) LOOP
        BEGIN
            MERGE INTO RR_GL_JOURNAL_BATCHES t
            USING DUAL
            ON (t.JE_BATCH_ID = rec.JE_BATCH_ID)
            WHEN MATCHED THEN UPDATE SET
                t.ACCOUNTED_PERIOD_TYPE     = rec.ACCOUNTED_PERIOD_TYPE,
                t.DEFAULT_PERIOD_NAME       = rec.DEFAULT_PERIOD_NAME,
                t.BATCH_NAME                = rec.BATCH_NAME,
                t.STATUS                    = rec.STATUS,
                t.CONTROL_TOTAL             = rec.CONTROL_TOTAL,
                t.BATCH_DESCRIPTION         = rec.BATCH_DESCRIPTION,
                t.ERROR_MESSAGE             = rec.ERROR_MESSAGE,
                t.POSTED_DATE               = TO_DATE(SUBSTR(rec.POSTED_DATE, 1, 10), 'YYYY-MM-DD'),
                t.POSTING_RUN_ID            = rec.POSTING_RUN_ID,
                t.REQUEST_ID                = rec.REQUEST_ID,
                t.RUNNING_TOTAL_ACCT_CR     = rec.RUNNING_TOTAL_ACCT_CR,
                t.RUNNING_TOTAL_ACCT_DR     = rec.RUNNING_TOTAL_ACCT_DR,
                t.RUNNING_TOTAL_CR          = rec.RUNNING_TOTAL_CR,
                t.RUNNING_TOTAL_DR          = rec.RUNNING_TOTAL_DR,
                t.ORACLE_CREATED_BY         = rec.ORACLE_CREATED_BY,
                t.ORACLE_CREATION_DATE      = TO_TIMESTAMP_TZ(REPLACE(rec.ORACLE_CREATION_DATE, 'Z', '+00:00'), 'YYYY-MM-DD"T"HH24:MI:SS.FFTZHTZM'),
                t.ORACLE_LAST_UPDATE_DATE   = TO_TIMESTAMP_TZ(REPLACE(rec.ORACLE_LAST_UPDATE_DATE, 'Z', '+00:00'), 'YYYY-MM-DD"T"HH24:MI:SS.FFTZHTZM'),
                t.ORACLE_LAST_UPDATED_BY    = rec.ORACLE_LAST_UPDATED_BY,
                t.ACTUAL_FLAG_MEANING       = rec.ACTUAL_FLAG_MEANING,
                t.APPROVAL_STATUS_MEANING   = rec.APPROVAL_STATUS_MEANING,
                t.APPROVER_EMPLOYEE_NAME    = rec.APPROVER_EMPLOYEE_NAME,
                t.FUNDS_STATUS_MEANING      = rec.FUNDS_STATUS_MEANING,
                t.PARENT_JE_BATCH_NAME      = rec.PARENT_JE_BATCH_NAME,
                t.CHART_OF_ACCOUNTS_NAME    = rec.CHART_OF_ACCOUNTS_NAME,
                t.STATUS_MEANING            = rec.STATUS_MEANING,
                t.COMPLETION_STATUS_MEANING = rec.COMPLETION_STATUS_MEANING,
                t.USER_PERIOD_SET_NAME      = rec.USER_PERIOD_SET_NAME,
                t.USER_JE_SOURCE_NAME       = rec.USER_JE_SOURCE_NAME,
                t.REVERSAL_DATE             = TO_DATE(SUBSTR(rec.REVERSAL_DATE, 1, 10), 'YYYY-MM-DD'),
                t.REVERSAL_PERIOD           = rec.REVERSAL_PERIOD,
                t.REVERSAL_FLAG             = rec.REVERSAL_FLAG,
                t.REVERSAL_METHOD_MEANING   = rec.REVERSAL_METHOD_MEANING,
                t.LAST_SYNC_DATE            = SYSTIMESTAMP,
                t.SYNC_COUNT                = NVL(t.SYNC_COUNT, 0) + 1
            WHEN NOT MATCHED THEN INSERT (
                JE_BATCH_ID, ACCOUNTED_PERIOD_TYPE, DEFAULT_PERIOD_NAME, BATCH_NAME,
                STATUS, CONTROL_TOTAL, BATCH_DESCRIPTION, ERROR_MESSAGE, POSTED_DATE,
                POSTING_RUN_ID, REQUEST_ID, RUNNING_TOTAL_ACCT_CR, RUNNING_TOTAL_ACCT_DR,
                RUNNING_TOTAL_CR, RUNNING_TOTAL_DR, ORACLE_CREATED_BY, ORACLE_CREATION_DATE,
                ORACLE_LAST_UPDATE_DATE, ORACLE_LAST_UPDATED_BY, ACTUAL_FLAG_MEANING,
                APPROVAL_STATUS_MEANING, APPROVER_EMPLOYEE_NAME, FUNDS_STATUS_MEANING,
                PARENT_JE_BATCH_NAME, CHART_OF_ACCOUNTS_NAME, STATUS_MEANING,
                COMPLETION_STATUS_MEANING, USER_PERIOD_SET_NAME, USER_JE_SOURCE_NAME,
                REVERSAL_DATE, REVERSAL_PERIOD, REVERSAL_FLAG, REVERSAL_METHOD_MEANING
            ) VALUES (
                rec.JE_BATCH_ID, rec.ACCOUNTED_PERIOD_TYPE, rec.DEFAULT_PERIOD_NAME, rec.BATCH_NAME,
                rec.STATUS, rec.CONTROL_TOTAL, rec.BATCH_DESCRIPTION, rec.ERROR_MESSAGE,
                TO_DATE(SUBSTR(rec.POSTED_DATE, 1, 10), 'YYYY-MM-DD'),
                rec.POSTING_RUN_ID, rec.REQUEST_ID, rec.RUNNING_TOTAL_ACCT_CR, rec.RUNNING_TOTAL_ACCT_DR,
                rec.RUNNING_TOTAL_CR, rec.RUNNING_TOTAL_DR, rec.ORACLE_CREATED_BY,
                TO_TIMESTAMP_TZ(REPLACE(rec.ORACLE_CREATION_DATE, 'Z', '+00:00'), 'YYYY-MM-DD"T"HH24:MI:SS.FFTZHTZM'),
                TO_TIMESTAMP_TZ(REPLACE(rec.ORACLE_LAST_UPDATE_DATE, 'Z', '+00:00'), 'YYYY-MM-DD"T"HH24:MI:SS.FFTZHTZM'),
                rec.ORACLE_LAST_UPDATED_BY, rec.ACTUAL_FLAG_MEANING, rec.APPROVAL_STATUS_MEANING,
                rec.APPROVER_EMPLOYEE_NAME, rec.FUNDS_STATUS_MEANING, rec.PARENT_JE_BATCH_NAME,
                rec.CHART_OF_ACCOUNTS_NAME, rec.STATUS_MEANING, rec.COMPLETION_STATUS_MEANING,
                rec.USER_PERIOD_SET_NAME, rec.USER_JE_SOURCE_NAME,
                TO_DATE(SUBSTR(rec.REVERSAL_DATE, 1, 10), 'YYYY-MM-DD'),
                rec.REVERSAL_PERIOD, rec.REVERSAL_FLAG, rec.REVERSAL_METHOD_MEANING
            );
            v_success := v_success + 1;
        EXCEPTION
            WHEN OTHERS THEN
                v_errors := v_errors + 1;
        END;
    END LOOP;
    COMMIT;

    :status_code := 200;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('inserted', v_success);
    APEX_JSON.WRITE('errors',   v_errors);
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- 2. POST reerp/gl/journals/headers
--    Body: { "batchId": N, "items": [{ "JeHeaderId": ..., "JournalName": ..., ... }] }
--    MERGE into RR_GL_HEADERS on JE_HEADER_ID
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/journals/headers',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'GL Journal Headers sync endpoint'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN NULL; -- Template may already exist
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journals/headers',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body    CLOB;
    v_batch_id NUMBER;
    v_success NUMBER := 0;
    v_errors  NUMBER := 0;
BEGIN
    v_body     := :body_text;
    v_batch_id := TO_NUMBER(JSON_VALUE(v_body, '$.batchId'));

    FOR rec IN (
        SELECT jt.*
        FROM JSON_TABLE(v_body, '$.items[*]' COLUMNS (
            JE_HEADER_ID                  NUMBER         PATH '$.JeHeaderId',
            JOURNAL_NAME                  VARCHAR2(240)  PATH '$.JournalName',
            JOURNAL_DESCRIPTION           VARCHAR2(4000) PATH '$.Description',
            PERIOD_NAME                   VARCHAR2(15)   PATH '$.PeriodName',
            DEFAULT_EFFECTIVE_DATE        VARCHAR2(50)   PATH '$.DefaultEffectiveDate',
            REFERENCE_DATE                VARCHAR2(50)   PATH '$.ReferenceDate',
            CURRENCY_CODE                 VARCHAR2(15)   PATH '$.CurrencyCode',
            LEDGER_CURRENCY_CODE          VARCHAR2(15)   PATH '$.LedgerCurrencyCode',
            CURRENCY_CONVERSION_DATE      VARCHAR2(50)   PATH '$.CurrencyConversionDate',
            CURRENCY_CONVERSION_RATE      NUMBER         PATH '$.CurrencyConversionRate',
            INV_CURRENCY_CONVERSION_RATE  NUMBER         PATH '$.InvCurrencyConversionRate',
            USER_CURRENCY_CONVERSION_TYPE VARCHAR2(30)   PATH '$.UserCurrencyConversionType',
            CONTROL_TOTAL                 NUMBER         PATH '$.ControlTotal',
            RUNNING_TOTAL_DR              NUMBER         PATH '$.RunningTotalDr',
            RUNNING_TOTAL_CR              NUMBER         PATH '$.RunningTotalCr',
            RUNNING_TOTAL_ACCOUNTED_DR    NUMBER         PATH '$.RunningTotalAccountedDr',
            RUNNING_TOTAL_ACCOUNTED_CR    NUMBER         PATH '$.RunningTotalAccountedCr',
            LEDGER_NAME                   VARCHAR2(240)  PATH '$.LedgerName',
            LEGAL_ENTITY_NAME             VARCHAR2(240)  PATH '$.LegalEntityName',
            USER_JE_CATEGORY_NAME         VARCHAR2(80)   PATH '$.UserJeCategoryName',
            ENCUMBRANCE_TYPE              VARCHAR2(80)   PATH '$.EncumbranceType',
            ACCRUAL_REV_EFF_DATE          VARCHAR2(50)   PATH '$.AccrualReversalEffectiveDate',
            ACCRUAL_REV_PERIOD_NAME       VARCHAR2(15)   PATH '$.AccrualReversalPeriodName',
            ACCRUAL_REV_STATUS            VARCHAR2(30)   PATH '$.AccrualReversalStatus',
            ACCRUAL_REV_JE_HEADER_NAME    VARCHAR2(240)  PATH '$.AccrualReversalJeHeaderName',
            CLOSE_ACCT_SEQ_VALUE          NUMBER         PATH '$.CloseAccountSequenceValue',
            CLOSE_ACCT_SEQ_ASSIGN_NAME    VARCHAR2(80)   PATH '$.CloseAccountSeqAssignName',
            POSTING_ACCT_SEQ_VALUE        NUMBER         PATH '$.PostingAccountSequenceValue',
            POSTING_ACCT_SEQ_ASSIGN_NAME  VARCHAR2(80)   PATH '$.PostingAccountSeqAssignName',
            EXTERNAL_REFERENCE            VARCHAR2(240)  PATH '$.ExternalReference',
            ORIGINATING_BAL_SEG_VALUE     VARCHAR2(25)   PATH '$.OriginatingBalSegValue',
            REVERSED_JE_HEADER_NAME       VARCHAR2(240)  PATH '$.ReversedJeHeaderName',
            JE_FROM_SLA_FLAG_MEANING      VARCHAR2(80)   PATH '$.JeFromSlaFlagMeaning',
            FUSION_CREATED_BY             VARCHAR2(64)   PATH '$.CreatedBy',
            FUSION_CREATION_DATE          VARCHAR2(50)   PATH '$.CreationDate',
            FUSION_LAST_UPDATE_DATE       VARCHAR2(50)   PATH '$.LastUpdateDate',
            FUSION_LAST_UPDATED_BY        VARCHAR2(64)   PATH '$.LastUpdatedBy'
        )) jt
        WHERE jt.JE_HEADER_ID IS NOT NULL
    ) LOOP
        BEGIN
            MERGE INTO RR_GL_HEADERS t
            USING DUAL
            ON (t.JE_HEADER_ID = rec.JE_HEADER_ID)
            WHEN MATCHED THEN UPDATE SET
                t.BATCH_ID                         = NVL(v_batch_id, t.BATCH_ID),
                t.JOURNAL_NAME                     = rec.JOURNAL_NAME,
                t.JOURNAL_DESCRIPTION              = rec.JOURNAL_DESCRIPTION,
                t.PERIOD_NAME                      = rec.PERIOD_NAME,
                t.DEFAULT_EFFECTIVE_DATE           = TO_DATE(SUBSTR(rec.DEFAULT_EFFECTIVE_DATE, 1, 10), 'YYYY-MM-DD'),
                t.REFERENCE_DATE                   = TO_DATE(SUBSTR(rec.REFERENCE_DATE, 1, 10), 'YYYY-MM-DD'),
                t.CURRENCY_CODE                    = rec.CURRENCY_CODE,
                t.LEDGER_CURRENCY_CODE             = rec.LEDGER_CURRENCY_CODE,
                t.CURRENCY_CONVERSION_DATE         = TO_DATE(SUBSTR(rec.CURRENCY_CONVERSION_DATE, 1, 10), 'YYYY-MM-DD'),
                t.CURRENCY_CONVERSION_RATE         = rec.CURRENCY_CONVERSION_RATE,
                t.INV_CURRENCY_CONVERSION_RATE     = rec.INV_CURRENCY_CONVERSION_RATE,
                t.USER_CURRENCY_CONVERSION_TYPE    = rec.USER_CURRENCY_CONVERSION_TYPE,
                t.CONTROL_TOTAL                    = rec.CONTROL_TOTAL,
                t.RUNNING_TOTAL_DR                 = rec.RUNNING_TOTAL_DR,
                t.RUNNING_TOTAL_CR                 = rec.RUNNING_TOTAL_CR,
                t.RUNNING_TOTAL_ACCOUNTED_DR       = rec.RUNNING_TOTAL_ACCOUNTED_DR,
                t.RUNNING_TOTAL_ACCOUNTED_CR       = rec.RUNNING_TOTAL_ACCOUNTED_CR,
                t.LEDGER_NAME                      = rec.LEDGER_NAME,
                t.LEGAL_ENTITY_NAME                = rec.LEGAL_ENTITY_NAME,
                t.USER_JE_CATEGORY_NAME            = rec.USER_JE_CATEGORY_NAME,
                t.ENCUMBRANCE_TYPE                 = rec.ENCUMBRANCE_TYPE,
                t.ACCRUAL_REVERSAL_EFFECTIVE_DATE  = TO_DATE(SUBSTR(rec.ACCRUAL_REV_EFF_DATE, 1, 10), 'YYYY-MM-DD'),
                t.ACCRUAL_REVERSAL_PERIOD_NAME     = rec.ACCRUAL_REV_PERIOD_NAME,
                t.ACCRUAL_REVERSAL_STATUS          = rec.ACCRUAL_REV_STATUS,
                t.ACCRUAL_REVERSAL_JE_HEADER_NAME  = rec.ACCRUAL_REV_JE_HEADER_NAME,
                t.CLOSE_ACCOUNT_SEQUENCE_VALUE     = rec.CLOSE_ACCT_SEQ_VALUE,
                t.CLOSE_ACCOUNT_SEQ_ASSIGN_NAME    = rec.CLOSE_ACCT_SEQ_ASSIGN_NAME,
                t.POSTING_ACCOUNT_SEQUENCE_VALUE   = rec.POSTING_ACCT_SEQ_VALUE,
                t.POSTING_ACCOUNT_SEQ_ASSIGN_NAME  = rec.POSTING_ACCT_SEQ_ASSIGN_NAME,
                t.EXTERNAL_REFERENCE               = rec.EXTERNAL_REFERENCE,
                t.ORIGINATING_BAL_SEG_VALUE        = rec.ORIGINATING_BAL_SEG_VALUE,
                t.REVERSED_JE_HEADER_NAME          = rec.REVERSED_JE_HEADER_NAME,
                t.JE_FROM_SLA_FLAG_MEANING         = rec.JE_FROM_SLA_FLAG_MEANING,
                t.FUSION_CREATED_BY                = rec.FUSION_CREATED_BY,
                t.FUSION_CREATION_DATE             = TO_TIMESTAMP_TZ(REPLACE(rec.FUSION_CREATION_DATE, 'Z', '+00:00'), 'YYYY-MM-DD"T"HH24:MI:SS.FFTZHTZM'),
                t.FUSION_LAST_UPDATE_DATE          = TO_TIMESTAMP_TZ(REPLACE(rec.FUSION_LAST_UPDATE_DATE, 'Z', '+00:00'), 'YYYY-MM-DD"T"HH24:MI:SS.FFTZHTZM'),
                t.FUSION_LAST_UPDATED_BY           = rec.FUSION_LAST_UPDATED_BY,
                t.SYNC_DATE                        = SYSTIMESTAMP
            WHEN NOT MATCHED THEN INSERT (
                JE_HEADER_ID, BATCH_ID, JOURNAL_NAME, JOURNAL_DESCRIPTION, PERIOD_NAME,
                DEFAULT_EFFECTIVE_DATE, REFERENCE_DATE, CURRENCY_CODE, LEDGER_CURRENCY_CODE,
                CURRENCY_CONVERSION_DATE, CURRENCY_CONVERSION_RATE, INV_CURRENCY_CONVERSION_RATE,
                USER_CURRENCY_CONVERSION_TYPE, CONTROL_TOTAL, RUNNING_TOTAL_DR, RUNNING_TOTAL_CR,
                RUNNING_TOTAL_ACCOUNTED_DR, RUNNING_TOTAL_ACCOUNTED_CR, LEDGER_NAME, LEGAL_ENTITY_NAME,
                USER_JE_CATEGORY_NAME, ENCUMBRANCE_TYPE, ACCRUAL_REVERSAL_EFFECTIVE_DATE,
                ACCRUAL_REVERSAL_PERIOD_NAME, ACCRUAL_REVERSAL_STATUS, ACCRUAL_REVERSAL_JE_HEADER_NAME,
                CLOSE_ACCOUNT_SEQUENCE_VALUE, CLOSE_ACCOUNT_SEQ_ASSIGN_NAME,
                POSTING_ACCOUNT_SEQUENCE_VALUE, POSTING_ACCOUNT_SEQ_ASSIGN_NAME,
                EXTERNAL_REFERENCE, ORIGINATING_BAL_SEG_VALUE, REVERSED_JE_HEADER_NAME,
                JE_FROM_SLA_FLAG_MEANING, FUSION_CREATED_BY, FUSION_CREATION_DATE,
                FUSION_LAST_UPDATE_DATE, FUSION_LAST_UPDATED_BY
            ) VALUES (
                rec.JE_HEADER_ID, v_batch_id, rec.JOURNAL_NAME, rec.JOURNAL_DESCRIPTION, rec.PERIOD_NAME,
                TO_DATE(SUBSTR(rec.DEFAULT_EFFECTIVE_DATE, 1, 10), 'YYYY-MM-DD'),
                TO_DATE(SUBSTR(rec.REFERENCE_DATE, 1, 10), 'YYYY-MM-DD'),
                rec.CURRENCY_CODE, rec.LEDGER_CURRENCY_CODE,
                TO_DATE(SUBSTR(rec.CURRENCY_CONVERSION_DATE, 1, 10), 'YYYY-MM-DD'),
                rec.CURRENCY_CONVERSION_RATE, rec.INV_CURRENCY_CONVERSION_RATE,
                rec.USER_CURRENCY_CONVERSION_TYPE, rec.CONTROL_TOTAL,
                rec.RUNNING_TOTAL_DR, rec.RUNNING_TOTAL_CR,
                rec.RUNNING_TOTAL_ACCOUNTED_DR, rec.RUNNING_TOTAL_ACCOUNTED_CR,
                rec.LEDGER_NAME, rec.LEGAL_ENTITY_NAME, rec.USER_JE_CATEGORY_NAME,
                rec.ENCUMBRANCE_TYPE,
                TO_DATE(SUBSTR(rec.ACCRUAL_REV_EFF_DATE, 1, 10), 'YYYY-MM-DD'),
                rec.ACCRUAL_REV_PERIOD_NAME, rec.ACCRUAL_REV_STATUS, rec.ACCRUAL_REV_JE_HEADER_NAME,
                rec.CLOSE_ACCT_SEQ_VALUE, rec.CLOSE_ACCT_SEQ_ASSIGN_NAME,
                rec.POSTING_ACCT_SEQ_VALUE, rec.POSTING_ACCT_SEQ_ASSIGN_NAME,
                rec.EXTERNAL_REFERENCE, rec.ORIGINATING_BAL_SEG_VALUE, rec.REVERSED_JE_HEADER_NAME,
                rec.JE_FROM_SLA_FLAG_MEANING, rec.FUSION_CREATED_BY,
                TO_TIMESTAMP_TZ(REPLACE(rec.FUSION_CREATION_DATE, 'Z', '+00:00'), 'YYYY-MM-DD"T"HH24:MI:SS.FFTZHTZM'),
                TO_TIMESTAMP_TZ(REPLACE(rec.FUSION_LAST_UPDATE_DATE, 'Z', '+00:00'), 'YYYY-MM-DD"T"HH24:MI:SS.FFTZHTZM'),
                rec.FUSION_LAST_UPDATED_BY
            );
            v_success := v_success + 1;
        EXCEPTION
            WHEN OTHERS THEN
                v_errors := v_errors + 1;
        END;
    END LOOP;
    COMMIT;

    :status_code := 200;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('inserted', v_success);
    APEX_JSON.WRITE('errors',   v_errors);
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- 3. POST reerp/gl/journals/lines
--    Body: { "batchId": N, "jeHeaderId": N, "items": [...lines] }
--    MERGE into RR_GL_LINES_ALL on (JE_HEADER_ID, JE_LINE_NUMBER)
-- ---------------------------------------------------------------------------
BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'reerp',
        p_pattern     => 'gl/journals/lines',
        p_priority    => 0,
        p_etag_type   => 'HASH',
        p_comments    => 'GL Journal Lines sync endpoint'
    );
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN NULL; -- Template may already exist
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'gl/journals/lines',
        p_method         => 'POST',
        p_source_type    => ORDS.source_type_plsql,
        p_items_per_page => 0,
        p_source         => q'[
DECLARE
    v_body        CLOB;
    v_batch_id    NUMBER;
    v_header_id   NUMBER;
    v_success     NUMBER := 0;
    v_errors      NUMBER := 0;
BEGIN
    v_body      := :body_text;
    v_batch_id  := TO_NUMBER(JSON_VALUE(v_body, '$.batchId'));
    v_header_id := TO_NUMBER(JSON_VALUE(v_body, '$.jeHeaderId'));

    FOR rec IN (
        SELECT jt.*
        FROM JSON_TABLE(v_body, '$.items[*]' COLUMNS (
            JE_LINE_NUMBER                NUMBER         PATH '$.JeLineNumber',
            ENTERED_DR                    NUMBER         PATH '$.EnteredDr',
            ENTERED_CR                    NUMBER         PATH '$.EnteredCr',
            ACCOUNTED_DR                  NUMBER         PATH '$.AccountedDr',
            ACCOUNTED_CR                  NUMBER         PATH '$.AccountedCr',
            STAT_AMOUNT                   NUMBER         PATH '$.StatAmount',
            DESCRIPTION                   VARCHAR2(4000) PATH '$.Description',
            CURRENCY_CODE                 VARCHAR2(15)   PATH '$.CurrencyCode',
            CURRENCY_CONVERSION_DATE      VARCHAR2(50)   PATH '$.CurrencyConversionDate',
            CURRENCY_CONVERSION_RATE      NUMBER         PATH '$.CurrencyConversionRate',
            USER_CURRENCY_CONVERSION_TYPE VARCHAR2(30)   PATH '$.UserCurrencyConversionType',
            ACCOUNT_COMBINATION           VARCHAR2(750)  PATH '$.AccountCombination',
            CHART_OF_ACCOUNTS_NAME        VARCHAR2(240)  PATH '$.ChartOfAccountsName',
            REFERENCE1                    VARCHAR2(240)  PATH '$.Reference1',
            REFERENCE2                    VARCHAR2(240)  PATH '$.Reference2',
            REFERENCE3                    VARCHAR2(240)  PATH '$.Reference3',
            REFERENCE4                    VARCHAR2(240)  PATH '$.Reference4',
            REFERENCE5                    VARCHAR2(240)  PATH '$.Reference5',
            REFERENCE6                    VARCHAR2(240)  PATH '$.Reference6',
            REFERENCE7                    VARCHAR2(240)  PATH '$.Reference7',
            REFERENCE8                    VARCHAR2(240)  PATH '$.Reference8',
            REFERENCE9                    VARCHAR2(240)  PATH '$.Reference9',
            REFERENCE10                   VARCHAR2(240)  PATH '$.Reference10',
            JGZZ_RECON_REFERENCE          VARCHAR2(240)  PATH '$.JgzzReconReference',
            JGZZ_RECON_DATE               VARCHAR2(50)   PATH '$.JgzzReconDate',
            JGZZ_RECON_ID                 NUMBER         PATH '$.JgzzReconId',
            JGZZ_RECON_STATUS_MEANING     VARCHAR2(80)   PATH '$.JgzzReconStatusMeaning',
            RECONCILIATION_REFERENCE      VARCHAR2(240)  PATH '$.ReconciliationReference'
        )) jt
        WHERE jt.JE_LINE_NUMBER IS NOT NULL
    ) LOOP
        BEGIN
            MERGE INTO RR_GL_LINES_ALL t
            USING DUAL
            ON (t.JE_HEADER_ID = v_header_id AND t.JE_LINE_NUMBER = rec.JE_LINE_NUMBER)
            WHEN MATCHED THEN UPDATE SET
                t.BATCH_ID                      = v_batch_id,
                t.ENTERED_DR                    = rec.ENTERED_DR,
                t.ENTERED_CR                    = rec.ENTERED_CR,
                t.ACCOUNTED_DR                  = rec.ACCOUNTED_DR,
                t.ACCOUNTED_CR                  = rec.ACCOUNTED_CR,
                t.STAT_AMOUNT                   = rec.STAT_AMOUNT,
                t.DESCRIPTION                   = rec.DESCRIPTION,
                t.CURRENCY_CODE                 = rec.CURRENCY_CODE,
                t.CURRENCY_CONVERSION_DATE      = TO_DATE(SUBSTR(rec.CURRENCY_CONVERSION_DATE, 1, 10), 'YYYY-MM-DD'),
                t.CURRENCY_CONVERSION_RATE      = rec.CURRENCY_CONVERSION_RATE,
                t.USER_CURRENCY_CONVERSION_TYPE = rec.USER_CURRENCY_CONVERSION_TYPE,
                t.ACCOUNT_COMBINATION           = rec.ACCOUNT_COMBINATION,
                t.CHART_OF_ACCOUNTS_NAME        = rec.CHART_OF_ACCOUNTS_NAME,
                t.REFERENCE1                    = rec.REFERENCE1,
                t.REFERENCE2                    = rec.REFERENCE2,
                t.REFERENCE3                    = rec.REFERENCE3,
                t.REFERENCE4                    = rec.REFERENCE4,
                t.REFERENCE5                    = rec.REFERENCE5,
                t.REFERENCE6                    = rec.REFERENCE6,
                t.REFERENCE7                    = rec.REFERENCE7,
                t.REFERENCE8                    = rec.REFERENCE8,
                t.REFERENCE9                    = rec.REFERENCE9,
                t.REFERENCE10                   = rec.REFERENCE10,
                t.JGZZ_RECON_REFERENCE          = rec.JGZZ_RECON_REFERENCE,
                t.JGZZ_RECON_DATE               = TO_DATE(SUBSTR(rec.JGZZ_RECON_DATE, 1, 10), 'YYYY-MM-DD'),
                t.JGZZ_RECON_ID                 = rec.JGZZ_RECON_ID,
                t.JGZZ_RECON_STATUS_MEANING     = rec.JGZZ_RECON_STATUS_MEANING,
                t.RECONCILIATION_REFERENCE      = rec.RECONCILIATION_REFERENCE,
                t.SYNC_DATE                     = SYSTIMESTAMP
            WHEN NOT MATCHED THEN INSERT (
                JE_HEADER_ID, BATCH_ID, JE_LINE_NUMBER, ENTERED_DR, ENTERED_CR,
                ACCOUNTED_DR, ACCOUNTED_CR, STAT_AMOUNT, DESCRIPTION, CURRENCY_CODE,
                CURRENCY_CONVERSION_DATE, CURRENCY_CONVERSION_RATE, USER_CURRENCY_CONVERSION_TYPE,
                ACCOUNT_COMBINATION, CHART_OF_ACCOUNTS_NAME,
                REFERENCE1, REFERENCE2, REFERENCE3, REFERENCE4, REFERENCE5,
                REFERENCE6, REFERENCE7, REFERENCE8, REFERENCE9, REFERENCE10,
                JGZZ_RECON_REFERENCE, JGZZ_RECON_DATE, JGZZ_RECON_ID,
                JGZZ_RECON_STATUS_MEANING, RECONCILIATION_REFERENCE
            ) VALUES (
                v_header_id, v_batch_id, rec.JE_LINE_NUMBER, rec.ENTERED_DR, rec.ENTERED_CR,
                rec.ACCOUNTED_DR, rec.ACCOUNTED_CR, rec.STAT_AMOUNT, rec.DESCRIPTION, rec.CURRENCY_CODE,
                TO_DATE(SUBSTR(rec.CURRENCY_CONVERSION_DATE, 1, 10), 'YYYY-MM-DD'),
                rec.CURRENCY_CONVERSION_RATE, rec.USER_CURRENCY_CONVERSION_TYPE,
                rec.ACCOUNT_COMBINATION, rec.CHART_OF_ACCOUNTS_NAME,
                rec.REFERENCE1, rec.REFERENCE2, rec.REFERENCE3, rec.REFERENCE4, rec.REFERENCE5,
                rec.REFERENCE6, rec.REFERENCE7, rec.REFERENCE8, rec.REFERENCE9, rec.REFERENCE10,
                rec.JGZZ_RECON_REFERENCE,
                TO_DATE(SUBSTR(rec.JGZZ_RECON_DATE, 1, 10), 'YYYY-MM-DD'),
                rec.JGZZ_RECON_ID, rec.JGZZ_RECON_STATUS_MEANING, rec.RECONCILIATION_REFERENCE
            );
            v_success := v_success + 1;
        EXCEPTION
            WHEN OTHERS THEN
                v_errors := v_errors + 1;
        END;
    END LOOP;
    COMMIT;

    :status_code := 200;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('success', TRUE);
    APEX_JSON.WRITE('inserted', v_success);
    APEX_JSON.WRITE('errors',   v_errors);
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('success', FALSE);
        APEX_JSON.WRITE('error', SQLERRM);
        APEX_JSON.CLOSE_OBJECT;
END;
]'
    );
    COMMIT;
END;
/


-- ---------------------------------------------------------------------------
-- Prerequisites: Ensure these tables exist (run once if not already created)
--
-- RR_GL_JOURNAL_BATCHES  → database/gl/04_create_rr_journal_batches_table.sql
-- RR_GL_HEADERS          → database/gl/05_create_rr_je_headers_table.sql
-- RR_GL_LINES_ALL        → database/gl/06_create_rr_je_lines_table.sql
-- ---------------------------------------------------------------------------
