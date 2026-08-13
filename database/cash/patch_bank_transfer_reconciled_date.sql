-- ============================================================
-- Patch: Add RECONCILED_FLAG + RECONCILED_DATE to RR_BANK_ACCOUNT_TRANSFERS
-- and update GET handler to return both.
-- Run in Oracle APEX SQL Workshop (reerp module must exist)
-- ============================================================

-- ── Step 1a: Add RECONCILED_FLAG column ──────────────────────
BEGIN
  EXECUTE IMMEDIATE '
    ALTER TABLE RR_BANK_ACCOUNT_TRANSFERS
    ADD RECONCILED_FLAG VARCHAR2(1) DEFAULT ''N'' NOT NULL
  ';
  DBMS_OUTPUT.PUT_LINE('RECONCILED_FLAG column added');
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE = -1430 THEN   -- ORA-01430: column already exists
      DBMS_OUTPUT.PUT_LINE('RECONCILED_FLAG already exists — skipped');
    ELSE
      RAISE;
    END IF;
END;
/

-- ── Step 1b: Add RECONCILED_DATE column ──────────────────────
BEGIN
  EXECUTE IMMEDIATE '
    ALTER TABLE RR_BANK_ACCOUNT_TRANSFERS
    ADD RECONCILED_DATE DATE
  ';
  DBMS_OUTPUT.PUT_LINE('RECONCILED_DATE column added');
EXCEPTION
  WHEN OTHERS THEN
    IF SQLCODE = -1430 THEN
      DBMS_OUTPUT.PUT_LINE('RECONCILED_DATE already exists — skipped');
    ELSE
      RAISE;
    END IF;
END;
/

