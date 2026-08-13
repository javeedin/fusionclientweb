-- ============================================================
-- Petty Cash Module — Next Voucher Number Endpoint
-- File: database/pc/05_pc_voucher_no.sql
-- Run order: 5th (after 04_pc_reerp_wiring.sql)
-- ============================================================
-- Endpoint:
--   GET /pc/registers/:registerId/nextvoucherno
--   Returns the next available voucher number for a register.
--   Format: R{registerId}-{seq:02d}
--   Sequence = MAX(seq extracted from existing REFERENCE_NO) + 1
-- ============================================================

BEGIN
    ORDS.DELETE_HANDLER(
        p_module_name => 'pc',
        p_pattern     => 'registers/:registerId/nextvoucherno',
        p_method      => 'GET'
    );
EXCEPTION
    WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DELETE_TEMPLATE(
        p_module_name => 'pc',
        p_pattern     => 'registers/:registerId/nextvoucherno'
    );
EXCEPTION
    WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'pc',
        p_pattern     => 'registers/:registerId/nextvoucherno'
    );

    ORDS.DEFINE_HANDLER(
        p_module_name => 'pc',
        p_pattern     => 'registers/:registerId/nextvoucherno',
        p_method      => 'GET',
        p_source_type => ORDS.source_type_plsql,
        p_source      => q'[
DECLARE
    l_next_seq NUMBER;
    l_voucher  VARCHAR2(50);
BEGIN
    SELECT NVL(MAX(TO_NUMBER(REGEXP_SUBSTR(REFERENCE_NO, '[0-9]+$'))), 0) + 1
    INTO   l_next_seq
    FROM   RR_PC_TRANSACTIONS
    WHERE  REGISTER_ID = :registerId
    AND    REGEXP_LIKE(REFERENCE_NO, '^R[0-9]+-[0-9]+$');

    l_voucher := 'R' || TO_CHAR(:registerId) || '-' || LPAD(TO_CHAR(l_next_seq), 2, '0');

    :status_code := 200;
    HTP.PRN('{"voucherNo":' || APEX_JSON.STRINGIFY(l_voucher) ||
            ',"nextSeq":'   || TO_CHAR(l_next_seq)           || '}');
END;
]'
    );

    COMMIT;
END;
/
