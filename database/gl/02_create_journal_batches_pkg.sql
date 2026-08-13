-- ============================================================
-- GL Journal Batches Package
-- PL/SQL Package for inserting journal batches from ReactERP
-- ============================================================

CREATE OR REPLACE PACKAGE REERP_GL_JOURNAL_PKG AS

    -- Type for single journal batch record
    TYPE t_journal_batch_rec IS RECORD (
        journal_name              VARCHAR2(240),
        journal_description       VARCHAR2(4000),
        period_name               VARCHAR2(15),
        default_effective_date    DATE,
        reference_date            DATE,
        currency_code             VARCHAR2(15),
        ledger_currency_code      VARCHAR2(15),
        currency_conversion_date  DATE,
        currency_conversion_rate  NUMBER,
        inv_currency_conv_rate    NUMBER,
        user_currency_conv_type   VARCHAR2(30),
        control_total             NUMBER,
        running_total_dr          NUMBER,
        running_total_cr          NUMBER,
        running_total_accounted_dr NUMBER,
        running_total_accounted_cr NUMBER,
        ledger_name               VARCHAR2(240),
        legal_entity_name         VARCHAR2(240),
        user_je_category_name     VARCHAR2(80),
        encumbrance_type          VARCHAR2(80),
        accrual_reversal_eff_date DATE,
        accrual_reversal_period   VARCHAR2(15),
        accrual_reversal_status   VARCHAR2(30),
        accrual_reversal_je_name  VARCHAR2(240),
        close_acct_seq_value      NUMBER,
        close_acct_seq_assign_name VARCHAR2(80),
        posting_acct_seq_value    NUMBER,
        posting_acct_seq_assign_name VARCHAR2(80),
        external_reference        VARCHAR2(240),
        originating_bal_seg_value VARCHAR2(25),
        reversed_je_header_name   VARCHAR2(240),
        je_from_sla_flag_meaning  VARCHAR2(80),
        fusion_created_by         VARCHAR2(64),
        fusion_creation_date      TIMESTAMP WITH TIME ZONE,
        fusion_last_update_date   TIMESTAMP WITH TIME ZONE,
        fusion_last_updated_by    VARCHAR2(64)
    );

    -- Insert single journal batch from JSON
    PROCEDURE insert_journal_batch(
        p_json_data IN CLOB,
        p_result    OUT VARCHAR2,
        p_batch_id  OUT NUMBER
    );

    -- Insert multiple journal batches from JSON array
    PROCEDURE insert_journal_batches(
        p_json_data     IN CLOB,
        p_success_count OUT NUMBER,
        p_error_count   OUT NUMBER,
        p_result        OUT VARCHAR2
    );

    -- Delete journal batches by period (for re-sync)
    PROCEDURE delete_by_period(
        p_period_name   IN VARCHAR2,
        p_deleted_count OUT NUMBER
    );

END REERP_GL_JOURNAL_PKG;
/

