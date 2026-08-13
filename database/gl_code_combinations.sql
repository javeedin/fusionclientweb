-- ============================================================================
-- GL Code Combinations Table Structure, PL/SQL Procedure, and APEX REST Handler
-- ============================================================================

-- ============================================================================
-- 1. TABLE: REERP_GL_CODE_COMBINATIONS
-- ============================================================================
CREATE TABLE reerp_gl_code_combinations (
    -- Primary Key
    code_combination_id       NUMBER(18)      NOT NULL,
    chart_of_accounts_id      NUMBER(18)      NOT NULL,

    -- Segment Values (Chart of Accounts Segments)
    segment1_company          VARCHAR2(30),    -- buimercFinGlbCoaCo
    segment2_lob              VARCHAR2(30),    -- buimercFinGlbCoaLob
    segment3_department       VARCHAR2(30),    -- buimercFinGlbCoaDepartment
    segment4_account          VARCHAR2(30),    -- buimercFinGlbCoaAccount
    segment5_sub_account      VARCHAR2(30),    -- buimercFinGlbCoaSubAcc
    segment6_analysis         VARCHAR2(30),    -- buimercFinGlbCoaAlys
    segment7_intercompany     VARCHAR2(30),    -- buimercFinGlbCoaIc
    segment8_future1          VARCHAR2(30),    -- buimercFinGlbCoaFut1
    segment9_future2          VARCHAR2(30),    -- buimercFinGlbCoaFut2

    -- Concatenated Segments (for display/search)
    concatenated_segments     VARCHAR2(500)   GENERATED ALWAYS AS (
        segment1_company || '-' ||
        segment2_lob || '-' ||
        segment3_department || '-' ||
        segment4_account || '-' ||
        segment5_sub_account || '-' ||
        segment6_analysis || '-' ||
        segment7_intercompany || '-' ||
        segment8_future1 || '-' ||
        segment9_future2
    ) VIRTUAL,

    -- Account Attributes
    account_type              VARCHAR2(1),     -- A=Asset, L=Liability, O=Owner's Equity, R=Revenue, E=Expense
    summary_flag              VARCHAR2(1)     DEFAULT 'N',
    enabled_flag              VARCHAR2(1)     DEFAULT 'Y',

    -- Posting and Budgeting Flags
    detail_posting_allowed    VARCHAR2(1)     DEFAULT 'Y',
    detail_budgeting_allowed  VARCHAR2(1)     DEFAULT 'Y',

    -- Reconciliation
    jgzz_recon_flag           VARCHAR2(1)     DEFAULT 'N',

    -- Reference Fields
    reference3                VARCHAR2(150),
    financial_category        VARCHAR2(100),

    -- Effective Dates
    start_date_active         DATE,
    end_date_active           DATE,

    -- Audit Columns
    created_by                VARCHAR2(100)   DEFAULT USER,
    creation_date             TIMESTAMP       DEFAULT SYSTIMESTAMP,
    last_updated_by           VARCHAR2(100),
    last_update_date          TIMESTAMP,

    -- Constraints
    CONSTRAINT reerp_gl_cc_pk PRIMARY KEY (code_combination_id),
    CONSTRAINT reerp_gl_cc_coa_fk FOREIGN KEY (chart_of_accounts_id)
        REFERENCES reerp_chart_of_accounts(chart_of_accounts_id),
    CONSTRAINT reerp_gl_cc_acct_type_chk CHECK (account_type IN ('A', 'L', 'O', 'R', 'E')),
    CONSTRAINT reerp_gl_cc_summary_chk CHECK (summary_flag IN ('Y', 'N')),
    CONSTRAINT reerp_gl_cc_enabled_chk CHECK (enabled_flag IN ('Y', 'N')),
    CONSTRAINT reerp_gl_cc_posting_chk CHECK (detail_posting_allowed IN ('Y', 'N')),
    CONSTRAINT reerp_gl_cc_budget_chk CHECK (detail_budgeting_allowed IN ('Y', 'N'))
);

