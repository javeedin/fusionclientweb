-- =====================================================
-- AR Invoice Balance Package
-- Package : RR_AR_INVOICE_BALANCES
--
-- Data sources available:
--   RR_AR_INVOICE_HEADERS          original amount + freight
--   RR_AR_INVOICE_LINES            line amounts (Lines breakdown)
--   RR_AR_RECEIPT_APPLICATIONS     receipt applications
--   RR_AR_ADJUSTMENTS              approved adjustments
--
-- Balance formula:
--   Balance = Original - SUM(receipt applications) + SUM(adjustments)
-- =====================================================

CREATE OR REPLACE PACKAGE RR_AR_INVOICE_BALANCES AS

    -- Full breakdown as a ref cursor (8 rows)
    PROCEDURE get_balance_details (
        p_customer_transaction_id IN  NUMBER,
        p_transaction_number      IN  VARCHAR2 DEFAULT NULL,
        p_result                  OUT SYS_REFCURSOR,
        p_status                  OUT VARCHAR2,
        p_message                 OUT VARCHAR2
    );

    -- Outstanding balance amount only
    FUNCTION get_balance (
        p_customer_transaction_id IN NUMBER
    ) RETURN NUMBER;

    -- Full JSON response for ORDS
    FUNCTION get_balance_json (
        p_customer_transaction_id IN NUMBER,
        p_transaction_number      IN VARCHAR2 DEFAULT NULL
    ) RETURN CLOB;

END RR_AR_INVOICE_BALANCES;
/

