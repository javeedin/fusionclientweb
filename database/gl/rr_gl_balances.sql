-- =====================================================
-- RR_GL_BALANCES Table and Package
-- Trial Balance / GL Balances Storage
-- =====================================================

-- Drop existing objects (uncomment if needed)
-- DROP TABLE rr_gl_balances CASCADE CONSTRAINTS;
-- DROP PACKAGE rr_gl_balances_pkg;

-- =====================================================
-- 1. CREATE TABLE
-- =====================================================
CREATE TABLE rr_gl_balances (
    balance_id              NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ledger_id               NUMBER NOT NULL,
    period_name             VARCHAR2(30) NOT NULL,
    period_year             NUMBER(4) NOT NULL,
    period_num              NUMBER(2) NOT NULL,
    period_type             VARCHAR2(30),
    actual_flag             VARCHAR2(1) NOT NULL,  -- A=Actual, B=Budget, E=Encumbrance
    -- Account Segments
    company                 VARCHAR2(30),
    lob                     VARCHAR2(30),
    department              VARCHAR2(30),
    account                 VARCHAR2(30) NOT NULL,
    account_desc            VARCHAR2(240),
    sub_account             VARCHAR2(30),
    analysis                VARCHAR2(30),
    intercompany            VARCHAR2(30),
    future1                 VARCHAR2(30),
    future2                 VARCHAR2(30),
    -- Account Info
    account_type            VARCHAR2(1),  -- A=Asset, L=Liability, E=Equity, R=Revenue, X=Expense
    currency                VARCHAR2(15),
    currency_code           VARCHAR2(15),
    -- Balances
    opening_balance         NUMBER DEFAULT 0,
    period_activity         NUMBER DEFAULT 0,
    closing_balance         NUMBER DEFAULT 0,
    debit                   NUMBER DEFAULT 0,
    credit                  NUMBER DEFAULT 0,
    -- Audit columns
    created_by              VARCHAR2(100) DEFAULT USER,
    creation_date           TIMESTAMP DEFAULT SYSTIMESTAMP,
    last_updated_by         VARCHAR2(100) DEFAULT USER,
    last_update_date        TIMESTAMP DEFAULT SYSTIMESTAMP,
    -- Unique constraint on natural key
    CONSTRAINT rr_gl_balances_uk UNIQUE (
        ledger_id, period_name, period_year, period_num, actual_flag,
        company, lob, department, account, sub_account, analysis,
        intercompany, currency
    )
);

-- Create indexes for common queries
CREATE INDEX rr_gl_balances_period_idx ON rr_gl_balances (period_name, period_year);
CREATE INDEX rr_gl_balances_account_idx ON rr_gl_balances (account, account_type);
CREATE INDEX rr_gl_balances_ledger_idx ON rr_gl_balances (ledger_id);
CREATE INDEX rr_gl_balances_company_idx ON rr_gl_balances (company, department);

-- Add comments
COMMENT ON TABLE rr_gl_balances IS 'GL Balances / Trial Balance data synced from Oracle Fusion';
COMMENT ON COLUMN rr_gl_balances.actual_flag IS 'A=Actual, B=Budget, E=Encumbrance';
COMMENT ON COLUMN rr_gl_balances.account_type IS 'A=Asset, L=Liability, E=Equity, R=Revenue, X=Expense';