CREATE OR REPLACE PACKAGE BODY REERP_GL_JOURNAL_PKG AS

    -- --------------------------------------------------------
    -- Insert single journal batch from JSON
    -- --------------------------------------------------------
    PROCEDURE insert_journal_batch(
        p_json_data IN CLOB,
        p_result    OUT VARCHAR2,
        p_batch_id  OUT NUMBER
    ) IS
        v_journal_name VARCHAR2(240);
    BEGIN
        -- Parse JSON and insert
        INSERT INTO REERP_GL_JOURNAL_BATCHES (
            JOURNAL_NAME,
            JOURNAL_DESCRIPTION,
            PERIOD_NAME,
            DEFAULT_EFFECTIVE_DATE,
            REFERENCE_DATE,
            CURRENCY_CODE,
            LEDGER_CURRENCY_CODE,
            CURRENCY_CONVERSION_DATE,
            CURRENCY_CONVERSION_RATE,
            INV_CURRENCY_CONV_RATE,
            USER_CURRENCY_CONV_TYPE,
            CONTROL_TOTAL,
            RUNNING_TOTAL_DR,
            RUNNING_TOTAL_CR,
            RUNNING_TOTAL_ACCOUNTED_DR,
            RUNNING_TOTAL_ACCOUNTED_CR,
            LEDGER_NAME,
            LEGAL_ENTITY_NAME,
            USER_JE_CATEGORY_NAME,
            ENCUMBRANCE_TYPE,
            ACCRUAL_REVERSAL_EFF_DATE,
            ACCRUAL_REVERSAL_PERIOD,
            ACCRUAL_REVERSAL_STATUS,
            ACCRUAL_REVERSAL_JE_NAME,
            CLOSE_ACCT_SEQ_VALUE,
            CLOSE_ACCT_SEQ_ASSIGN_NAME,
            POSTING_ACCT_SEQ_VALUE,
            POSTING_ACCT_SEQ_ASSIGN_NAME,
            EXTERNAL_REFERENCE,
            ORIGINATING_BAL_SEG_VALUE,
            REVERSED_JE_HEADER_NAME,
            JE_FROM_SLA_FLAG_MEANING,
            FUSION_CREATED_BY,
            FUSION_CREATION_DATE,
            FUSION_LAST_UPDATE_DATE,
            FUSION_LAST_UPDATED_BY,
            LAST_UPDATED_BY,
            LAST_UPDATE_DATE
        )
        VALUES (
            JSON_VALUE(p_json_data, '$.JournalName'),
            JSON_VALUE(p_json_data, '$.JournalDescription'),
            JSON_VALUE(p_json_data, '$.PeriodName'),
            TO_DATE(JSON_VALUE(p_json_data, '$.DefaultEffectiveDate'), 'YYYY-MM-DD'),
            TO_DATE(JSON_VALUE(p_json_data, '$.ReferenceDate'), 'YYYY-MM-DD'),
            JSON_VALUE(p_json_data, '$.CurrencyCode'),
            JSON_VALUE(p_json_data, '$.LedgerCurrencyCode'),
            TO_DATE(JSON_VALUE(p_json_data, '$.CurrencyConversionDate'), 'YYYY-MM-DD'),
            JSON_VALUE(p_json_data, '$.CurrencyConversionRate' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.InvCurrencyConversionRate' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.UserCurrencyConversionType'),
            JSON_VALUE(p_json_data, '$.ControlTotal' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.RunningTotalDr' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.RunningTotalCr' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.RunningTotalAccountedDr' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.RunningTotalAccountedCr' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.LedgerName'),
            JSON_VALUE(p_json_data, '$.LegalEntityName'),
            JSON_VALUE(p_json_data, '$.UserJeCategoryName'),
            JSON_VALUE(p_json_data, '$.EncumbranceType'),
            TO_DATE(JSON_VALUE(p_json_data, '$.AccrualReversalEffectiveDate'), 'YYYY-MM-DD'),
            JSON_VALUE(p_json_data, '$.AccrualReversalPeriodName'),
            JSON_VALUE(p_json_data, '$.AccrualReversalStatus'),
            JSON_VALUE(p_json_data, '$.AccrualReversalJeHeaderName'),
            JSON_VALUE(p_json_data, '$.CloseAccountSequenceValue' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.CloseAccountSequenceAssignName'),
            JSON_VALUE(p_json_data, '$.PostingAccountSequenceValue' RETURNING NUMBER),
            JSON_VALUE(p_json_data, '$.PostingAccountSequenceAssignName'),
            JSON_VALUE(p_json_data, '$.ExternalReference'),
            JSON_VALUE(p_json_data, '$.OriginatingBalSegValue'),
            JSON_VALUE(p_json_data, '$.ReversedJeHeaderName'),
            JSON_VALUE(p_json_data, '$.JeFromSlaFlagMeaning'),
            JSON_VALUE(p_json_data, '$.CreatedBy'),
            TO_TIMESTAMP_TZ(JSON_VALUE(p_json_data, '$.CreationDate'), 'YYYY-MM-DD"T"HH24:MI:SS.FFTZHTZM'),
            TO_TIMESTAMP_TZ(JSON_VALUE(p_json_data, '$.LastUpdateDate'), 'YYYY-MM-DD"T"HH24:MI:SS.FFTZHTZM'),
            JSON_VALUE(p_json_data, '$.LastUpdatedBy'),
            USER,
            SYSTIMESTAMP
        )
        RETURNING JOURNAL_BATCH_ID, JOURNAL_NAME INTO p_batch_id, v_journal_name;

        p_result := 'SUCCESS: Inserted journal batch "' || v_journal_name || '" with ID ' || p_batch_id;
        COMMIT;

    EXCEPTION
        WHEN OTHERS THEN
            p_result := 'ERROR: ' || SQLERRM;
            p_batch_id := NULL;
            ROLLBACK;
    END insert_journal_batch;

    -- --------------------------------------------------------
    -- Insert multiple journal batches from JSON array
    -- --------------------------------------------------------
    PROCEDURE insert_journal_batches(
        p_json_data     IN CLOB,
        p_success_count OUT NUMBER,
        p_error_count   OUT NUMBER,
        p_result        OUT VARCHAR2
    ) IS
        v_batch_id NUMBER;
        v_result   VARCHAR2(4000);
    BEGIN
        p_success_count := 0;
        p_error_count := 0;

        -- Loop through JSON array using JSON_TABLE
        FOR rec IN (
            SELECT jt.*
            FROM JSON_TABLE(p_json_data, '$.items[*]'
                COLUMNS (
                    journal_name              VARCHAR2(240)  PATH '$.JournalName',
                    journal_description       VARCHAR2(4000) PATH '$.JournalDescription',
                    period_name               VARCHAR2(15)   PATH '$.PeriodName',
                    default_effective_date    VARCHAR2(20)   PATH '$.DefaultEffectiveDate',
                    reference_date            VARCHAR2(20)   PATH '$.ReferenceDate',
                    currency_code             VARCHAR2(15)   PATH '$.CurrencyCode',
                    ledger_currency_code      VARCHAR2(15)   PATH '$.LedgerCurrencyCode',
                    currency_conversion_date  VARCHAR2(20)   PATH '$.CurrencyConversionDate',
                    currency_conversion_rate  NUMBER         PATH '$.CurrencyConversionRate',
                    inv_currency_conv_rate    NUMBER         PATH '$.InvCurrencyConversionRate',
                    user_currency_conv_type   VARCHAR2(30)   PATH '$.UserCurrencyConversionType',
                    control_total             NUMBER         PATH '$.ControlTotal',
                    running_total_dr          NUMBER         PATH '$.RunningTotalDr',
                    running_total_cr          NUMBER         PATH '$.RunningTotalCr',
                    running_total_accounted_dr NUMBER        PATH '$.RunningTotalAccountedDr',
                    running_total_accounted_cr NUMBER        PATH '$.RunningTotalAccountedCr',
                    ledger_name               VARCHAR2(240)  PATH '$.LedgerName',
                    legal_entity_name         VARCHAR2(240)  PATH '$.LegalEntityName',
                    user_je_category_name     VARCHAR2(80)   PATH '$.UserJeCategoryName',
                    encumbrance_type          VARCHAR2(80)   PATH '$.EncumbranceType',
                    accrual_reversal_eff_date VARCHAR2(20)   PATH '$.AccrualReversalEffectiveDate',
                    accrual_reversal_period   VARCHAR2(15)   PATH '$.AccrualReversalPeriodName',
                    accrual_reversal_status   VARCHAR2(30)   PATH '$.AccrualReversalStatus',
                    accrual_reversal_je_name  VARCHAR2(240)  PATH '$.AccrualReversalJeHeaderName',
                    close_acct_seq_value      NUMBER         PATH '$.CloseAccountSequenceValue',
                    close_acct_seq_assign_name VARCHAR2(80)  PATH '$.CloseAccountSequenceAssignName',
                    posting_acct_seq_value    NUMBER         PATH '$.PostingAccountSequenceValue',
                    posting_acct_seq_assign_name VARCHAR2(80) PATH '$.PostingAccountSequenceAssignName',
                    external_reference        VARCHAR2(240)  PATH '$.ExternalReference',
                    originating_bal_seg_value VARCHAR2(25)   PATH '$.OriginatingBalSegValue',
                    reversed_je_header_name   VARCHAR2(240)  PATH '$.ReversedJeHeaderName',
                    je_from_sla_flag_meaning  VARCHAR2(80)   PATH '$.JeFromSlaFlagMeaning',
                    fusion_created_by         VARCHAR2(64)   PATH '$.CreatedBy',
                    fusion_creation_date      VARCHAR2(50)   PATH '$.CreationDate',
                    fusion_last_update_date   VARCHAR2(50)   PATH '$.LastUpdateDate',
                    fusion_last_updated_by    VARCHAR2(64)   PATH '$.LastUpdatedBy'
                )
            ) jt
        ) LOOP
            BEGIN
                INSERT INTO REERP_GL_JOURNAL_BATCHES (
                    JOURNAL_NAME,
                    JOURNAL_DESCRIPTION,
                    PERIOD_NAME,
                    DEFAULT_EFFECTIVE_DATE,
                    REFERENCE_DATE,
                    CURRENCY_CODE,
                    LEDGER_CURRENCY_CODE,
                    CURRENCY_CONVERSION_DATE,
                    CURRENCY_CONVERSION_RATE,
                    INV_CURRENCY_CONV_RATE,
                    USER_CURRENCY_CONV_TYPE,
                    CONTROL_TOTAL,
                    RUNNING_TOTAL_DR,
                    RUNNING_TOTAL_CR,
                    RUNNING_TOTAL_ACCOUNTED_DR,
                    RUNNING_TOTAL_ACCOUNTED_CR,
                    LEDGER_NAME,
                    LEGAL_ENTITY_NAME,
                    USER_JE_CATEGORY_NAME,
                    ENCUMBRANCE_TYPE,
                    ACCRUAL_REVERSAL_EFF_DATE,
                    ACCRUAL_REVERSAL_PERIOD,
                    ACCRUAL_REVERSAL_STATUS,
                    ACCRUAL_REVERSAL_JE_NAME,
                    CLOSE_ACCT_SEQ_VALUE,
                    CLOSE_ACCT_SEQ_ASSIGN_NAME,
                    POSTING_ACCT_SEQ_VALUE,
                    POSTING_ACCT_SEQ_ASSIGN_NAME,
                    EXTERNAL_REFERENCE,
                    ORIGINATING_BAL_SEG_VALUE,
                    REVERSED_JE_HEADER_NAME,
                    JE_FROM_SLA_FLAG_MEANING,
                    FUSION_CREATED_BY,
                    FUSION_CREATION_DATE,
                    FUSION_LAST_UPDATE_DATE,
                    FUSION_LAST_UPDATED_BY,
                    LAST_UPDATED_BY,
                    LAST_UPDATE_DATE
                )
                VALUES (
                    rec.journal_name,
                    rec.journal_description,
                    rec.period_name,
                    TO_DATE(rec.default_effective_date, 'YYYY-MM-DD'),
                    TO_DATE(rec.reference_date, 'YYYY-MM-DD'),
                    rec.currency_code,
                    rec.ledger_currency_code,
                    TO_DATE(rec.currency_conversion_date, 'YYYY-MM-DD'),
                    rec.currency_conversion_rate,
                    rec.inv_currency_conv_rate,
                    rec.user_currency_conv_type,
                    rec.control_total,
                    rec.running_total_dr,
                    rec.running_total_cr,
                    rec.running_total_accounted_dr,
                    rec.running_total_accounted_cr,
                    rec.ledger_name,
                    rec.legal_entity_name,
                    rec.user_je_category_name,
                    rec.encumbrance_type,
                    TO_DATE(rec.accrual_reversal_eff_date, 'YYYY-MM-DD'),
                    rec.accrual_reversal_period,
                    rec.accrual_reversal_status,
                    rec.accrual_reversal_je_name,
                    rec.close_acct_seq_value,
                    rec.close_acct_seq_assign_name,
                    rec.posting_acct_seq_value,
                    rec.posting_acct_seq_assign_name,
                    rec.external_reference,
                    rec.originating_bal_seg_value,
                    rec.reversed_je_header_name,
                    rec.je_from_sla_flag_meaning,
                    rec.fusion_created_by,
                    CASE WHEN rec.fusion_creation_date IS NOT NULL
                         THEN TO_TIMESTAMP_TZ(rec.fusion_creation_date, 'YYYY-MM-DD"T"HH24:MI:SS.FFTZHTZM')
                         ELSE NULL END,
                    CASE WHEN rec.fusion_last_update_date IS NOT NULL
                         THEN TO_TIMESTAMP_TZ(rec.fusion_last_update_date, 'YYYY-MM-DD"T"HH24:MI:SS.FFTZHTZM')
                         ELSE NULL END,
                    rec.fusion_last_updated_by,
                    USER,
                    SYSTIMESTAMP
                );

                p_success_count := p_success_count + 1;

            EXCEPTION
                WHEN OTHERS THEN
                    p_error_count := p_error_count + 1;
                    -- Log error but continue processing
                    DBMS_OUTPUT.PUT_LINE('Error inserting: ' || rec.journal_name || ' - ' || SQLERRM);
            END;
        END LOOP;

        COMMIT;
        p_result := 'Completed: ' || p_success_count || ' inserted, ' || p_error_count || ' errors';

    EXCEPTION
        WHEN OTHERS THEN
            p_result := 'ERROR: ' || SQLERRM;
            ROLLBACK;
    END insert_journal_batches;

    -- --------------------------------------------------------
    -- Delete journal batches by period (for re-sync)
    -- --------------------------------------------------------
    PROCEDURE delete_by_period(
        p_period_name   IN VARCHAR2,
        p_deleted_count OUT NUMBER
    ) IS
    BEGIN
        DELETE FROM REERP_GL_JOURNAL_BATCHES
        WHERE PERIOD_NAME = p_period_name;

        p_deleted_count := SQL%ROWCOUNT;
        COMMIT;
    END delete_by_period;

END REERP_GL_JOURNAL_PKG;
/
