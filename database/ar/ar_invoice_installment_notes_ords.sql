-- =====================================================
-- AR Invoice Installment Notes
-- Table  : RR_AR_INVOICE_INSTALLMENT_NOTES
-- Module : ar
-- Base   : /ar/invoices/installments/notes
-- =====================================================

-- =====================================================
-- 1. Table
-- =====================================================
CREATE TABLE RR_AR_INVOICE_INSTALLMENT_NOTES (
    NOTE_ID                 NUMBER PRIMARY KEY,
    CUSTOMER_TRX_ID         NUMBER NOT NULL,
    INSTALLMENT_ID          NUMBER NOT NULL,
    SOURCE_OBJECT_CODE      VARCHAR2(100),
    SOURCE_OBJECT_ID        VARCHAR2(100),
    PARTY_NAME              VARCHAR2(360),
    NOTE_TYPE_CODE          VARCHAR2(100),
    VISIBILITY_CODE         VARCHAR2(100),
    CREATOR_PARTY_ID        NUMBER,
    CREATED_BY              VARCHAR2(240),
    CREATION_DATE           TIMESTAMP,
    LAST_UPDATE_DATE        TIMESTAMP,
    PARTY_ID                NUMBER,
    CORP_CURRENCY_CODE      VARCHAR2(30),
    CURRENCY_CODE           VARCHAR2(30),
    CONTACT_RELATIONSHIP_ID NUMBER,
    PARENT_NOTE_ID          NUMBER,
    LAST_UPDATED_BY         VARCHAR2(240),
    EMAIL_ADDRESS           VARCHAR2(240),
    FORMATTED_ADDRESS       VARCHAR2(2000),
    FORMATTED_PHONE_NUMBER  VARCHAR2(100),
    UPDATE_FLAG             VARCHAR2(10),
    DELETE_FLAG             VARCHAR2(10),
    NOTE_NUMBER             VARCHAR2(100),
    NOTE_TITLE              VARCHAR2(500),
    SOURCE_SYSTEM           VARCHAR2(100),
    NOTE_TEXT               CLOB,
    SYNC_DATE               TIMESTAMP DEFAULT SYSTIMESTAMP,

CREATE INDEX IDX_AR_INST_NOTES_TRX  ON RR_AR_INVOICE_INSTALLMENT_NOTES (CUSTOMER_TRX_ID);
CREATE INDEX IDX_AR_INST_NOTES_INST ON RR_AR_INVOICE_INSTALLMENT_NOTES (INSTALLMENT_ID);

COMMENT ON TABLE RR_AR_INVOICE_INSTALLMENT_NOTES IS 'AR Invoice Installment Notes synced from Fusion receivablesInvoiceInstallmentNotes';

-- =====================================================
-- 2. Template: ar/invoices/installments/notes/bulk
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'invoices/installments/notes/bulk');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'invoices/installments/notes/bulk',
        p_comments    => 'Bulk upsert AR Invoice Installment Notes'
    );
    COMMIT;
END;
/

-- =====================================================
-- 3. POST /ar/invoices/installments/notes/bulk
--    Body: { "items": [ { "NoteId": N, "CustomerTrxId": N, "InstallmentId": N, ... } ] }
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/installments/notes/bulk',
        p_method         => 'POST',
        p_source_type    => 'plsql/block',
        p_mimes_allowed  => 'application/json',
        p_comments       => 'Bulk upsert AR Invoice Installment Notes from Fusion',
        p_source         => q'[
