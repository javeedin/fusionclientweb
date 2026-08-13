-- ============================================================
-- RENTAL MANAGEMENT MODULE — SAMPLE DATA
-- 5 Brokers, 10 Properties, 10 Customers, 6 Agreements
-- Agreements call the package → auto-generates installments
-- and monthly revenue splits.
-- Run after: 01_tables, 02_lookup_data, 03_packages, 04_ords_apis
-- ============================================================

-- ============================================================
-- BROKERS
-- ============================================================
INSERT INTO RR_RM_BROKERS (
    BROKER_ID, BROKER_NUMBER, BROKER_NAME, COMPANY_NAME,
    RERA_NO, RERA_EXPIRY, EMAIL, MOBILE, COMMISSION_RATE, STATUS
) VALUES (
    RR_RM_BROKERS_S.NEXTVAL, 'BRK-001001',
    'Ahmed Al Mansouri', 'Betterhomes Real Estate LLC',
    'RERA-2024-10045', DATE '2025-12-31',
    'ahmed.mansouri@betterhomes.ae', '+971501234567', 2.5, 'ACTIVE'
);

INSERT INTO RR_RM_BROKERS (
    BROKER_ID, BROKER_NUMBER, BROKER_NAME, COMPANY_NAME,
    RERA_NO, RERA_EXPIRY, EMAIL, MOBILE, COMMISSION_RATE, STATUS
) VALUES (
    RR_RM_BROKERS_S.NEXTVAL, 'BRK-001002',
    'Sarah Johnson', 'Allsopp & Allsopp Real Estate',
    'RERA-2024-20118', DATE '2025-11-30',
    'sarah.johnson@allsopp.ae', '+971521112233', 2.0, 'ACTIVE'
);

INSERT INTO RR_RM_BROKERS (
    BROKER_ID, BROKER_NUMBER, BROKER_NAME, COMPANY_NAME,
    RERA_NO, RERA_EXPIRY, EMAIL, MOBILE, COMMISSION_RATE, STATUS
) VALUES (
    RR_RM_BROKERS_S.NEXTVAL, 'BRK-001003',
    'Ravi Sharma', 'Espace Real Estate',
    'RERA-2024-30276', DATE '2026-03-31',
    'ravi.sharma@espacerealestate.ae', '+971509988776', 2.5, 'ACTIVE'
);

INSERT INTO RR_RM_BROKERS (
    BROKER_ID, BROKER_NUMBER, BROKER_NAME, COMPANY_NAME,
    RERA_NO, RERA_EXPIRY, EMAIL, MOBILE, COMMISSION_RATE, STATUS
) VALUES (
    RR_RM_BROKERS_S.NEXTVAL, 'BRK-001004',
    'Layla Hassan', 'Driven Properties',
    'RERA-2024-40389', DATE '2025-09-30',
    'layla.hassan@drivenproperties.ae', '+971554445566', 2.0, 'ACTIVE'
);

INSERT INTO RR_RM_BROKERS (
    BROKER_ID, BROKER_NUMBER, BROKER_NAME, COMPANY_NAME,
    RERA_NO, RERA_EXPIRY, EMAIL, MOBILE, COMMISSION_RATE, STATUS
) VALUES (
    RR_RM_BROKERS_S.NEXTVAL, 'BRK-001005',
    'James O''Brien', 'Patriot Real Estate Brokers',
    'RERA-2023-50512', DATE '2025-06-30',
    'james.obrien@patriotrealestate.ae', '+971556677889', 3.0, 'ACTIVE'
);

COMMIT;

-- ============================================================
-- PROPERTIES  — 10 realistic Dubai properties
-- ============================================================

-- 1. Downtown Dubai apartment
INSERT INTO RR_RM_PROPERTIES (
    PROPERTY_ID, PROPERTY_NUMBER, PROPERTY_NAME,
    PROPERTY_TYPE, USAGE_TYPE, BUILDING_NAME, FLOOR_NO, UNIT_NO,
    AREA_SQFT, AREA_SQMT, BEDROOMS, BATHROOMS, PARKING_SPACES,
    COMMUNITY, DISTRICT, CITY, EMIRATE, COUNTRY,
    MAKANI_NO, TITLE_DEED_NO, DEWA_PREMISE_NO,
    OWNER_NAME, OWNER_CONTACT, ANNUAL_MARKET_RENT,
    FEATURES, STATUS
) VALUES (
    RR_RM_PROPERTIES_S.NEXTVAL, 'PROP-001001', 'Burj Views Tower A — Unit 1204',
    'APARTMENT', 'RESIDENTIAL', 'Burj Views Tower A', '12', '1204',
    1180, 109.6, 2, 2, 1,
    'Downtown Dubai', 'Burj Khalifa District', 'Dubai', 'Dubai', 'UAE',
    '2131459802', 'TD-DXB-2019-004521', 'DEWA-10234567',
    'Mohammed Al Rashid', '+971505551001', 120000,
    'Gym, Pool, Concierge, Balcony, Burj Khalifa View', 'RENTED'
);

-- 2. Dubai Marina 1BR
INSERT INTO RR_RM_PROPERTIES (
    PROPERTY_ID, PROPERTY_NUMBER, PROPERTY_NAME,
    PROPERTY_TYPE, USAGE_TYPE, BUILDING_NAME, FLOOR_NO, UNIT_NO,
    AREA_SQFT, AREA_SQMT, BEDROOMS, BATHROOMS, PARKING_SPACES,
    COMMUNITY, DISTRICT, CITY, EMIRATE, COUNTRY,
    MAKANI_NO, TITLE_DEED_NO, DEWA_PREMISE_NO,
    OWNER_NAME, OWNER_CONTACT, ANNUAL_MARKET_RENT,
    FEATURES, STATUS
) VALUES (
    RR_RM_PROPERTIES_S.NEXTVAL, 'PROP-001002', 'Princess Tower — Unit 4508',
    'APARTMENT', 'RESIDENTIAL', 'Princess Tower', '45', '4508',
    870, 80.8, 1, 1, 1,
    'Dubai Marina', 'JBR', 'Dubai', 'Dubai', 'UAE',
    '2316780145', 'TD-DXB-2020-011203', 'DEWA-10345678',
    'Fatima Al Zaabi', '+971505551002', 85000,
    'Gym, Pool, Marina View, Balcony, 24h Security', 'AVAILABLE'
);

