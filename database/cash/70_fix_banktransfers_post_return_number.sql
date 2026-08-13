-- ============================================================
-- PATCH 70: Fix POST cash/banktransfers — return bankAccountTransferNumber
--
-- Problem:
--   The POST response only returns bankAccountTransferId:
--     {"status":"success","count":1,"bankAccountTransferId":123}
--   bankAccountTransferNumber is not included, so the frontend
--   cannot show the transfer number after creation.
--
-- Fix:
--   After the sync procedure, query BANK_ACCOUNT_TRANSFER_NUMBER
--   from RR_BANK_ACCOUNT_TRANSFERS using the returned ID and include
--   it in the response.
--
-- HOW TO RUN:
--   APEX SQL Workshop → SQL Commands
--   Run the single BEGIN...END; block below.
-- ============================================================

BEGIN
    BEGIN
        ORDS.DELETE_HANDLER(
            p_module_name => 'reerp',
            p_pattern     => 'cash/banktransfers',
            p_method      => 'POST'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'cash/banktransfers',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Sync bank account transfers — returns bankAccountTransferId + bankAccountTransferNumber',
        p_source         => q'[
DECLARE
    l_json         CLOB;
    l_count        NUMBER;
    l_error        VARCHAR2(4000);
    l_last_id      NUMBER;
    l_transfer_num VARCHAR2(100);
BEGIN
    l_json := :body_text;

    RR_SYNC_BANK_ACCOUNT_TRANSFERS(
        p_json    => l_json,
        p_count   => l_count,
        p_error   => l_error,
        p_last_id => l_last_id
    );

    IF l_error IS NOT NULL THEN
        :status_code := 500;
        HTP.P('{"status":"error","message":"' || REPLACE(l_error, '"', '\"') || '"}');
    ELSE
        -- Fetch the transfer number for the newly created/updated record
        BEGIN
            SELECT TO_CHAR(BANK_ACCOUNT_TRANSFER_NUMBER)
            INTO   l_transfer_num
            FROM   RR_BANK_ACCOUNT_TRANSFERS
            WHERE  BANK_ACCOUNT_TRANSFER_ID = l_last_id;
        EXCEPTION WHEN NO_DATA_FOUND THEN
            l_transfer_num := NULL;
        END;

        :status_code := 200;
        HTP.P('{"status":"success","count":'             || l_count                              ||
              ',"bankAccountTransferId":'                || NVL(TO_CHAR(l_last_id), 'null')      ||
              ',"bankAccountTransferNumber":'            || NVL('"' || l_transfer_num || '"', 'null') ||
              '}');
    END IF;
END;
]'
    );
    COMMIT;
END;
/
