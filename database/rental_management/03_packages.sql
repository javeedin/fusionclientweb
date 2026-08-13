-- ============================================================
-- RENTAL MANAGEMENT MODULE — PL/SQL PACKAGES
-- Run after 01_tables.sql and 02_lookup_data.sql
-- Packages:
--   RR_RM_UTIL_PKG         — number generation, helpers
--   RR_RM_AGREEMENTS_PKG   — agreement CRUD
--   RR_RM_INSTALLMENTS_PKG — installment generation & status
--   RR_RM_SPLITS_PKG       — monthly revenue split generation
--   RR_RM_PROPERTIES_PKG   — property CRUD
--   RR_RM_CUSTOMERS_PKG    — customer CRUD
--   RR_RM_EXPENSES_PKG     — expense CRUD
-- ============================================================

-- ============================================================
-- PACKAGE: RR_RM_UTIL_PKG  — shared helpers
-- ============================================================
CREATE OR REPLACE PACKAGE RR_RM_UTIL_PKG AS
    FUNCTION  gen_agreement_number  RETURN VARCHAR2;
    FUNCTION  gen_customer_number   RETURN VARCHAR2;
    FUNCTION  gen_property_number   RETURN VARCHAR2;
    FUNCTION  gen_expense_number    RETURN VARCHAR2;
    FUNCTION  months_diff (p_start DATE, p_end DATE) RETURN NUMBER;
    FUNCTION  payment_count (p_freq VARCHAR2, p_months NUMBER) RETURN NUMBER;
    FUNCTION  freq_months  (p_freq VARCHAR2) RETURN NUMBER;
END RR_RM_UTIL_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_RM_UTIL_PKG AS

    FUNCTION gen_agreement_number RETURN VARCHAR2 IS
        v_seq NUMBER;
    BEGIN
        SELECT RR_RM_AGREEMENTS_S.NEXTVAL INTO v_seq FROM DUAL;
        RETURN 'AGR-' || TO_CHAR(SYSDATE,'YYYY') || '-' || LPAD(v_seq,6,'0');
    END;

    FUNCTION gen_customer_number RETURN VARCHAR2 IS
        v_seq NUMBER;
    BEGIN
        SELECT RR_RM_CUSTOMERS_S.NEXTVAL INTO v_seq FROM DUAL;
        RETURN 'CUST-' || LPAD(v_seq,6,'0');
    END;

    FUNCTION gen_property_number RETURN VARCHAR2 IS
        v_seq NUMBER;
    BEGIN
        SELECT RR_RM_PROPERTIES_S.NEXTVAL INTO v_seq FROM DUAL;
        RETURN 'PROP-' || LPAD(v_seq,6,'0');
    END;

    FUNCTION gen_expense_number RETURN VARCHAR2 IS
        v_seq NUMBER;
    BEGIN
        SELECT RR_RM_EXPENSES_S.NEXTVAL INTO v_seq FROM DUAL;
        RETURN 'EXP-' || TO_CHAR(SYSDATE,'YYYY') || '-' || LPAD(v_seq,6,'0');
    END;

    FUNCTION months_diff (p_start DATE, p_end DATE) RETURN NUMBER IS
    BEGIN
        RETURN ROUND(MONTHS_BETWEEN(p_end, p_start));
    END;

    FUNCTION payment_count (p_freq VARCHAR2, p_months NUMBER) RETURN NUMBER IS
    BEGIN
        RETURN CASE p_freq
            WHEN 'MONTHLY'     THEN p_months
            WHEN 'QUARTERLY'   THEN CEIL(p_months / 3)
            WHEN 'HALF_YEARLY' THEN CEIL(p_months / 6)
            WHEN 'YEARLY'      THEN CEIL(p_months / 12)
            ELSE p_months
        END;
    END;

    FUNCTION freq_months (p_freq VARCHAR2) RETURN NUMBER IS
    BEGIN
        RETURN CASE p_freq
            WHEN 'MONTHLY'     THEN 1
            WHEN 'QUARTERLY'   THEN 3
            WHEN 'HALF_YEARLY' THEN 6
            WHEN 'YEARLY'      THEN 12
            ELSE 1
        END;
    END;

END RR_RM_UTIL_PKG;
/

-- ============================================================
-- PACKAGE: RR_RM_INSTALLMENTS_PKG
-- ============================================================
CREATE OR REPLACE PACKAGE RR_RM_INSTALLMENTS_PKG AS
    PROCEDURE generate_installments (p_agreement_id IN NUMBER, p_result OUT VARCHAR2);
    PROCEDURE update_status         (p_json IN CLOB, p_result OUT VARCHAR2);
    PROCEDURE handle_bounce         (p_json IN CLOB, p_result OUT VARCHAR2);
    FUNCTION  get_installments      (p_agreement_id IN NUMBER) RETURN CLOB;