-- 3. JLT Studio
INSERT INTO RR_RM_PROPERTIES (
    PROPERTY_ID, PROPERTY_NUMBER, PROPERTY_NAME,
    PROPERTY_TYPE, USAGE_TYPE, BUILDING_NAME, FLOOR_NO, UNIT_NO,
    AREA_SQFT, AREA_SQMT, BEDROOMS, BATHROOMS, PARKING_SPACES,
    COMMUNITY, DISTRICT, CITY, EMIRATE, COUNTRY,
    MAKANI_NO, TITLE_DEED_NO, DEWA_PREMISE_NO,
    OWNER_NAME, OWNER_CONTACT, ANNUAL_MARKET_RENT,
    FEATURES, STATUS
) VALUES (
    RR_RM_PROPERTIES_S.NEXTVAL, 'PROP-001003', 'Cluster Q, Lake View Tower — Unit 802',
    'STUDIO', 'RESIDENTIAL', 'Lake View Tower', '8', '802',
    490, 45.5, 0, 1, 1,
    'Jumeirah Lake Towers', 'Cluster Q', 'Dubai', 'Dubai', 'UAE',
    '2251334509', 'TD-DXB-2018-008876', 'DEWA-10456789',
    'Mohammed Al Rashid', '+971505551001', 45000,
    'Gym, Pool, Lake View, Metro Access', 'RENTED'
);

-- 4. Arabian Ranches Villa 3BR
INSERT INTO RR_RM_PROPERTIES (
    PROPERTY_ID, PROPERTY_NUMBER, PROPERTY_NAME,
    PROPERTY_TYPE, USAGE_TYPE, BUILDING_NAME, FLOOR_NO, UNIT_NO,
    AREA_SQFT, AREA_SQMT, BEDROOMS, BATHROOMS, PARKING_SPACES,
    PLOT_NO, COMMUNITY, DISTRICT, CITY, EMIRATE, COUNTRY,
    TITLE_DEED_NO, DEWA_PREMISE_NO,
    OWNER_NAME, OWNER_CONTACT, ANNUAL_MARKET_RENT,
    FEATURES, STATUS
) VALUES (
    RR_RM_PROPERTIES_S.NEXTVAL, 'PROP-001004', 'Arabian Ranches — Mirador Villa 45',
    'VILLA', 'RESIDENTIAL', NULL, 'G+1', 'Villa 45',
    3200, 297.3, 3, 4, 2,
    '45', 'Arabian Ranches', 'Mirador', 'Dubai', 'Dubai', 'UAE',
    'TD-DXB-2017-003312', 'DEWA-10567890',
    'Khalid Al Mansoori', '+971505551003', 200000,
    'Private Garden, Pool, Maid Room, Golf Course View, Gated Community', 'RENTED'
);

-- 5. Palm Jumeirah 4BR Villa
INSERT INTO RR_RM_PROPERTIES (
    PROPERTY_ID, PROPERTY_NUMBER, PROPERTY_NAME,
    PROPERTY_TYPE, USAGE_TYPE, BUILDING_NAME, FLOOR_NO, UNIT_NO,
    AREA_SQFT, AREA_SQMT, BEDROOMS, BATHROOMS, PARKING_SPACES,
    PLOT_NO, COMMUNITY, DISTRICT, CITY, EMIRATE, COUNTRY,
    TITLE_DEED_NO, DEWA_PREMISE_NO,
    OWNER_NAME, OWNER_CONTACT, ANNUAL_MARKET_RENT,
    FEATURES, STATUS
) VALUES (
    RR_RM_PROPERTIES_S.NEXTVAL, 'PROP-001005', 'Palm Jumeirah Frond K — Villa 7',
    'VILLA', 'RESIDENTIAL', NULL, 'G+1', 'Villa 7',
    6500, 604.0, 4, 5, 3,
    'K-07', 'Palm Jumeirah', 'Frond K', 'Dubai', 'Dubai', 'UAE',
    'TD-DXB-2016-002100', 'DEWA-10678901',
    'Hamdan Al Falasi', '+971505551004', 550000,
    'Private Beach, Private Pool, Sea View, Maid Room, Study, Smart Home', 'AVAILABLE'
);

-- 6. DIFC Office
INSERT INTO RR_RM_PROPERTIES (
    PROPERTY_ID, PROPERTY_NUMBER, PROPERTY_NAME,
    PROPERTY_TYPE, USAGE_TYPE, BUILDING_NAME, FLOOR_NO, UNIT_NO,
    AREA_SQFT, AREA_SQMT, BEDROOMS, BATHROOMS, PARKING_SPACES,
    COMMUNITY, DISTRICT, CITY, EMIRATE, COUNTRY,
    TITLE_DEED_NO, DEWA_PREMISE_NO,
    OWNER_NAME, OWNER_CONTACT, ANNUAL_MARKET_RENT,
    FEATURES, STATUS
) VALUES (
    RR_RM_PROPERTIES_S.NEXTVAL, 'PROP-001006', 'Gate Village 6 — Office Suite 302',
    'OFFICE', 'COMMERCIAL', 'Gate Village Building 6', '3', '302',
    1850, 171.9, 0, 2, 3,
    'DIFC', 'Gate Village', 'Dubai', 'Dubai', 'UAE',
    'TD-DXB-2021-015600', 'DEWA-10789012',
    'Buimercc Investments LLC', '+971505551005', 350000,
    'Fully Fitted, Server Room, Reception, Boardroom, 24h Security, DIFC License', 'RENTED'
);

-- 7. Business Bay 2BR
INSERT INTO RR_RM_PROPERTIES (
    PROPERTY_ID, PROPERTY_NUMBER, PROPERTY_NAME,
    PROPERTY_TYPE, USAGE_TYPE, BUILDING_NAME, FLOOR_NO, UNIT_NO,
    AREA_SQFT, AREA_SQMT, BEDROOMS, BATHROOMS, PARKING_SPACES,
    COMMUNITY, DISTRICT, CITY, EMIRATE, COUNTRY,
    MAKANI_NO, TITLE_DEED_NO, DEWA_PREMISE_NO,
    OWNER_NAME, OWNER_CONTACT, ANNUAL_MARKET_RENT,
    FEATURES, STATUS
) VALUES (
    RR_RM_PROPERTIES_S.NEXTVAL, 'PROP-001007', 'Executive Bay Tower — Unit 1503',
    'APARTMENT', 'RESIDENTIAL', 'Executive Bay Tower', '15', '1503',
    1350, 125.4, 2, 3, 1,
    'Business Bay', 'Executive Bay', 'Dubai', 'Dubai', 'UAE',
    '2186672341', 'TD-DXB-2022-018900', 'DEWA-10890123',
    'Khalid Al Mansoori', '+971505551003', 130000,
    'Canal View, Gym, Pool, Covered Parking, Walking Distance to Metro', 'RENTED'
);

-- 8. JBR Shop
INSERT INTO RR_RM_PROPERTIES (
    PROPERTY_ID, PROPERTY_NUMBER, PROPERTY_NAME,
    PROPERTY_TYPE, USAGE_TYPE, BUILDING_NAME, FLOOR_NO, UNIT_NO,
    AREA_SQFT, AREA_SQMT, BEDROOMS, BATHROOMS, PARKING_SPACES,
    COMMUNITY, DISTRICT, CITY, EMIRATE, COUNTRY,
    TITLE_DEED_NO, DEWA_PREMISE_NO,
    OWNER_NAME, OWNER_CONTACT, ANNUAL_MARKET_RENT,
    FEATURES, STATUS
) VALUES (
    RR_RM_PROPERTIES_S.NEXTVAL, 'PROP-001008', 'The Walk JBR — Retail Unit G-12',
    'SHOP', 'COMMERCIAL', 'The Walk JBR', 'G', 'G-12',
    680, 63.2, 0, 1, 0,
    'JBR', 'The Walk', 'Dubai', 'Dubai', 'UAE',
    'TD-DXB-2019-006700', 'DEWA-10901234',
    'Hamdan Al Falasi', '+971505551004', 220000,
    'Beach Facing, High Footfall, Al Fresco Seating, Central AC', 'AVAILABLE'
);

