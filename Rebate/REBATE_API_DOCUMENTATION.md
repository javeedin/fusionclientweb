# Rebate Management API Documentation

## Overview
The Rebate Management system provides a comprehensive PL/SQL package (`FC_REBATE_PKG`) and APEX REST handlers for managing rebate headers and detail records.

---

## Database Tables

### OT_PM_REBATE_HEAD_MIT (Header Table)
Main rebate record containing:
- `PRHM_SYS_ID` - Primary Key (System generated)
- `PRHM_COMP_CODE` - Company Code
- `PRHM_VENDOR` - Vendor Code
- `PRHM_GROUP` - Rebate Group
- `PRHM_PERIOD` - Period (YYYY-MM format)
- `PRHM_CURRENCY` - Currency Code
- `PRHM_APPR_STATUS` - Approval Status (0/1)
- `PRHM_SUBMIT_STATUS` - Submit Status (0/1)
- Accounting Codes (DR/CR Main & Sub)
- Audit Fields (CR_UID, CR_DT, UPD_UID, UPD_DT)

### OT_PM_REBATE_DETAIL_MIT (Detail Table)
Line-level rebate records linked to header via `PRDM_PRHM_SYS_ID`
- `PRDM_SYS_ID` - Primary Key
- `PRDM_PRHM_SYS_ID` - Foreign Key to Header
- `PRDM_DT` - Transaction Date
- `PRDM_REBT_TYPE` - Rebate Type
- `PRDM_PM_AMT` - PM Amount
- `PRDM_BA_AMT` - BA Amount
- `PRDM_TOTAL_AMT` - Total Amount
- `PRDM_CUSTOMER` - Customer Code
- `PRDM_BSNS_TYPE` - Business Type
- Confirmation fields (CONF_YN, RCVD_YN, etc.)
- Audit Fields

---

## PL/SQL Package: FC_REBATE_PKG

### Package Procedures

#### 1. **get_rebate_json**
Fetches a single rebate with all associated lines as JSON.

```sql
FC_REBATE_PKG.get_rebate_json(
  p_prhm_sys_id IN NUMBER,
  p_json_response OUT CLOB
);
```

**Parameters:**
- `p_prhm_sys_id` - Rebate header system ID
- `p_json_response` - Output JSON containing header and lines array

**Returns JSON Structure:**
```json
{
  "prhm_sys_id": 1,
  "prhm_comp_code": "COMP001",
  "prhm_vendor": "VENDOR001",
  "prhm_group": "GROUP001",
  "prhm_period": "2026-08",
  "prhm_currency": "USD",
  "prhm_appr_status": 0,
  "prhm_submit_status": 0,
  "lines": [
    {
      "prdm_sys_id": 1,
      "prdm_prhm_sys_id": 1,
      "prdm_sm_code": "SM001",
      "prdm_dt": "2026-08-08",
      "prdm_rebt_type": "CASH",
      "prdm_pm_amt": 1000,
      "prdm_ba_amt": 500,
      "prdm_total_amt": 1500,
      "prdm_customer": "CUST001"
    }
  ]
}
```

**Example:**
```sql
DECLARE
  v_json CLOB;
BEGIN
  FC_REBATE_PKG.get_rebate_json(p_prhm_sys_id => 1, p_json_response => v_json);
  DBMS_OUTPUT.PUT_LINE(v_json);
END;
```

---

#### 2. **get_all_rebates_json**
Fetches all rebates with optional filtering.

```sql
FC_REBATE_PKG.get_all_rebates_json(
  p_comp_code IN VARCHAR2 DEFAULT NULL,
  p_vendor IN VARCHAR2 DEFAULT NULL,
  p_period IN VARCHAR2 DEFAULT NULL,
  p_json_response OUT CLOB
);
```

**Parameters:**
- `p_comp_code` - Filter by company code (optional)
- `p_vendor` - Filter by vendor (optional)
- `p_period` - Filter by period (optional)
- `p_json_response` - Output JSON array of rebates

**Returns:** JSON array of rebate headers

**Example:**
```sql
DECLARE
  v_json CLOB;
BEGIN
  FC_REBATE_PKG.get_all_rebates_json(
    p_comp_code => 'COMP001',
    p_period => '2026-08',
    p_json_response => v_json
  );
  DBMS_OUTPUT.PUT_LINE(v_json);
END;
```

---

#### 3. **create_rebate_header**
Creates a new rebate header record.