END RR_RM_INSTALLMENTS_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_RM_INSTALLMENTS_PKG AS

    -- ----------------------------------------------------------------
    -- Generate installment schedule from agreement header data
    -- ----------------------------------------------------------------
    PROCEDURE generate_installments (p_agreement_id IN NUMBER, p_result OUT VARCHAR2) IS
        v_start       DATE;
        v_end         DATE;
        v_freq        VARCHAR2(20);
        v_total       NUMBER;
        v_no_months   NUMBER;
        v_no_pmts     NUMBER;
        v_freq_months NUMBER;
        v_freq_amount NUMBER;
        v_due_date    DATE;
        v_inst_id     NUMBER;
    BEGIN
        -- Load agreement header
        SELECT START_DATE, END_DATE, PAYMENT_FREQUENCY, TOTAL_AMOUNT
        INTO   v_start, v_end, v_freq, v_total
        FROM   RR_RM_AGREEMENTS
        WHERE  AGREEMENT_ID = p_agreement_id;

        v_no_months   := RR_RM_UTIL_PKG.months_diff(v_start, v_end);
        v_freq_months := RR_RM_UTIL_PKG.freq_months(v_freq);
        v_no_pmts     := RR_RM_UTIL_PKG.payment_count(v_freq, v_no_months);
        v_freq_amount := ROUND(v_total / v_no_pmts, 2);

        -- Remove any existing installments (draft re-generation)
        DELETE FROM RR_RM_MONTHLY_SPLITS WHERE AGREEMENT_ID = p_agreement_id;
        DELETE FROM RR_RM_INSTALLMENTS   WHERE AGREEMENT_ID = p_agreement_id;

        -- Create installment rows
        FOR i IN 1..v_no_pmts LOOP
            v_due_date := ADD_MONTHS(v_start, (i - 1) * v_freq_months);
            v_inst_id  := RR_RM_INSTALLMENTS_S.NEXTVAL;

            INSERT INTO RR_RM_INSTALLMENTS (
                INSTALLMENT_ID, AGREEMENT_ID, INSTALLMENT_NUMBER,
                DUE_DATE, AMOUNT, STATUS
            ) VALUES (
                v_inst_id, p_agreement_id, i,
                v_due_date, v_freq_amount, 'PENDING'
            );
        END LOOP;

        -- Update NO_OF_PAYMENTS and FREQUENCY_AMOUNT on header
        UPDATE RR_RM_AGREEMENTS
        SET    NO_OF_PAYMENTS  = v_no_pmts,
               NO_OF_MONTHS   = v_no_months,
               FREQUENCY_AMOUNT = v_freq_amount,
               LAST_UPDATE_DATE = SYSDATE
        WHERE  AGREEMENT_ID   = p_agreement_id;

        COMMIT;
        p_result := '{"status":"success","no_of_payments":' || v_no_pmts ||
                    ',"frequency_amount":' || v_freq_amount || '}';
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_result := '{"status":"error","message":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END generate_installments;

    -- ----------------------------------------------------------------
    -- Update a single installment status (presented / cleared / bounced)
    -- JSON: { installmentId, status, chequeNo, chequeDate, bankName,
    --         presentedDate, clearedDate, bouncedDate, bouncedReason,
    --         receiptNumber, receiptDate, notes }
    -- ----------------------------------------------------------------
    PROCEDURE update_status (p_json IN CLOB, p_result OUT VARCHAR2) IS
        v_id         NUMBER;
        v_status     VARCHAR2(20);
        v_old_status VARCHAR2(20);
    BEGIN
        v_id     := TO_NUMBER(JSON_VALUE(p_json, '$.installmentId'));
        v_status := JSON_VALUE(p_json, '$.status');

        SELECT STATUS INTO v_old_status
        FROM   RR_RM_INSTALLMENTS
        WHERE  INSTALLMENT_ID = v_id;

        UPDATE RR_RM_INSTALLMENTS
        SET    STATUS            = NVL(JSON_VALUE(p_json, '$.status'),        STATUS),
               CHEQUE_NO         = NVL(JSON_VALUE(p_json, '$.chequeNo'),       CHEQUE_NO),
               CHEQUE_DATE       = NVL(TO_DATE(JSON_VALUE(p_json,'$.chequeDate'),'YYYY-MM-DD'), CHEQUE_DATE),
               BANK_NAME         = NVL(JSON_VALUE(p_json, '$.bankName'),       BANK_NAME),
               PRESENTED_DATE    = CASE WHEN v_status = 'PRESENTED'
                                        THEN NVL(TO_DATE(JSON_VALUE(p_json,'$.presentedDate'),'YYYY-MM-DD'), SYSDATE)
                                        ELSE PRESENTED_DATE END,
               CLEARED_DATE      = CASE WHEN v_status = 'CLEARED'
                                        THEN NVL(TO_DATE(JSON_VALUE(p_json,'$.clearedDate'),'YYYY-MM-DD'), SYSDATE)
                                        ELSE CLEARED_DATE END,
               BOUNCED_DATE      = CASE WHEN v_status = 'BOUNCED'
                                        THEN NVL(TO_DATE(JSON_VALUE(p_json,'$.bouncedDate'),'YYYY-MM-DD'), SYSDATE)
                                        ELSE BOUNCED_DATE END,
               BOUNCED_REASON    = NVL(JSON_VALUE(p_json, '$.bouncedReason'), BOUNCED_REASON),
               RECEIPT_NUMBER    = NVL(JSON_VALUE(p_json, '$.receiptNumber'),  RECEIPT_NUMBER),
               RECEIPT_DATE      = NVL(TO_DATE(JSON_VALUE(p_json,'$.receiptDate'),'YYYY-MM-DD'), RECEIPT_DATE),
               NOTES             = NVL(JSON_VALUE(p_json, '$.notes'),          NOTES),
               LAST_UPDATED_BY   = USER,
               LAST_UPDATE_DATE  = SYSDATE
        WHERE  INSTALLMENT_ID = v_id;

        -- When a cheque is cleared, mark the monthly splits as RECOGNIZED
        IF v_status = 'CLEARED' THEN
            UPDATE RR_RM_MONTHLY_SPLITS
            SET    STATUS = 'RECOGNIZED', LAST_UPDATE_DATE = SYSDATE
            WHERE  INSTALLMENT_ID = v_id;
        END IF;

        COMMIT;
        p_result := '{"status":"success","installmentId":' || v_id ||
                    ',"newStatus":"' || v_status || '"}';
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_result := '{"status":"error","message":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END update_status;

    -- ----------------------------------------------------------------
    -- Handle bounced cheque — create replacement installment
    -- JSON: { installmentId, newChequeNo, newChequeDate, newBankName,
    --         newAmount, bouncedReason }
    -- ----------------------------------------------------------------
    PROCEDURE handle_bounce (p_json IN CLOB, p_result OUT VARCHAR2) IS
        v_orig_id   NUMBER;
        v_new_id    NUMBER;
        v_agr_id    NUMBER;
        v_inst_num  NUMBER;
        v_amount    NUMBER;
    BEGIN
        v_orig_id := TO_NUMBER(JSON_VALUE(p_json, '$.installmentId'));

        SELECT AGREEMENT_ID, INSTALLMENT_NUMBER, AMOUNT
        INTO   v_agr_id, v_inst_num, v_amount
        FROM   RR_RM_INSTALLMENTS
        WHERE  INSTALLMENT_ID = v_orig_id;

        -- Mark original as BOUNCED
        UPDATE RR_RM_INSTALLMENTS
        SET    STATUS          = 'BOUNCED',
               BOUNCED_DATE    = SYSDATE,
               BOUNCED_REASON  = JSON_VALUE(p_json, '$.bouncedReason'),
               LAST_UPDATE_DATE= SYSDATE
        WHERE  INSTALLMENT_ID  = v_orig_id;

        -- Create replacement installment
        v_new_id := RR_RM_INSTALLMENTS_S.NEXTVAL;
        INSERT INTO RR_RM_INSTALLMENTS (
            INSTALLMENT_ID, AGREEMENT_ID, INSTALLMENT_NUMBER,
            DUE_DATE, AMOUNT, PAYMENT_METHOD,
            CHEQUE_NO, CHEQUE_DATE, BANK_NAME, STATUS, NOTES
        )
        SELECT v_new_id, AGREEMENT_ID,
               INSTALLMENT_NUMBER || 'R',           -- suffix R = Replacement
               SYSDATE,
               NVL(TO_NUMBER(JSON_VALUE(p_json,'$.newAmount')), AMOUNT),
               'CHEQUE',
               JSON_VALUE(p_json,'$.newChequeNo'),
               TO_DATE(JSON_VALUE(p_json,'$.newChequeDate'),'YYYY-MM-DD'),
               JSON_VALUE(p_json,'$.newBankName'),
               'PENDING',
               'Replacement for bounced cheque ' || CHEQUE_NO
        FROM   RR_RM_INSTALLMENTS
        WHERE  INSTALLMENT_ID = v_orig_id;

        -- Link original to replacement
        UPDATE RR_RM_INSTALLMENTS
        SET    REPLACED_BY_ID = v_new_id, STATUS = 'REPLACED'
        WHERE  INSTALLMENT_ID = v_orig_id;

        COMMIT;
        p_result := '{"status":"success","replacementInstallmentId":' || v_new_id || '}';
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_result := '{"status":"error","message":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END handle_bounce;

    -- ----------------------------------------------------------------
    -- Return JSON array of installments for an agreement
    -- ----------------------------------------------------------------
    FUNCTION get_installments (p_agreement_id IN NUMBER) RETURN CLOB IS
        v_result CLOB := '[';
        v_sep    VARCHAR2(1) := '';
    BEGIN
        FOR r IN (
            SELECT INSTALLMENT_ID, INSTALLMENT_NUMBER, DUE_DATE,
                   AMOUNT, PAYMENT_METHOD, CHEQUE_NO, CHEQUE_DATE,
                   BANK_NAME, ACCOUNT_NO, STATUS,
                   PRESENTED_DATE, CLEARED_DATE, BOUNCED_DATE,
                   BOUNCED_REASON, LATE_PAYMENT_CHARGE,
                   RECEIPT_NUMBER, RECEIPT_DATE, NOTES
            FROM   RR_RM_INSTALLMENTS
            WHERE  AGREEMENT_ID = p_agreement_id
            ORDER  BY INSTALLMENT_NUMBER
        ) LOOP
            v_result := v_result || v_sep ||
                '{"installmentId":'    || r.INSTALLMENT_ID ||
                ',"installmentNo":'    || r.INSTALLMENT_NUMBER ||
                ',"dueDate":"'         || TO_CHAR(r.DUE_DATE,'YYYY-MM-DD') || '"' ||
                ',"amount":'           || NVL(r.AMOUNT,0) ||
                ',"paymentMethod":"'   || NVL(r.PAYMENT_METHOD,'') || '"' ||
                ',"chequeNo":"'        || NVL(r.CHEQUE_NO,'')      || '"' ||
                ',"chequeDate":"'      || NVL(TO_CHAR(r.CHEQUE_DATE,'YYYY-MM-DD'),'') || '"' ||
                ',"bankName":"'        || NVL(r.BANK_NAME,'')      || '"' ||
                ',"status":"'          || r.STATUS                 || '"' ||
                ',"presentedDate":"'   || NVL(TO_CHAR(r.PRESENTED_DATE,'YYYY-MM-DD'),'') || '"' ||
                ',"clearedDate":"'     || NVL(TO_CHAR(r.CLEARED_DATE,'YYYY-MM-DD'),'') || '"' ||
                ',"bouncedDate":"'     || NVL(TO_CHAR(r.BOUNCED_DATE,'YYYY-MM-DD'),'') || '"' ||
                ',"receiptNumber":"'   || NVL(r.RECEIPT_NUMBER,'') || '"' ||
                ',"notes":"'           || NVL(r.NOTES,'')          || '"' ||
                '}';
            v_sep := ',';
        END LOOP;
        RETURN v_result || ']';
    END get_installments;

END RR_RM_INSTALLMENTS_PKG;
/

-- ============================================================
-- PACKAGE: RR_RM_SPLITS_PKG — monthly revenue recognition
-- ============================================================
CREATE OR REPLACE PACKAGE RR_RM_SPLITS_PKG AS
    PROCEDURE generate_splits (p_agreement_id IN NUMBER, p_result OUT VARCHAR2);
    FUNCTION  get_splits       (p_agreement_id IN NUMBER) RETURN CLOB;
