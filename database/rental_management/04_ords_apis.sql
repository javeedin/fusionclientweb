-- ============================================================
-- RENTAL MANAGEMENT MODULE — ORDS REST API HANDLERS
-- Module name: rm  (registered under reerp ORDS schema)
-- Base URL: <apex_base>/ords/bcldifc/reerp/rm/...
--
-- CORRECT ORDS plsql/block CORS pattern (all GET/POST/PUT handlers):
--   OWA_UTIL.MIME_HEADER('application/json', FALSE);  -- set Content-Type, leave headers open
--   HTP.P('Access-Control-Allow-Origin: *');           -- add CORS header
--   OWA_UTIL.HTTP_HEADER_CLOSE;                        -- blank line: end of headers
--   HTP.PRN(NVL(v_result, '...'));                     -- response body
--
-- OPTIONS handlers use same pattern but with no body after HTTP_HEADER_CLOSE.
-- ============================================================

-- Ensure module exists
BEGIN
    ORDS.DEFINE_MODULE(
        p_module_name    => 'rm',
        p_base_path      => 'rm/',
        p_items_per_page => 0,
        p_status         => 'PUBLISHED',
        p_comments       => 'Rental Management REST API'
    );
    COMMIT;
EXCEPTION WHEN OTHERS THEN COMMIT;
END;
/

-- ============================================================
-- Helper: drop template if exists
-- ============================================================
CREATE OR REPLACE PROCEDURE rm_drop_template (p_pattern IN VARCHAR2) AS
BEGIN
    ORDS.DELETE_TEMPLATE(p_module_name => 'rm', p_pattern => p_pattern);
    COMMIT;
EXCEPTION WHEN OTHERS THEN NULL;
END;
/

-- ===========================================================
-- AGREEMENTS  —  POST / GET collection
-- ===========================================================
EXEC rm_drop_template('agreements');
BEGIN
    ORDS.DEFINE_TEMPLATE(p_module_name=>'rm', p_pattern=>'agreements');
    COMMIT;
END;
/

-- POST /rm/agreements — create
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rm', p_pattern => 'agreements',
        p_method         => 'POST', p_source_type => 'plsql/block',
        p_items_per_page => 0,
        p_source => '
DECLARE
    v_body   CLOB := :body_text;
    v_result VARCHAR2(4000);
