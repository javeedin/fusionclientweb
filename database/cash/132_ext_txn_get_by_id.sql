-- ============================================================
-- PATCH 132: GET a single external cash transaction by id
--
--   GET  cash/externaltransactions/:externalTransactionId
--
-- Why:
--   The single-segment path cash/externaltransactions/:id had only
--   PUT (reconcile) and DELETE handlers — there was NO GET, so the
--   Petty Cash "Bank Txn ID" drill (which only has the id) could not
--   fetch the row and showed "Bank transaction not found".
--
--   Note: the URL is cash/externaltransactions/<id> (e.g.
--   .../cash/externaltransactions/1000000395). The template variable
--   is :externalTransactionId — the same single-segment template that
--   already carries PUT/DELETE — so this only ADDS the GET method and
--   does not create a conflicting second template.
--
-- Returns ORDS json/collection shape: {"items":[ { ...one row... } ]}
-- with camelCase keys matching the search handler, so the app's
-- existing mapping works unchanged. :externalTransactionId filters on
-- EXTERNAL_TRANSACTION_ID (what the app stores as Bank Txn ID).
--
-- HOW TO RUN: APEX SQL Workshop → SQL Commands — run this block.
-- ============================================================

BEGIN
  -- make sure the single-segment template exists (created by patch 74)
  BEGIN
    ORDS.DEFINE_TEMPLATE(
      p_module_name => 'reerp',
      p_pattern     => 'cash/externaltransactions/:externalTransactionId'
    );
  EXCEPTION WHEN OTHERS THEN NULL; -- already exists
  END;

  BEGIN
    ORDS.DELETE_HANDLER(
      p_module_name => 'reerp',
      p_pattern     => 'cash/externaltransactions/:externalTransactionId',
      p_method      => 'GET'
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'cash/externaltransactions/:externalTransactionId',
    p_method         => 'GET',
    p_source_type    => 'json/collection',
    p_items_per_page => 1,
    p_mimes_allowed  => '',
    p_comments       => 'Get one external cash transaction by EXTERNAL_TRANSACTION_ID',
    p_source         => q'[
SELECT
    EXTERNAL_TRANSACTION_ID                              AS "externalTransactionId",
    TRANSACTION_ID                                      AS "transactionId",
    TO_CHAR(TRANSACTION_DATE, 'YYYY-MM-DD')             AS "transactionDate",
    TO_CHAR(VALUE_DATE,       'YYYY-MM-DD')             AS "valueDate",
    TO_CHAR(CLEARED_DATE,     'YYYY-MM-DD')             AS "clearedDate",
    AMOUNT                                              AS "amount",
    CURRENCY_CODE                                       AS "currencyCode",
    DESCRIPTION                                         AS "description",
    REFERENCE_TEXT                                      AS "referenceText",
    SOURCE                                              AS "source",
    CASE WHEN NVL(RECONCILED_FLAG, 'N') = 'Y' THEN 'REC'
         ELSE NVL(STATUS, 'UNR') END                    AS "status",
    TRANSACTION_TYPE                                    AS "transactionType",
    NVL(ACCOUNTING_FLAG, 'N')                           AS "accountingFlag",
    NVL(RECONCILED_FLAG, 'N')                           AS "reconciledFlag",
    BANK_ACCOUNT_NAME                                   AS "bankAccountName",
    BUSINESS_UNIT_NAME                                  AS "businessUnitName",
    LEGAL_ENTITY_NAME                                   AS "legalEntityName",
    ASSET_ACCOUNT_COMBINATION                           AS "assetAccountCombination",
    OFFSET_ACCOUNT_COMBINATION                          AS "offsetAccountCombination",
    BANK_CONVERSION_RATE                                AS "bankConversionRate",
    BANK_CONVERSION_RATE_TYPE                           AS "bankConversionRateType",
    TRANSFER_ID                                         AS "transferId",
    CHECK_NUMBER                                        AS "checkNumber",
    RECON_REFERENCE                                     AS "reconReference",
    CREATED_BY                                          AS "createdBy",
    TO_CHAR(CREATION_DATE,    'YYYY-MM-DD"T"HH24:MI:SS') AS "creationDate",
    LAST_UPDATED_BY                                     AS "lastUpdatedBy",
    TO_CHAR(LAST_UPDATE_DATE, 'YYYY-MM-DD"T"HH24:MI:SS') AS "lastUpdateDate",
    TRANSACTION_DIRECTION                               AS "transactionDirection",
    PAYMENT_METHOD                                      AS "paymentMethod",
    PAYMENT_DOCUMENT                                    AS "paymentDocument",
    PAPER_DOCUMENT_NUMBER                               AS "paperDocumentNumber",
    PAYEE_NAME                                          AS "payeeName",
    PAYEE_ID                                            AS "payeeId",
    TO_CHAR(SYNC_DATE,        'YYYY-MM-DD"T"HH24:MI:SS') AS "syncDate"
FROM RR_EXTERNAL_CASH_TRANSACTIONS
WHERE EXTERNAL_TRANSACTION_ID = TO_NUMBER(:externalTransactionId)
]'
  );

  COMMIT;
END;
/

-- VERIFY:
--   GET {base}/cash/externaltransactions/1000000395
--   → {"items":[ { "externalTransactionId":1000000395, "amount":-15000, ... } ]}
--   The Petty Cash Bank Txn ID drill then opens the transaction.