END RR_RM_SPLITS_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_RM_SPLITS_PKG AS

    -- ----------------------------------------------------------------
    -- Generate one row per calendar month in the agreement period.
    -- Monthly amount = TOTAL_AMOUNT / NO_OF_MONTHS (even split).
    -- Each row is linked to the installment that covers that month.
    -- ----------------------------------------------------------------
    PROCEDURE generate_splits (p_agreement_id IN NUMBER, p_result OUT VARCHAR2) IS
        v_start        DATE;
        v_end          DATE;
        v_total        NUMBER;
        v_no_months    NUMBER;
        v_monthly_amt  NUMBER;
        v_cur_date     DATE;
        v_split_id     NUMBER;
        v_inst_id      NUMBER;
        v_freq         VARCHAR2(20);
        v_freq_months  NUMBER;
        v_inst_num     NUMBER;
    BEGIN
        SELECT START_DATE, END_DATE, TOTAL_AMOUNT, NO_OF_MONTHS, PAYMENT_FREQUENCY
        INTO   v_start, v_end, v_total, v_no_months, v_freq
        FROM   RR_RM_AGREEMENTS
        WHERE  AGREEMENT_ID = p_agreement_id;

        v_freq_months := RR_RM_UTIL_PKG.freq_months(v_freq);
        v_monthly_amt := ROUND(v_total / GREATEST(v_no_months, 1), 2);

        -- Clean old splits
        DELETE FROM RR_RM_MONTHLY_SPLITS WHERE AGREEMENT_ID = p_agreement_id;

        v_cur_date := TRUNC(v_start, 'MM');

        WHILE v_cur_date <= v_end LOOP
            -- Find the installment that covers this month
            v_inst_num := CEIL(
                MONTHS_BETWEEN(v_cur_date, TRUNC(v_start,'MM')) / v_freq_months
            ) + 1;

            BEGIN
                SELECT INSTALLMENT_ID INTO v_inst_id
                FROM   RR_RM_INSTALLMENTS
                WHERE  AGREEMENT_ID       = p_agreement_id
                AND    INSTALLMENT_NUMBER = v_inst_num
                AND    ROWNUM = 1;
            EXCEPTION
                WHEN NO_DATA_FOUND THEN v_inst_id := NULL;
            END;

            v_split_id := RR_RM_SPLITS_S.NEXTVAL;

            INSERT INTO RR_RM_MONTHLY_SPLITS (
                SPLIT_ID, AGREEMENT_ID, INSTALLMENT_ID,
                PERIOD_YEAR, PERIOD_MONTH, PERIOD_DATE, AMOUNT, STATUS
            ) VALUES (
                v_split_id, p_agreement_id, v_inst_id,
                EXTRACT(YEAR  FROM v_cur_date),
                EXTRACT(MONTH FROM v_cur_date),
                v_cur_date,
                v_monthly_amt,
                'ACCRUED'
            );

            v_cur_date := ADD_MONTHS(v_cur_date, 1);
        END LOOP;

        COMMIT;
        p_result := '{"status":"success","splitsGenerated":' ||
                    ROUND(MONTHS_BETWEEN(v_end, v_start)) || '}';
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_result := '{"status":"error","message":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END generate_splits;

    -- ----------------------------------------------------------------
    -- Return JSON array of monthly splits for an agreement
    -- ----------------------------------------------------------------
    FUNCTION get_splits (p_agreement_id IN NUMBER) RETURN CLOB IS
        v_result CLOB := '[';
        v_sep    VARCHAR2(1) := '';
    BEGIN
        FOR r IN (
            SELECT s.SPLIT_ID, s.PERIOD_YEAR, s.PERIOD_MONTH,
                   s.PERIOD_DATE, s.AMOUNT, s.STATUS,
                   s.INSTALLMENT_ID,
                   i.INSTALLMENT_NUMBER, i.CHEQUE_NO, i.STATUS AS INST_STATUS
            FROM   RR_RM_MONTHLY_SPLITS s
            LEFT   JOIN RR_RM_INSTALLMENTS i ON i.INSTALLMENT_ID = s.INSTALLMENT_ID
            WHERE  s.AGREEMENT_ID = p_agreement_id
            ORDER  BY s.PERIOD_YEAR, s.PERIOD_MONTH
        ) LOOP
            v_result := v_result || v_sep ||
                '{"splitId":'        || r.SPLIT_ID ||
                ',"year":'           || r.PERIOD_YEAR ||
                ',"month":'          || r.PERIOD_MONTH ||
                ',"periodDate":"'    || TO_CHAR(r.PERIOD_DATE,'YYYY-MM-DD') || '"' ||
                ',"amount":'         || NVL(r.AMOUNT,0) ||
                ',"status":"'        || r.STATUS || '"' ||
                ',"installmentNo":"' || NVL(TO_CHAR(r.INSTALLMENT_NUMBER),'') || '"' ||
                ',"chequeNo":"'      || NVL(r.CHEQUE_NO,'') || '"' ||
                ',"instStatus":"'    || NVL(r.INST_STATUS,'') || '"' ||
                '}';
            v_sep := ',';
        END LOOP;
        RETURN v_result || ']';
    END get_splits;

END RR_RM_SPLITS_PKG;
/

-- ============================================================
-- PACKAGE: RR_RM_AGREEMENTS_PKG — main CRUD
-- ============================================================
CREATE OR REPLACE PACKAGE RR_RM_AGREEMENTS_PKG AS
    PROCEDURE create_agreement    (p_json IN CLOB, p_result OUT VARCHAR2);
    PROCEDURE update_agreement    (p_json IN CLOB, p_result OUT VARCHAR2);
    PROCEDURE activate_agreement  (p_agreement_id IN NUMBER, p_result OUT VARCHAR2);
    PROCEDURE terminate_agreement (p_json IN CLOB, p_result OUT VARCHAR2);
    FUNCTION  get_agreement       (p_agreement_id IN NUMBER) RETURN CLOB;
    FUNCTION  search_agreements   (p_json IN CLOB) RETURN CLOB;
    PROCEDURE upsert_documents    (p_json IN CLOB, p_result OUT VARCHAR2);