-- =====================================================
-- 2. CREATE PACKAGE SPECIFICATION
-- =====================================================
CREATE OR REPLACE PACKAGE rr_gl_balances_pkg AS

    -- Type for balance record
    TYPE balance_rec_type IS RECORD (
        period_type         VARCHAR2(30),
        period_name         VARCHAR2(30),
        actual_flag         VARCHAR2(1),
        period_year         VARCHAR2(10),
        period_num          VARCHAR2(10),
        ledger_id           VARCHAR2(30),
        company             VARCHAR2(30),
        lob                 VARCHAR2(30),
        department          VARCHAR2(30),
        account             VARCHAR2(30),
        account_desc        VARCHAR2(240),
        sub_account         VARCHAR2(30),
        analysis            VARCHAR2(30),
        intercompany        VARCHAR2(30),
        future1             VARCHAR2(30),
        future2             VARCHAR2(30),
        account_type        VARCHAR2(1),
        currency            VARCHAR2(15),
        opening_balance     NUMBER,
        period_activity     NUMBER,
        closing_balance     NUMBER,
        debit               NUMBER,
        credit              NUMBER,
        currency_code       VARCHAR2(15)
    );

    TYPE balance_tab_type IS TABLE OF balance_rec_type;

    -- Insert or update a single balance record
    PROCEDURE upsert_balance (
        p_period_type       IN VARCHAR2,
        p_period_name       IN VARCHAR2,
        p_actual_flag       IN VARCHAR2,
        p_period_year       IN NUMBER,
        p_period_num        IN NUMBER,
        p_ledger_id         IN NUMBER,
        p_company           IN VARCHAR2,
        p_lob               IN VARCHAR2,
        p_department        IN VARCHAR2,
        p_account           IN VARCHAR2,
        p_account_desc      IN VARCHAR2,
        p_sub_account       IN VARCHAR2,
        p_analysis          IN VARCHAR2,
        p_intercompany      IN VARCHAR2,
        p_future1           IN VARCHAR2,
        p_future2           IN VARCHAR2,
        p_account_type      IN VARCHAR2,
        p_currency          IN VARCHAR2,
        p_opening_balance   IN NUMBER,
        p_period_activity   IN NUMBER,
        p_closing_balance   IN NUMBER,
        p_debit             IN NUMBER,
        p_credit            IN NUMBER,
        p_currency_code     IN VARCHAR2,
        p_balance_id        OUT NUMBER,
        p_action            OUT VARCHAR2
    );

    -- Process JSON array of balances
    PROCEDURE process_balances_json (
        p_json_data     IN CLOB,
        p_inserted      OUT NUMBER,
        p_updated       OUT NUMBER,
        p_errors        OUT NUMBER,
        p_error_msg     OUT VARCHAR2
    );

    -- Delete balances for a period
    PROCEDURE delete_period_balances (
        p_ledger_id     IN NUMBER,
        p_period_name   IN VARCHAR2,
        p_period_year   IN NUMBER,
        p_deleted       OUT NUMBER
    );

    -- Get balances summary
    FUNCTION get_period_summary (
        p_ledger_id     IN NUMBER,
        p_period_name   IN VARCHAR2,
        p_period_year   IN NUMBER
    ) RETURN SYS_REFCURSOR;

END rr_gl_balances_pkg;
/