```sql
FC_REBATE_PKG.create_rebate_header(
  p_comp_code IN VARCHAR2,
  p_vendor IN VARCHAR2,
  p_group IN VARCHAR2,
  p_sm_code IN VARCHAR2 DEFAULT NULL,
  p_period IN VARCHAR2,
  p_dr_main_acnt_code IN VARCHAR2,
  p_dr_sub_acnt_code IN VARCHAR2,
  p_cr_main_acnt_code IN VARCHAR2,
  p_cr_sub_acnt_code IN VARCHAR2,
  p_currency IN VARCHAR2,
  p_annotation IN VARCHAR2 DEFAULT NULL,
  p_cr_uid IN VARCHAR2,
  p_prhm_sys_id OUT NUMBER
);
```

**Example:**
```sql
DECLARE
  v_header_id NUMBER;
BEGIN
  FC_REBATE_PKG.create_rebate_header(
    p_comp_code => 'COMP001',
    p_vendor => 'VENDOR001',
    p_group => 'GROUP001',
    p_period => '2026-08',
    p_dr_main_acnt_code => '1000',
    p_dr_sub_acnt_code => '1001',
    p_cr_main_acnt_code => '2000',
    p_cr_sub_acnt_code => '2001',
    p_currency => 'USD',
    p_cr_uid => 'USER001',
    p_prhm_sys_id => v_header_id
  );
  DBMS_OUTPUT.PUT_LINE('Created Header ID: ' || v_header_id);
END;
```

---

#### 4. **add_rebate_line**
Adds a new line to an existing rebate.

```sql
FC_REBATE_PKG.add_rebate_line(
  p_prhm_sys_id IN NUMBER,
  p_sm_code IN VARCHAR2,
  p_dt IN DATE,
  p_rebt_type IN VARCHAR2,
  p_choice_list IN VARCHAR2 DEFAULT NULL,
  p_pm_amt IN NUMBER DEFAULT NULL,
  p_pm_conf_yn IN VARCHAR2 DEFAULT 'N',
  p_pm_remarks IN VARCHAR2 DEFAULT NULL,
  p_ba_amt IN NUMBER DEFAULT NULL,
  p_ba_remarks IN VARCHAR2 DEFAULT NULL,
  p_ba_conf_yn IN VARCHAR2 DEFAULT 'N',
  p_cr_rcvd_yn IN VARCHAR2 DEFAULT 'N',
  p_comp_code IN VARCHAR2 DEFAULT NULL,
  p_ref IN VARCHAR2 DEFAULT NULL,
  p_rebt_used IN NUMBER DEFAULT NULL,
  p_ba_rcvd_dt IN DATE DEFAULT NULL,
  p_profit_yn IN VARCHAR2 DEFAULT 'N',
  p_ven_recv_yn IN VARCHAR2 DEFAULT 'N',
  p_region IN VARCHAR2 DEFAULT NULL,
  p_jv_yn IN VARCHAR2 DEFAULT NULL,
  p_ref_doc IN VARCHAR2 DEFAULT NULL,
  p_total_amt IN NUMBER DEFAULT NULL,
  p_customer IN VARCHAR2 DEFAULT NULL,
  p_bsns_type IN VARCHAR2 DEFAULT NULL,
  p_cr_uid IN VARCHAR2,
  p_prdm_sys_id OUT NUMBER
);
```

**Example:**
```sql
DECLARE
  v_line_id NUMBER;
BEGIN
  FC_REBATE_PKG.add_rebate_line(
    p_prhm_sys_id => 1,
    p_sm_code => 'SM001',
    p_dt => SYSDATE,
    p_rebt_type => 'CASH',
    p_pm_amt => 1000,
    p_ba_amt => 500,
    p_total_amt => 1500,
    p_customer => 'CUST001',
    p_cr_uid => 'USER001',
    p_prdm_sys_id => v_line_id
  );
  DBMS_OUTPUT.PUT_LINE('Created Line ID: ' || v_line_id);
END;
```

---

#### 5. **update_rebate_line**
Updates an existing rebate line (only specified fields are updated).

```sql
FC_REBATE_PKG.update_rebate_line(
  p_prdm_sys_id IN NUMBER,
  p_sm_code IN VARCHAR2 DEFAULT NULL,
  p_dt IN DATE DEFAULT NULL,
  p_rebt_type IN VARCHAR2 DEFAULT NULL,
  -- ... other optional fields
  p_upd_uid IN VARCHAR2
);
```

**Example:**
```sql
BEGIN
  FC_REBATE_PKG.update_rebate_line(
    p_prdm_sys_id => 1,
    p_pm_amt => 1500,
    p_ba_amt => 750,
    p_upd_uid => 'USER001'
  );
END;
```

---

#### 6. **delete_rebate_line**
Deletes a specific rebate line.

```sql
FC_REBATE_PKG.delete_rebate_line(
  p_prdm_sys_id IN NUMBER
);
```

**Example:**
```sql
BEGIN
  FC_REBATE_PKG.delete_rebate_line(p_prdm_sys_id => 1);
END;
```

---