-- 9. Dubai Hills Townhouse
INSERT INTO RR_RM_PROPERTIES (
    PROPERTY_ID, PROPERTY_NUMBER, PROPERTY_NAME,
    PROPERTY_TYPE, USAGE_TYPE, BUILDING_NAME, FLOOR_NO, UNIT_NO,
    AREA_SQFT, AREA_SQMT, BEDROOMS, BATHROOMS, PARKING_SPACES,
    PLOT_NO, COMMUNITY, DISTRICT, CITY, EMIRATE, COUNTRY,
    TITLE_DEED_NO, DEWA_PREMISE_NO,
    OWNER_NAME, OWNER_CONTACT, ANNUAL_MARKET_RENT,
    FEATURES, STATUS
) VALUES (
    RR_RM_PROPERTIES_S.NEXTVAL, 'PROP-001009', 'Dubai Hills Estate — Maple Townhouse 28',
    'TOWNHOUSE', 'RESIDENTIAL', NULL, 'G+1', 'TH-28',
    2400, 223.0, 3, 3, 2,
    '28', 'Dubai Hills Estate', 'Maple', 'Dubai', 'Dubai', 'UAE',
    'TD-DXB-2023-021500', 'DEWA-11012345',
    'Buimercc Investments LLC', '+971505551005', 175000,
    'Private Garden, Community Pool, Golf Course Nearby, Kids Play Area, Maid Room', 'AVAILABLE'
);

-- 10. Al Quoz Warehouse
INSERT INTO RR_RM_PROPERTIES (
    PROPERTY_ID, PROPERTY_NUMBER, PROPERTY_NAME,
    PROPERTY_TYPE, USAGE_TYPE, BUILDING_NAME, FLOOR_NO, UNIT_NO,
    AREA_SQFT, AREA_SQMT, BEDROOMS, BATHROOMS, PARKING_SPACES,
    PLOT_NO, COMMUNITY, DISTRICT, CITY, EMIRATE, COUNTRY,
    TITLE_DEED_NO, DEWA_PREMISE_NO,
    OWNER_NAME, OWNER_CONTACT, ANNUAL_MARKET_RENT,
    FEATURES, STATUS
) VALUES (
    RR_RM_PROPERTIES_S.NEXTVAL, 'PROP-001010', 'Al Quoz Industrial 3 — Warehouse W-09',
    'WAREHOUSE', 'COMMERCIAL', NULL, 'G', 'W-09',
    8000, 743.2, 0, 2, 10,
    'W-09/Plot-112', 'Al Quoz Industrial', 'Al Quoz 3', 'Dubai', 'Dubai', 'UAE',
    'TD-DXB-2015-001850', 'DEWA-11123456',
    'Mohammed Al Rashid', '+971505551001', 180000,
    'Loading Dock, 40ft Container Access, 3-Phase Power, CCTV, Mezzanine Office', 'RENTED'
);

COMMIT;
SELECT 'Properties inserted: ' || COUNT(*) FROM RR_RM_PROPERTIES WHERE PROPERTY_NUMBER LIKE 'PROP-0010%';

-- ============================================================
-- CUSTOMERS  — 10 realistic Dubai tenants (mix of individual / company)
-- ============================================================

-- 1. British expat - Downtown
INSERT INTO RR_RM_CUSTOMERS (
    CUSTOMER_ID, CUSTOMER_NUMBER, CUSTOMER_TYPE,
    FIRST_NAME, LAST_NAME, FULL_NAME, EMAIL, PHONE, MOBILE,
    NATIONALITY, PASSPORT_NO, PASSPORT_EXPIRY,
    EMIRATES_ID, EMIRATES_ID_EXPIRY,
    ADDRESS_LINE1, CITY, EMIRATE, COUNTRY,
    OCCUPATION, EMPLOYER_NAME, STATUS
) VALUES (
    RR_RM_CUSTOMERS_S.NEXTVAL, 'CUST-001001', 'INDIVIDUAL',
    'James', 'Harrison', 'James Harrison',
    'james.harrison@gmail.com', '+97143221100', '+971521001001',
    'British', 'GB1234567', DATE '2029-08-15',
    '784-1985-1234567-1', DATE '2027-06-30',
    'Apt 1204, Burj Views Tower A, Downtown Dubai', 'Dubai', 'Dubai', 'UAE',
    'Finance Director', 'HSBC Bank Middle East', 'ACTIVE'
);

-- 2. Indian IT professional - JLT
INSERT INTO RR_RM_CUSTOMERS (
    CUSTOMER_ID, CUSTOMER_NUMBER, CUSTOMER_TYPE,
    FIRST_NAME, LAST_NAME, FULL_NAME, EMAIL, PHONE, MOBILE,
    NATIONALITY, PASSPORT_NO, PASSPORT_EXPIRY,
    EMIRATES_ID, EMIRATES_ID_EXPIRY,
    ADDRESS_LINE1, CITY, EMIRATE, COUNTRY,
    OCCUPATION, EMPLOYER_NAME, STATUS
) VALUES (
    RR_RM_CUSTOMERS_S.NEXTVAL, 'CUST-001002', 'INDIVIDUAL',
    'Arjun', 'Mehta', 'Arjun Mehta',
    'arjun.mehta@email.com', '+97143112200', '+971552002002',
    'Indian', 'M9876543', DATE '2028-03-22',
    '784-1990-2345678-2', DATE '2026-12-31',
    'Unit 802, Lake View Tower, JLT Cluster Q', 'Dubai', 'Dubai', 'UAE',
    'Senior Software Engineer', 'Accenture Middle East', 'ACTIVE'
);

-- 3. UAE National - Arabian Ranches
INSERT INTO RR_RM_CUSTOMERS (
    CUSTOMER_ID, CUSTOMER_NUMBER, CUSTOMER_TYPE,
    FIRST_NAME, LAST_NAME, FULL_NAME, EMAIL, PHONE, MOBILE,
    NATIONALITY, EMIRATES_ID, EMIRATES_ID_EXPIRY,
    ADDRESS_LINE1, CITY, EMIRATE, COUNTRY,
    OCCUPATION, EMPLOYER_NAME, STATUS
) VALUES (
    RR_RM_CUSTOMERS_S.NEXTVAL, 'CUST-001003', 'INDIVIDUAL',
    'Sultan', 'Al Ketbi', 'Sultan Khalid Al Ketbi',
    'sultan.alketbi@gov.ae', '+97143987600', '+971503003003',
    'Emirati', '784-1975-3456789-3', DATE '2028-11-05',
    'Villa 45, Mirador, Arabian Ranches', 'Dubai', 'Dubai', 'UAE',
    'Senior Manager', 'Dubai Municipality', 'ACTIVE'
);