-- ── Step 2: Rebuild GET handler (adds reconciledFlag + reconciledDate) ───────
BEGIN
  BEGIN
    ORDS.DELETE_HANDLER(
      p_module_name => 'reerp',
      p_pattern     => 'cash/banktransfers',
      p_method      => 'GET'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'cash/banktransfers',
    p_method         => 'GET',
    p_source_type    => ORDS.source_type_plsql,
    p_items_per_page => 0,
    p_mimes_allowed  => '',
    p_comments       => 'List bank account transfers',
    p_source         => q'[
DECLARE
    l_date_from   VARCHAR2(30)  := :date_from;
    l_date_to     VARCHAR2(30)  := :date_to;
    l_from_acct   VARCHAR2(360) := :from_account;
    l_to_acct     VARCHAR2(360) := :to_account;
    l_status      VARCHAR2(60)  := :status;
    l_bu          VARCHAR2(360) := :business_unit;
    l_limit       NUMBER        := NVL(TO_NUMBER(:row_limit), 500);
    l_offset      NUMBER        := NVL(TO_NUMBER(:row_offset), 0);
    v_total NUMBER := 0;

    CURSOR c_transfers IS
        SELECT BANK_ACCOUNT_TRANSFER_ID,
               BANK_ACCOUNT_TRANSFER_NUMBER,
               TO_CHAR(TRANSACTION_DATE, 'YYYY-MM-DD')               AS TRANSACTION_DATE,
               MEMO,
               PAYMENT_REQUEST_ID,
               PAYMENT_AMOUNT,
               FROM_AMOUNT,
               FROM_EXTERNAL_TRX_ID,
               TO_EXTERNAL_TRX_ID,
               CONVERSION_RATE,
               FROM_BANK_ACCOUNT_NAME,
               TO_BANK_ACCOUNT_NAME,
               FROM_CURRENCY_CODE,
               TO_CURRENCY_CODE,
               PAYMENT_CURRENCY_CODE,
               CONVERSION_RATE_TYPE,
               STATUS,
               PAYMENT_STATUS,
               PAYMENT_METHOD,
               PAYMENT_PROFILE_NAME,
               BUSINESS_UNIT,
               PAYMENT_FILE,
               IS_SETTLED_WITH_IBY_FLAG,
               NVL(ACCOUNTING_FLAG, 'N')                              AS ACCOUNTING_FLAG,
               NVL(RECONCILED_FLAG, 'N')                              AS RECONCILED_FLAG,
               TO_CHAR(RECONCILED_DATE, 'YYYY-MM-DD')                 AS RECONCILED_DATE,
               CREATED_BY,
               TO_CHAR(CREATION_DATE,    'YYYY-MM-DD"T"HH24:MI:SS')   AS CREATION_DATE,
               LAST_UPDATED_BY,
               TO_CHAR(LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS')   AS LAST_UPDATE_DATE,
               LAST_UPDATE_LOGIN,
               TO_CHAR(SYNC_DATE,        'YYYY-MM-DD"T"HH24:MI:SS')   AS SYNC_DATE
          FROM RR_BANK_ACCOUNT_TRANSFERS
         WHERE (l_date_from IS NULL OR TRANSACTION_DATE >= TO_DATE(l_date_from, 'YYYY-MM-DD'))
           AND (l_date_to   IS NULL OR TRANSACTION_DATE <= TO_DATE(l_date_to,   'YYYY-MM-DD'))
           AND (l_from_acct IS NULL OR UPPER(FROM_BANK_ACCOUNT_NAME) LIKE '%' || UPPER(l_from_acct) || '%')
           AND (l_to_acct   IS NULL OR UPPER(TO_BANK_ACCOUNT_NAME)   LIKE '%' || UPPER(l_to_acct)   || '%')
           AND (l_status    IS NULL OR STATUS        = l_status)
           AND (l_bu        IS NULL OR BUSINESS_UNIT = l_bu)
         ORDER BY TRANSACTION_DATE DESC, BANK_ACCOUNT_TRANSFER_ID DESC
         OFFSET l_offset ROWS FETCH NEXT l_limit ROWS ONLY;

    r c_transfers%ROWTYPE;
BEGIN
    SELECT COUNT(*)
      INTO v_total
      FROM RR_BANK_ACCOUNT_TRANSFERS
     WHERE (l_date_from IS NULL OR TRANSACTION_DATE >= TO_DATE(l_date_from, 'YYYY-MM-DD'))
       AND (l_date_to   IS NULL OR TRANSACTION_DATE <= TO_DATE(l_date_to,   'YYYY-MM-DD'))
       AND (l_from_acct IS NULL OR UPPER(FROM_BANK_ACCOUNT_NAME) LIKE '%' || UPPER(l_from_acct) || '%')
       AND (l_to_acct   IS NULL OR UPPER(TO_BANK_ACCOUNT_NAME)   LIKE '%' || UPPER(l_to_acct)   || '%')
       AND (l_status    IS NULL OR STATUS        = l_status)
       AND (l_bu        IS NULL OR BUSINESS_UNIT = l_bu);

    :status_code := 200;
    APEX_JSON.OPEN_OBJECT;
    APEX_JSON.WRITE('status', 'success');
    APEX_JSON.WRITE('total',  v_total);
    APEX_JSON.OPEN_ARRAY('items');

    OPEN c_transfers;
    LOOP
        FETCH c_transfers INTO r;
        EXIT WHEN c_transfers%NOTFOUND;

        APEX_JSON.OPEN_OBJECT;
        APEX_JSON.WRITE('bankAccountTransferId',     r.BANK_ACCOUNT_TRANSFER_ID);
        APEX_JSON.WRITE('bankAccountTransferNumber', r.BANK_ACCOUNT_TRANSFER_NUMBER);
        APEX_JSON.WRITE('transactionDate',           r.TRANSACTION_DATE);
        APEX_JSON.WRITE('memo',                      r.MEMO);
        APEX_JSON.WRITE('paymentRequestId',          r.PAYMENT_REQUEST_ID);
        APEX_JSON.WRITE('paymentAmount',             r.PAYMENT_AMOUNT);
        APEX_JSON.WRITE('fromAmount',                r.FROM_AMOUNT);
        APEX_JSON.WRITE('fromExternalTrxId',         r.FROM_EXTERNAL_TRX_ID);
        APEX_JSON.WRITE('toExternalTrxId',           r.TO_EXTERNAL_TRX_ID);
        APEX_JSON.WRITE('conversionRate',            r.CONVERSION_RATE);
        APEX_JSON.WRITE('fromBankAccountName',       r.FROM_BANK_ACCOUNT_NAME);
        APEX_JSON.WRITE('toBankAccountName',         r.TO_BANK_ACCOUNT_NAME);
        APEX_JSON.WRITE('fromCurrencyCode',          r.FROM_CURRENCY_CODE);
        APEX_JSON.WRITE('toCurrencyCode',            r.TO_CURRENCY_CODE);
        APEX_JSON.WRITE('paymentCurrencyCode',       r.PAYMENT_CURRENCY_CODE);
        APEX_JSON.WRITE('conversionRateType',        r.CONVERSION_RATE_TYPE);
        APEX_JSON.WRITE('status',                    r.STATUS);
        APEX_JSON.WRITE('paymentStatus',             r.PAYMENT_STATUS);
        APEX_JSON.WRITE('paymentMethod',             r.PAYMENT_METHOD);
        APEX_JSON.WRITE('paymentProfileName',        r.PAYMENT_PROFILE_NAME);
        APEX_JSON.WRITE('businessUnit',              r.BUSINESS_UNIT);
        APEX_JSON.WRITE('paymentFile',               r.PAYMENT_FILE);
        APEX_JSON.WRITE('isSettledWithIbyFlag',      r.IS_SETTLED_WITH_IBY_FLAG);
        APEX_JSON.WRITE('accountingFlag',            r.ACCOUNTING_FLAG);
        APEX_JSON.WRITE('reconciledFlag',            r.RECONCILED_FLAG);
        APEX_JSON.WRITE('reconciledDate',            r.RECONCILED_DATE);
        APEX_JSON.WRITE('createdBy',                 r.CREATED_BY);
        APEX_JSON.WRITE('creationDate',              r.CREATION_DATE);
        APEX_JSON.WRITE('lastUpdatedBy',             r.LAST_UPDATED_BY);
        APEX_JSON.WRITE('lastUpdateDate',            r.LAST_UPDATE_DATE);
        APEX_JSON.WRITE('lastUpdateLogin',           r.LAST_UPDATE_LOGIN);
        APEX_JSON.WRITE('syncDate',                  r.SYNC_DATE);
        APEX_JSON.CLOSE_OBJECT;
    END LOOP;
    CLOSE c_transfers;

    APEX_JSON.CLOSE_ARRAY;
    APEX_JSON.CLOSE_OBJECT;
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"status":"error","message":' || APEX_JSON.STRINGIFY(SQLERRM) || '}');
END;
]'
  );

  COMMIT;
  DBMS_OUTPUT.PUT_LINE('GET handler rebuilt successfully');
END;
/

-- ── Step 3: Update POST/MERGE procedure to store ReconciledFlag + ReconciledDate ──
-- In your RR_SYNC_BANK_ACCOUNT_TRANSFERS procedure (called by the POST handler),
-- add the following to the JSON_TABLE columns list:
--
--   reconciled_flag  VARCHAR2(1)  PATH '$.ReconciledFlag',
--   reconciled_date  DATE         PATH '$.ReconciledDate'
--
-- And in the MERGE UPDATE SET clause add:
--
--   RECONCILED_FLAG = NVL(src.reconciled_flag, tgt.RECONCILED_FLAG),
--   RECONCILED_DATE = NVL(src.reconciled_date, tgt.RECONCILED_DATE),
--
-- And in the MERGE INSERT VALUES add:
--
--   NVL(src.reconciled_flag, 'N'),   -- RECONCILED_FLAG
--   NVL(src.reconciled_date, NULL)   -- RECONCILED_DATE
--
-- The bank reconciliation flow sends:
--   { "items": [{ "BankAccountTransferId": X, "PaymentStatus": "Reconciled",
--                 "ReconciledFlag": "Y", "ReconciledDate": "YYYY-MM-DD", ... }] }
-- so the MERGE will pick up both fields and store them.