#### 7. **update_rebate_header**
Updates rebate header fields.

```sql
FC_REBATE_PKG.update_rebate_header(
  p_prhm_sys_id IN NUMBER,
  p_sm_code IN VARCHAR2 DEFAULT NULL,
  p_annotation IN VARCHAR2 DEFAULT NULL,
  p_appr_status IN NUMBER DEFAULT NULL,
  p_appr_uid IN VARCHAR2 DEFAULT NULL,
  p_submit_status IN NUMBER DEFAULT NULL,
  p_amd_no IN NUMBER DEFAULT NULL,
  p_amd_user_id IN VARCHAR2 DEFAULT NULL,
  p_upd_uid IN VARCHAR2
);
```

**Example:**
```sql
BEGIN
  FC_REBATE_PKG.update_rebate_header(
    p_prhm_sys_id => 1,
    p_annotation => 'Updated annotation',
    p_appr_status => 1,
    p_appr_uid => 'APPROVER001',
    p_upd_uid => 'USER001'
  );
END;
```

---

#### 8. **delete_rebate**
Deletes a rebate header and all associated lines.

```sql
FC_REBATE_PKG.delete_rebate(
  p_prhm_sys_id IN NUMBER
);
```

**Example:**
```sql
BEGIN
  FC_REBATE_PKG.delete_rebate(p_prhm_sys_id => 1);
END;
```

---

#### 9. **create_rebate_with_lines**
Creates a complete rebate with header and all lines in a single transaction.

```sql
FC_REBATE_PKG.create_rebate_with_lines(
  p_json_input IN CLOB,
  p_prhm_sys_id OUT NUMBER,
  p_status OUT VARCHAR2,
  p_message OUT VARCHAR2
);
```

**Input JSON Format:**
```json
{
  "prhm_comp_code": "COMP001",
  "prhm_vendor": "VENDOR001",
  "prhm_group": "GROUP001",
  "prhm_sm_code": "SM001",
  "prhm_period": "2026-08",
  "prhm_dr_main_acnt_code": "1000",
  "prhm_dr_sub_acnt_code": "1001",
  "prhm_cr_main_acnt_code": "2000",
  "prhm_cr_sub_acnt_code": "2001",
  "prhm_currency": "USD",
  "prhm_annotation": "Initial rebate",
  "prhm_cr_uid": "USER001",
  "lines": [
    {
      "prdm_sm_code": "SM001",
      "prdm_dt": "2026-08-08",
      "prdm_rebt_type": "CASH",
      "prdm_choice_list": "LIST1",
      "prdm_pm_amt": 1000,
      "prdm_pm_conf_yn": "N",
      "prdm_ba_amt": 500,
      "prdm_ba_conf_yn": "N",
      "prdm_total_amt": 1500,
      "prdm_customer": "CUST001",
      "prdm_bsns_type": "REGULAR",
      "prdm_region": "ASIA",
      "prdm_cr_uid": "USER001"
    },
    {
      "prdm_sm_code": "SM002",
      "prdm_dt": "2026-08-09",
      "prdm_rebt_type": "BONUS",
      "prdm_pm_amt": 2000,
      "prdm_total_amt": 2000,
      "prdm_customer": "CUST002",
      "prdm_cr_uid": "USER001"
    }
  ]
}
```

**Example:**
```sql
DECLARE
  v_header_id NUMBER;
  v_status VARCHAR2(100);
  v_message VARCHAR2(2000);
BEGIN
  FC_REBATE_PKG.create_rebate_with_lines(
    p_json_input => q'[{
      "prhm_comp_code": "COMP001",
      "prhm_vendor": "VENDOR001",
      "prhm_group": "GROUP001",
      "prhm_period": "2026-08",
      "prhm_dr_main_acnt_code": "1000",
      "prhm_dr_sub_acnt_code": "1001",
      "prhm_cr_main_acnt_code": "2000",
      "prhm_cr_sub_acnt_code": "2001",
      "prhm_currency": "USD",
      "prhm_cr_uid": "USER001",
      "lines": [
        {
          "prdm_sm_code": "SM001",
          "prdm_dt": "2026-08-08",
          "prdm_rebt_type": "CASH",
          "prdm_pm_amt": 1000,
          "prdm_total_amt": 1000,
          "prdm_customer": "CUST001",
          "prdm_cr_uid": "USER001"
        }
      ]
    }]',
    p_prhm_sys_id => v_header_id,
    p_status => v_status,
    p_message => v_message
  );
  DBMS_OUTPUT.PUT_LINE('Status: ' || v_status);
  DBMS_OUTPUT.PUT_LINE('Message: ' || v_message);
  DBMS_OUTPUT.PUT_LINE('Header ID: ' || v_header_id);
END;
```

---

## APEX REST Handlers