END RR_RM_AGREEMENTS_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_RM_AGREEMENTS_PKG AS

    -- ----------------------------------------------------------------
    -- Create a new rental agreement + installments + monthly splits
    -- ----------------------------------------------------------------
    PROCEDURE create_agreement (p_json IN CLOB, p_result OUT VARCHAR2) IS
        v_id         NUMBER := RR_RM_AGREEMENTS_S.NEXTVAL;
        v_agr_num    VARCHAR2(30);
        v_inst_res   VARCHAR2(500);
        v_split_res  VARCHAR2(500);
    BEGIN
        v_agr_num := 'AGR-' || TO_CHAR(SYSDATE,'YYYY') || '-' || LPAD(v_id,6,'0');

        INSERT INTO RR_RM_AGREEMENTS (
            AGREEMENT_ID, AGREEMENT_NUMBER, AGREEMENT_TYPE,
            SIGN_DATE, VALID_FROM, VALID_TO, STATUS,
            PROPERTY_ID, CUSTOMER_ID,
            TENANT_CONTACT_PHONE, TENANT_CONTACT_EMAIL, TENANT_CONTACT_ADDRESS,
            BROKER_ID, BROKER_COMMISSION_AMOUNT, BROKER_COMMISSION_PCT,
            START_DATE, END_DATE,
            PAYMENT_FREQUENCY, TOTAL_AMOUNT,
            CURRENCY_CODE,
            SECURITY_DEPOSIT_AMOUNT, SECURITY_DEPOSIT_CHEQUE,
            SECURITY_DEPOSIT_DATE, SECURITY_DEPOSIT_BANK,
            ADVANCE_RENT_AMOUNT, ADVANCE_RENT_MONTHS,
            EJARI_NUMBER, EJARI_REG_DATE, EJARI_EXPIRY_DATE,
            MUNICIPALITY_FEES, RERA_INDEX_PCT,
            GRACE_PERIOD_DAYS, NOTICE_PERIOD_DAYS,
            RENEWAL_OPTION, RENT_INCREMENT_PCT,
            SPECIAL_CONDITIONS, INTERNAL_NOTES
        ) VALUES (
            v_id, v_agr_num,
            NVL(JSON_VALUE(p_json,'$.agreementType'),'NEW'),
            TO_DATE(JSON_VALUE(p_json,'$.signDate'),       'YYYY-MM-DD'),
            TO_DATE(JSON_VALUE(p_json,'$.validFrom'),      'YYYY-MM-DD'),
            TO_DATE(JSON_VALUE(p_json,'$.validTo'),        'YYYY-MM-DD'),
            'DRAFT',
            TO_NUMBER(JSON_VALUE(p_json,'$.propertyId')),
            TO_NUMBER(JSON_VALUE(p_json,'$.customerId')),
            JSON_VALUE(p_json,'$.tenantContactPhone'),
            JSON_VALUE(p_json,'$.tenantContactEmail'),
            JSON_VALUE(p_json,'$.tenantContactAddress'),
            TO_NUMBER(JSON_VALUE(p_json,'$.brokerId')),
            TO_NUMBER(JSON_VALUE(p_json,'$.brokerCommissionAmount')),
            TO_NUMBER(JSON_VALUE(p_json,'$.brokerCommissionPct')),
            TO_DATE(JSON_VALUE(p_json,'$.startDate'),      'YYYY-MM-DD'),
            TO_DATE(JSON_VALUE(p_json,'$.endDate'),        'YYYY-MM-DD'),
            JSON_VALUE(p_json,'$.paymentFrequency'),
            TO_NUMBER(JSON_VALUE(p_json,'$.totalAmount')),
            NVL(JSON_VALUE(p_json,'$.currencyCode'),'AED'),
            TO_NUMBER(JSON_VALUE(p_json,'$.securityDepositAmount')),
            JSON_VALUE(p_json,'$.securityDepositCheque'),
            TO_DATE(JSON_VALUE(p_json,'$.securityDepositDate'),  'YYYY-MM-DD'),
            JSON_VALUE(p_json,'$.securityDepositBank'),
            TO_NUMBER(JSON_VALUE(p_json,'$.advanceRentAmount')),
            TO_NUMBER(JSON_VALUE(p_json,'$.advanceRentMonths')),
            JSON_VALUE(p_json,'$.ejariNumber'),
            TO_DATE(JSON_VALUE(p_json,'$.ejariRegDate'),   'YYYY-MM-DD'),
            TO_DATE(JSON_VALUE(p_json,'$.ejariExpiryDate'),'YYYY-MM-DD'),
            TO_NUMBER(JSON_VALUE(p_json,'$.municipalityFees')),
            TO_NUMBER(JSON_VALUE(p_json,'$.reraIndexPct')),
            NVL(TO_NUMBER(JSON_VALUE(p_json,'$.gracePeriodDays')),0),
            NVL(TO_NUMBER(JSON_VALUE(p_json,'$.noticePeriodDays')),90),
            NVL(JSON_VALUE(p_json,'$.renewalOption'),'N'),
            TO_NUMBER(JSON_VALUE(p_json,'$.rentIncrementPct')),
            JSON_VALUE(p_json,'$.specialConditions'),
            JSON_VALUE(p_json,'$.internalNotes')
        );

        -- Update property status to RESERVED
        UPDATE RR_RM_PROPERTIES
        SET    STATUS = 'RESERVED', LAST_UPDATE_DATE = SYSDATE
        WHERE  PROPERTY_ID = TO_NUMBER(JSON_VALUE(p_json,'$.propertyId'));

        -- Auto-generate installments
        RR_RM_INSTALLMENTS_PKG.generate_installments(v_id, v_inst_res);

        -- Auto-generate monthly splits
        RR_RM_SPLITS_PKG.generate_splits(v_id, v_split_res);

        -- Create document checklist from document types
        INSERT INTO RR_RM_AGREEMENT_DOCUMENTS (
            DOCUMENT_ID, AGREEMENT_ID, DOCUMENT_TYPE_ID
        )
        SELECT RR_RM_AGRDOCS_S.NEXTVAL, v_id, DOCUMENT_TYPE_ID
        FROM   RR_RM_DOCUMENT_TYPES
        WHERE  ENABLED_FLAG  = 'Y'
        AND   (CUSTOMER_TYPE = 'ALL'
               OR CUSTOMER_TYPE = (SELECT CUSTOMER_TYPE FROM RR_RM_CUSTOMERS
                                   WHERE  CUSTOMER_ID = TO_NUMBER(JSON_VALUE(p_json,'$.customerId'))));

        COMMIT;
        p_result := '{"status":"success","agreementId":' || v_id ||
                    ',"agreementNumber":"' || v_agr_num || '"' ||
                    ',"installments":' || v_inst_res ||
                    ',"splits":' || v_split_res || '}';
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_result := '{"status":"error","message":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END create_agreement;

    -- ----------------------------------------------------------------
    -- Update agreement header fields (does NOT regenerate lines)
    -- ----------------------------------------------------------------
    PROCEDURE update_agreement (p_json IN CLOB, p_result OUT VARCHAR2) IS
        v_id NUMBER := TO_NUMBER(JSON_VALUE(p_json,'$.agreementId'));
    BEGIN
        UPDATE RR_RM_AGREEMENTS
        SET    AGREEMENT_TYPE           = NVL(JSON_VALUE(p_json,'$.agreementType'),AGREEMENT_TYPE),
               SIGN_DATE               = NVL(TO_DATE(JSON_VALUE(p_json,'$.signDate'),'YYYY-MM-DD'),SIGN_DATE),
               VALID_FROM              = NVL(TO_DATE(JSON_VALUE(p_json,'$.validFrom'),'YYYY-MM-DD'),VALID_FROM),
               VALID_TO                = NVL(TO_DATE(JSON_VALUE(p_json,'$.validTo'),'YYYY-MM-DD'),VALID_TO),
               BROKER_ID               = NVL(TO_NUMBER(JSON_VALUE(p_json,'$.brokerId')),BROKER_ID),
               BROKER_COMMISSION_AMOUNT= NVL(TO_NUMBER(JSON_VALUE(p_json,'$.brokerCommissionAmount')),BROKER_COMMISSION_AMOUNT),
               BROKER_COMMISSION_PCT   = NVL(TO_NUMBER(JSON_VALUE(p_json,'$.brokerCommissionPct')),BROKER_COMMISSION_PCT),
               TENANT_CONTACT_PHONE    = NVL(JSON_VALUE(p_json,'$.tenantContactPhone'),TENANT_CONTACT_PHONE),
               TENANT_CONTACT_EMAIL    = NVL(JSON_VALUE(p_json,'$.tenantContactEmail'),TENANT_CONTACT_EMAIL),
               TENANT_CONTACT_ADDRESS  = NVL(JSON_VALUE(p_json,'$.tenantContactAddress'),TENANT_CONTACT_ADDRESS),
               EJARI_NUMBER            = NVL(JSON_VALUE(p_json,'$.ejariNumber'),EJARI_NUMBER),
               EJARI_REG_DATE          = NVL(TO_DATE(JSON_VALUE(p_json,'$.ejariRegDate'),'YYYY-MM-DD'),EJARI_REG_DATE),
               EJARI_EXPIRY_DATE       = NVL(TO_DATE(JSON_VALUE(p_json,'$.ejariExpiryDate'),'YYYY-MM-DD'),EJARI_EXPIRY_DATE),
               MUNICIPALITY_FEES       = NVL(TO_NUMBER(JSON_VALUE(p_json,'$.municipalityFees')),MUNICIPALITY_FEES),
               MUNICIPALITY_FEES_PAID  = NVL(JSON_VALUE(p_json,'$.municipalityFeesPaid'),MUNICIPALITY_FEES_PAID),
               SECURITY_DEPOSIT_STATUS = NVL(JSON_VALUE(p_json,'$.securityDepositStatus'),SECURITY_DEPOSIT_STATUS),
               SPECIAL_CONDITIONS      = NVL(JSON_VALUE(p_json,'$.specialConditions'),SPECIAL_CONDITIONS),
               INTERNAL_NOTES          = NVL(JSON_VALUE(p_json,'$.internalNotes'),INTERNAL_NOTES),
               LAST_UPDATED_BY         = USER,
               LAST_UPDATE_DATE        = SYSDATE
        WHERE  AGREEMENT_ID = v_id;
        COMMIT;
        p_result := '{"status":"success","agreementId":' || v_id || '}';
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_result := '{"status":"error","message":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END update_agreement;

    -- ----------------------------------------------------------------
    -- Activate agreement  →  set status ACTIVE, property → RENTED
    -- ----------------------------------------------------------------
    PROCEDURE activate_agreement (p_agreement_id IN NUMBER, p_result OUT VARCHAR2) IS
        v_prop_id NUMBER;
    BEGIN
        SELECT PROPERTY_ID INTO v_prop_id
        FROM   RR_RM_AGREEMENTS WHERE AGREEMENT_ID = p_agreement_id;

        UPDATE RR_RM_AGREEMENTS
        SET    STATUS = 'ACTIVE', LAST_UPDATE_DATE = SYSDATE
        WHERE  AGREEMENT_ID = p_agreement_id AND STATUS IN ('DRAFT','EXPIRED');

        UPDATE RR_RM_PROPERTIES
        SET    STATUS = 'RENTED', LAST_UPDATE_DATE = SYSDATE
        WHERE  PROPERTY_ID = v_prop_id;

        COMMIT;
        p_result := '{"status":"success","agreementId":' || p_agreement_id ||
                    ',"agreementStatus":"ACTIVE"}';
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_result := '{"status":"error","message":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END activate_agreement;

    -- ----------------------------------------------------------------
    -- Terminate agreement  →  set status TERMINATED, property → AVAILABLE
    -- JSON: { agreementId, terminatedDate, terminationReason }
    -- ----------------------------------------------------------------
    PROCEDURE terminate_agreement (p_json IN CLOB, p_result OUT VARCHAR2) IS
        v_id      NUMBER := TO_NUMBER(JSON_VALUE(p_json,'$.agreementId'));
        v_prop_id NUMBER;
    BEGIN
        SELECT PROPERTY_ID INTO v_prop_id
        FROM   RR_RM_AGREEMENTS WHERE AGREEMENT_ID = v_id;

        UPDATE RR_RM_AGREEMENTS
        SET    STATUS            = 'TERMINATED',
               TERMINATED_DATE  = NVL(TO_DATE(JSON_VALUE(p_json,'$.terminatedDate'),'YYYY-MM-DD'), SYSDATE),
               TERMINATION_REASON = JSON_VALUE(p_json,'$.terminationReason'),
               TERMINATED_BY    = USER,
               LAST_UPDATE_DATE = SYSDATE
        WHERE  AGREEMENT_ID = v_id;

        -- Cancel pending installments
        UPDATE RR_RM_INSTALLMENTS
        SET    STATUS = 'CANCELLED', LAST_UPDATE_DATE = SYSDATE
        WHERE  AGREEMENT_ID = v_id AND STATUS = 'PENDING';

        UPDATE RR_RM_PROPERTIES
        SET    STATUS = 'AVAILABLE', LAST_UPDATE_DATE = SYSDATE
        WHERE  PROPERTY_ID = v_prop_id;

        COMMIT;
        p_result := '{"status":"success","agreementId":' || v_id ||
                    ',"agreementStatus":"TERMINATED"}';
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_result := '{"status":"error","message":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END terminate_agreement;

    -- ----------------------------------------------------------------
    -- Get single agreement as JSON (header + summary counts)
    -- ----------------------------------------------------------------
    FUNCTION get_agreement (p_agreement_id IN NUMBER) RETURN CLOB IS
        v_result CLOB;
    BEGIN
        SELECT JSON_OBJECT(
            'agreementId'           VALUE a.AGREEMENT_ID,
            'agreementNumber'       VALUE a.AGREEMENT_NUMBER,
            'agreementType'         VALUE a.AGREEMENT_TYPE,
            'status'                VALUE a.STATUS,
            'signDate'              VALUE TO_CHAR(a.SIGN_DATE,'YYYY-MM-DD'),
            'startDate'             VALUE TO_CHAR(a.START_DATE,'YYYY-MM-DD'),
            'endDate'               VALUE TO_CHAR(a.END_DATE,'YYYY-MM-DD'),
            'noOfMonths'            VALUE a.NO_OF_MONTHS,
            'paymentFrequency'      VALUE a.PAYMENT_FREQUENCY,
            'noOfPayments'          VALUE a.NO_OF_PAYMENTS,
            'totalAmount'           VALUE a.TOTAL_AMOUNT,
            'frequencyAmount'       VALUE a.FREQUENCY_AMOUNT,
            'currencyCode'          VALUE a.CURRENCY_CODE,
            'propertyId'            VALUE a.PROPERTY_ID,
            'propertyName'          VALUE p.PROPERTY_NAME,
            'propertyNumber'        VALUE p.PROPERTY_NUMBER,
            'unitNo'                VALUE p.UNIT_NO,
            'buildingName'          VALUE p.BUILDING_NAME,
            'community'             VALUE p.COMMUNITY,
            'customerId'            VALUE a.CUSTOMER_ID,
            'customerName'          VALUE c.FULL_NAME,
            'customerMobile'        VALUE c.MOBILE,
            'customerEmail'         VALUE c.EMAIL,
            'tenantContactPhone'    VALUE a.TENANT_CONTACT_PHONE,
            'tenantContactEmail'    VALUE a.TENANT_CONTACT_EMAIL,
            'brokerId'              VALUE a.BROKER_ID,
            'brokerName'            VALUE b.BROKER_NAME,
            'brokerCommissionAmount'VALUE a.BROKER_COMMISSION_AMOUNT,
            'brokerCommissionPct'   VALUE a.BROKER_COMMISSION_PCT,
            'brokerCommissionPaid'  VALUE a.BROKER_COMMISSION_PAID,
            'securityDepositAmount' VALUE a.SECURITY_DEPOSIT_AMOUNT,
            'securityDepositStatus' VALUE a.SECURITY_DEPOSIT_STATUS,
            'ejariNumber'           VALUE a.EJARI_NUMBER,
            'ejariRegDate'          VALUE TO_CHAR(a.EJARI_REG_DATE,'YYYY-MM-DD'),
            'municipalityFees'      VALUE a.MUNICIPALITY_FEES,
            'municipalityFeesPaid'  VALUE a.MUNICIPALITY_FEES_PAID,
            'noticePeriodDays'      VALUE a.NOTICE_PERIOD_DAYS,
            'specialConditions'     VALUE a.SPECIAL_CONDITIONS,
            'internalNotes'         VALUE a.INTERNAL_NOTES,
            'creationDate'          VALUE TO_CHAR(a.CREATION_DATE,'YYYY-MM-DD')
        )
        INTO v_result
        FROM RR_RM_AGREEMENTS a
        JOIN RR_RM_PROPERTIES p ON p.PROPERTY_ID = a.PROPERTY_ID
        JOIN RR_RM_CUSTOMERS  c ON c.CUSTOMER_ID  = a.CUSTOMER_ID
        LEFT JOIN RR_RM_BROKERS b ON b.BROKER_ID  = a.BROKER_ID
        WHERE a.AGREEMENT_ID = p_agreement_id;

        RETURN v_result;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN RETURN '{"error":"Agreement not found"}';
        WHEN OTHERS THEN RETURN '{"error":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END get_agreement;

    -- ----------------------------------------------------------------
    -- Search agreements — returns JSON array
    -- JSON filters: { status, customerId, propertyId, dateFrom, dateTo,
    --                 agreementNumber, limit, offset }
    -- ----------------------------------------------------------------
    FUNCTION search_agreements (p_json IN CLOB) RETURN CLOB IS
        v_result CLOB := '{"agreements":[';
        v_sep    VARCHAR2(1) := '';
        v_lim    NUMBER := NVL(TO_NUMBER(JSON_VALUE(p_json,'$.limit')),  200);
        v_off    NUMBER := NVL(TO_NUMBER(JSON_VALUE(p_json,'$.offset')), 0);
    BEGIN
        FOR r IN (
            SELECT a.AGREEMENT_ID, a.AGREEMENT_NUMBER, a.AGREEMENT_TYPE,
                   a.STATUS, a.PAYMENT_FREQUENCY, a.TOTAL_AMOUNT,
                   a.NO_OF_MONTHS, a.NO_OF_PAYMENTS, a.FREQUENCY_AMOUNT,
                   TO_CHAR(a.START_DATE,'YYYY-MM-DD') AS START_DATE,
                   TO_CHAR(a.END_DATE,  'YYYY-MM-DD') AS END_DATE,
                   TO_CHAR(a.SIGN_DATE, 'YYYY-MM-DD') AS SIGN_DATE,
                   p.PROPERTY_NAME, p.PROPERTY_NUMBER, p.UNIT_NO, p.COMMUNITY,
                   c.FULL_NAME AS CUSTOMER_NAME, c.MOBILE AS CUSTOMER_MOBILE,
                   a.EJARI_NUMBER, a.EJARI_REG_DATE
            FROM   RR_RM_AGREEMENTS a
            JOIN   RR_RM_PROPERTIES p ON p.PROPERTY_ID = a.PROPERTY_ID
            JOIN   RR_RM_CUSTOMERS  c ON c.CUSTOMER_ID  = a.CUSTOMER_ID
            WHERE  (JSON_VALUE(p_json,'$.status')          IS NULL OR a.STATUS           = JSON_VALUE(p_json,'$.status'))
            AND    (JSON_VALUE(p_json,'$.customerId')       IS NULL OR a.CUSTOMER_ID      = TO_NUMBER(JSON_VALUE(p_json,'$.customerId')))
            AND    (JSON_VALUE(p_json,'$.propertyId')       IS NULL OR a.PROPERTY_ID      = TO_NUMBER(JSON_VALUE(p_json,'$.propertyId')))
            AND    (JSON_VALUE(p_json,'$.agreementNumber')  IS NULL OR UPPER(a.AGREEMENT_NUMBER) LIKE '%' || UPPER(JSON_VALUE(p_json,'$.agreementNumber')) || '%')
            AND    (JSON_VALUE(p_json,'$.dateFrom')         IS NULL OR a.START_DATE       >= TO_DATE(JSON_VALUE(p_json,'$.dateFrom'),'YYYY-MM-DD'))
            AND    (JSON_VALUE(p_json,'$.dateTo')           IS NULL OR a.END_DATE         <= TO_DATE(JSON_VALUE(p_json,'$.dateTo'),'YYYY-MM-DD'))
            ORDER  BY a.CREATION_DATE DESC
            OFFSET v_off ROWS FETCH NEXT v_lim ROWS ONLY
        ) LOOP
            v_result := v_result || v_sep ||
                '{"agreementId":'      || r.AGREEMENT_ID ||
                ',"agreementNumber":"' || r.AGREEMENT_NUMBER || '"' ||
                ',"type":"'            || r.AGREEMENT_TYPE || '"' ||
                ',"status":"'          || r.STATUS || '"' ||
                ',"startDate":"'       || r.START_DATE || '"' ||
                ',"endDate":"'         || r.END_DATE || '"' ||
                ',"signDate":"'        || r.SIGN_DATE || '"' ||
                ',"noOfMonths":'       || NVL(r.NO_OF_MONTHS,0) ||
                ',"frequency":"'       || r.PAYMENT_FREQUENCY || '"' ||
                ',"totalAmount":'      || NVL(r.TOTAL_AMOUNT,0) ||
                ',"frequencyAmount":'  || NVL(r.FREQUENCY_AMOUNT,0) ||
                ',"noOfPayments":'     || NVL(r.NO_OF_PAYMENTS,0) ||
                ',"propertyName":"'    || NVL(r.PROPERTY_NAME,'') || '"' ||
                ',"propertyNumber":"'  || NVL(r.PROPERTY_NUMBER,'') || '"' ||
                ',"unitNo":"'          || NVL(r.UNIT_NO,'') || '"' ||
                ',"community":"'       || NVL(r.COMMUNITY,'') || '"' ||
                ',"customerName":"'    || NVL(r.CUSTOMER_NAME,'') || '"' ||
                ',"customerMobile":"'  || NVL(r.CUSTOMER_MOBILE,'') || '"' ||
                ',"ejariNumber":"'     || NVL(r.EJARI_NUMBER,'') || '"' ||
                '}';
            v_sep := ',';
        END LOOP;
        RETURN v_result || ']}';
    EXCEPTION
        WHEN OTHERS THEN RETURN '{"error":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END search_agreements;

    -- ----------------------------------------------------------------
    -- Save / update document checklist items
    -- JSON: { agreementId, documents:[{documentId, submittedFlag,
    --          documentNumber, documentExpiry, verifiedFlag, notes}] }
    -- ----------------------------------------------------------------
    PROCEDURE upsert_documents (p_json IN CLOB, p_result OUT VARCHAR2) IS
        v_agr_id NUMBER := TO_NUMBER(JSON_VALUE(p_json,'$.agreementId'));
        v_arr    JSON_ARRAY_T;
        v_obj    JSON_OBJECT_T;
        v_doc_id NUMBER;
    BEGIN
        v_arr := JSON_ARRAY_T(JSON_QUERY(p_json,'$.documents'));
        FOR i IN 0..v_arr.GET_SIZE - 1 LOOP
            v_obj    := TREAT(v_arr.GET(i) AS JSON_OBJECT_T);
            v_doc_id := v_obj.GET_NUMBER('documentId');
            UPDATE RR_RM_AGREEMENT_DOCUMENTS
            SET    SUBMITTED_FLAG  = NVL(v_obj.GET_STRING('submittedFlag'), SUBMITTED_FLAG),
                   SUBMITTED_DATE  = CASE WHEN v_obj.GET_STRING('submittedFlag') = 'Y'
                                          THEN NVL(SUBMITTED_DATE, SYSDATE) ELSE SUBMITTED_DATE END,
                   DOCUMENT_NUMBER = NVL(v_obj.GET_STRING('documentNumber'), DOCUMENT_NUMBER),
                   DOCUMENT_EXPIRY = NVL(TO_DATE(v_obj.GET_STRING('documentExpiry'),'YYYY-MM-DD'), DOCUMENT_EXPIRY),
                   VERIFIED_FLAG   = NVL(v_obj.GET_STRING('verifiedFlag'), VERIFIED_FLAG),
                   VERIFIED_BY     = CASE WHEN v_obj.GET_STRING('verifiedFlag') = 'Y' THEN USER ELSE VERIFIED_BY END,
                   VERIFIED_DATE   = CASE WHEN v_obj.GET_STRING('verifiedFlag') = 'Y' THEN SYSDATE ELSE VERIFIED_DATE END,
                   NOTES           = NVL(v_obj.GET_STRING('notes'), NOTES),
                   LAST_UPDATE_DATE= SYSDATE
            WHERE  DOCUMENT_ID = v_doc_id AND AGREEMENT_ID = v_agr_id;
        END LOOP;
        COMMIT;
        p_result := '{"status":"success"}';
    EXCEPTION
        WHEN OTHERS THEN
            ROLLBACK;
            p_result := '{"status":"error","message":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END upsert_documents;

