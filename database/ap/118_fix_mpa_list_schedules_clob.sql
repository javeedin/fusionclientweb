-- ============================================================
-- 118_FIX_MPA_LIST_SCHEDULES_CLOB.SQL
-- Fix ORA-06502 in RR_AP_MPA_PKG.list_schedules
-- Root cause: VARCHAR2 || CLOB implicit cast fails when result
-- exceeds 32767 bytes. Fix: use DBMS_LOB.APPEND for all concat.
-- ============================================================

CREATE OR REPLACE PACKAGE BODY RR_AP_MPA_PKG AS

  -- ── JSON helpers ────────────────────────────────────────────────────────
  FUNCTION esc(p IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN REPLACE(REPLACE(p, CHR(92), CHR(92)||CHR(92)), '"', CHR(92)||'"');
  END;

  FUNCTION jstr(p IN VARCHAR2) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE WHEN p IS NULL THEN 'null' ELSE '"'||esc(p)||'"' END;
  END;

  FUNCTION jnum(p IN NUMBER) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE WHEN p IS NULL THEN 'null' ELSE TO_CHAR(p) END;
  END;

  FUNCTION jdate(p IN DATE) RETURN VARCHAR2 IS
  BEGIN
    RETURN CASE WHEN p IS NULL THEN 'null'
           ELSE '"'||TO_CHAR(p,'YYYY-MM-DD')||'"' END;
  END;

  -- ── internal CLOB append helper ─────────────────────────────────────────
  PROCEDURE app(p_clob IN OUT NOCOPY CLOB, p_str IN VARCHAR2) IS
  BEGIN
    DBMS_LOB.WRITEAPPEND(p_clob, LENGTH(p_str), p_str);
  END;

  -- ── generate_schedule ────────────────────────────────────────────────────
  PROCEDURE generate_schedule (
    p_invoice_id IN NUMBER
  ) IS
    v_invoice_number  VARCHAR2(50);
    v_supplier        VARCHAR2(500);
    v_supplier_number VARCHAR2(30);
    v_business_unit   VARCHAR2(200);
    v_invoice_date    DATE;
    v_currency        VARCHAR2(15);
    v_total_days      NUMBER;
    v_cur_month       DATE;
    v_period_start    DATE;
    v_period_end      DATE;
    v_period_days     NUMBER;
    v_period_amount   NUMBER;
    v_running_sum     NUMBER;
    v_last_month      DATE;
    v_period_name     VARCHAR2(20);
  BEGIN
    DELETE FROM RR_AP_INVOICE_MULTIPERIOD_SCHEDULE
     WHERE INVOICE_ID     = p_invoice_id
       AND POSTING_STATUS = 'Not Posted';

    BEGIN
      SELECT INV.INVOICE_NUMBER, INV.SUPPLIER, INV.SUPPLIER_NUMBER,
             INV.BUSINESS_UNIT, INV.INVOICE_DATE, INV.INVOICE_CURRENCY
        INTO v_invoice_number, v_supplier, v_supplier_number,
             v_business_unit, v_invoice_date, v_currency
        FROM RR_AP_INVOICES_ALL INV
       WHERE INV.INVOICE_ID = p_invoice_id;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        RAISE_APPLICATION_ERROR(-20001, 'Invoice not found: ' || p_invoice_id);
    END;

    FOR ln IN (
      SELECT LINE_NUMBER, LINE_AMOUNT, DESCRIPTION,
             DISTRIBUTION_COMBINATION,
             MULTIPERIOD_START_DATE, MULTIPERIOD_END_DATE,
             MULTIPERIOD_ACCRUAL_ACCOUNT
        FROM RR_AP_INVOICE_LINES_ALL
       WHERE INVOICE_ID             = p_invoice_id
         AND MULTIPERIOD_START_DATE IS NOT NULL
         AND MULTIPERIOD_END_DATE   IS NOT NULL
       ORDER BY LINE_NUMBER
    ) LOOP
      v_total_days  := TRUNC(ln.MULTIPERIOD_END_DATE) - TRUNC(ln.MULTIPERIOD_START_DATE) + 1;
      v_running_sum := 0;
      v_last_month  := TRUNC(ln.MULTIPERIOD_END_DATE, 'MM');
      v_cur_month   := TRUNC(ln.MULTIPERIOD_START_DATE, 'MM');

      WHILE v_cur_month <= v_last_month LOOP
        v_period_start  := GREATEST(ln.MULTIPERIOD_START_DATE, v_cur_month);
        v_period_end    := LEAST(ln.MULTIPERIOD_END_DATE, LAST_DAY(v_cur_month));
        v_period_days   := TRUNC(v_period_end) - TRUNC(v_period_start) + 1;
        v_period_name   := TO_CHAR(v_cur_month, 'Mon-YYYY');

        IF v_cur_month = v_last_month THEN
          v_period_amount := ROUND(ln.LINE_AMOUNT - v_running_sum, 2);
        ELSE
          v_period_amount := ROUND(ln.LINE_AMOUNT * v_period_days / v_total_days, 2);
        END IF;
        v_running_sum := v_running_sum + v_period_amount;

        INSERT INTO RR_AP_INVOICE_MULTIPERIOD_SCHEDULE (
          INVOICE_ID, INVOICE_NUMBER, LINE_NUMBER,
          BUSINESS_UNIT, SUPPLIER, SUPPLIER_NUMBER,
          INVOICE_DATE, PERIOD_DATE, PERIOD_NAME,
          ORIGINAL_AMOUNT, PERIOD_AMOUNT,
          ACCRUAL_ACCOUNT, CHARGE_ACCOUNT,
          DESCRIPTION, POSTING_STATUS, TRANSACTION_STATUS, CURRENCY_CODE
        ) VALUES (
          p_invoice_id, v_invoice_number, ln.LINE_NUMBER,
          v_business_unit, v_supplier, v_supplier_number,
          v_invoice_date, v_cur_month, v_period_name,
          ln.LINE_AMOUNT, v_period_amount,
          ln.MULTIPERIOD_ACCRUAL_ACCOUNT, ln.DISTRIBUTION_COMBINATION,
          ln.DESCRIPTION, 'Not Posted', 'Active', v_currency
        );

        v_cur_month := ADD_MONTHS(v_cur_month, 1);
      END LOOP;
    END LOOP;
    COMMIT;
  END generate_schedule;


  -- ── list_schedules ── CLOB-safe version ──────────────────────────────────
  FUNCTION list_schedules (
    p_invoice_number  IN VARCHAR2,
    p_supplier        IN VARCHAR2,
    p_business_unit   IN VARCHAR2,
    p_posting_status  IN VARCHAR2
  ) RETURN CLOB IS
    v_buf   CLOB;
    v_first BOOLEAN := TRUE;
  BEGIN
    DBMS_LOB.CREATETEMPORARY(v_buf, TRUE);
    app(v_buf, '{"schedules":[');

    FOR r IN (
      SELECT
        s.INVOICE_ID,
        s.INVOICE_NUMBER,
        s.SUPPLIER,
        s.SUPPLIER_NUMBER,
        s.BUSINESS_UNIT,
        s.INVOICE_DATE,
        s.CURRENCY_CODE,
        COUNT(*)                                                              AS TOTAL_LINES,
        SUM(s.PERIOD_AMOUNT)                                                  AS TOTAL_AMOUNT,
        SUM(CASE WHEN s.POSTING_STATUS = 'Posted'     THEN s.PERIOD_AMOUNT ELSE 0 END) AS POSTED_AMOUNT,
        SUM(CASE WHEN s.POSTING_STATUS = 'Not Posted' THEN s.PERIOD_AMOUNT ELSE 0 END) AS NOT_POSTED_AMOUNT,
        MIN(s.PERIOD_DATE)                                                    AS MIN_PERIOD_DATE,
        MAX(s.PERIOD_DATE)                                                    AS MAX_PERIOD_DATE
      FROM RR_AP_INVOICE_MULTIPERIOD_SCHEDULE s
     WHERE (p_invoice_number IS NULL OR UPPER(s.INVOICE_NUMBER) LIKE '%'||UPPER(p_invoice_number)||'%')
       AND (p_supplier       IS NULL OR UPPER(s.SUPPLIER)       LIKE '%'||UPPER(p_supplier)||'%')
       AND (p_business_unit  IS NULL OR s.BUSINESS_UNIT         = p_business_unit)
       AND (p_posting_status IS NULL OR s.POSTING_STATUS        = p_posting_status)
       AND s.TRANSACTION_STATUS = 'Active'
     GROUP BY
        s.INVOICE_ID, s.INVOICE_NUMBER, s.SUPPLIER, s.SUPPLIER_NUMBER,
        s.BUSINESS_UNIT, s.INVOICE_DATE, s.CURRENCY_CODE
     ORDER BY s.INVOICE_NUMBER
    ) LOOP
      IF NOT v_first THEN app(v_buf, ','); END IF;
      v_first := FALSE;
      app(v_buf, '{'
        || '"invoiceId":'       || jnum(r.INVOICE_ID)       || ','
        || '"invoiceNumber":'   || jstr(r.INVOICE_NUMBER)   || ','
        || '"supplier":'        || jstr(r.SUPPLIER)         || ','
        || '"supplierNumber":'  || jstr(r.SUPPLIER_NUMBER)  || ','
        || '"businessUnit":'    || jstr(r.BUSINESS_UNIT)    || ','
        || '"invoiceDate":'     || jdate(r.INVOICE_DATE)    || ','
        || '"currencyCode":'    || jstr(r.CURRENCY_CODE)    || ','
        || '"totalLines":'      || jnum(r.TOTAL_LINES)      || ','
        || '"totalAmount":'     || jnum(r.TOTAL_AMOUNT)     || ','
        || '"postedAmount":'    || jnum(r.POSTED_AMOUNT)    || ','
        || '"notPostedAmount":' || jnum(r.NOT_POSTED_AMOUNT)|| ','
        || '"minPeriodDate":'   || jdate(r.MIN_PERIOD_DATE) || ','
        || '"maxPeriodDate":'   || jdate(r.MAX_PERIOD_DATE)
        || '}');
    END LOOP;

    app(v_buf, ']}');
    RETURN v_buf;
  END list_schedules;


  -- ── get_invoice_schedule ─────────────────────────────────────────────────
  FUNCTION get_invoice_schedule (
    p_invoice_id IN NUMBER
  ) RETURN CLOB IS
    v_buf   CLOB;
    v_first BOOLEAN := TRUE;
    v_inv   RR_AP_INVOICE_MULTIPERIOD_SCHEDULE%ROWTYPE;
    v_hdr_invoice_number  VARCHAR2(100);
    v_hdr_supplier        VARCHAR2(500);
    v_hdr_business_unit   VARCHAR2(200);
    v_hdr_invoice_date    VARCHAR2(20);
    v_hdr_currency        VARCHAR2(15);
    v_hdr_acct_status     VARCHAR2(100);
  BEGIN
    DBMS_LOB.CREATETEMPORARY(v_buf, TRUE);

    -- Header from first schedule row
    BEGIN
      SELECT s.INVOICE_NUMBER, s.SUPPLIER, s.BUSINESS_UNIT,
             TO_CHAR(s.INVOICE_DATE,'YYYY-MM-DD'), s.CURRENCY_CODE
        INTO v_hdr_invoice_number, v_hdr_supplier, v_hdr_business_unit,
             v_hdr_invoice_date, v_hdr_currency
        FROM RR_AP_INVOICE_MULTIPERIOD_SCHEDULE s
       WHERE s.INVOICE_ID = p_invoice_id
         AND ROWNUM = 1;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        v_hdr_invoice_number := NULL;
        v_hdr_supplier       := NULL;
        v_hdr_business_unit  := NULL;
        v_hdr_invoice_date   := NULL;
        v_hdr_currency       := NULL;
    END;

    -- Accounting status from SLA headers
    BEGIN
      SELECT h.ACCOUNTING_STATUS
        INTO v_hdr_acct_status
        FROM RR_SLA_ACCOUNTING_HEADERS h
       WHERE h.SOURCE_TABLE = 'AP_INVOICES'
         AND h.SOURCE_ID    = p_invoice_id
       ORDER BY h.HEADER_ID DESC
       FETCH FIRST 1 ROWS ONLY;
    EXCEPTION WHEN NO_DATA_FOUND THEN v_hdr_acct_status := NULL;
    END;

    app(v_buf, '{'
      || '"invoiceId":'               || jnum(p_invoice_id)        || ','
      || '"invoiceNumber":'           || jstr(v_hdr_invoice_number) || ','
      || '"supplier":'                || jstr(v_hdr_supplier)       || ','
      || '"businessUnit":'            || jstr(v_hdr_business_unit)  || ','
      || '"invoiceDate":'             || CASE WHEN v_hdr_invoice_date IS NULL THEN 'null' ELSE '"'||v_hdr_invoice_date||'"' END || ','
      || '"currencyCode":'            || jstr(v_hdr_currency)       || ','
      || '"invoiceAccountingStatus":' || jstr(v_hdr_acct_status)    || ','
      || '"lines":[');

    FOR r IN (
      SELECT SCHEDULE_ID, LINE_NUMBER, PERIOD_DATE, PERIOD_NAME,
             ORIGINAL_AMOUNT, PERIOD_AMOUNT, ACCRUAL_ACCOUNT, CHARGE_ACCOUNT,
             DESCRIPTION, POSTING_STATUS, POSTED_DATE, POSTED_BY, SLA_HEADER_ID
        FROM RR_AP_INVOICE_MULTIPERIOD_SCHEDULE
       WHERE INVOICE_ID        = p_invoice_id
         AND TRANSACTION_STATUS = 'Active'
       ORDER BY PERIOD_DATE, LINE_NUMBER
    ) LOOP
      IF NOT v_first THEN app(v_buf, ','); END IF;
      v_first := FALSE;
      app(v_buf, '{'
        || '"scheduleId":'    || jnum(r.SCHEDULE_ID)                        || ','
        || '"lineNumber":'    || jnum(r.LINE_NUMBER)                        || ','
        || '"periodDate":'    || CASE WHEN r.PERIOD_DATE IS NULL THEN 'null' ELSE '"'||TO_CHAR(r.PERIOD_DATE,'YYYY-MM-DD')||'"' END || ','
        || '"periodName":'    || jstr(r.PERIOD_NAME)                        || ','
        || '"originalAmount":'|| jnum(r.ORIGINAL_AMOUNT)                    || ','
        || '"periodAmount":'  || jnum(r.PERIOD_AMOUNT)                      || ','
        || '"accrualAccount":'|| jstr(r.ACCRUAL_ACCOUNT)                    || ','
        || '"chargeAccount":' || jstr(r.CHARGE_ACCOUNT)                     || ','
        || '"description":'   || jstr(r.DESCRIPTION)                        || ','
        || '"postingStatus":' || jstr(r.POSTING_STATUS)                     || ','
        || '"postedDate":'    || CASE WHEN r.POSTED_DATE IS NULL THEN 'null' ELSE '"'||TO_CHAR(r.POSTED_DATE,'YYYY-MM-DD')||'"' END || ','
        || '"postedBy":'      || jstr(r.POSTED_BY)                          || ','
        || '"slaHeaderId":'   || jnum(r.SLA_HEADER_ID)
        || '}');
    END LOOP;

    app(v_buf, ']}');
    RETURN v_buf;
  END get_invoice_schedule;


  -- ── mark_period_posted ───────────────────────────────────────────────────
  PROCEDURE mark_period_posted (
    p_invoice_id   IN NUMBER,
    p_period_name  IN VARCHAR2,
    p_sla_header_id IN NUMBER,
    p_posted_by    IN VARCHAR2
  ) IS
  BEGIN
    UPDATE RR_AP_INVOICE_MULTIPERIOD_SCHEDULE
       SET POSTING_STATUS = 'Posted',
           POSTED_DATE    = SYSDATE,
           POSTED_BY      = p_posted_by,
           SLA_HEADER_ID  = p_sla_header_id
     WHERE INVOICE_ID   = p_invoice_id
       AND PERIOD_NAME   = p_period_name
       AND POSTING_STATUS = 'Not Posted';
    COMMIT;
  END mark_period_posted;


  -- ── delete_schedule ──────────────────────────────────────────────────────
  PROCEDURE delete_schedule (
    p_invoice_id IN NUMBER,
    p_deleted    OUT NUMBER,
    p_posted_kept OUT NUMBER
  ) IS
  BEGIN
    SELECT COUNT(*) INTO p_posted_kept
      FROM RR_AP_INVOICE_MULTIPERIOD_SCHEDULE
     WHERE INVOICE_ID = p_invoice_id AND POSTING_STATUS = 'Posted';

    DELETE FROM RR_AP_INVOICE_MULTIPERIOD_SCHEDULE
     WHERE INVOICE_ID     = p_invoice_id
       AND POSTING_STATUS = 'Not Posted';

    p_deleted := SQL%ROWCOUNT;
    COMMIT;
  END delete_schedule;

END RR_AP_MPA_PKG;
/