-- 4. Technology Company - DIFC
INSERT INTO RR_RM_CUSTOMERS (
    CUSTOMER_ID, CUSTOMER_NUMBER, CUSTOMER_TYPE,
    FIRST_NAME, LAST_NAME, FULL_NAME, COMPANY_NAME, EMAIL, PHONE, MOBILE,
    TRADE_LICENSE_NO, TRADE_LICENSE_EXPIRY,
    ADDRESS_LINE1, CITY, EMIRATE, COUNTRY,
    STATUS
) VALUES (
    RR_RM_CUSTOMERS_S.NEXTVAL, 'CUST-001004', 'COMPANY',
    NULL, NULL, 'FinTech Solutions DIFC Ltd',
    'FinTech Solutions DIFC Ltd',
    'admin@fintechsolutions.ae', '+97143001122', '+971504004004',
    'DIFC-2022-007123', DATE '2026-03-31',
    'Gate Village 6, Suite 302, DIFC', 'Dubai', 'Dubai', 'UAE',
    'ACTIVE'
);

-- 5. Pakistani engineer - Business Bay
INSERT INTO RR_RM_CUSTOMERS (
    CUSTOMER_ID, CUSTOMER_NUMBER, CUSTOMER_TYPE,
    FIRST_NAME, LAST_NAME, FULL_NAME, EMAIL, PHONE, MOBILE,
    NATIONALITY, PASSPORT_NO, PASSPORT_EXPIRY,
    EMIRATES_ID, EMIRATES_ID_EXPIRY,
    ADDRESS_LINE1, CITY, EMIRATE, COUNTRY,
    OCCUPATION, EMPLOYER_NAME, STATUS
) VALUES (
    RR_RM_CUSTOMERS_S.NEXTVAL, 'CUST-001005', 'INDIVIDUAL',
    'Usman', 'Siddiqui', 'Usman Siddiqui',
    'usman.siddiqui@gmail.com', '+97143882244', '+971555005005',
    'Pakistani', 'AK4512390', DATE '2027-07-18',
    '784-1988-4567890-4', DATE '2027-03-31',
    'Unit 1503, Executive Bay Tower, Business Bay', 'Dubai', 'Dubai', 'UAE',
    'Civil Engineer', 'AECOM Middle East', 'ACTIVE'
);

-- 6. American expat - Palm Jumeirah (prospective)
INSERT INTO RR_RM_CUSTOMERS (
    CUSTOMER_ID, CUSTOMER_NUMBER, CUSTOMER_TYPE,
    FIRST_NAME, LAST_NAME, FULL_NAME, EMAIL, PHONE, MOBILE,
    NATIONALITY, PASSPORT_NO, PASSPORT_EXPIRY,
    EMIRATES_ID, EMIRATES_ID_EXPIRY,
    ADDRESS_LINE1, CITY, EMIRATE, COUNTRY,
    OCCUPATION, EMPLOYER_NAME, STATUS
) VALUES (
    RR_RM_CUSTOMERS_S.NEXTVAL, 'CUST-001006', 'INDIVIDUAL',
    'Michael', 'Thompson', 'Michael Thompson',
    'michael.thompson@outlook.com', '+97143556677', '+971506006006',
    'American', 'US98765432', DATE '2030-01-10',
    '784-1982-5678901-5', DATE '2026-09-30',
    'Villa 7, Frond K, Palm Jumeirah', 'Dubai', 'Dubai', 'UAE',
    'Regional CEO', 'Chevron Middle East', 'ACTIVE'
);

-- 7. Retail trading company - JBR Shop
INSERT INTO RR_RM_CUSTOMERS (
    CUSTOMER_ID, CUSTOMER_NUMBER, CUSTOMER_TYPE,
    FIRST_NAME, LAST_NAME, FULL_NAME, COMPANY_NAME, EMAIL, PHONE, MOBILE,
    TRADE_LICENSE_NO, TRADE_LICENSE_EXPIRY,
    ADDRESS_LINE1, CITY, EMIRATE, COUNTRY,
    STATUS
) VALUES (
    RR_RM_CUSTOMERS_S.NEXTVAL, 'CUST-001007', 'COMPANY',
    NULL, NULL, 'Coastal Eats & Lifestyle LLC',
    'Coastal Eats & Lifestyle LLC',
    'ops@coastaleats.ae', '+97143778899', '+971507007007',
    'DED-2021-885412', DATE '2025-12-31',
    'The Walk JBR, Retail G-12', 'Dubai', 'Dubai', 'UAE',
    'ACTIVE'
);

-- 8. Egyptian doctor - Dubai Hills
INSERT INTO RR_RM_CUSTOMERS (
    CUSTOMER_ID, CUSTOMER_NUMBER, CUSTOMER_TYPE,
    FIRST_NAME, LAST_NAME, FULL_NAME, EMAIL, PHONE, MOBILE,
    NATIONALITY, PASSPORT_NO, PASSPORT_EXPIRY,
    EMIRATES_ID, EMIRATES_ID_EXPIRY,
    ADDRESS_LINE1, CITY, EMIRATE, COUNTRY,
    OCCUPATION, EMPLOYER_NAME, STATUS
) VALUES (
    RR_RM_CUSTOMERS_S.NEXTVAL, 'CUST-001008', 'INDIVIDUAL',
    'Karim', 'El-Sayed', 'Dr. Karim El-Sayed',
    'karim.elsayed@mediclinic.ae', '+97143445566', '+971558008008',
    'Egyptian', 'EG11223344', DATE '2028-05-20',
    '784-1979-6789012-6', DATE '2027-01-31',
    'TH-28, Maple, Dubai Hills Estate', 'Dubai', 'Dubai', 'UAE',
    'Cardiologist', 'Mediclinic City Hospital', 'ACTIVE'
);

-- 9. Logistics company - Al Quoz Warehouse
INSERT INTO RR_RM_CUSTOMERS (
    CUSTOMER_ID, CUSTOMER_NUMBER, CUSTOMER_TYPE,
    FIRST_NAME, LAST_NAME, FULL_NAME, COMPANY_NAME, EMAIL, PHONE, MOBILE,
    TRADE_LICENSE_NO, TRADE_LICENSE_EXPIRY,
    ADDRESS_LINE1, CITY, EMIRATE, COUNTRY,
    STATUS
) VALUES (
    RR_RM_CUSTOMERS_S.NEXTVAL, 'CUST-001009', 'COMPANY',
    NULL, NULL, 'Gulf Logistics & Freight Solutions LLC',
    'Gulf Logistics & Freight Solutions LLC',
    'warehouse@gulflogistics.ae', '+97143991100', '+971509009009',
    'DED-2019-441287', DATE '2026-06-30',
    'Warehouse W-09, Al Quoz Industrial 3', 'Dubai', 'Dubai', 'UAE',
    'ACTIVE'
);