END RR_RM_AGREEMENTS_PKG;
/

-- ============================================================
-- PACKAGE: RR_RM_PROPERTIES_PKG
-- ============================================================
CREATE OR REPLACE PACKAGE RR_RM_PROPERTIES_PKG AS
    PROCEDURE create_property (p_json IN CLOB, p_result OUT VARCHAR2);
    PROCEDURE update_property (p_json IN CLOB, p_result OUT VARCHAR2);
    FUNCTION  get_properties  (p_json IN CLOB) RETURN CLOB;
END RR_RM_PROPERTIES_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_RM_PROPERTIES_PKG AS

    PROCEDURE create_property (p_json IN CLOB, p_result OUT VARCHAR2) IS
        v_id     NUMBER := RR_RM_PROPERTIES_S.NEXTVAL;
        v_num    VARCHAR2(20) := 'PROP-' || LPAD(v_id,6,'0');
    BEGIN
        INSERT INTO RR_RM_PROPERTIES (
            PROPERTY_ID, PROPERTY_NUMBER, PROPERTY_NAME,
            PROPERTY_TYPE, USAGE_TYPE, BUILDING_NAME, FLOOR_NO, UNIT_NO,
            AREA_SQFT, AREA_SQMT, BEDROOMS, BATHROOMS, PARKING_SPACES,
            PLOT_NO, MAKANI_NO, COMMUNITY, DISTRICT, CITY, EMIRATE, COUNTRY,
            TITLE_DEED_NO, TITLE_DEED_DATE, MUNICIPALITY_NO,
            DEWA_PREMISE_NO, DEWA_ACCOUNT_NO,
            OWNER_NAME, OWNER_CONTACT,
            ANNUAL_MARKET_RENT, PURCHASE_VALUE,
            FEATURES, DESCRIPTION, STATUS
        ) VALUES (
            v_id, v_num, JSON_VALUE(p_json,'$.propertyName'),
            JSON_VALUE(p_json,'$.propertyType'),
            JSON_VALUE(p_json,'$.usageType'),
            JSON_VALUE(p_json,'$.buildingName'),
            JSON_VALUE(p_json,'$.floorNo'),
            JSON_VALUE(p_json,'$.unitNo'),
            TO_NUMBER(JSON_VALUE(p_json,'$.areaSqft')),
            TO_NUMBER(JSON_VALUE(p_json,'$.areaSqmt')),
            TO_NUMBER(JSON_VALUE(p_json,'$.bedrooms')),
            TO_NUMBER(JSON_VALUE(p_json,'$.bathrooms')),
            TO_NUMBER(JSON_VALUE(p_json,'$.parkingSpaces')),
            JSON_VALUE(p_json,'$.plotNo'),
            JSON_VALUE(p_json,'$.makaniNo'),
            JSON_VALUE(p_json,'$.community'),
            JSON_VALUE(p_json,'$.district'),
            NVL(JSON_VALUE(p_json,'$.city'),'Dubai'),
            NVL(JSON_VALUE(p_json,'$.emirate'),'Dubai'),
            NVL(JSON_VALUE(p_json,'$.country'),'UAE'),
            JSON_VALUE(p_json,'$.titleDeedNo'),
            TO_DATE(JSON_VALUE(p_json,'$.titleDeedDate'),'YYYY-MM-DD'),
            JSON_VALUE(p_json,'$.municipalityNo'),
            JSON_VALUE(p_json,'$.dewaPremiseNo'),
            JSON_VALUE(p_json,'$.dewaAccountNo'),
            JSON_VALUE(p_json,'$.ownerName'),
            JSON_VALUE(p_json,'$.ownerContact'),
            TO_NUMBER(JSON_VALUE(p_json,'$.annualMarketRent')),
            TO_NUMBER(JSON_VALUE(p_json,'$.purchaseValue')),
            JSON_VALUE(p_json,'$.features'),
            JSON_VALUE(p_json,'$.description'),
            NVL(JSON_VALUE(p_json,'$.status'),'AVAILABLE')
        );
        COMMIT;
        p_result := '{"status":"success","propertyId":' || v_id ||
                    ',"propertyNumber":"' || v_num || '"}';
    EXCEPTION
        WHEN OTHERS THEN ROLLBACK;
            p_result := '{"status":"error","message":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END create_property;

    PROCEDURE update_property (p_json IN CLOB, p_result OUT VARCHAR2) IS
        v_id NUMBER := TO_NUMBER(JSON_VALUE(p_json,'$.propertyId'));
    BEGIN
        UPDATE RR_RM_PROPERTIES
        SET    PROPERTY_NAME     = NVL(JSON_VALUE(p_json,'$.propertyName'),    PROPERTY_NAME),
               BUILDING_NAME     = NVL(JSON_VALUE(p_json,'$.buildingName'),    BUILDING_NAME),
               FLOOR_NO          = NVL(JSON_VALUE(p_json,'$.floorNo'),         FLOOR_NO),
               UNIT_NO           = NVL(JSON_VALUE(p_json,'$.unitNo'),          UNIT_NO),
               AREA_SQFT         = NVL(TO_NUMBER(JSON_VALUE(p_json,'$.areaSqft')),  AREA_SQFT),
               AREA_SQMT         = NVL(TO_NUMBER(JSON_VALUE(p_json,'$.areaSqmt')),  AREA_SQMT),
               BEDROOMS          = NVL(TO_NUMBER(JSON_VALUE(p_json,'$.bedrooms')),   BEDROOMS),
               BATHROOMS         = NVL(TO_NUMBER(JSON_VALUE(p_json,'$.bathrooms')),  BATHROOMS),
               PARKING_SPACES    = NVL(TO_NUMBER(JSON_VALUE(p_json,'$.parkingSpaces')), PARKING_SPACES),
               OWNER_NAME        = NVL(JSON_VALUE(p_json,'$.ownerName'),       OWNER_NAME),
               OWNER_CONTACT     = NVL(JSON_VALUE(p_json,'$.ownerContact'),    OWNER_CONTACT),
               ANNUAL_MARKET_RENT= NVL(TO_NUMBER(JSON_VALUE(p_json,'$.annualMarketRent')),ANNUAL_MARKET_RENT),
               DEWA_PREMISE_NO   = NVL(JSON_VALUE(p_json,'$.dewaPremiseNo'),   DEWA_PREMISE_NO),
               DEWA_ACCOUNT_NO   = NVL(JSON_VALUE(p_json,'$.dewaAccountNo'),   DEWA_ACCOUNT_NO),
               TITLE_DEED_NO     = NVL(JSON_VALUE(p_json,'$.titleDeedNo'),     TITLE_DEED_NO),
               FEATURES          = NVL(JSON_VALUE(p_json,'$.features'),        FEATURES),
               DESCRIPTION       = NVL(JSON_VALUE(p_json,'$.description'),     DESCRIPTION),
               STATUS            = NVL(JSON_VALUE(p_json,'$.status'),          STATUS),
               LAST_UPDATED_BY   = USER,
               LAST_UPDATE_DATE  = SYSDATE
        WHERE  PROPERTY_ID = v_id;
        COMMIT;
        p_result := '{"status":"success","propertyId":' || v_id || '}';
    EXCEPTION
        WHEN OTHERS THEN ROLLBACK;
            p_result := '{"status":"error","message":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END update_property;

    FUNCTION get_properties (p_json IN CLOB) RETURN CLOB IS
        v_result CLOB := '{"properties":[';
        v_sep    VARCHAR2(1) := '';
    BEGIN
        FOR r IN (
            SELECT p.PROPERTY_ID, p.PROPERTY_NUMBER, p.PROPERTY_NAME,
                   p.PROPERTY_TYPE, p.USAGE_TYPE, p.BUILDING_NAME,
                   p.UNIT_NO, p.FLOOR_NO, p.AREA_SQFT, p.AREA_SQMT,
                   p.BEDROOMS, p.BATHROOMS, p.PARKING_SPACES,
                   p.COMMUNITY, p.DISTRICT, p.CITY,
                   p.OWNER_NAME, p.ANNUAL_MARKET_RENT,
                   p.STATUS, p.TITLE_DEED_NO, p.DEWA_PREMISE_NO,
                   p.MAKANI_NO, p.FEATURES
            FROM   RR_RM_PROPERTIES p
            WHERE  (JSON_VALUE(p_json,'$.status')       IS NULL OR p.STATUS        = JSON_VALUE(p_json,'$.status'))
            AND    (JSON_VALUE(p_json,'$.usageType')     IS NULL OR p.USAGE_TYPE    = JSON_VALUE(p_json,'$.usageType'))
            AND    (JSON_VALUE(p_json,'$.propertyType')  IS NULL OR p.PROPERTY_TYPE = JSON_VALUE(p_json,'$.propertyType'))
            AND    (JSON_VALUE(p_json,'$.search')        IS NULL OR UPPER(p.PROPERTY_NAME) LIKE '%' || UPPER(JSON_VALUE(p_json,'$.search')) || '%'
                                                                 OR UPPER(p.COMMUNITY)     LIKE '%' || UPPER(JSON_VALUE(p_json,'$.search')) || '%')
            ORDER  BY p.PROPERTY_NUMBER
        ) LOOP
            v_result := v_result || v_sep ||
                '{"propertyId":'       || r.PROPERTY_ID ||
                ',"propertyNumber":"'  || r.PROPERTY_NUMBER || '"' ||
                ',"propertyName":"'    || REPLACE(r.PROPERTY_NAME,'"','\"') || '"' ||
                ',"propertyType":"'    || r.PROPERTY_TYPE || '"' ||
                ',"usageType":"'       || r.USAGE_TYPE || '"' ||
                ',"buildingName":"'    || NVL(r.BUILDING_NAME,'') || '"' ||
                ',"unitNo":"'          || NVL(r.UNIT_NO,'') || '"' ||
                ',"community":"'       || NVL(r.COMMUNITY,'') || '"' ||
                ',"bedrooms":'         || NVL(r.BEDROOMS,0) ||
                ',"bathrooms":'        || NVL(r.BATHROOMS,0) ||
                ',"areaSqft":'         || NVL(r.AREA_SQFT,0) ||
                ',"ownerName":"'       || NVL(r.OWNER_NAME,'') || '"' ||
                ',"annualMarketRent":' || NVL(r.ANNUAL_MARKET_RENT,0) ||
                ',"status":"'          || r.STATUS || '"' ||
                '}';
            v_sep := ',';
        END LOOP;
        RETURN v_result || ']}';
    EXCEPTION
        WHEN OTHERS THEN RETURN '{"error":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END get_properties;