-- =====================================================
-- 3. CREATE PACKAGE BODY
-- =====================================================
CREATE OR REPLACE PACKAGE BODY rr_gl_balances_pkg AS

    -- =========================================
    -- Upsert a single balance record
    -- =========================================
    PROCEDURE upsert_balance (
        p_period_type       IN VARCHAR2,
        p_period_name       IN VARCHAR2,
        p_actual_flag       IN VARCHAR2,
        p_period_year       IN NUMBER,
        p_period_num        IN NUMBER,
        p_ledger_id         IN NUMBER,
        p_company           IN VARCHAR2,
        p_lob               IN VARCHAR2,
        p_department        IN VARCHAR2,
        p_account           IN VARCHAR2,
        p_account_desc      IN VARCHAR2,
        p_sub_account       IN VARCHAR2,
        p_analysis          IN VARCHAR2,
        p_intercompany      IN VARCHAR2,
        p_future1           IN VARCHAR2,
        p_future2           IN VARCHAR2,
        p_account_type      IN VARCHAR2,
        p_currency          IN VARCHAR2,
        p_opening_balance   IN NUMBER,
        p_period_activity   IN NUMBER,
        p_closing_balance   IN NUMBER,
        p_debit             IN NUMBER,
        p_credit            IN NUMBER,
        p_currency_code     IN VARCHAR2,
        p_balance_id        OUT NUMBER,
        p_action            OUT VARCHAR2
    ) IS
        v_existing_id NUMBER;
    BEGIN
        -- Check if record exists
        BEGIN
            SELECT balance_id INTO v_existing_id
            FROM rr_gl_balances
            WHERE ledger_id = p_ledger_id
              AND period_name = p_period_name
              AND period_year = p_period_year
              AND period_num = p_period_num
              AND actual_flag = p_actual_flag
              AND NVL(company, '~') = NVL(p_company, '~')
              AND NVL(lob, '~') = NVL(p_lob, '~')
              AND NVL(department, '~') = NVL(p_department, '~')
              AND account = p_account
              AND NVL(sub_account, '~') = NVL(p_sub_account, '~')
              AND NVL(analysis, '~') = NVL(p_analysis, '~')
              AND NVL(intercompany, '~') = NVL(p_intercompany, '~')
              AND NVL(currency, '~') = NVL(p_currency, '~');

            -- Record exists, update it
            UPDATE rr_gl_balances
            SET period_type = p_period_type,
                account_desc = p_account_desc,
                future1 = p_future1,
                future2 = p_future2,
                account_type = p_account_type,
                opening_balance = NVL(p_opening_balance, 0),
                period_activity = NVL(p_period_activity, 0),
                closing_balance = NVL(p_closing_balance, 0),
                debit = NVL(p_debit, 0),
                credit = NVL(p_credit, 0),
                currency_code = p_currency_code,
                last_updated_by = USER,
                last_update_date = SYSTIMESTAMP
            WHERE balance_id = v_existing_id;

            p_balance_id := v_existing_id;
            p_action := 'UPDATED';

        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                -- Record doesn't exist, insert it
                INSERT INTO rr_gl_balances (
                    ledger_id, period_name, period_year, period_num, period_type,
                    actual_flag, company, lob, department, account, account_desc,
                    sub_account, analysis, intercompany, future1, future2,
                    account_type, currency, opening_balance, period_activity,
                    closing_balance, debit, credit, currency_code
                ) VALUES (
                    p_ledger_id, p_period_name, p_period_year, p_period_num, p_period_type,
                    p_actual_flag, p_company, p_lob, p_department, p_account, p_account_desc,
                    p_sub_account, p_analysis, p_intercompany, p_future1, p_future2,
                    p_account_type, p_currency, NVL(p_opening_balance, 0), NVL(p_period_activity, 0),
                    NVL(p_closing_balance, 0), NVL(p_debit, 0), NVL(p_credit, 0), p_currency_code
                ) RETURNING balance_id INTO p_balance_id;

                p_action := 'INSERTED';
        END;

    END upsert_balance;

    -- =========================================
    -- Process JSON array of balances
    -- =========================================
    PROCEDURE process_balances_json (
        p_json_data     IN CLOB,
        p_inserted      OUT NUMBER,
        p_updated       OUT NUMBER,
        p_errors        OUT NUMBER,
        p_error_msg     OUT VARCHAR2
    ) IS
        v_balance_id    NUMBER;
        v_action        VARCHAR2(20);
        v_error_detail  VARCHAR2(4000);
    BEGIN
        p_inserted := 0;
        p_updated := 0;
        p_errors := 0;
        p_error_msg := NULL;

        -- Process each item in the JSON array
        FOR rec IN (
            SELECT jt.*
            FROM JSON_TABLE(p_json_data, '$.items[*]'
                COLUMNS (
                    period_type     VARCHAR2(30)  PATH '$.period_type',
                    period_name     VARCHAR2(30)  PATH '$.period_name',
                    actual_flag     VARCHAR2(1)   PATH '$.actual_flag',
                    period_year     VARCHAR2(10)  PATH '$.period_year',
                    period_num      VARCHAR2(10)  PATH '$.period_num',
                    ledger_id       VARCHAR2(30)  PATH '$.ledger_id',
                    company         VARCHAR2(30)  PATH '$.company',
                    lob             VARCHAR2(30)  PATH '$.lob',
                    department      VARCHAR2(30)  PATH '$.department',
                    account         VARCHAR2(30)  PATH '$.account',
                    account_desc    VARCHAR2(240) PATH '$.account_desc',
                    sub_account     VARCHAR2(30)  PATH '$.sub_account',
                    analysis        VARCHAR2(30)  PATH '$.analysis',
                    intercompany    VARCHAR2(30)  PATH '$.intercompany',
                    future1         VARCHAR2(30)  PATH '$.future1',
                    future2         VARCHAR2(30)  PATH '$.future2',
                    account_type    VARCHAR2(1)   PATH '$.account_type',
                    currency        VARCHAR2(15)  PATH '$.currency',
                    opening_balance NUMBER        PATH '$.opening_balance',
                    period_activity NUMBER        PATH '$.period_activity',
                    closing_balance NUMBER        PATH '$.closing_balance',
                    debit           NUMBER        PATH '$.debit',
                    credit          NUMBER        PATH '$.credit',
                    currency_code   VARCHAR2(15)  PATH '$.currency_code'
                )
            ) jt
        ) LOOP
            BEGIN
                upsert_balance(
                    p_period_type       => rec.period_type,
                    p_period_name       => rec.period_name,
                    p_actual_flag       => NVL(rec.actual_flag, 'A'),
                    p_period_year       => TO_NUMBER(rec.period_year),
                    p_period_num        => TO_NUMBER(rec.period_num),
                    p_ledger_id         => TO_NUMBER(rec.ledger_id),
                    p_company           => rec.company,
                    p_lob               => rec.lob,
                    p_department        => rec.department,
                    p_account           => rec.account,
                    p_account_desc      => rec.account_desc,
                    p_sub_account       => rec.sub_account,
                    p_analysis          => rec.analysis,
                    p_intercompany      => rec.intercompany,
                    p_future1           => rec.future1,
                    p_future2           => rec.future2,
                    p_account_type      => rec.account_type,
                    p_currency          => rec.currency,
                    p_opening_balance   => rec.opening_balance,
                    p_period_activity   => rec.period_activity,
                    p_closing_balance   => rec.closing_balance,
                    p_debit             => rec.debit,
                    p_credit            => rec.credit,
                    p_currency_code     => rec.currency_code,
                    p_balance_id        => v_balance_id,
                    p_action            => v_action
                );

                IF v_action = 'INSERTED' THEN
                    p_inserted := p_inserted + 1;
                ELSE
                    p_updated := p_updated + 1;
                END IF;

            EXCEPTION
                WHEN OTHERS THEN
                    p_errors := p_errors + 1;
                    v_error_detail := 'Account ' || rec.account || ': ' || SQLERRM;
                    IF p_error_msg IS NULL THEN
                        p_error_msg := v_error_detail;
                    ELSIF LENGTH(p_error_msg) < 3500 THEN
                        p_error_msg := p_error_msg || '; ' || v_error_detail;
                    END IF;
            END;
        END LOOP;

        COMMIT;

    EXCEPTION
        WHEN OTHERS THEN
            p_error_msg := 'Fatal error: ' || SQLERRM;
            ROLLBACK;
    END process_balances_json;

    -- =========================================
    -- Delete balances for a period
    -- =========================================
    PROCEDURE delete_period_balances (
        p_ledger_id     IN NUMBER,
        p_period_name   IN VARCHAR2,
        p_period_year   IN NUMBER,
        p_deleted       OUT NUMBER
    ) IS
    BEGIN
        DELETE FROM rr_gl_balances
        WHERE ledger_id = p_ledger_id
          AND period_name = p_period_name
          AND period_year = p_period_year;

        p_deleted := SQL%ROWCOUNT;
        COMMIT;
    END delete_period_balances;

    -- =========================================
    -- Get balances summary for a period
    -- =========================================
    FUNCTION get_period_summary (
        p_ledger_id     IN NUMBER,
        p_period_name   IN VARCHAR2,
        p_period_year   IN NUMBER
    ) RETURN SYS_REFCURSOR IS
        v_cursor SYS_REFCURSOR;
    BEGIN
        OPEN v_cursor FOR
            SELECT
                account_type,
                COUNT(*) as account_count,
                SUM(opening_balance) as total_opening,
                SUM(debit) as total_debit,
                SUM(credit) as total_credit,
                SUM(closing_balance) as total_closing
            FROM rr_gl_balances
            WHERE ledger_id = p_ledger_id
              AND period_name = p_period_name
              AND period_year = p_period_year
            GROUP BY account_type
            ORDER BY account_type;

        RETURN v_cursor;
    END get_period_summary;

END rr_gl_balances_pkg;
/