-- 10. Lebanese architect - Dubai Marina (prospective)
INSERT INTO RR_RM_CUSTOMERS (
    CUSTOMER_ID, CUSTOMER_NUMBER, CUSTOMER_TYPE,
    FIRST_NAME, LAST_NAME, FULL_NAME, EMAIL, PHONE, MOBILE,
    NATIONALITY, PASSPORT_NO, PASSPORT_EXPIRY,
    EMIRATES_ID, EMIRATES_ID_EXPIRY,
    ADDRESS_LINE1, CITY, EMIRATE, COUNTRY,
    OCCUPATION, EMPLOYER_NAME, STATUS
) VALUES (
    RR_RM_CUSTOMERS_S.NEXTVAL, 'CUST-001010', 'INDIVIDUAL',
    'Nadia', 'Khoury', 'Nadia Khoury',
    'nadia.khoury@designhaus.ae', '+97143224455', '+971550010010',
    'Lebanese', 'LB55443322', DATE '2029-11-30',
    '784-1993-7890123-7', DATE '2026-08-31',
    'Princess Tower, Dubai Marina', 'Dubai', 'Dubai', 'UAE',
    'Senior Architect', 'Design Haus Architecture & Interiors', 'ACTIVE'
);

COMMIT;
SELECT 'Customers inserted: ' || COUNT(*) FROM RR_RM_CUSTOMERS WHERE CUSTOMER_NUMBER LIKE 'CUST-0010%';

-- ============================================================
-- AGREEMENTS — 6 agreements (package auto-generates installments
-- and monthly splits for each)
-- ============================================================
-- We call the packages directly so all child records are created.

DECLARE
    v_result  VARCHAR2(4000);
    v_prop_id NUMBER;
    v_cust_id NUMBER;
    v_brkr_id NUMBER;