CREATE OR REPLACE PACKAGE BODY RR_AR_INVOICE_BALANCES AS

    -- -------------------------------------------------------
    -- get_balance: Original - Receipts + Adjustments
    -- -------------------------------------------------------
    FUNCTION get_balance (
        p_customer_transaction_id IN NUMBER
    ) RETURN NUMBER IS
        l_orig     NUMBER := 0;
        l_receipts NUMBER := 0;
        l_adj      NUMBER := 0;
        l_txn_num  VARCHAR2(50);
    BEGIN
        SELECT NVL(ENTERED_AMOUNT, 0), NVL(TRANSACTION_NUMBER, '')
        INTO   l_orig, l_txn_num
        FROM   RR_AR_INVOICE_HEADERS
        WHERE  CUSTOMER_TRANSACTION_ID = p_customer_transaction_id;

        SELECT NVL(SUM(APPLICATION_AMOUNT), 0)
        INTO   l_receipts
        FROM   RR_AR_RECEIPT_APPLICATIONS
        WHERE  (APPLICATION_STATUS = 'APP' OR UPPER(APPLICATION_STATUS) = 'APPLIED')
          AND  (REFERENCE_TRANSACTION_NUMBER = l_txn_num
                OR REFERENCE_TRANSACTION_ID  = p_customer_transaction_id);

        SELECT NVL(SUM(ADJUSTMENT_AMOUNT), 0)
        INTO   l_adj
        FROM   RR_AR_ADJUSTMENTS
        WHERE  STATUS = 'Approved'
          AND  (TRANSACTION_NUMBER    = l_txn_num
                OR CUSTOMER_TRANSACTION_ID = p_customer_transaction_id);

        RETURN l_orig - l_receipts + l_adj;
    EXCEPTION
        WHEN OTHERS THEN RETURN NULL;
    END get_balance;

    -- -------------------------------------------------------
    -- get_balance_details — 8 rows
    -- Columns returned:
    --   category, line_amount, tax_amount, freight_amount,
    --   charge_amount, total_amount, sort_order, is_total
    -- -------------------------------------------------------
    PROCEDURE get_balance_details (
        p_customer_transaction_id IN  NUMBER,
        p_transaction_number      IN  VARCHAR2 DEFAULT NULL,
        p_result                  OUT SYS_REFCURSOR,
        p_status                  OUT VARCHAR2,
        p_message                 OUT VARCHAR2
    ) IS
        l_txn_num VARCHAR2(50) := p_transaction_number;
    BEGIN
        -- Resolve txn number if not supplied
        IF l_txn_num IS NULL AND p_customer_transaction_id IS NOT NULL THEN
            BEGIN
                SELECT TRANSACTION_NUMBER INTO l_txn_num
                FROM   RR_AR_INVOICE_HEADERS
                WHERE  CUSTOMER_TRANSACTION_ID = p_customer_transaction_id;
            EXCEPTION
                WHEN NO_DATA_FOUND THEN l_txn_num := NULL;
            END;
        END IF;

        OPEN p_result FOR
        WITH
        -- ── Original: header amount + line breakdown ─────────────────────────
        hdr AS (
            SELECT NVL(ENTERED_AMOUNT, 0) AS total_amt,
                   NVL(FREIGHT_AMOUNT, 0) AS freight_amt
            FROM   RR_AR_INVOICE_HEADERS
            WHERE  CUSTOMER_TRANSACTION_ID = p_customer_transaction_id
        ),
        lns AS (
            SELECT NVL(SUM(LINE_AMOUNT), 0) AS line_sum
            FROM   RR_AR_INVOICE_LINES
            WHERE  CUSTOMER_TRANSACTION_ID = p_customer_transaction_id
        ),
        orig AS (
            SELECT
                h.total_amt,
                h.freight_amt,
                -- Lines: sum of invoice lines; fall back to total - freight if lines not loaded
                CASE WHEN l.line_sum <> 0 THEN l.line_sum
                     ELSE h.total_amt - h.freight_amt
                END AS line_amt,
                0 AS tax_amt
            FROM hdr h, lns l
        ),
        -- ── Receipt applications ─────────────────────────────────────────────
        rcpt_apps AS (
            SELECT NVL(APPLICATION_AMOUNT, 0)           AS amt,
                   UPPER(NVL(ACTIVITY_NAME, 'RECEIPT'))  AS act
            FROM   RR_AR_RECEIPT_APPLICATIONS
            WHERE  (APPLICATION_STATUS = 'APP' OR UPPER(APPLICATION_STATUS) = 'APPLIED')
              AND  (
                    (l_txn_num IS NOT NULL
                     AND REFERENCE_TRANSACTION_NUMBER = l_txn_num)
                 OR (p_customer_transaction_id IS NOT NULL
                     AND REFERENCE_TRANSACTION_ID = p_customer_transaction_id)
                  )
        ),
        receipts_s  AS (SELECT NVL(SUM(amt), 0) AS amt FROM rcpt_apps
                        WHERE act NOT LIKE '%DISCOUNT%'
                          AND act NOT LIKE '%PREPAYMENT%'
                          AND act NOT LIKE '%BILLS RECEIVABLE%'
                          AND act NOT LIKE '%CREDIT%'),
        prepay_s    AS (SELECT NVL(SUM(amt), 0) AS amt FROM rcpt_apps WHERE act LIKE '%PREPAYMENT%'),
        credits_s   AS (SELECT NVL(SUM(amt), 0) AS amt FROM rcpt_apps WHERE act LIKE '%CREDIT%'),
        discounts_s AS (SELECT NVL(SUM(amt), 0) AS amt FROM rcpt_apps WHERE act LIKE '%DISCOUNT%'),
        bills_s     AS (SELECT NVL(SUM(amt), 0) AS amt FROM rcpt_apps WHERE act LIKE '%BILLS RECEIVABLE%'),
        -- ── Approved adjustments (already signed from Fusion) ───────────────
        adj_s AS (
            SELECT NVL(SUM(ADJUSTMENT_AMOUNT), 0) AS amt
            FROM   RR_AR_ADJUSTMENTS
            WHERE  STATUS = 'Approved'
              AND  (
                    (l_txn_num IS NOT NULL
                     AND TRANSACTION_NUMBER = l_txn_num)
                 OR (p_customer_transaction_id IS NOT NULL
                     AND CUSTOMER_TRANSACTION_ID = p_customer_transaction_id)
                  )
        )
        SELECT category,
               ROUND(line_amount,    2) AS line_amount,
               ROUND(tax_amount,     2) AS tax_amount,
               ROUND(freight_amount, 2) AS freight_amount,
               ROUND(charge_amount,  2) AS charge_amount,
               ROUND(total_amount,   2) AS total_amount,
               sort_order, is_total
        FROM (
            SELECT 'Original Amount'   AS category,
                   o.line_amt          AS line_amount,
                   o.tax_amt           AS tax_amount,
                   o.freight_amt       AS freight_amount,
                   (o.total_amt - o.line_amt - o.tax_amt - o.freight_amt) AS charge_amount,
                   o.total_amt         AS total_amount,
                   1 AS sort_order,   'N' AS is_total
            FROM orig o
            UNION ALL
            SELECT 'Prepayments',   -(p.amt), 0, 0, 0, -(p.amt), 2, 'N' FROM prepay_s p
            UNION ALL
            SELECT 'Receipts',      -(r.amt), 0, 0, 0, -(r.amt), 3, 'N' FROM receipts_s r
            UNION ALL
            SELECT 'Credits/Refunds', -(c.amt), 0, 0, 0, -(c.amt), 4, 'N' FROM credits_s c
            UNION ALL
            SELECT 'Adjustments',   a.amt, 0, 0, 0, a.amt, 5, 'N' FROM adj_s a
            UNION ALL
            SELECT 'Bills Receivable', -(b.amt), 0, 0, 0, -(b.amt), 6, 'N' FROM bills_s b
            UNION ALL
            SELECT 'Discounts',     -(d.amt), 0, 0, 0, -(d.amt), 7, 'N' FROM discounts_s d
            UNION ALL
            SELECT 'Balance',
                   -- Lines col: original lines + all activity lines
                   o.line_amt    + (-(r.amt)) + (-(c.amt)) + a.amt + (-(b.amt)) + (-(d.amt)) + (-(p.amt)),
                   o.tax_amt,
                   o.freight_amt,
                   (o.total_amt - o.line_amt - o.tax_amt - o.freight_amt),
                   -- Total col
                   o.total_amt   + (-(r.amt)) + (-(c.amt)) + a.amt + (-(b.amt)) + (-(d.amt)) + (-(p.amt)),
                   8, 'Y'
            FROM orig o, prepay_s p, receipts_s r, credits_s c, adj_s a, bills_s b, discounts_s d
        )
        ORDER BY sort_order;

        p_status  := 'SUCCESS';
        p_message := 'OK';
    EXCEPTION
        WHEN OTHERS THEN
            p_status  := 'ERROR';
            p_message := SQLERRM;
    END get_balance_details;

    -- -------------------------------------------------------
    -- get_balance_json: returns full JSON for ORDS
    -- -------------------------------------------------------
    FUNCTION get_balance_json (
        p_customer_transaction_id IN NUMBER,
        p_transaction_number      IN VARCHAR2 DEFAULT NULL
    ) RETURN CLOB IS
        l_rc       SYS_REFCURSOR;
        l_status   VARCHAR2(20);
        l_message  VARCHAR2(4000);
        l_category VARCHAR2(50);
        l_line     NUMBER;
        l_tax      NUMBER;
        l_freight  NUMBER;
        l_charge   NUMBER;
        l_total    NUMBER;
        l_sort     NUMBER;
        l_is_total VARCHAR2(1);
        l_json     CLOB := '';
        l_sep      VARCHAR2(1) := '';
        l_balance  NUMBER;
    BEGIN
        get_balance_details(
            p_customer_transaction_id,
            p_transaction_number,
            l_rc, l_status, l_message
        );

        IF l_status = 'SUCCESS' THEN
            LOOP
                FETCH l_rc INTO
                    l_category, l_line,  l_tax,      l_freight,
                    l_charge,   l_total, l_sort,     l_is_total;
                EXIT WHEN l_rc%NOTFOUND;
                l_json := l_json || l_sep || '{'
                    || '"category":"'       || REPLACE(l_category, '"', '\"') || '"'
                    || ',"line_amount":'    || NVL(l_line,    0)
                    || ',"tax_amount":'     || NVL(l_tax,     0)
                    || ',"freight_amount":' || NVL(l_freight, 0)
                    || ',"charge_amount":'  || NVL(l_charge,  0)
                    || ',"total_amount":'   || NVL(l_total,   0)
                    || ',"sort_order":'     || l_sort
                    || ',"is_total":"'      || l_is_total || '"'
                    || '}';
                l_sep := ',';
            END LOOP;
            CLOSE l_rc;

            l_balance := NVL(get_balance(p_customer_transaction_id), 0);

            RETURN '{"status":"SUCCESS","balance":' || l_balance
                || ',"items":[' || l_json || ']}';
        ELSE
            IF l_rc%ISOPEN THEN CLOSE l_rc; END IF;
            RETURN '{"status":"ERROR","message":"'
                || REPLACE(l_message, '"', '\"')
                || '","balance":0,"items":[]}';
        END IF;
    EXCEPTION
        WHEN OTHERS THEN
            IF l_rc%ISOPEN THEN CLOSE l_rc; END IF;
            RETURN '{"status":"ERROR","message":"'
                || REPLACE(SQLERRM, '"', '\"')
                || '","balance":0,"items":[]}';
    END get_balance_json;

END RR_AR_INVOICE_BALANCES;
/