-- Indexes for performance
CREATE INDEX reerp_gl_cc_coa_idx ON reerp_gl_code_combinations(chart_of_accounts_id);
CREATE INDEX reerp_gl_cc_account_idx ON reerp_gl_code_combinations(segment4_account);
CREATE INDEX reerp_gl_cc_company_idx ON reerp_gl_code_combinations(segment1_company);
CREATE INDEX reerp_gl_cc_enabled_idx ON reerp_gl_code_combinations(enabled_flag);
CREATE INDEX reerp_gl_cc_concat_idx ON reerp_gl_code_combinations(concatenated_segments);

-- Comments
COMMENT ON TABLE reerp_gl_code_combinations IS 'Stores GL Code Combinations (Chart of Accounts segment combinations)';
COMMENT ON COLUMN reerp_gl_code_combinations.code_combination_id IS 'Unique identifier for the code combination';
COMMENT ON COLUMN reerp_gl_code_combinations.account_type IS 'Account type: A=Asset, L=Liability, O=Owners Equity, R=Revenue, E=Expense';
COMMENT ON COLUMN reerp_gl_code_combinations.concatenated_segments IS 'Virtual column with all segments concatenated';


-- ============================================================================
-- 2. STAGING TABLE: REERP_GL_CODE_COMB_STG (for bulk loading)
-- ============================================================================
CREATE TABLE reerp_gl_code_comb_stg (
    stg_id                    NUMBER GENERATED ALWAYS AS IDENTITY,
    batch_id                  NUMBER,
    code_combination_id       NUMBER(18),
    chart_of_accounts_id      NUMBER(18),
    segment1_company          VARCHAR2(30),
    segment2_lob              VARCHAR2(30),
    segment3_department       VARCHAR2(30),
    segment4_account          VARCHAR2(30),
    segment5_sub_account      VARCHAR2(30),
    segment6_analysis         VARCHAR2(30),
    segment7_intercompany     VARCHAR2(30),
    segment8_future1          VARCHAR2(30),
    segment9_future2          VARCHAR2(30),
    account_type              VARCHAR2(1),
    summary_flag              VARCHAR2(1),
    enabled_flag              VARCHAR2(1),
    detail_posting_allowed    VARCHAR2(1),
    detail_budgeting_allowed  VARCHAR2(1),
    jgzz_recon_flag           VARCHAR2(1),
    reference3                VARCHAR2(150),
    financial_category        VARCHAR2(100),
    start_date_active         DATE,
    end_date_active           DATE,
    process_status            VARCHAR2(20)    DEFAULT 'PENDING',  -- PENDING, PROCESSED, ERROR
    error_message             VARCHAR2(4000),
    created_date              TIMESTAMP       DEFAULT SYSTIMESTAMP,
    CONSTRAINT reerp_gl_cc_stg_pk PRIMARY KEY (stg_id)
);