BEGIN
    -- ─────────────────────────────────────────────────────────
    -- AGR-1: Downtown 2BR — James Harrison, Monthly, 1 year
    -- ─────────────────────────────────────────────────────────
    SELECT PROPERTY_ID INTO v_prop_id FROM RR_RM_PROPERTIES WHERE PROPERTY_NUMBER = 'PROP-001001';
    SELECT CUSTOMER_ID INTO v_cust_id FROM RR_RM_CUSTOMERS  WHERE CUSTOMER_NUMBER = 'CUST-001001';
    SELECT BROKER_ID   INTO v_brkr_id FROM RR_RM_BROKERS    WHERE BROKER_NUMBER   = 'BRK-001001';

    RR_RM_AGREEMENTS_PKG.create_agreement(
        p_json => JSON_OBJECT(
            'agreementType'          VALUE 'NEW',
            'signDate'               VALUE '2025-01-05',
            'validFrom'              VALUE '2025-01-15',
            'validTo'                VALUE '2026-01-14',
            'propertyId'             VALUE v_prop_id,
            'customerId'             VALUE v_cust_id,
            'brokerId'               VALUE v_brkr_id,
            'brokerCommissionPct'    VALUE 2.5,
            'brokerCommissionAmount' VALUE 3000,
            'tenantContactPhone'     VALUE '+971521001001',
            'tenantContactEmail'     VALUE 'james.harrison@gmail.com',
            'startDate'              VALUE '2025-01-15',
            'endDate'                VALUE '2026-01-14',
            'paymentFrequency'       VALUE 'MONTHLY',
            'totalAmount'            VALUE 120000,
            'currencyCode'           VALUE 'AED',
            'securityDepositAmount'  VALUE 10000,
            'securityDepositCheque'  VALUE 'CHK-ADC-001001',
            'securityDepositDate'    VALUE '2025-01-10',
            'securityDepositBank'    VALUE 'Abu Dhabi Commercial Bank',
            'ejariNumber'            VALUE 'EJARI-2025-DXB-441001',
            'municipalityFees'       VALUE 6000,
            'noticePeriodDays'       VALUE 90,
            'gracePeriodDays'        VALUE 5,
            'renewalOption'          VALUE 'Y',
            'specialConditions'      VALUE 'No pets. Tenant responsible for minor maintenance under AED 500. Annual rent increase capped at RERA index.'
        ),
        p_result => v_result
    );
    DBMS_OUTPUT.PUT_LINE('AGR-1 result: ' || v_result);

    -- ─────────────────────────────────────────────────────────
    -- AGR-2: JLT Studio — Arjun Mehta, Quarterly, 1 year
    -- ─────────────────────────────────────────────────────────
    SELECT PROPERTY_ID INTO v_prop_id FROM RR_RM_PROPERTIES WHERE PROPERTY_NUMBER = 'PROP-001003';
    SELECT CUSTOMER_ID INTO v_cust_id FROM RR_RM_CUSTOMERS  WHERE CUSTOMER_NUMBER = 'CUST-001002';
    SELECT BROKER_ID   INTO v_brkr_id FROM RR_RM_BROKERS    WHERE BROKER_NUMBER   = 'BRK-001002';

    RR_RM_AGREEMENTS_PKG.create_agreement(
        p_json => JSON_OBJECT(
            'agreementType'          VALUE 'NEW',
            'signDate'               VALUE '2024-12-20',
            'validFrom'              VALUE '2025-01-01',
            'validTo'                VALUE '2025-12-31',
            'propertyId'             VALUE v_prop_id,
            'customerId'             VALUE v_cust_id,
            'brokerId'               VALUE v_brkr_id,
            'brokerCommissionPct'    VALUE 2.0,
            'brokerCommissionAmount' VALUE 900,
            'tenantContactPhone'     VALUE '+971552002002',
            'tenantContactEmail'     VALUE 'arjun.mehta@email.com',
            'startDate'              VALUE '2025-01-01',
            'endDate'                VALUE '2025-12-31',
            'paymentFrequency'       VALUE 'QUARTERLY',
            'totalAmount'            VALUE 45000,
            'currencyCode'           VALUE 'AED',
            'securityDepositAmount'  VALUE 5000,
            'securityDepositCheque'  VALUE 'CHK-EMB-002001',
            'securityDepositDate'    VALUE '2024-12-22',
            'securityDepositBank'    VALUE 'Emirates NBD',
            'ejariNumber'            VALUE 'EJARI-2025-DXB-220002',
            'municipalityFees'       VALUE 2250,
            'noticePeriodDays'       VALUE 60,
            'gracePeriodDays'        VALUE 0,
            'renewalOption'          VALUE 'Y',
            'specialConditions'      VALUE 'Studio unit — no structural modifications allowed.'
        ),
        p_result => v_result
    );
    DBMS_OUTPUT.PUT_LINE('AGR-2 result: ' || v_result);

    -- ─────────────────────────────────────────────────────────
    -- AGR-3: Arabian Ranches Villa — Sultan Al Ketbi, 4 cheques, 2 years
    -- ─────────────────────────────────────────────────────────
    SELECT PROPERTY_ID INTO v_prop_id FROM RR_RM_PROPERTIES WHERE PROPERTY_NUMBER = 'PROP-001004';
    SELECT CUSTOMER_ID INTO v_cust_id FROM RR_RM_CUSTOMERS  WHERE CUSTOMER_NUMBER = 'CUST-001003';
    SELECT BROKER_ID   INTO v_brkr_id FROM RR_RM_BROKERS    WHERE BROKER_NUMBER   = 'BRK-001003';

    RR_RM_AGREEMENTS_PKG.create_agreement(
        p_json => JSON_OBJECT(
            'agreementType'          VALUE 'RENEWAL',
            'signDate'               VALUE '2024-06-01',
            'validFrom'              VALUE '2024-07-01',
            'validTo'                VALUE '2026-06-30',
            'propertyId'             VALUE v_prop_id,
            'customerId'             VALUE v_cust_id,
            'brokerId'               VALUE v_brkr_id,
            'brokerCommissionPct'    VALUE 2.5,
            'brokerCommissionAmount' VALUE 5000,
            'tenantContactPhone'     VALUE '+971503003003',
            'tenantContactEmail'     VALUE 'sultan.alketbi@gov.ae',
            'startDate'              VALUE '2024-07-01',
            'endDate'                VALUE '2026-06-30',
            'paymentFrequency'       VALUE 'QUARTERLY',
            'totalAmount'            VALUE 400000,
            'currencyCode'           VALUE 'AED',
            'securityDepositAmount'  VALUE 20000,
            'securityDepositCheque'  VALUE 'CHK-FAB-003001',
            'securityDepositDate'    VALUE '2024-06-05',
            'securityDepositBank'    VALUE 'First Abu Dhabi Bank',
            'advanceRentAmount'      VALUE 100000,
            'advanceRentMonths'      VALUE 6,
            'ejariNumber'            VALUE 'EJARI-2024-DXB-183003',
            'municipalityFees'       VALUE 10000,
            'noticePeriodDays'       VALUE 90,
            'gracePeriodDays'        VALUE 7,
            'renewalOption'          VALUE 'N',
            'rentIncrementPct'       VALUE 5,
            'specialConditions'      VALUE '2-year renewal. Tenant may keep pets with written approval. Landscaping maintained by owner. Pool serviced bi-weekly.'
        ),
        p_result => v_result
    );
    DBMS_OUTPUT.PUT_LINE('AGR-3 result: ' || v_result);

    -- ─────────────────────────────────────────────────────────
    -- AGR-4: DIFC Office — FinTech Solutions, Half-yearly, 1 year
    -- ─────────────────────────────────────────────────────────
    SELECT PROPERTY_ID INTO v_prop_id FROM RR_RM_PROPERTIES WHERE PROPERTY_NUMBER = 'PROP-001006';
    SELECT CUSTOMER_ID INTO v_cust_id FROM RR_RM_CUSTOMERS  WHERE CUSTOMER_NUMBER = 'CUST-001004';
    SELECT BROKER_ID   INTO v_brkr_id FROM RR_RM_BROKERS    WHERE BROKER_NUMBER   = 'BRK-001004';

    RR_RM_AGREEMENTS_PKG.create_agreement(
        p_json => JSON_OBJECT(
            'agreementType'          VALUE 'NEW',
            'signDate'               VALUE '2025-02-10',
            'validFrom'              VALUE '2025-03-01',
            'validTo'                VALUE '2026-02-28',
            'propertyId'             VALUE v_prop_id,
            'customerId'             VALUE v_cust_id,
            'brokerId'               VALUE v_brkr_id,
            'brokerCommissionPct'    VALUE 2.0,
            'brokerCommissionAmount' VALUE 7000,
            'tenantContactPhone'     VALUE '+971504004004',
            'tenantContactEmail'     VALUE 'admin@fintechsolutions.ae',
            'startDate'              VALUE '2025-03-01',
            'endDate'                VALUE '2026-02-28',
            'paymentFrequency'       VALUE 'HALF_YEARLY',
            'totalAmount'            VALUE 350000,
            'currencyCode'           VALUE 'AED',
            'securityDepositAmount'  VALUE 35000,
            'securityDepositCheque'  VALUE 'CHK-CBD-004001',
            'securityDepositDate'    VALUE '2025-02-12',
            'securityDepositBank'    VALUE 'Commercial Bank of Dubai',
            'ejariNumber'            VALUE 'EJARI-2025-DXB-557004',
            'municipalityFees'       VALUE 17500,
            'noticePeriodDays'       VALUE 90,
            'gracePeriodDays'        VALUE 10,
            'renewalOption'          VALUE 'Y',
            'specialConditions'      VALUE 'DIFC commercial lease. Tenant responsible for fit-out maintenance. Server room AC maintained by owner. Early termination requires 6-month penalty.'
        ),
        p_result => v_result
    );
    DBMS_OUTPUT.PUT_LINE('AGR-4 result: ' || v_result);

    -- ─────────────────────────────────────────────────────────
    -- AGR-5: Business Bay 2BR — Usman Siddiqui, Monthly, 1 year
    -- ─────────────────────────────────────────────────────────
    SELECT PROPERTY_ID INTO v_prop_id FROM RR_RM_PROPERTIES WHERE PROPERTY_NUMBER = 'PROP-001007';
    SELECT CUSTOMER_ID INTO v_cust_id FROM RR_RM_CUSTOMERS  WHERE CUSTOMER_NUMBER = 'CUST-001005';
    SELECT BROKER_ID   INTO v_brkr_id FROM RR_RM_BROKERS    WHERE BROKER_NUMBER   = 'BRK-001005';

    RR_RM_AGREEMENTS_PKG.create_agreement(
        p_json => JSON_OBJECT(
            'agreementType'          VALUE 'NEW',
            'signDate'               VALUE '2025-03-01',
            'validFrom'              VALUE '2025-03-15',
            'validTo'                VALUE '2026-03-14',
            'propertyId'             VALUE v_prop_id,
            'customerId'             VALUE v_cust_id,
            'brokerId'               VALUE v_brkr_id,
            'brokerCommissionPct'    VALUE 3.0,
            'brokerCommissionAmount' VALUE 3900,
            'tenantContactPhone'     VALUE '+971555005005',
            'tenantContactEmail'     VALUE 'usman.siddiqui@gmail.com',
            'startDate'              VALUE '2025-03-15',
            'endDate'                VALUE '2026-03-14',
            'paymentFrequency'       VALUE 'MONTHLY',
            'totalAmount'            VALUE 130000,
            'currencyCode'           VALUE 'AED',
            'securityDepositAmount'  VALUE 11000,
            'securityDepositCheque'  VALUE 'CHK-DIB-005001',
            'securityDepositDate'    VALUE '2025-03-03',
            'securityDepositBank'    VALUE 'Dubai Islamic Bank',
            'ejariNumber'            VALUE 'EJARI-2025-DXB-334005',
            'municipalityFees'       VALUE 6500,
            'noticePeriodDays'       VALUE 90,
            'gracePeriodDays'        VALUE 5,
            'renewalOption'          VALUE 'Y',
            'specialConditions'      VALUE 'Canal view unit. Parking Bay B-42. No subletting. Tenant to maintain AC filters monthly.'
        ),
        p_result => v_result
    );
    DBMS_OUTPUT.PUT_LINE('AGR-5 result: ' || v_result);

    -- ─────────────────────────────────────────────────────────
    -- AGR-6: Al Quoz Warehouse — Gulf Logistics, Yearly, 2 years
    -- ─────────────────────────────────────────────────────────
    SELECT PROPERTY_ID INTO v_prop_id FROM RR_RM_PROPERTIES WHERE PROPERTY_NUMBER = 'PROP-001010';
    SELECT CUSTOMER_ID INTO v_cust_id FROM RR_RM_CUSTOMERS  WHERE CUSTOMER_NUMBER = 'CUST-001009';
    SELECT BROKER_ID   INTO v_brkr_id FROM RR_RM_BROKERS    WHERE BROKER_NUMBER   = 'BRK-001001';

    RR_RM_AGREEMENTS_PKG.create_agreement(
        p_json => JSON_OBJECT(
            'agreementType'          VALUE 'RENEWAL',
            'signDate'               VALUE '2024-08-15',
            'validFrom'              VALUE '2024-09-01',
            'validTo'                VALUE '2026-08-31',
            'propertyId'             VALUE v_prop_id,
            'customerId'             VALUE v_cust_id,
            'brokerId'               VALUE v_brkr_id,
            'brokerCommissionPct'    VALUE 2.5,
            'brokerCommissionAmount' VALUE 4500,
            'tenantContactPhone'     VALUE '+971509009009',
            'tenantContactEmail'     VALUE 'warehouse@gulflogistics.ae',
            'startDate'              VALUE '2024-09-01',
            'endDate'                VALUE '2026-08-31',
            'paymentFrequency'       VALUE 'YEARLY',
            'totalAmount'            VALUE 360000,
            'currencyCode'           VALUE 'AED',
            'securityDepositAmount'  VALUE 30000,
            'securityDepositCheque'  VALUE 'CHK-ADIB-006001',
            'securityDepositDate'    VALUE '2024-08-18',
            'securityDepositBank'    VALUE 'Abu Dhabi Islamic Bank',
            'advanceRentAmount'      VALUE 180000,
            'advanceRentMonths'      VALUE 12,
            'ejariNumber'            VALUE 'EJARI-2024-DXB-092006',
            'municipalityFees'       VALUE 9000,
            'noticePeriodDays'       VALUE 120,
            'gracePeriodDays'        VALUE 0,
            'renewalOption'          VALUE 'N',
            'specialConditions'      VALUE '2-year warehouse lease. Tenant may install additional shelving with written approval. Loading dock access 24/7. Tenant responsible for all internal maintenance. External structure maintained by owner.'
        ),
        p_result => v_result
    );
    DBMS_OUTPUT.PUT_LINE('AGR-6 result: ' || v_result);

