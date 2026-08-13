-- =============================================
-- RR_ROLES Table and Sync Procedure
-- For syncing Roles from Oracle HCM
-- =============================================

-- Drop existing objects (optional, for clean setup)
-- DROP TABLE RR_ROLES;
-- DROP PROCEDURE RR_SYNC_ROLES;

-- =============================================
-- 1. Create the RR_ROLES table
-- =============================================
CREATE TABLE RR_ROLES (
    ROLE_ID                NUMBER PRIMARY KEY,
    ROLE_NAME              VARCHAR2(240),
    ROLE_CODE              VARCHAR2(240),
    DESCRIPTION            VARCHAR2(4000),
    ACTIVE_FLAG            VARCHAR2(5),
    ABSTRACT_ROLE          VARCHAR2(1),
    DATA_ROLE              VARCHAR2(1),
    JOB_ROLE               VARCHAR2(1),
    DUTY_ROLE              VARCHAR2(1),
    DELEGATION_ALLOWED     VARCHAR2(1),
    EXTERNAL_ROLE          VARCHAR2(1),
    OBJECT_VERSION_NUMBER  NUMBER,
    -- Audit columns
    SYNC_DATE              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    SYNC_SOURCE            VARCHAR2(50) DEFAULT 'ORACLE_HCM'
);

-- Create indexes for performance
CREATE INDEX IDX_ROLES_CODE ON RR_ROLES(ROLE_CODE);
CREATE INDEX IDX_ROLES_NAME ON RR_ROLES(ROLE_NAME);
CREATE INDEX IDX_ROLES_ACTIVE ON RR_ROLES(ACTIVE_FLAG);

-- =============================================
-- 2. Create the sync procedure (MERGE/Upsert)
-- =============================================
CREATE OR REPLACE PROCEDURE RR_SYNC_ROLES (
    p_json_data IN CLOB,
    p_result    OUT VARCHAR2
) AS
    v_count NUMBER := 0;
BEGIN
    -- MERGE (upsert) roles from JSON
    MERGE INTO RR_ROLES target
    USING (
        SELECT
            jt.ROLE_ID,
            jt.ROLE_NAME,
            jt.ROLE_CODE,
            jt.DESCRIPTION,
            CASE WHEN jt.ACTIVE_FLAG = 'true' THEN 'Y' ELSE 'N' END AS ACTIVE_FLAG,
            jt.ABSTRACT_ROLE,
            jt.DATA_ROLE,
            jt.JOB_ROLE,
            jt.DUTY_ROLE,
            jt.DELEGATION_ALLOWED,
            jt.EXTERNAL_ROLE,
            jt.OBJECT_VERSION_NUMBER
        FROM JSON_TABLE(
            p_json_data,
            '$.items[*]'
            COLUMNS (
                ROLE_ID                NUMBER        PATH '$.RoleId',
                ROLE_NAME              VARCHAR2(240) PATH '$.RoleName',
                ROLE_CODE              VARCHAR2(240) PATH '$.RoleCode',
                DESCRIPTION            VARCHAR2(4000) PATH '$.Description',
                ACTIVE_FLAG            VARCHAR2(10)  PATH '$.ActiveFlag',
                ABSTRACT_ROLE          VARCHAR2(1)   PATH '$.AbstractRole',
                DATA_ROLE              VARCHAR2(1)   PATH '$.DataRole',
                JOB_ROLE               VARCHAR2(1)   PATH '$.JobRole',
                DUTY_ROLE              VARCHAR2(1)   PATH '$.DutyRole',
                DELEGATION_ALLOWED     VARCHAR2(1)   PATH '$.DelegationAllowed',
                EXTERNAL_ROLE          VARCHAR2(1)   PATH '$.ExternalRole',
                OBJECT_VERSION_NUMBER  NUMBER        PATH '$.ObjectVersionNumber'
            )
        ) jt
        WHERE jt.ROLE_ID IS NOT NULL
    ) source
    ON (target.ROLE_ID = source.ROLE_ID)
    WHEN MATCHED THEN
        UPDATE SET
            target.ROLE_NAME = source.ROLE_NAME,
            target.ROLE_CODE = source.ROLE_CODE,
            target.DESCRIPTION = source.DESCRIPTION,
            target.ACTIVE_FLAG = source.ACTIVE_FLAG,
            target.ABSTRACT_ROLE = source.ABSTRACT_ROLE,
            target.DATA_ROLE = source.DATA_ROLE,
            target.JOB_ROLE = source.JOB_ROLE,
            target.DUTY_ROLE = source.DUTY_ROLE,
            target.DELEGATION_ALLOWED = source.DELEGATION_ALLOWED,
            target.EXTERNAL_ROLE = source.EXTERNAL_ROLE,
            target.OBJECT_VERSION_NUMBER = source.OBJECT_VERSION_NUMBER,
            target.SYNC_DATE = CURRENT_TIMESTAMP
    WHEN NOT MATCHED THEN
        INSERT (
            ROLE_ID, ROLE_NAME, ROLE_CODE, DESCRIPTION,
            ACTIVE_FLAG, ABSTRACT_ROLE, DATA_ROLE, JOB_ROLE,
            DUTY_ROLE, DELEGATION_ALLOWED, EXTERNAL_ROLE, OBJECT_VERSION_NUMBER,
            SYNC_DATE, SYNC_SOURCE
        )
        VALUES (
            source.ROLE_ID, source.ROLE_NAME, source.ROLE_CODE, source.DESCRIPTION,
            source.ACTIVE_FLAG, source.ABSTRACT_ROLE, source.DATA_ROLE, source.JOB_ROLE,
            source.DUTY_ROLE, source.DELEGATION_ALLOWED, source.EXTERNAL_ROLE, source.OBJECT_VERSION_NUMBER,
            CURRENT_TIMESTAMP, 'ORACLE_HCM'
        );

    v_count := SQL%ROWCOUNT;
    COMMIT;

    p_result := '{"success": true, "message": "Synced ' || v_count || ' roles", "count": ' || v_count || '}';

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        p_result := '{"success": false, "error": "' || REPLACE(SQLERRM, '"', '\"') || '"}';
END RR_SYNC_ROLES;
/

-- =============================================
-- 3. Create APEX REST Handler
-- =============================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'reerp',
        p_pattern        => 'roles',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_items_per_page => 0,
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Sync Roles from Oracle HCM',
        p_source         => q'[
DECLARE
    l_json_clob CLOB;
    l_result    VARCHAR2(4000);
BEGIN
    l_json_clob := :body_text;

    RR_SYNC_ROLES(
        p_json_data => l_json_clob,
        p_result    => l_result
    );

    :status_code := 200;
    HTP.P(l_result);
EXCEPTION
    WHEN OTHERS THEN
        :status_code := 500;
        HTP.P('{"success": false, "error": "' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;
]'
    );
    COMMIT;
END;
/

-- =============================================
-- Verification Queries
-- =============================================
-- SELECT COUNT(*) FROM RR_ROLES;
-- SELECT * FROM RR_ROLES WHERE ROWNUM <= 10;
-- SELECT ROLE_CODE, ROLE_NAME, ACTIVE_FLAG FROM RR_ROLES WHERE JOB_ROLE = 'Y';