-- ============================================================================
-- 3. PL/SQL PACKAGE SPECIFICATION: REERP_GL_CODE_COMB_PKG
-- ============================================================================
CREATE OR REPLACE PACKAGE reerp_gl_code_comb_pkg AS

    -- Type for single code combination record
    TYPE t_code_combination_rec IS RECORD (
        code_combination_id       NUMBER,
        chart_of_accounts_id      NUMBER,
        segment1_company          VARCHAR2(30),
        segment2_lob              VARCHAR2(30),
        segment3_department       VARCHAR2(30),
        segment4_account          VARCHAR2(30),
        segment5_sub_account      VARCHAR2(30),
        segment6_analysis         VARCHAR2(30),
        segment7_intercompany     VARCHAR2(30),
        segment8_future1          VARCHAR2(30),
        segment9_future2          VARCHAR2(30),
        account_type              VARCHAR2(1),
        summary_flag              VARCHAR2(1),
        enabled_flag              VARCHAR2(1),
        detail_posting_allowed    VARCHAR2(1),
        detail_budgeting_allowed  VARCHAR2(1),
        jgzz_recon_flag           VARCHAR2(1),
        reference3                VARCHAR2(150),
        financial_category        VARCHAR2(100),
        start_date_active         DATE,
        end_date_active           DATE
    );

    -- Type for table of records
    TYPE t_code_combination_tab IS TABLE OF t_code_combination_rec;

    -- Procedure to process single code combination (MERGE - insert or update)
    PROCEDURE process_code_combination (
        p_code_combination_id     IN NUMBER,
        p_chart_of_accounts_id    IN NUMBER,
        p_segment1_company        IN VARCHAR2,
        p_segment2_lob            IN VARCHAR2,
        p_segment3_department     IN VARCHAR2,
        p_segment4_account        IN VARCHAR2,
        p_segment5_sub_account    IN VARCHAR2,
        p_segment6_analysis       IN VARCHAR2,
        p_segment7_intercompany   IN VARCHAR2,
        p_segment8_future1        IN VARCHAR2,
        p_segment9_future2        IN VARCHAR2,
        p_account_type            IN VARCHAR2,
        p_summary_flag            IN VARCHAR2,
        p_enabled_flag            IN VARCHAR2,
        p_detail_posting_allowed  IN VARCHAR2,
        p_detail_budgeting_allowed IN VARCHAR2,
        p_jgzz_recon_flag         IN VARCHAR2,
        p_reference3              IN VARCHAR2,
        p_financial_category      IN VARCHAR2,
        p_start_date_active       IN DATE,
        p_end_date_active         IN DATE,
        p_status                  OUT VARCHAR2,
        p_message                 OUT VARCHAR2
    );

    -- Procedure to process JSON payload (for REST API)
    PROCEDURE process_json_payload (
        p_json_payload    IN  CLOB,
        p_batch_id        OUT NUMBER,
        p_total_count     OUT NUMBER,
        p_success_count   OUT NUMBER,
        p_error_count     OUT NUMBER,
        p_status          OUT VARCHAR2,
        p_message         OUT VARCHAR2
    );

    -- Procedure to process staging table records
    PROCEDURE process_staging_batch (
        p_batch_id        IN  NUMBER,
        p_success_count   OUT NUMBER,
        p_error_count     OUT NUMBER
    );

    -- Function to validate code combination
    FUNCTION validate_code_combination (
        p_code_combination_id     IN NUMBER,
        p_chart_of_accounts_id    IN NUMBER
    ) RETURN VARCHAR2;

    -- Function to get code combination by segments
    FUNCTION get_ccid_by_segments (
        p_segment1_company        IN VARCHAR2,
        p_segment2_lob            IN VARCHAR2,
        p_segment3_department     IN VARCHAR2,
        p_segment4_account        IN VARCHAR2,
        p_segment5_sub_account    IN VARCHAR2,
        p_segment6_analysis       IN VARCHAR2,
        p_segment7_intercompany   IN VARCHAR2,
        p_segment8_future1        IN VARCHAR2,
        p_segment9_future2        IN VARCHAR2
    ) RETURN NUMBER;

END reerp_gl_code_comb_pkg;
/