END;
/

-- ============================================================
-- Update some installments to simulate real payment history
-- (AGR-1 Downtown — mark Jan, Feb, Mar as cleared)
-- ============================================================
DECLARE
    v_result  VARCHAR2(400);
    CURSOR c_inst IS
        SELECT i.INSTALLMENT_ID, i.INSTALLMENT_NUMBER
        FROM   RR_RM_INSTALLMENTS i
        JOIN   RR_RM_AGREEMENTS   a ON a.AGREEMENT_ID = i.AGREEMENT_ID
        WHERE  a.AGREEMENT_NUMBER LIKE 'AGR-2025%'
        AND    i.INSTALLMENT_NUMBER <= 3
        ORDER  BY a.AGREEMENT_ID, i.INSTALLMENT_NUMBER;
    v_inst_num NUMBER := 0;
    v_banks VARCHAR2(100);
    v_cheques VARCHAR2(100);
BEGIN
    FOR rec IN c_inst LOOP
        v_inst_num := v_inst_num + 1;
        v_banks    := CASE MOD(v_inst_num,3) WHEN 0 THEN 'Emirates NBD'
                                              WHEN 1 THEN 'Abu Dhabi Commercial Bank'
                                                     ELSE 'Dubai Islamic Bank' END;
        v_cheques  := 'CHK-' || LPAD(1000000 + rec.INSTALLMENT_ID,8,'0');

        RR_RM_INSTALLMENTS_PKG.update_status(
            p_json => JSON_OBJECT(
                'installmentId'  VALUE rec.INSTALLMENT_ID,
                'status'         VALUE 'CLEARED',
                'chequeNo'       VALUE v_cheques,
                'chequeDate'     VALUE TO_CHAR(SYSDATE - (rec.INSTALLMENT_NUMBER * 30), 'YYYY-MM-DD'),
                'bankName'       VALUE v_banks,
                'presentedDate'  VALUE TO_CHAR(SYSDATE - (rec.INSTALLMENT_NUMBER * 30) + 5, 'YYYY-MM-DD'),
                'clearedDate'    VALUE TO_CHAR(SYSDATE - (rec.INSTALLMENT_NUMBER * 30) + 9, 'YYYY-MM-DD'),
                'receiptNumber'  VALUE 'RCP-' || LPAD(rec.INSTALLMENT_ID, 6, '0'),
                'receiptDate'    VALUE TO_CHAR(SYSDATE - (rec.INSTALLMENT_NUMBER * 30) + 9, 'YYYY-MM-DD'),
                'notes'          VALUE 'Payment cleared — verified by accounts team'
            ),
            p_result => v_result
        );
    END LOOP;
    DBMS_OUTPUT.PUT_LINE('Installment update results: ' || v_inst_num || ' installments marked CLEARED');
END;
/

-- ============================================================
-- Add some property expenses
-- ============================================================
DECLARE
    v_result  VARCHAR2(400);
    v_prop_id NUMBER;
    v_exp_type_id NUMBER;