END RR_RM_PROPERTIES_PKG;
/

-- ============================================================
-- PACKAGE: RR_RM_CUSTOMERS_PKG
-- ============================================================
CREATE OR REPLACE PACKAGE RR_RM_CUSTOMERS_PKG AS
    PROCEDURE create_customer (p_json IN CLOB, p_result OUT VARCHAR2);
    PROCEDURE update_customer (p_json IN CLOB, p_result OUT VARCHAR2);
    FUNCTION  get_customers   (p_json IN CLOB) RETURN CLOB;
END RR_RM_CUSTOMERS_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_RM_CUSTOMERS_PKG AS

    PROCEDURE create_customer (p_json IN CLOB, p_result OUT VARCHAR2) IS
        v_id  NUMBER := RR_RM_CUSTOMERS_S.NEXTVAL;
        v_num VARCHAR2(20) := 'CUST-' || LPAD(v_id,6,'0');
    BEGIN
        INSERT INTO RR_RM_CUSTOMERS (
            CUSTOMER_ID, CUSTOMER_NUMBER, CUSTOMER_TYPE,
            FIRST_NAME, LAST_NAME, FULL_NAME, COMPANY_NAME,
            EMAIL, PHONE, MOBILE, NATIONALITY,
            PASSPORT_NO, PASSPORT_EXPIRY,
            EMIRATES_ID, EMIRATES_ID_EXPIRY,
            TRADE_LICENSE_NO, TRADE_LICENSE_EXPIRY,
            ADDRESS_LINE1, ADDRESS_LINE2, CITY, EMIRATE, COUNTRY,
            OCCUPATION, EMPLOYER_NAME, NOTES, STATUS
        ) VALUES (
            v_id, v_num,
            NVL(JSON_VALUE(p_json,'$.customerType'),'INDIVIDUAL'),
            JSON_VALUE(p_json,'$.firstName'),
            JSON_VALUE(p_json,'$.lastName'),
            JSON_VALUE(p_json,'$.fullName'),
            JSON_VALUE(p_json,'$.companyName'),
            JSON_VALUE(p_json,'$.email'),
            JSON_VALUE(p_json,'$.phone'),
            JSON_VALUE(p_json,'$.mobile'),
            JSON_VALUE(p_json,'$.nationality'),
            JSON_VALUE(p_json,'$.passportNo'),
            TO_DATE(JSON_VALUE(p_json,'$.passportExpiry'),'YYYY-MM-DD'),
            JSON_VALUE(p_json,'$.emiratesId'),
            TO_DATE(JSON_VALUE(p_json,'$.emiratesIdExpiry'),'YYYY-MM-DD'),
            JSON_VALUE(p_json,'$.tradeLicenseNo'),
            TO_DATE(JSON_VALUE(p_json,'$.tradeLicenseExpiry'),'YYYY-MM-DD'),
            JSON_VALUE(p_json,'$.addressLine1'),
            JSON_VALUE(p_json,'$.addressLine2'),
            NVL(JSON_VALUE(p_json,'$.city'),'Dubai'),
            NVL(JSON_VALUE(p_json,'$.emirate'),'Dubai'),
            NVL(JSON_VALUE(p_json,'$.country'),'UAE'),
            JSON_VALUE(p_json,'$.occupation'),
            JSON_VALUE(p_json,'$.employerName'),
            JSON_VALUE(p_json,'$.notes'),
            'ACTIVE'
        );
        COMMIT;
        p_result := '{"status":"success","customerId":' || v_id ||
                    ',"customerNumber":"' || v_num || '"}';
    EXCEPTION
        WHEN OTHERS THEN ROLLBACK;
            p_result := '{"status":"error","message":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END create_customer;

    PROCEDURE update_customer (p_json IN CLOB, p_result OUT VARCHAR2) IS
        v_id NUMBER := TO_NUMBER(JSON_VALUE(p_json,'$.customerId'));
    BEGIN
        UPDATE RR_RM_CUSTOMERS
        SET    FULL_NAME             = NVL(JSON_VALUE(p_json,'$.fullName'),     FULL_NAME),
               EMAIL                = NVL(JSON_VALUE(p_json,'$.email'),         EMAIL),
               PHONE                = NVL(JSON_VALUE(p_json,'$.phone'),         PHONE),
               MOBILE               = NVL(JSON_VALUE(p_json,'$.mobile'),        MOBILE),
               PASSPORT_NO          = NVL(JSON_VALUE(p_json,'$.passportNo'),    PASSPORT_NO),
               PASSPORT_EXPIRY      = NVL(TO_DATE(JSON_VALUE(p_json,'$.passportExpiry'),'YYYY-MM-DD'), PASSPORT_EXPIRY),
               EMIRATES_ID          = NVL(JSON_VALUE(p_json,'$.emiratesId'),    EMIRATES_ID),
               EMIRATES_ID_EXPIRY   = NVL(TO_DATE(JSON_VALUE(p_json,'$.emiratesIdExpiry'),'YYYY-MM-DD'), EMIRATES_ID_EXPIRY),
               TRADE_LICENSE_NO     = NVL(JSON_VALUE(p_json,'$.tradeLicenseNo'), TRADE_LICENSE_NO),
               ADDRESS_LINE1        = NVL(JSON_VALUE(p_json,'$.addressLine1'),  ADDRESS_LINE1),
               OCCUPATION           = NVL(JSON_VALUE(p_json,'$.occupation'),    OCCUPATION),
               STATUS               = NVL(JSON_VALUE(p_json,'$.status'),        STATUS),
               LAST_UPDATED_BY      = USER,
               LAST_UPDATE_DATE     = SYSDATE
        WHERE  CUSTOMER_ID = v_id;
        COMMIT;
        p_result := '{"status":"success","customerId":' || v_id || '}';
    EXCEPTION
        WHEN OTHERS THEN ROLLBACK;
            p_result := '{"status":"error","message":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END update_customer;

    FUNCTION get_customers (p_json IN CLOB) RETURN CLOB IS
        v_result CLOB := '{"customers":[';
        v_sep    VARCHAR2(1) := '';
    BEGIN
        FOR r IN (
            SELECT CUSTOMER_ID, CUSTOMER_NUMBER, CUSTOMER_TYPE,
                   FULL_NAME, COMPANY_NAME, EMAIL, MOBILE, PHONE,
                   NATIONALITY, PASSPORT_NO,
                   TO_CHAR(PASSPORT_EXPIRY,'YYYY-MM-DD') AS PASSPORT_EXPIRY,
                   EMIRATES_ID,
                   TO_CHAR(EMIRATES_ID_EXPIRY,'YYYY-MM-DD') AS EMIRATES_ID_EXPIRY,
                   TRADE_LICENSE_NO, OCCUPATION, EMPLOYER_NAME,
                   ADDRESS_LINE1, CITY, EMIRATE, STATUS
            FROM   RR_RM_CUSTOMERS
            WHERE  (JSON_VALUE(p_json,'$.status') IS NULL OR STATUS = JSON_VALUE(p_json,'$.status'))
            AND    (JSON_VALUE(p_json,'$.search')  IS NULL
                    OR UPPER(FULL_NAME)     LIKE '%' || UPPER(JSON_VALUE(p_json,'$.search')) || '%'
                    OR UPPER(MOBILE)        LIKE '%' || UPPER(JSON_VALUE(p_json,'$.search')) || '%'
                    OR UPPER(EMIRATES_ID)   LIKE '%' || UPPER(JSON_VALUE(p_json,'$.search')) || '%')
            ORDER  BY FULL_NAME
        ) LOOP
            v_result := v_result || v_sep ||
                '{"customerId":'       || r.CUSTOMER_ID ||
                ',"customerNumber":"'  || r.CUSTOMER_NUMBER || '"' ||
                ',"customerType":"'    || r.CUSTOMER_TYPE || '"' ||
                ',"fullName":"'        || REPLACE(r.FULL_NAME,'"','\"') || '"' ||
                ',"companyName":"'     || NVL(r.COMPANY_NAME,'') || '"' ||
                ',"email":"'           || NVL(r.EMAIL,'') || '"' ||
                ',"mobile":"'          || NVL(r.MOBILE,'') || '"' ||
                ',"nationality":"'     || NVL(r.NATIONALITY,'') || '"' ||
                ',"emiratesId":"'      || NVL(r.EMIRATES_ID,'') || '"' ||
                ',"passportNo":"'      || NVL(r.PASSPORT_NO,'') || '"' ||
                ',"passportExpiry":"'  || NVL(r.PASSPORT_EXPIRY,'') || '"' ||
                ',"emiratesIdExpiry":"'|| NVL(r.EMIRATES_ID_EXPIRY,'') || '"' ||
                ',"tradeLicenseNo":"'  || NVL(r.TRADE_LICENSE_NO,'') || '"' ||
                ',"occupation":"'      || NVL(r.OCCUPATION,'') || '"' ||
                ',"city":"'            || NVL(r.CITY,'') || '"' ||
                ',"status":"'          || r.STATUS || '"' ||
                '}';
            v_sep := ',';
        END LOOP;
        RETURN v_result || ']}';
    EXCEPTION
        WHEN OTHERS THEN RETURN '{"error":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END get_customers;

