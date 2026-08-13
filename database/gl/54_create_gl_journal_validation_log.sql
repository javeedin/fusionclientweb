-- ============================================================
-- Create sequence for RR_GL_VALIDATION_LOG.LOG_ID
-- (Table already exists — just need the sequence for LOG_ID)
-- ============================================================
DECLARE
    l_count NUMBER;
BEGIN
    SELECT COUNT(*) INTO l_count FROM user_sequences
    WHERE sequence_name = 'RR_GL_VAL_LOG_SEQ';
    IF l_count = 0 THEN
        EXECUTE IMMEDIATE 'CREATE SEQUENCE RR_GL_VAL_LOG_SEQ START WITH 1 INCREMENT BY 1 NOCACHE NOCYCLE';
        DBMS_OUTPUT.PUT_LINE('Created RR_GL_VAL_LOG_SEQ');
    ELSE
        DBMS_OUTPUT.PUT_LINE('RR_GL_VAL_LOG_SEQ already exists');
    END IF;
END;
/

DBMS_OUTPUT.PUT_LINE('RR_GL_VALIDATION_LOG sequence setup complete');