BEGIN
    SELECT PROPERTY_ID INTO v_prop_id FROM RR_RM_PROPERTIES WHERE PROPERTY_NUMBER = 'PROP-001001';
    SELECT EXPENSE_TYPE_ID INTO v_exp_type_id FROM RR_RM_EXPENSE_TYPES WHERE EXPENSE_TYPE_CODE = 'AC_MAINTENANCE';
    RR_RM_EXPENSES_PKG.create_expense(JSON_OBJECT(
        'propertyId'     VALUE v_prop_id,
        'expenseTypeId'  VALUE v_exp_type_id,
        'expenseDate'    VALUE '2025-01-20',
        'description'    VALUE 'Annual AC servicing — 2 units, Burj Views Tower A Apt 1204',
        'amount'         VALUE 1800,
        'paidBy'         VALUE 'OWNER',
        'paymentMethod'  VALUE 'BANK_TRANSFER',
        'vendorName'     VALUE 'Cool Air Technical Services LLC',
        'vendorContact'  VALUE '+971553001001',
        'receiptNo'      VALUE 'CATS-INV-2025-0112'
    ), v_result);

    SELECT PROPERTY_ID INTO v_prop_id FROM RR_RM_PROPERTIES WHERE PROPERTY_NUMBER = 'PROP-001004';
    SELECT EXPENSE_TYPE_ID INTO v_exp_type_id FROM RR_RM_EXPENSE_TYPES WHERE EXPENSE_TYPE_CODE = 'MUNICIPALITY';
    RR_RM_EXPENSES_PKG.create_expense(JSON_OBJECT(
        'propertyId'     VALUE v_prop_id,
        'expenseTypeId'  VALUE v_exp_type_id,
        'expenseDate'    VALUE '2024-07-05',
        'description'    VALUE 'Dubai Municipality 5% fees — Arabian Ranches Villa FY2024',
        'amount'         VALUE 10000,
        'paidBy'         VALUE 'OWNER',
        'paymentMethod'  VALUE 'ONLINE',
        'vendorName'     VALUE 'Dubai Municipality',
        'receiptNo'      VALUE 'DM-2024-441003-FEE'
    ), v_result);

    SELECT PROPERTY_ID INTO v_prop_id FROM RR_RM_PROPERTIES WHERE PROPERTY_NUMBER = 'PROP-001006';
    SELECT EXPENSE_TYPE_ID INTO v_exp_type_id FROM RR_RM_EXPENSE_TYPES WHERE EXPENSE_TYPE_CODE = 'EJARI_FEE';
    RR_RM_EXPENSES_PKG.create_expense(JSON_OBJECT(
        'propertyId'     VALUE v_prop_id,
        'expenseTypeId'  VALUE v_exp_type_id,
        'expenseDate'    VALUE '2025-03-05',
        'description'    VALUE 'Ejari registration fee — DIFC Office FY2025',
        'amount'         VALUE 220,
        'paidBy'         VALUE 'OWNER',
        'paymentMethod'  VALUE 'ONLINE',
        'vendorName'     VALUE 'Dubai Land Department',
        'receiptNo'      VALUE 'DLD-EJARI-2025-557004'
    ), v_result);

    SELECT PROPERTY_ID INTO v_prop_id FROM RR_RM_PROPERTIES WHERE PROPERTY_NUMBER = 'PROP-001007';
    SELECT EXPENSE_TYPE_ID INTO v_exp_type_id FROM RR_RM_EXPENSE_TYPES WHERE EXPENSE_TYPE_CODE = 'PLUMBING';
    RR_RM_EXPENSES_PKG.create_expense(JSON_OBJECT(
        'propertyId'     VALUE v_prop_id,
        'expenseTypeId'  VALUE v_exp_type_id,
        'expenseDate'    VALUE '2025-02-10',
        'description'    VALUE 'Kitchen sink blockage repair and bathroom sealant replacement',
        'amount'         VALUE 650,
        'paidBy'         VALUE 'OWNER',
        'paymentMethod'  VALUE 'CASH',
        'vendorName'     VALUE 'Quick Fix Plumbing Services',
        'vendorContact'  VALUE '+971554002002',
        'receiptNo'      VALUE 'QFP-RCP-4421'
    ), v_result);

    SELECT PROPERTY_ID INTO v_prop_id FROM RR_RM_PROPERTIES WHERE PROPERTY_NUMBER = 'PROP-001010';
    SELECT EXPENSE_TYPE_ID INTO v_exp_type_id FROM RR_RM_EXPENSE_TYPES WHERE EXPENSE_TYPE_CODE = 'BROKER_FEE';
    RR_RM_EXPENSES_PKG.create_expense(JSON_OBJECT(
        'propertyId'     VALUE v_prop_id,
        'expenseTypeId'  VALUE v_exp_type_id,
        'expenseDate'    VALUE '2024-08-20',
        'description'    VALUE 'Broker commission — Gulf Logistics warehouse renewal (2.5%)',
        'amount'         VALUE 4500,
        'paidBy'         VALUE 'OWNER',
        'paymentMethod'  VALUE 'BANK_TRANSFER',
        'vendorName'     VALUE 'Betterhomes Real Estate LLC',
        'vendorContact'  VALUE '+971501234567',
        'receiptNo'      VALUE 'BH-2024-COMM-0892'
    ), v_result);

    DBMS_OUTPUT.PUT_LINE('Expenses created.');
END;
/

-- ============================================================
-- ACTIVATE 4 of the 6 agreements
-- ============================================================
DECLARE
    v_result VARCHAR2(400);
BEGIN
    FOR r IN (
        SELECT AGREEMENT_ID FROM RR_RM_AGREEMENTS
        WHERE  AGREEMENT_NUMBER IN (
            SELECT AGREEMENT_NUMBER FROM RR_RM_AGREEMENTS
            WHERE  SIGN_DATE < SYSDATE
            ORDER  BY CREATION_DATE
            FETCH  FIRST 4 ROWS ONLY
        )
    ) LOOP
        RR_RM_AGREEMENTS_PKG.activate_agreement(r.AGREEMENT_ID, v_result);
        DBMS_OUTPUT.PUT_LINE('Activated: ' || v_result);
    END LOOP;
END;
/

-- ============================================================
-- VERIFICATION SUMMARY
-- ============================================================
SELECT '=== RENTAL MANAGEMENT SAMPLE DATA SUMMARY ===' AS summary FROM DUAL;

SELECT
    'BROKERS'    AS entity, COUNT(*) AS total, NULL AS active_count
FROM RR_RM_BROKERS WHERE BROKER_NUMBER LIKE 'BRK-0010%'
UNION ALL SELECT 'PROPERTIES',  COUNT(*), SUM(CASE STATUS WHEN 'RENTED' THEN 1 ELSE 0 END)
FROM RR_RM_PROPERTIES WHERE PROPERTY_NUMBER LIKE 'PROP-0010%'
UNION ALL SELECT 'CUSTOMERS',   COUNT(*), SUM(CASE STATUS WHEN 'ACTIVE' THEN 1 ELSE 0 END)
FROM RR_RM_CUSTOMERS  WHERE CUSTOMER_NUMBER LIKE 'CUST-0010%'
UNION ALL SELECT 'AGREEMENTS',  COUNT(*), SUM(CASE STATUS WHEN 'ACTIVE' THEN 1 ELSE 0 END)
FROM RR_RM_AGREEMENTS WHERE CREATION_DATE > SYSDATE - 1
UNION ALL SELECT 'INSTALLMENTS',COUNT(*), SUM(CASE STATUS WHEN 'CLEARED' THEN 1 ELSE 0 END)
FROM RR_RM_INSTALLMENTS WHERE CREATION_DATE > SYSDATE - 1
UNION ALL SELECT 'MONTHLY SPLITS', COUNT(*), SUM(CASE STATUS WHEN 'RECOGNIZED' THEN 1 ELSE 0 END)
FROM RR_RM_MONTHLY_SPLITS WHERE CREATION_DATE > SYSDATE - 1
UNION ALL SELECT 'EXPENSES',    COUNT(*), SUM(CASE STATUS WHEN 'PENDING' THEN 1 ELSE 0 END)
FROM RR_RM_EXPENSES WHERE CREATION_DATE > SYSDATE - 1;