-- ============================================================================
-- 4. PL/SQL PACKAGE BODY: REERP_GL_CODE_COMB_PKG
-- ============================================================================
CREATE OR REPLACE PACKAGE BODY reerp_gl_code_comb_pkg AS

    -- ========================================================================
    -- Process single code combination (MERGE - insert or update)
    -- ========================================================================
    PROCEDURE process_code_combination (
        p_code_combination_id     IN NUMBER,
        p_chart_of_accounts_id    IN NUMBER,
        p_segment1_company        IN VARCHAR2,
        p_segment2_lob            IN VARCHAR2,
        p_segment3_department     IN VARCHAR2,
        p_segment4_account        IN VARCHAR2,
        p_segment5_sub_account    IN VARCHAR2,
        p_segment6_analysis       IN VARCHAR2,
        p_segment7_intercompany   IN VARCHAR2,
        p_segment8_future1        IN VARCHAR2,
        p_segment9_future2        IN VARCHAR2,
        p_account_type            IN VARCHAR2,
        p_summary_flag            IN VARCHAR2,
        p_enabled_flag            IN VARCHAR2,
        p_detail_posting_allowed  IN VARCHAR2,
        p_detail_budgeting_allowed IN VARCHAR2,
        p_jgzz_recon_flag         IN VARCHAR2,
        p_reference3              IN VARCHAR2,
        p_financial_category      IN VARCHAR2,
        p_start_date_active       IN DATE,
        p_end_date_active         IN DATE,
        p_status                  OUT VARCHAR2,
        p_message                 OUT VARCHAR2
    ) AS
    BEGIN
        -- MERGE: Insert if not exists, Update if exists
        MERGE INTO reerp_gl_code_combinations tgt
        USING (
            SELECT
                p_code_combination_id     AS code_combination_id,
                p_chart_of_accounts_id    AS chart_of_accounts_id,
                p_segment1_company        AS segment1_company,
                p_segment2_lob            AS segment2_lob,
                p_segment3_department     AS segment3_department,
                p_segment4_account        AS segment4_account,
                p_segment5_sub_account    AS segment5_sub_account,
                p_segment6_analysis       AS segment6_analysis,
                p_segment7_intercompany   AS segment7_intercompany,
                p_segment8_future1        AS segment8_future1,
                p_segment9_future2        AS segment9_future2,
                p_account_type            AS account_type,
                p_summary_flag            AS summary_flag,
                p_enabled_flag            AS enabled_flag,
                p_detail_posting_allowed  AS detail_posting_allowed,
                p_detail_budgeting_allowed AS detail_budgeting_allowed,
                p_jgzz_recon_flag         AS jgzz_recon_flag,
                p_reference3              AS reference3,
                p_financial_category      AS financial_category,
                p_start_date_active       AS start_date_active,
                p_end_date_active         AS end_date_active
            FROM dual
        ) src
        ON (tgt.code_combination_id = src.code_combination_id)
        WHEN MATCHED THEN
            UPDATE SET
                tgt.chart_of_accounts_id    = src.chart_of_accounts_id,
                tgt.segment1_company        = src.segment1_company,
                tgt.segment2_lob            = src.segment2_lob,
                tgt.segment3_department     = src.segment3_department,
                tgt.segment4_account        = src.segment4_account,
                tgt.segment5_sub_account    = src.segment5_sub_account,
                tgt.segment6_analysis       = src.segment6_analysis,
                tgt.segment7_intercompany   = src.segment7_intercompany,
                tgt.segment8_future1        = src.segment8_future1,
                tgt.segment9_future2        = src.segment9_future2,
                tgt.account_type            = src.account_type,
                tgt.summary_flag            = src.summary_flag,
                tgt.enabled_flag            = src.enabled_flag,
                tgt.detail_posting_allowed  = src.detail_posting_allowed,
                tgt.detail_budgeting_allowed = src.detail_budgeting_allowed,
                tgt.jgzz_recon_flag         = src.jgzz_recon_flag,
                tgt.reference3              = src.reference3,
                tgt.financial_category      = src.financial_category,
                tgt.start_date_active       = src.start_date_active,
                tgt.end_date_active         = src.end_date_active,
                tgt.last_updated_by         = USER,
                tgt.last_update_date        = SYSTIMESTAMP
        WHEN NOT MATCHED THEN
            INSERT (
                code_combination_id,
                chart_of_accounts_id,
                segment1_company,
                segment2_lob,
                segment3_department,
                segment4_account,
                segment5_sub_account,
                segment6_analysis,
                segment7_intercompany,
                segment8_future1,
                segment9_future2,
                account_type,
                summary_flag,
                enabled_flag,
                detail_posting_allowed,
                detail_budgeting_allowed,
                jgzz_recon_flag,
                reference3,
                financial_category,
                start_date_active,
                end_date_active,
                created_by,
                creation_date
            ) VALUES (
                src.code_combination_id,
                src.chart_of_accounts_id,
                src.segment1_company,
                src.segment2_lob,
                src.segment3_department,
                src.segment4_account,
                src.segment5_sub_account,
                src.segment6_analysis,
                src.segment7_intercompany,
                src.segment8_future1,
                src.segment9_future2,
                src.account_type,
                src.summary_flag,
                src.enabled_flag,
                src.detail_posting_allowed,
                src.detail_budgeting_allowed,
                src.jgzz_recon_flag,
                src.reference3,
                src.financial_category,
                src.start_date_active,
                src.end_date_active,
                USER,
                SYSTIMESTAMP
            );

        p_status := 'SUCCESS';
        p_message := 'Code combination processed successfully. CCID: ' || p_code_combination_id;

    EXCEPTION
        WHEN OTHERS THEN
            p_status := 'ERROR';
            p_message := 'Error processing code combination: ' || SQLERRM;
    END process_code_combination;

    -- ========================================================================
    -- Process JSON payload from REST API
    -- ========================================================================
    PROCEDURE process_json_payload (
        p_json_payload    IN  CLOB,
        p_batch_id        OUT NUMBER,
        p_total_count     OUT NUMBER,
        p_success_count   OUT NUMBER,
        p_error_count     OUT NUMBER,
        p_status          OUT VARCHAR2,
        p_message         OUT VARCHAR2
    ) AS
        l_items       JSON_ARRAY_T;
        l_item        JSON_OBJECT_T;
        l_json_obj    JSON_OBJECT_T;
        l_status      VARCHAR2(20);
        l_msg         VARCHAR2(4000);
    BEGIN
        -- Generate batch ID
        SELECT NVL(MAX(batch_id), 0) + 1 INTO p_batch_id FROM reerp_gl_code_comb_stg;

        -- Parse JSON
        l_json_obj := JSON_OBJECT_T.parse(p_json_payload);
        l_items := l_json_obj.get_Array('items');

        p_total_count := l_items.get_size();
        p_success_count := 0;
        p_error_count := 0;

        -- Process each item
        FOR i IN 0 .. l_items.get_size() - 1 LOOP
            l_item := TREAT(l_items.get(i) AS JSON_OBJECT_T);

            BEGIN
                -- Insert into staging table
                INSERT INTO reerp_gl_code_comb_stg (
                    batch_id,
                    code_combination_id,
                    chart_of_accounts_id,
                    segment1_company,
                    segment2_lob,
                    segment3_department,
                    segment4_account,
                    segment5_sub_account,
                    segment6_analysis,
                    segment7_intercompany,
                    segment8_future1,
                    segment9_future2,
                    account_type,
                    summary_flag,
                    enabled_flag,
                    detail_posting_allowed,
                    detail_budgeting_allowed,
                    jgzz_recon_flag,
                    reference3,
                    financial_category,
                    start_date_active,
                    end_date_active,
                    process_status
                ) VALUES (
                    p_batch_id,
                    l_item.get_Number('_CODE_COMBINATION_ID'),
                    l_item.get_Number('_CHART_OF_ACCOUNTS_ID'),
                    l_item.get_String('buimercFinGlbCoaCo'),
                    l_item.get_String('buimercFinGlbCoaLob'),
                    l_item.get_String('buimercFinGlbCoaDepartment'),
                    l_item.get_String('buimercFinGlbCoaAccount'),
                    l_item.get_String('buimercFinGlbCoaSubAcc'),
                    l_item.get_String('buimercFinGlbCoaAlys'),
                    l_item.get_String('buimercFinGlbCoaIc'),
                    l_item.get_String('buimercFinGlbCoaFut1'),
                    l_item.get_String('buimercFinGlbCoaFut2'),
                    l_item.get_String('AccountType'),
                    l_item.get_String('SummaryFlag'),
                    l_item.get_String('EnabledFlag'),
                    l_item.get_String('DetailPostingAllowedFlag'),
                    l_item.get_String('DetailBudgetingAllowedFlag'),
                    l_item.get_String('JgzzReconFlag'),
                    l_item.get_String('Reference3'),
                    l_item.get_String('FinancialCategory'),
                    TO_DATE(l_item.get_String('StartDateActive'), 'YYYY-MM-DD'),
                    CASE
                        WHEN l_item.get_String('EndDateActive') IS NOT NULL
                        THEN TO_DATE(l_item.get_String('EndDateActive'), 'YYYY-MM-DD')
                        ELSE NULL
                    END,
                    'PENDING'
                );

                p_success_count := p_success_count + 1;

            EXCEPTION
                WHEN OTHERS THEN
                    p_error_count := p_error_count + 1;
                    -- Log error but continue processing
                    INSERT INTO reerp_gl_code_comb_stg (
                        batch_id,
                        code_combination_id,
                        process_status,
                        error_message
                    ) VALUES (
                        p_batch_id,
                        l_item.get_Number('_CODE_COMBINATION_ID'),
                        'ERROR',
                        SQLERRM
                    );
            END;
        END LOOP;

        COMMIT;

        -- Process staging records to main table
        process_staging_batch(p_batch_id, p_success_count, p_error_count);

        p_status := 'SUCCESS';
        p_message := 'Processed ' || p_total_count || ' records. Success: ' || p_success_count || ', Errors: ' || p_error_count;

    EXCEPTION
        WHEN OTHERS THEN
            p_status := 'ERROR';
            p_message := 'Error processing JSON payload: ' || SQLERRM;
            p_total_count := 0;
            p_success_count := 0;
            p_error_count := 0;
    END process_json_payload;

    -- ========================================================================
    -- Process staging table records
    -- ========================================================================
    PROCEDURE process_staging_batch (
        p_batch_id        IN  NUMBER,
        p_success_count   OUT NUMBER,
        p_error_count     OUT NUMBER
    ) AS
        l_status  VARCHAR2(20);
        l_message VARCHAR2(4000);
    BEGIN
        p_success_count := 0;
        p_error_count := 0;

        FOR rec IN (
            SELECT *
            FROM reerp_gl_code_comb_stg
            WHERE batch_id = p_batch_id
            AND process_status = 'PENDING'
        ) LOOP
            BEGIN
                process_code_combination(
                    p_code_combination_id     => rec.code_combination_id,
                    p_chart_of_accounts_id    => rec.chart_of_accounts_id,
                    p_segment1_company        => rec.segment1_company,
                    p_segment2_lob            => rec.segment2_lob,
                    p_segment3_department     => rec.segment3_department,
                    p_segment4_account        => rec.segment4_account,
                    p_segment5_sub_account    => rec.segment5_sub_account,
                    p_segment6_analysis       => rec.segment6_analysis,
                    p_segment7_intercompany   => rec.segment7_intercompany,
                    p_segment8_future1        => rec.segment8_future1,
                    p_segment9_future2        => rec.segment9_future2,
                    p_account_type            => rec.account_type,
                    p_summary_flag            => rec.summary_flag,
                    p_enabled_flag            => rec.enabled_flag,
                    p_detail_posting_allowed  => rec.detail_posting_allowed,
                    p_detail_budgeting_allowed => rec.detail_budgeting_allowed,
                    p_jgzz_recon_flag         => rec.jgzz_recon_flag,
                    p_reference3              => rec.reference3,
                    p_financial_category      => rec.financial_category,
                    p_start_date_active       => rec.start_date_active,
                    p_end_date_active         => rec.end_date_active,
                    p_status                  => l_status,
                    p_message                 => l_message
                );

                IF l_status = 'SUCCESS' THEN
                    UPDATE reerp_gl_code_comb_stg
                    SET process_status = 'PROCESSED'
                    WHERE stg_id = rec.stg_id;
                    p_success_count := p_success_count + 1;
                ELSE
                    UPDATE reerp_gl_code_comb_stg
                    SET process_status = 'ERROR',
                        error_message = l_message
                    WHERE stg_id = rec.stg_id;
                    p_error_count := p_error_count + 1;
                END IF;

            EXCEPTION
                WHEN OTHERS THEN
                    UPDATE reerp_gl_code_comb_stg
                    SET process_status = 'ERROR',
                        error_message = SQLERRM
                    WHERE stg_id = rec.stg_id;
                    p_error_count := p_error_count + 1;
            END;
        END LOOP;

        COMMIT;

    END process_staging_batch;

    -- ========================================================================
    -- Validate code combination
    -- ========================================================================
    FUNCTION validate_code_combination (
        p_code_combination_id     IN NUMBER,
        p_chart_of_accounts_id    IN NUMBER
    ) RETURN VARCHAR2 AS
        l_count NUMBER;
    BEGIN
        SELECT COUNT(*)
        INTO l_count
        FROM reerp_gl_code_combinations
        WHERE code_combination_id = p_code_combination_id
        AND chart_of_accounts_id = p_chart_of_accounts_id
        AND enabled_flag = 'Y'
        AND (end_date_active IS NULL OR end_date_active >= SYSDATE);

        IF l_count > 0 THEN
            RETURN 'VALID';
        ELSE
            RETURN 'INVALID';
        END IF;
    END validate_code_combination;

    -- ========================================================================
    -- Get CCID by segments
    -- ========================================================================
    FUNCTION get_ccid_by_segments (
        p_segment1_company        IN VARCHAR2,
        p_segment2_lob            IN VARCHAR2,
        p_segment3_department     IN VARCHAR2,
        p_segment4_account        IN VARCHAR2,
        p_segment5_sub_account    IN VARCHAR2,
        p_segment6_analysis       IN VARCHAR2,
        p_segment7_intercompany   IN VARCHAR2,
        p_segment8_future1        IN VARCHAR2,
        p_segment9_future2        IN VARCHAR2
    ) RETURN NUMBER AS
        l_ccid NUMBER;
    BEGIN
        SELECT code_combination_id
        INTO l_ccid
        FROM reerp_gl_code_combinations
        WHERE segment1_company = p_segment1_company
        AND segment2_lob = p_segment2_lob
        AND segment3_department = p_segment3_department
        AND segment4_account = p_segment4_account
        AND segment5_sub_account = p_segment5_sub_account
        AND segment6_analysis = p_segment6_analysis
        AND segment7_intercompany = p_segment7_intercompany
        AND segment8_future1 = p_segment8_future1
        AND segment9_future2 = p_segment9_future2
        AND enabled_flag = 'Y'
        AND ROWNUM = 1;

        RETURN l_ccid;

    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            RETURN NULL;
    END get_ccid_by_segments;