### Available Endpoints

| Method | Endpoint | Function | Description |
|--------|----------|----------|-------------|
| GET | /rebate/ | `apex_rebate_list` | List all rebates (with optional filters) |
| GET | /rebate/:id | `apex_rebate_get` | Get single rebate with lines |
| POST | /rebate/ | `apex_rebate_create_json` | Create rebate with header and lines |
| PUT | /rebate/:id | `apex_rebate_update` | Update rebate header |
| POST | /rebate/:id/lines | `apex_rebate_add_line` | Add line to rebate |
| PUT | /rebate/line/:id | `apex_rebate_update_line` | Update rebate line |
| DELETE | /rebate/:id | `apex_rebate_delete` | Delete rebate and all lines |
| DELETE | /rebate/line/:id | `apex_rebate_delete_line` | Delete rebate line |

### Example APEX REST Calls

#### 1. List All Rebates
```
GET /rebate/?comp_code=COMP001&period=2026-08
```

**Response:**
```json
[
  {
    "prhm_sys_id": 1,
    "prhm_comp_code": "COMP001",
    "prhm_vendor": "VENDOR001",
    "prhm_period": "2026-08",
    "prhm_currency": "USD"
  }
]
```

#### 2. Get Single Rebate with Lines
```
GET /rebate/1
```

**Response:**
```json
{
  "prhm_sys_id": 1,
  "prhm_comp_code": "COMP001",
  "lines": [...]
}
```

#### 3. Create Rebate with Lines
```
POST /rebate/
Content-Type: application/json

{
  "prhm_comp_code": "COMP001",
  "prhm_vendor": "VENDOR001",
  "prhm_group": "GROUP001",
  "prhm_period": "2026-08",
  "prhm_dr_main_acnt_code": "1000",
  "prhm_dr_sub_acnt_code": "1001",
  "prhm_cr_main_acnt_code": "2000",
  "prhm_cr_sub_acnt_code": "2001",
  "prhm_currency": "USD",
  "prhm_cr_uid": "USER001",
  "lines": [
    {
      "prdm_sm_code": "SM001",
      "prdm_dt": "2026-08-08",
      "prdm_rebt_type": "CASH",
      "prdm_pm_amt": 1000,
      "prdm_total_amt": 1000,
      "prdm_customer": "CUST001",
      "prdm_cr_uid": "USER001"
    }
  ]
}
```

**Response:**
```json
{
  "status": "SUCCESS",
  "message": "Rebate created successfully with ID: 1",
  "prhm_sys_id": 1
}
```

#### 4. Add Line to Rebate
```
POST /rebate/1/lines
Content-Type: application/json

{
  "prdm_sm_code": "SM002",
  "prdm_dt": "2026-08-09",
  "prdm_rebt_type": "BONUS",
  "prdm_pm_amt": 2000,
  "prdm_total_amt": 2000,
  "prdm_customer": "CUST002",
  "prdm_cr_uid": "USER001"
}
```

#### 5. Update Rebate Header
```
PUT /rebate/1
Content-Type: application/json

{
  "prhm_annotation": "Updated annotation",
  "prhm_appr_status": 1,
  "prhm_upd_uid": "USER001"
}
```

#### 6. Update Rebate Line
```
PUT /rebate/line/1
Content-Type: application/json

{
  "prdm_pm_amt": 1500,
  "prdm_upd_uid": "USER001"
}
```

#### 7. Delete Rebate
```
DELETE /rebate/1
```

#### 8. Delete Rebate Line
```
DELETE /rebate/line/1
```

---

## Installation

### 1. Create Package
```sql
@FC_REBATE_PKG.sql
```

### 2. Create APEX Handlers (Optional)
```sql
@APEX_REBATE_REST_HANDLER.sql
```

### 3. Grant Permissions
```sql
GRANT EXECUTE ON FC_REBATE_PKG TO <user_role>;
GRANT EXECUTE ON apex_rebate_list TO <user_role>;
GRANT EXECUTE ON apex_rebate_get TO <user_role>;
-- Grant other functions as needed
```

---

## Error Handling

All procedures use standard exception handling:
- Database errors are captured and returned as JSON error responses
- Transactions are rolled back on any error
- Error messages are descriptive for debugging

**Error Response Format:**
```json
{
  "error": "ORA-00001: Error message details"
}
```

---

## Notes

- All date fields should be in `YYYY-MM-DD` format in JSON
- DateTime fields are stored as `YYYY-MM-DD HH24:MI:SS`
- All update operations only update specified fields (NULL values do not overwrite)
- System automatically generates IDs for headers and detail records
- Deletion of header cascades to all associated lines
- All operations are committed after successful execution

---

## Support

For issues or questions regarding the Rebate API, please contact the database administration team.