DECLARE
    l_body       CLOB;
    l_items      JSON_ARRAY_T;
    l_item       JSON_OBJECT_T;
    l_inserted   NUMBER := 0;
    l_updated    NUMBER := 0;
    l_errors     NUMBER := 0;
    l_error_msgs VARCHAR2(4000) := '';
    v_dest_off   INTEGER := 1;
    v_src_off    INTEGER := 1;
    v_lang_ctx   INTEGER := DBMS_LOB.DEFAULT_LANG_CTX;
    v_warning    INTEGER;
    v_exists     NUMBER;

    v_note_id                NUMBER;
    v_customer_trx_id        NUMBER;
    v_installment_id         NUMBER;
    v_source_object_code     VARCHAR2(100);
    v_source_object_id       VARCHAR2(100);
    v_party_name             VARCHAR2(360);
    v_note_type_code         VARCHAR2(100);
    v_visibility_code        VARCHAR2(100);
    v_creator_party_id       NUMBER;
    v_created_by             VARCHAR2(240);
    v_creation_date          TIMESTAMP;
    v_last_update_date       TIMESTAMP;
    v_party_id               NUMBER;
    v_corp_currency_code     VARCHAR2(30);
    v_currency_code          VARCHAR2(30);
    v_contact_relationship_id NUMBER;
    v_parent_note_id         NUMBER;
    v_last_updated_by        VARCHAR2(240);
    v_email_address          VARCHAR2(240);
    v_formatted_address      VARCHAR2(2000);
    v_formatted_phone_number VARCHAR2(100);
    v_update_flag            VARCHAR2(10);
    v_delete_flag            VARCHAR2(10);
    v_note_number            VARCHAR2(100);
    v_note_title             VARCHAR2(500);
    v_source_system          VARCHAR2(100);
    v_note_text              CLOB;

    FUNCTION safe_str(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN VARCHAR2 IS
    BEGIN
        IF p_obj.has(p_key) AND NOT p_obj.get(p_key).is_null THEN
            RETURN p_obj.get_string(p_key);
        END IF;
        RETURN NULL;
    END;

    FUNCTION safe_num(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN NUMBER IS
    BEGIN
        IF p_obj.has(p_key) AND NOT p_obj.get(p_key).is_null THEN
            RETURN p_obj.get_number(p_key);
        END IF;
        RETURN NULL;
    END;

    FUNCTION safe_ts(p_obj JSON_OBJECT_T, p_key VARCHAR2) RETURN TIMESTAMP IS
        v_str VARCHAR2(50);
    BEGIN
        IF p_obj.has(p_key) AND NOT p_obj.get(p_key).is_null THEN
            v_str := p_obj.get_string(p_key);
            IF v_str IS NOT NULL THEN
                RETURN TO_TIMESTAMP(SUBSTR(v_str, 1, 19), 'YYYY-MM-DD"T"HH24:MI:SS');
            END IF;
        END IF;
        RETURN NULL;
    END;

BEGIN
    DBMS_LOB.CREATETEMPORARY(l_body, TRUE);
    DBMS_LOB.CONVERTTOCLOB(
        l_body, :body, DBMS_LOB.LOBMAXSIZE,
        v_dest_off, v_src_off,
        NLS_CHARSET_ID('AL32UTF8'), v_lang_ctx, v_warning
    );

    l_items := JSON_ARRAY_T(JSON_OBJECT_T.PARSE(l_body).get_array('items'));

    FOR i IN 0 .. l_items.get_size() - 1 LOOP
        BEGIN
            l_item := JSON_OBJECT_T(l_items.get(i));

            v_note_id                := safe_num(l_item, 'NoteId');
            v_customer_trx_id        := safe_num(l_item, 'CustomerTrxId');
            v_installment_id         := safe_num(l_item, 'InstallmentId');
            v_source_object_code     := safe_str(l_item, 'SourceObjectCode');
            v_source_object_id       := safe_str(l_item, 'SourceObjectId');
            v_party_name             := safe_str(l_item, 'PartyName');
            v_note_type_code         := safe_str(l_item, 'NoteTypeCode');
            v_visibility_code        := safe_str(l_item, 'VisibilityCode');
            v_creator_party_id       := safe_num(l_item, 'CreatorPartyId');
            v_created_by             := safe_str(l_item, 'CreatedBy');
            v_creation_date          := safe_ts (l_item, 'CreationDate');
            v_last_update_date       := safe_ts (l_item, 'LastUpdateDate');
            v_party_id               := safe_num(l_item, 'PartyId');
            v_corp_currency_code     := safe_str(l_item, 'CorpCurrencyCode');
            v_currency_code          := safe_str(l_item, 'CurrencyCode');
            v_contact_relationship_id:= safe_num(l_item, 'ContactRelationshipId');
            v_parent_note_id         := safe_num(l_item, 'ParentNoteId');
            v_last_updated_by        := safe_str(l_item, 'LastUpdatedBy');
            v_email_address          := safe_str(l_item, 'EmailAddress');
            v_formatted_address      := safe_str(l_item, 'FormattedAddress');
            v_formatted_phone_number := safe_str(l_item, 'FormattedPhoneNumber');
            v_update_flag            := safe_str(l_item, 'UpdateFlag');
            v_delete_flag            := safe_str(l_item, 'DeleteFlag');
            v_note_number            := safe_str(l_item, 'NoteNumber');
            v_note_title             := safe_str(l_item, 'NoteTitle');
            v_source_system          := safe_str(l_item, 'SourceSystem');
            v_note_text              := safe_str(l_item, 'Notes');

            SELECT COUNT(*) INTO v_exists
            FROM RR_AR_INVOICE_INSTALLMENT_NOTES
            WHERE NOTE_ID = v_note_id;

            MERGE INTO RR_AR_INVOICE_INSTALLMENT_NOTES d
            USING (SELECT v_note_id AS nid FROM DUAL) s
            ON (d.NOTE_ID = s.nid)
            WHEN MATCHED THEN UPDATE SET
                CUSTOMER_TRX_ID         = v_customer_trx_id,
                INSTALLMENT_ID          = v_installment_id,
                SOURCE_OBJECT_CODE      = v_source_object_code,
                SOURCE_OBJECT_ID        = v_source_object_id,
                PARTY_NAME              = v_party_name,
                NOTE_TYPE_CODE          = v_note_type_code,
                VISIBILITY_CODE         = v_visibility_code,
                CREATOR_PARTY_ID        = v_creator_party_id,
                CREATED_BY              = v_created_by,
                CREATION_DATE           = v_creation_date,
                LAST_UPDATE_DATE        = v_last_update_date,
                PARTY_ID                = v_party_id,
                CORP_CURRENCY_CODE      = v_corp_currency_code,
                CURRENCY_CODE           = v_currency_code,
                CONTACT_RELATIONSHIP_ID = v_contact_relationship_id,
                PARENT_NOTE_ID          = v_parent_note_id,
                LAST_UPDATED_BY         = v_last_updated_by,
                EMAIL_ADDRESS           = v_email_address,
                FORMATTED_ADDRESS       = v_formatted_address,
                FORMATTED_PHONE_NUMBER  = v_formatted_phone_number,
                UPDATE_FLAG             = v_update_flag,
                DELETE_FLAG             = v_delete_flag,
                NOTE_NUMBER             = v_note_number,
                NOTE_TITLE              = v_note_title,
                SOURCE_SYSTEM           = v_source_system,
                NOTE_TEXT               = v_note_text,
                SYNC_DATE               = SYSTIMESTAMP
            WHEN NOT MATCHED THEN INSERT (
                NOTE_ID, CUSTOMER_TRX_ID, INSTALLMENT_ID,
                SOURCE_OBJECT_CODE, SOURCE_OBJECT_ID,
                PARTY_NAME, NOTE_TYPE_CODE, VISIBILITY_CODE,
                CREATOR_PARTY_ID, CREATED_BY, CREATION_DATE, LAST_UPDATE_DATE,
                PARTY_ID, CORP_CURRENCY_CODE, CURRENCY_CODE,
                CONTACT_RELATIONSHIP_ID, PARENT_NOTE_ID,
                LAST_UPDATED_BY, EMAIL_ADDRESS,
                FORMATTED_ADDRESS, FORMATTED_PHONE_NUMBER,
                UPDATE_FLAG, DELETE_FLAG,
                NOTE_NUMBER, NOTE_TITLE, SOURCE_SYSTEM, NOTE_TEXT,
                SYNC_DATE
            ) VALUES (
                v_note_id, v_customer_trx_id, v_installment_id,
                v_source_object_code, v_source_object_id,
                v_party_name, v_note_type_code, v_visibility_code,
                v_creator_party_id, v_created_by, v_creation_date, v_last_update_date,
                v_party_id, v_corp_currency_code, v_currency_code,
                v_contact_relationship_id, v_parent_note_id,
                v_last_updated_by, v_email_address,
                v_formatted_address, v_formatted_phone_number,
                v_update_flag, v_delete_flag,
                v_note_number, v_note_title, v_source_system, v_note_text,
                SYSTIMESTAMP
            );

            IF v_exists > 0 THEN
                l_updated  := l_updated  + 1;
            ELSE
                l_inserted := l_inserted + 1;
            END IF;

        EXCEPTION WHEN OTHERS THEN
            l_errors := l_errors + 1;
            IF LENGTH(l_error_msgs) < 3500 THEN
                l_error_msgs := l_error_msgs || 'Row ' || i || ': ' || SUBSTR(SQLERRM,1,200) || '; ';
            END IF;
        END;
    END LOOP;

    COMMIT;
    :status_code := CASE WHEN l_errors = 0 THEN 201 ELSE 207 END;
    HTP.P('{"status":"' || CASE WHEN l_errors = 0 THEN 'SUCCESS' ELSE 'PARTIAL' END || '"' ||
          ',"inserted":' || l_inserted ||
          ',"updated":'  || l_updated  ||
          ',"errors":'   || l_errors   ||
          CASE WHEN l_error_msgs IS NOT NULL
               THEN ',"errorDetail":"' || REPLACE(l_error_msgs, '"', '\"') || '"'
               ELSE '' END || '}');
EXCEPTION WHEN OTHERS THEN
    ROLLBACK;
    :status_code := 500;
    HTP.P('{"status":"ERROR","message":"' || REPLACE(SQLERRM, '"', '\"') || '"}');
END;]'
    );
    COMMIT;