BEGIN
    RR_RM_AGREEMENTS_PKG.create_agreement(v_body, v_result);
    OWA_UTIL.MIME_HEADER(''application/json'', FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(NVL(v_result, ''{"status":"error","message":"No result returned"}''));
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER(''application/json'', FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(''{"status":"error","message":"'' || REPLACE(SQLERRM,''"'',''\"'') || ''"}'' );
END;
'   );
    COMMIT;
END;
/

-- GET /rm/agreements — search
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name    => 'rm', p_pattern => 'agreements',
        p_method         => 'GET', p_source_type => 'plsql/block',
        p_items_per_page => 0,
        p_source => '
DECLARE
    v_filter CLOB;
    v_result CLOB;
BEGIN
    v_filter := JSON_OBJECT(
        ''status''          VALUE :status,
        ''agreementNumber'' VALUE :agreement_number,
        ''customerId''      VALUE :customer_id,
        ''propertyId''      VALUE :property_id,
        ''dateFrom''        VALUE :date_from,
        ''dateTo''          VALUE :date_to,
        ''limit''           VALUE NVL(:lim, 200),
        ''offset''          VALUE NVL(:off, 0)
        ABSENT ON NULL
    );
    v_result := RR_RM_AGREEMENTS_PKG.search_agreements(v_filter);
    OWA_UTIL.MIME_HEADER(''application/json'', FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(NVL(v_result, ''{"agreements":[]}''));
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER(''application/json'', FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(''{"error":"'' || REPLACE(SQLERRM,''"'',''\"'') || ''"}'' );
END;
'   );
    COMMIT;
END;
/

-- OPTIONS /rm/agreements
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm', p_pattern=>'agreements', p_method=>'OPTIONS',
        p_source_type=>'plsql/block', p_items_per_page=>0,
        p_source=>'BEGIN
    OWA_UTIL.MIME_HEADER(''text/plain'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    HTP.P(''Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS'');
    HTP.P(''Access-Control-Allow-Headers: Content-Type, Accept'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
END;');
    COMMIT;
END;
/

-- ===========================================================
-- AGREEMENT  —  GET / PUT single record
-- ===========================================================
EXEC rm_drop_template('agreements/:id');
BEGIN
    ORDS.DEFINE_TEMPLATE(p_module_name=>'rm', p_pattern=>'agreements/:id');
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm', p_pattern=>'agreements/:id', p_method=>'GET',
        p_source_type=>'plsql/block', p_items_per_page=>0,
        p_source=>'
DECLARE v_result CLOB;
BEGIN
    v_result := RR_RM_AGREEMENTS_PKG.get_agreement(TO_NUMBER(:id));
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(NVL(v_result, ''{"error":"not found"}''));
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(''{"error":"''||REPLACE(SQLERRM,''"'',''\"'')||''"}'' );
END;');
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm', p_pattern=>'agreements/:id', p_method=>'PUT',
        p_source_type=>'plsql/block', p_items_per_page=>0,
        p_source=>'
DECLARE v_body CLOB := :body_text; v_result VARCHAR2(4000);
BEGIN
    v_body := JSON_MERGEPATCH(v_body, JSON_OBJECT(''agreementId'' VALUE TO_NUMBER(:id)));
    RR_RM_AGREEMENTS_PKG.update_agreement(v_body, v_result);
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(NVL(v_result,''{"status":"error"}''));
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(''{"error":"''||REPLACE(SQLERRM,''"'',''\"'')||''"}'' );
END;');
    COMMIT;
END;
/

BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm', p_pattern=>'agreements/:id', p_method=>'OPTIONS',
        p_source_type=>'plsql/block', p_items_per_page=>0,
        p_source=>'BEGIN
    OWA_UTIL.MIME_HEADER(''text/plain'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    HTP.P(''Access-Control-Allow-Methods: GET, PUT, OPTIONS'');
    HTP.P(''Access-Control-Allow-Headers: Content-Type, Accept'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
END;');
    COMMIT;
END;
/

-- ===========================================================
-- ACTIVATE / TERMINATE
-- ===========================================================
EXEC rm_drop_template('agreements/:id/activate');
BEGIN ORDS.DEFINE_TEMPLATE(p_module_name=>'rm',p_pattern=>'agreements/:id/activate'); COMMIT; END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm',p_pattern=>'agreements/:id/activate',p_method=>'POST',
        p_source_type=>'plsql/block',p_items_per_page=>0,
        p_source=>'DECLARE v_result VARCHAR2(400);
BEGIN
    RR_RM_AGREEMENTS_PKG.activate_agreement(TO_NUMBER(:id), v_result);
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(NVL(v_result,''{"status":"error"}''));
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(''{"error":"''||REPLACE(SQLERRM,''"'',''\"'')||''"}'' );
END;');
    COMMIT;
END;
/

EXEC rm_drop_template('agreements/:id/terminate');
BEGIN ORDS.DEFINE_TEMPLATE(p_module_name=>'rm',p_pattern=>'agreements/:id/terminate'); COMMIT; END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm',p_pattern=>'agreements/:id/terminate',p_method=>'POST',
        p_source_type=>'plsql/block',p_items_per_page=>0,
        p_source=>'DECLARE v_body CLOB := :body_text; v_result VARCHAR2(400);
BEGIN
    v_body := JSON_MERGEPATCH(v_body, JSON_OBJECT(''agreementId'' VALUE TO_NUMBER(:id)));
    RR_RM_AGREEMENTS_PKG.terminate_agreement(v_body, v_result);
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(NVL(v_result,''{"status":"error"}''));
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(''{"error":"''||REPLACE(SQLERRM,''"'',''\"'')||''"}'' );
END;');
    COMMIT;
END;
/

-- ===========================================================
-- INSTALLMENTS
-- ===========================================================
EXEC rm_drop_template('agreements/:id/installments');
BEGIN ORDS.DEFINE_TEMPLATE(p_module_name=>'rm',p_pattern=>'agreements/:id/installments'); COMMIT; END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm',p_pattern=>'agreements/:id/installments',p_method=>'GET',
        p_source_type=>'plsql/block',p_items_per_page=>0,
        p_source=>'DECLARE v_result CLOB;
BEGIN
    v_result := RR_RM_INSTALLMENTS_PKG.get_installments(TO_NUMBER(:id));
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(NVL(v_result,''[]''));
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(''{"error":"''||REPLACE(SQLERRM,''"'',''\"'')||''"}'' );
END;');
    COMMIT;
END;
/

EXEC rm_drop_template('installments/:id');
BEGIN ORDS.DEFINE_TEMPLATE(p_module_name=>'rm',p_pattern=>'installments/:id'); COMMIT; END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm',p_pattern=>'installments/:id',p_method=>'PUT',
        p_source_type=>'plsql/block',p_items_per_page=>0,
        p_source=>'DECLARE v_body CLOB := :body_text; v_result VARCHAR2(400);
BEGIN
    v_body := JSON_MERGEPATCH(v_body, JSON_OBJECT(''installmentId'' VALUE TO_NUMBER(:id)));
    RR_RM_INSTALLMENTS_PKG.update_status(v_body, v_result);
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(NVL(v_result,''{"status":"error"}''));
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(''{"error":"''||REPLACE(SQLERRM,''"'',''\"'')||''"}'' );
END;');
    COMMIT;
END;
/

EXEC rm_drop_template('installments/bounce');
BEGIN ORDS.DEFINE_TEMPLATE(p_module_name=>'rm',p_pattern=>'installments/bounce'); COMMIT; END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm',p_pattern=>'installments/bounce',p_method=>'POST',
        p_source_type=>'plsql/block',p_items_per_page=>0,
        p_source=>'DECLARE v_body CLOB := :body_text; v_result VARCHAR2(400);
BEGIN
    RR_RM_INSTALLMENTS_PKG.handle_bounce(v_body, v_result);
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(NVL(v_result,''{"status":"error"}''));
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(''{"error":"''||REPLACE(SQLERRM,''"'',''\"'')||''"}'' );
END;');
    COMMIT;
END;
/

-- ===========================================================
-- MONTHLY SPLITS
-- ===========================================================
EXEC rm_drop_template('agreements/:id/splits');
BEGIN ORDS.DEFINE_TEMPLATE(p_module_name=>'rm',p_pattern=>'agreements/:id/splits'); COMMIT; END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm',p_pattern=>'agreements/:id/splits',p_method=>'GET',
        p_source_type=>'plsql/block',p_items_per_page=>0,
        p_source=>'DECLARE v_result CLOB;
BEGIN
    v_result := RR_RM_SPLITS_PKG.get_splits(TO_NUMBER(:id));
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(NVL(v_result,''[]''));
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(''{"error":"''||REPLACE(SQLERRM,''"'',''\"'')||''"}'' );
END;');
    COMMIT;
END;
/

-- ===========================================================
-- PROPERTIES
-- ===========================================================
EXEC rm_drop_template('properties');
BEGIN ORDS.DEFINE_TEMPLATE(p_module_name=>'rm',p_pattern=>'properties'); COMMIT; END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm',p_pattern=>'properties',p_method=>'POST',
        p_source_type=>'plsql/block',p_items_per_page=>0,
        p_source=>'DECLARE v_body CLOB := :body_text; v_result VARCHAR2(400);
BEGIN
    RR_RM_PROPERTIES_PKG.create_property(v_body, v_result);
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(NVL(v_result,''{"status":"error"}''));
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(''{"error":"''||REPLACE(SQLERRM,''"'',''\"'')||''"}'' );
END;');
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm',p_pattern=>'properties',p_method=>'GET',
        p_source_type=>'plsql/block',p_items_per_page=>0,
        p_source=>'DECLARE v_filter CLOB; v_result CLOB;
BEGIN
    v_filter := JSON_OBJECT(''status'' VALUE :status, ''usageType'' VALUE :usage_type,
                             ''propertyType'' VALUE :property_type, ''search'' VALUE :search ABSENT ON NULL);
    v_result := RR_RM_PROPERTIES_PKG.get_properties(v_filter);
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(NVL(v_result,''{"properties":[]}''));
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(''{"error":"''||REPLACE(SQLERRM,''"'',''\"'')||''"}'' );
END;');
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm',p_pattern=>'properties',p_method=>'OPTIONS',
        p_source_type=>'plsql/block',p_items_per_page=>0,
        p_source=>'BEGIN
    OWA_UTIL.MIME_HEADER(''text/plain'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    HTP.P(''Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS'');
    HTP.P(''Access-Control-Allow-Headers: Content-Type, Accept'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
END;');
    COMMIT;
END;
/

EXEC rm_drop_template('properties/:id');
BEGIN ORDS.DEFINE_TEMPLATE(p_module_name=>'rm',p_pattern=>'properties/:id'); COMMIT; END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm',p_pattern=>'properties/:id',p_method=>'PUT',
        p_source_type=>'plsql/block',p_items_per_page=>0,
        p_source=>'DECLARE v_body CLOB := :body_text; v_result VARCHAR2(400);
BEGIN
    v_body := JSON_MERGEPATCH(v_body, JSON_OBJECT(''propertyId'' VALUE TO_NUMBER(:id)));
    RR_RM_PROPERTIES_PKG.update_property(v_body, v_result);
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(NVL(v_result,''{"status":"error"}''));
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(''{"error":"''||REPLACE(SQLERRM,''"'',''\"'')||''"}'' );
END;');
    COMMIT;
END;
/

-- ===========================================================
-- CUSTOMERS
-- ===========================================================
EXEC rm_drop_template('customers');
BEGIN ORDS.DEFINE_TEMPLATE(p_module_name=>'rm',p_pattern=>'customers'); COMMIT; END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm',p_pattern=>'customers',p_method=>'POST',
        p_source_type=>'plsql/block',p_items_per_page=>0,
        p_source=>'DECLARE v_body CLOB := :body_text; v_result VARCHAR2(400);
BEGIN
    RR_RM_CUSTOMERS_PKG.create_customer(v_body, v_result);
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(NVL(v_result,''{"status":"error"}''));
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(''{"error":"''||REPLACE(SQLERRM,''"'',''\"'')||''"}'' );
END;');
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm',p_pattern=>'customers',p_method=>'GET',
        p_source_type=>'plsql/block',p_items_per_page=>0,
        p_source=>'DECLARE v_filter CLOB; v_result CLOB;
BEGIN
    v_filter := JSON_OBJECT(''status'' VALUE :status, ''search'' VALUE :search ABSENT ON NULL);
    v_result := RR_RM_CUSTOMERS_PKG.get_customers(v_filter);
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(NVL(v_result,''{"customers":[]}''));
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(''{"error":"''||REPLACE(SQLERRM,''"'',''\"'')||''"}'' );
END;');
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm',p_pattern=>'customers',p_method=>'OPTIONS',
        p_source_type=>'plsql/block',p_items_per_page=>0,
        p_source=>'BEGIN
    OWA_UTIL.MIME_HEADER(''text/plain'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    HTP.P(''Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS'');
    HTP.P(''Access-Control-Allow-Headers: Content-Type, Accept'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
END;');
    COMMIT;
END;
/

EXEC rm_drop_template('customers/:id');
BEGIN ORDS.DEFINE_TEMPLATE(p_module_name=>'rm',p_pattern=>'customers/:id'); COMMIT; END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm',p_pattern=>'customers/:id',p_method=>'PUT',
        p_source_type=>'plsql/block',p_items_per_page=>0,
        p_source=>'DECLARE v_body CLOB := :body_text; v_result VARCHAR2(400);
BEGIN
    v_body := JSON_MERGEPATCH(v_body, JSON_OBJECT(''customerId'' VALUE TO_NUMBER(:id)));
    RR_RM_CUSTOMERS_PKG.update_customer(v_body, v_result);
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(NVL(v_result,''{"status":"error"}''));
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(''{"error":"''||REPLACE(SQLERRM,''"'',''\"'')||''"}'' );
END;');
    COMMIT;
END;
/

-- ===========================================================
-- EXPENSES
-- ===========================================================
EXEC rm_drop_template('expenses');
BEGIN ORDS.DEFINE_TEMPLATE(p_module_name=>'rm',p_pattern=>'expenses'); COMMIT; END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm',p_pattern=>'expenses',p_method=>'POST',
        p_source_type=>'plsql/block',p_items_per_page=>0,
        p_source=>'DECLARE v_body CLOB := :body_text; v_result VARCHAR2(400);
BEGIN
    RR_RM_EXPENSES_PKG.create_expense(v_body, v_result);
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(NVL(v_result,''{"status":"error"}''));
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(''{"error":"''||REPLACE(SQLERRM,''"'',''\"'')||''"}'' );
END;');
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm',p_pattern=>'expenses',p_method=>'GET',
        p_source_type=>'plsql/block',p_items_per_page=>0,
        p_source=>'DECLARE v_filter CLOB; v_result CLOB;
BEGIN
    v_filter := JSON_OBJECT(''status'' VALUE :status, ''propertyId'' VALUE :property_id,
                             ''dateFrom'' VALUE :date_from, ''dateTo'' VALUE :date_to ABSENT ON NULL);
    v_result := RR_RM_EXPENSES_PKG.get_expenses(v_filter);
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(NVL(v_result,''{"expenses":[]}''));
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(''{"error":"''||REPLACE(SQLERRM,''"'',''\"'')||''"}'' );
END;');
    COMMIT;
END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm',p_pattern=>'expenses',p_method=>'OPTIONS',
        p_source_type=>'plsql/block',p_items_per_page=>0,
        p_source=>'BEGIN
    OWA_UTIL.MIME_HEADER(''text/plain'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    HTP.P(''Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS'');
    HTP.P(''Access-Control-Allow-Headers: Content-Type, Accept'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
END;');
    COMMIT;
END;
/

EXEC rm_drop_template('expenses/:id');
BEGIN ORDS.DEFINE_TEMPLATE(p_module_name=>'rm',p_pattern=>'expenses/:id'); COMMIT; END;
/
BEGIN
    ORDS.DEFINE_HANDLER(
        p_module_name=>'rm',p_pattern=>'expenses/:id',p_method=>'PUT',
        p_source_type=>'plsql/block',p_items_per_page=>0,
        p_source=>'DECLARE v_body CLOB := :body_text; v_result VARCHAR2(400);
BEGIN
    v_body := JSON_MERGEPATCH(v_body, JSON_OBJECT(''expenseId'' VALUE TO_NUMBER(:id)));
    RR_RM_EXPENSES_PKG.update_expense(v_body, v_result);
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(NVL(v_result,''{"status":"error"}''));
EXCEPTION WHEN OTHERS THEN
    OWA_UTIL.MIME_HEADER(''application/json'',FALSE);
    HTP.P(''Access-Control-Allow-Origin: *'');
    OWA_UTIL.HTTP_HEADER_CLOSE;
    HTP.PRN(''{"error":"''||REPLACE(SQLERRM,''"'',''\"'')||''"}'' );
END;');
    COMMIT;
END;
/

-- Cleanup helper proc
DROP PROCEDURE rm_drop_template;
/

-- Verify all endpoints
SELECT t.uri_template, h.method
FROM   user_ords_handlers  h
JOIN   user_ords_templates t ON h.template_id = t.id
WHERE  t.module_name = 'rm'
ORDER  BY t.uri_template, h.method;