END reerp_gl_code_comb_pkg;
/


-- ============================================================================
-- 5. APEX REST HANDLER - POST Handler for Loading Code Combinations
-- ============================================================================
--
-- Module: reerp
-- Template: gl/codecombinations/load
-- Method: POST
-- Source Type: PL/SQL
--
-- Handler Source:
-- ============================================================================

/*
DECLARE
    l_json_payload    CLOB;
    l_batch_id        NUMBER;
    l_total_count     NUMBER;
    l_success_count   NUMBER;
    l_error_count     NUMBER;
    l_status          VARCHAR2(20);
    l_message         VARCHAR2(4000);
BEGIN
    -- Get the JSON payload from the request body
    l_json_payload := :body_text;

    -- Process the JSON payload
    reerp_gl_code_comb_pkg.process_json_payload(
        p_json_payload    => l_json_payload,
        p_batch_id        => l_batch_id,
        p_total_count     => l_total_count,
        p_success_count   => l_success_count,
        p_error_count     => l_error_count,
        p_status          => l_status,
        p_message         => l_message
    );

    -- Set response
    :status_code := CASE WHEN l_status = 'SUCCESS' THEN 200 ELSE 500 END;

    -- Return JSON response
    apex_json.open_object;
    apex_json.write('status', l_status);
    apex_json.write('message', l_message);
    apex_json.write('batchId', l_batch_id);
    apex_json.write('totalCount', l_total_count);
    apex_json.write('successCount', l_success_count);
    apex_json.write('errorCount', l_error_count);
    apex_json.close_object;

EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        apex_json.open_object;
        apex_json.write('status', 'ERROR');
        apex_json.write('message', SQLERRM);
        apex_json.close_object;
END;
*/