END;
/

-- =====================================================
-- 4. Template: ar/invoices/:customerTrxId/installments/notes
-- =====================================================
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'ar', p_pattern => 'invoices/:customerTrxId/installments/notes');
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

BEGIN
    ORDS.DEFINE_TEMPLATE(
        p_module_name => 'ar',
        p_pattern     => 'invoices/:customerTrxId/installments/notes',
        p_comments    => 'List all notes for all installments of an AR invoice'
    );
    COMMIT;
END;
/

-- =====================================================
-- 5. GET /ar/invoices/:customerTrxId/installments/notes
-- =====================================================
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'ar',
        p_pattern        => 'invoices/:customerTrxId/installments/notes',
        p_method         => 'GET',
        p_source_type    => 'json/collection',
        p_items_per_page => 200,
        p_comments       => 'Fetch all installment notes for an AR invoice',
        p_source         => '
SELECT
    n.NOTE_ID,
    n.CUSTOMER_TRX_ID,
    n.INSTALLMENT_ID,
    n.SOURCE_OBJECT_CODE,
    n.SOURCE_OBJECT_ID,
    n.PARTY_NAME,
    n.NOTE_TYPE_CODE,
    n.VISIBILITY_CODE,
    n.CREATED_BY,
    n.CREATION_DATE,
    n.LAST_UPDATE_DATE,
    n.LAST_UPDATED_BY,
    n.EMAIL_ADDRESS,
    n.NOTE_NUMBER,
    n.NOTE_TITLE,
    n.NOTE_TEXT,
    n.CURRENCY_CODE,
    n.FORMATTED_ADDRESS,
    n.FORMATTED_PHONE_NUMBER,
    n.SYNC_DATE
FROM RR_AR_INVOICE_INSTALLMENT_NOTES n
WHERE n.CUSTOMER_TRX_ID = :customerTrxId
ORDER BY n.CREATION_DATE DESC'
    );
    COMMIT;
END;
/

-- =====================================================
-- ENDPOINTS SUMMARY
-- =====================================================
-- GET  {base}/ar/invoices/:customerTrxId/installments/notes   All notes for an invoice
-- POST {base}/ar/invoices/installments/notes/bulk             Bulk upsert notes
-- =====================================================