END RR_RM_CUSTOMERS_PKG;
/

-- ============================================================
-- PACKAGE: RR_RM_EXPENSES_PKG
-- ============================================================
CREATE OR REPLACE PACKAGE RR_RM_EXPENSES_PKG AS
    PROCEDURE create_expense (p_json IN CLOB, p_result OUT VARCHAR2);
    PROCEDURE update_expense (p_json IN CLOB, p_result OUT VARCHAR2);
    FUNCTION  get_expenses   (p_json IN CLOB) RETURN CLOB;
END RR_RM_EXPENSES_PKG;
/

CREATE OR REPLACE PACKAGE BODY RR_RM_EXPENSES_PKG AS

    PROCEDURE create_expense (p_json IN CLOB, p_result OUT VARCHAR2) IS
        v_id  NUMBER := RR_RM_EXPENSES_S.NEXTVAL;
        v_num VARCHAR2(20) := 'EXP-' || TO_CHAR(SYSDATE,'YYYY') || '-' || LPAD(v_id,5,'0');
    BEGIN
        INSERT INTO RR_RM_EXPENSES (
            EXPENSE_ID, EXPENSE_NUMBER, PROPERTY_ID, AGREEMENT_ID,
            EXPENSE_TYPE_ID, EXPENSE_DATE, DESCRIPTION, AMOUNT,
            CURRENCY_CODE, PAID_BY, PAYMENT_METHOD,
            RECEIPT_NO, VENDOR_NAME, VENDOR_CONTACT, NOTES, STATUS
        ) VALUES (
            v_id, v_num,
            TO_NUMBER(JSON_VALUE(p_json,'$.propertyId')),
            TO_NUMBER(JSON_VALUE(p_json,'$.agreementId')),
            TO_NUMBER(JSON_VALUE(p_json,'$.expenseTypeId')),
            TO_DATE(JSON_VALUE(p_json,'$.expenseDate'),'YYYY-MM-DD'),
            JSON_VALUE(p_json,'$.description'),
            TO_NUMBER(JSON_VALUE(p_json,'$.amount')),
            NVL(JSON_VALUE(p_json,'$.currencyCode'),'AED'),
            NVL(JSON_VALUE(p_json,'$.paidBy'),'OWNER'),
            JSON_VALUE(p_json,'$.paymentMethod'),
            JSON_VALUE(p_json,'$.receiptNo'),
            JSON_VALUE(p_json,'$.vendorName'),
            JSON_VALUE(p_json,'$.vendorContact'),
            JSON_VALUE(p_json,'$.notes'),
            'PENDING'
        );
        COMMIT;
        p_result := '{"status":"success","expenseId":' || v_id ||
                    ',"expenseNumber":"' || v_num || '"}';
    EXCEPTION
        WHEN OTHERS THEN ROLLBACK;
            p_result := '{"status":"error","message":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END create_expense;

    PROCEDURE update_expense (p_json IN CLOB, p_result OUT VARCHAR2) IS
        v_id NUMBER := TO_NUMBER(JSON_VALUE(p_json,'$.expenseId'));
    BEGIN
        UPDATE RR_RM_EXPENSES
        SET    DESCRIPTION      = NVL(JSON_VALUE(p_json,'$.description'), DESCRIPTION),
               AMOUNT           = NVL(TO_NUMBER(JSON_VALUE(p_json,'$.amount')), AMOUNT),
               STATUS           = NVL(JSON_VALUE(p_json,'$.status'),      STATUS),
               APPROVED_BY      = CASE WHEN JSON_VALUE(p_json,'$.status') = 'APPROVED' THEN USER ELSE APPROVED_BY END,
               APPROVED_DATE    = CASE WHEN JSON_VALUE(p_json,'$.status') = 'APPROVED' THEN SYSDATE ELSE APPROVED_DATE END,
               PAID_DATE        = CASE WHEN JSON_VALUE(p_json,'$.status') = 'PAID'
                                       THEN NVL(TO_DATE(JSON_VALUE(p_json,'$.paidDate'),'YYYY-MM-DD'),SYSDATE)
                                       ELSE PAID_DATE END,
               RECEIPT_NO       = NVL(JSON_VALUE(p_json,'$.receiptNo'),   RECEIPT_NO),
               VENDOR_NAME      = NVL(JSON_VALUE(p_json,'$.vendorName'),  VENDOR_NAME),
               NOTES            = NVL(JSON_VALUE(p_json,'$.notes'),       NOTES),
               LAST_UPDATED_BY  = USER,
               LAST_UPDATE_DATE = SYSDATE
        WHERE  EXPENSE_ID = v_id;
        COMMIT;
        p_result := '{"status":"success","expenseId":' || v_id || '}';
    EXCEPTION
        WHEN OTHERS THEN ROLLBACK;
            p_result := '{"status":"error","message":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END update_expense;

    FUNCTION get_expenses (p_json IN CLOB) RETURN CLOB IS
        v_result CLOB := '{"expenses":[';
        v_sep    VARCHAR2(1) := '';
    BEGIN
        FOR r IN (
            SELECT e.EXPENSE_ID, e.EXPENSE_NUMBER,
                   e.EXPENSE_DATE, e.DESCRIPTION, e.AMOUNT, e.CURRENCY_CODE,
                   e.PAID_BY, e.STATUS, e.RECEIPT_NO, e.VENDOR_NAME,
                   e.APPROVED_BY, e.APPROVED_DATE, e.PAID_DATE,
                   p.PROPERTY_NAME, p.PROPERTY_NUMBER,
                   t.EXPENSE_TYPE_NAME, t.CATEGORY
            FROM   RR_RM_EXPENSES      e
            JOIN   RR_RM_PROPERTIES    p ON p.PROPERTY_ID    = e.PROPERTY_ID
            JOIN   RR_RM_EXPENSE_TYPES t ON t.EXPENSE_TYPE_ID= e.EXPENSE_TYPE_ID
            WHERE  (JSON_VALUE(p_json,'$.status')     IS NULL OR e.STATUS     = JSON_VALUE(p_json,'$.status'))
            AND    (JSON_VALUE(p_json,'$.propertyId') IS NULL OR e.PROPERTY_ID= TO_NUMBER(JSON_VALUE(p_json,'$.propertyId')))
            AND    (JSON_VALUE(p_json,'$.dateFrom')   IS NULL OR e.EXPENSE_DATE >= TO_DATE(JSON_VALUE(p_json,'$.dateFrom'),'YYYY-MM-DD'))
            AND    (JSON_VALUE(p_json,'$.dateTo')     IS NULL OR e.EXPENSE_DATE <= TO_DATE(JSON_VALUE(p_json,'$.dateTo'),'YYYY-MM-DD'))
            ORDER  BY e.EXPENSE_DATE DESC
        ) LOOP
            v_result := v_result || v_sep ||
                '{"expenseId":'         || r.EXPENSE_ID ||
                ',"expenseNumber":"'    || r.EXPENSE_NUMBER || '"' ||
                ',"expenseDate":"'      || TO_CHAR(r.EXPENSE_DATE,'YYYY-MM-DD') || '"' ||
                ',"description":"'      || REPLACE(r.DESCRIPTION,'"','\"') || '"' ||
                ',"amount":'            || r.AMOUNT ||
                ',"currencyCode":"'     || r.CURRENCY_CODE || '"' ||
                ',"paidBy":"'           || r.PAID_BY || '"' ||
                ',"status":"'           || r.STATUS || '"' ||
                ',"receiptNo":"'        || NVL(r.RECEIPT_NO,'') || '"' ||
                ',"vendorName":"'       || NVL(r.VENDOR_NAME,'') || '"' ||
                ',"propertyName":"'     || REPLACE(r.PROPERTY_NAME,'"','\"') || '"' ||
                ',"expenseTypeName":"'  || r.EXPENSE_TYPE_NAME || '"' ||
                ',"category":"'         || r.CATEGORY || '"' ||
                '}';
            v_sep := ',';
        END LOOP;
        RETURN v_result || ']}';
    EXCEPTION
        WHEN OTHERS THEN RETURN '{"error":"' || REPLACE(SQLERRM,'"','\"') || '"}';
    END get_expenses;

END RR_RM_EXPENSES_PKG;
/

-- Verify all packages compiled without errors
SELECT OBJECT_NAME, STATUS FROM USER_OBJECTS
WHERE  OBJECT_TYPE = 'PACKAGE BODY'
AND    OBJECT_NAME LIKE 'RR_RM%'
ORDER  BY OBJECT_NAME;