-- ============================================================================
-- 6. APEX REST HANDLER - GET Handler for Retrieving Code Combinations
-- ============================================================================
--
-- Module: reerp
-- Template: gl/codecombinations
-- Method: GET
-- Source Type: Query
--
-- Handler Source (SQL Query):
-- ============================================================================

/*
SELECT
    code_combination_id AS "_CODE_COMBINATION_ID",
    chart_of_accounts_id AS "_CHART_OF_ACCOUNTS_ID",
    segment1_company AS "buimercFinGlbCoaCo",
    segment2_lob AS "buimercFinGlbCoaLob",
    segment3_department AS "buimercFinGlbCoaDepartment",
    segment4_account AS "buimercFinGlbCoaAccount",
    segment5_sub_account AS "buimercFinGlbCoaSubAcc",
    segment6_analysis AS "buimercFinGlbCoaAlys",
    segment7_intercompany AS "buimercFinGlbCoaIc",
    segment8_future1 AS "buimercFinGlbCoaFut1",
    segment9_future2 AS "buimercFinGlbCoaFut2",
    concatenated_segments AS "ConcatenatedSegments",
    account_type AS "AccountType",
    summary_flag AS "SummaryFlag",
    enabled_flag AS "EnabledFlag",
    detail_posting_allowed AS "DetailPostingAllowedFlag",
    detail_budgeting_allowed AS "DetailBudgetingAllowedFlag",
    jgzz_recon_flag AS "JgzzReconFlag",
    reference3 AS "Reference3",
    financial_category AS "FinancialCategory",
    TO_CHAR(start_date_active, 'YYYY-MM-DD') AS "StartDateActive",
    TO_CHAR(end_date_active, 'YYYY-MM-DD') AS "EndDateActive"
FROM reerp_gl_code_combinations
WHERE enabled_flag = 'Y'
AND (end_date_active IS NULL OR end_date_active >= SYSDATE)
ORDER BY concatenated_segments
*/


-- ============================================================================
-- 7. APEX REST HANDLER - GET Handler for Searching Code Combinations
-- ============================================================================
--
-- Module: reerp
-- Template: gl/codecombinations/search
-- Method: GET
-- Parameters: q (search term), account (account segment), company (company segment)
-- Source Type: PL/SQL
--
-- Handler Source:
-- ============================================================================

/*
DECLARE
    l_search_term   VARCHAR2(100) := :q;
    l_account       VARCHAR2(30)  := :account;
    l_company       VARCHAR2(30)  := :company;
    l_cursor        SYS_REFCURSOR;
BEGIN
    OPEN l_cursor FOR
        SELECT
            code_combination_id,
            concatenated_segments,
            segment4_account AS account,
            segment1_company AS company,
            account_type,
            enabled_flag
        FROM reerp_gl_code_combinations
        WHERE enabled_flag = 'Y'
        AND (end_date_active IS NULL OR end_date_active >= SYSDATE)
        AND (
            l_search_term IS NULL
            OR UPPER(concatenated_segments) LIKE '%' || UPPER(l_search_term) || '%'
        )
        AND (l_account IS NULL OR segment4_account = l_account)
        AND (l_company IS NULL OR segment1_company = l_company)
        ORDER BY concatenated_segments
        FETCH FIRST 100 ROWS ONLY;

    apex_json.open_object;
    apex_json.write('items', l_cursor);
    apex_json.close_object;
END;
*/


-- ============================================================================
-- 8. Grant permissions (adjust schema name as needed)
-- ============================================================================
-- GRANT SELECT, INSERT, UPDATE, DELETE ON reerp_gl_code_combinations TO your_apex_schema;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON reerp_gl_code_comb_stg TO your_apex_schema;
-- GRANT EXECUTE ON reerp_gl_code_comb_pkg TO your_apex_schema;
