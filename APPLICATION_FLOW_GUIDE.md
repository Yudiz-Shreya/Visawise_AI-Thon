# Application Flow Guide

## Complete Flow: Upload → Create → Validate → Edit (if needed)

### Step 1: Get Presigned URLs ✅ (Already Done)
**Endpoint:** `POST /api/presigned-url/v1`

You've already completed this step and received presigned URLs.

---

### Step 2: Upload Documents to S3 ✅ (Already Done)
Upload files to S3 using the presigned URLs.

---

### Step 3: Create/Update Application (REQUIRED FIRST)
**Endpoint:** `POST /api/applications/v1`

**Why create first?**
- You MUST create the application first before validating
- The validation endpoint requires an `applicationId` which is returned after creating the application
- Creating the application saves all document references and form data

**Request Payload:**
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "countryId": "69589f26a9c370e5771451ca",
  "visaTypeId": "507f1f77bcf86cd799439012",
  "documents": [
    {
      "sDocumentType": "passport_photo",
      "sS3Key": "visawise/applications/passport_photo/1767417547229_passport-photo.jpg",
      "sS3Url": "https://fastttlink-media.s3.ap-south-1.amazonaws.com/visawise/applications/passport_photo/1767417547229_passport-photo.jpg"
    },
    {
      "sDocumentType": "visa_application_form",
      "sS3Key": "visawise/applications/visa_application_form/1767417547247_visa-application-form.pdf",
      "sS3Url": "https://fastttlink-media.s3.ap-south-1.amazonaws.com/visawise/applications/visa_application_form/1767417547247_visa-application-form.pdf"
    },
    {
      "sDocumentType": "cover_letter",
      "sS3Key": "visawise/applications/cover_letter/1767417547250_cover-letter.pdf",
      "sS3Url": "https://fastttlink-media.s3.ap-south-1.amazonaws.com/visawise/applications/cover_letter/1767417547250_cover-letter.pdf"
    },
    {
      "sDocumentType": "accommodation_proof",
      "sS3Key": "visawise/applications/accommodation_proof/1767417547252_accommodation-proof.pdf",
      "sS3Url": "https://fastttlink-media.s3.ap-south-1.amazonaws.com/visawise/applications/accommodation_proof/1767417547252_accommodation-proof.pdf"
    },
    {
      "sDocumentType": "bank_statements",
      "sS3Key": "visawise/applications/bank_statements/1767417547253_bank-statements-last-6-months.pdf",
      "sS3Url": "https://fastttlink-media.s3.ap-south-1.amazonaws.com/visawise/applications/bank_statements/1767417547253_bank-statements-last-6-months.pdf"
    },
    {
      "sDocumentType": "income_proof",
      "sS3Key": "visawise/applications/income_proof/1767417547255_income-proof.pdf",
      "sS3Url": "https://fastttlink-media.s3.ap-south-1.amazonaws.com/visawise/applications/income_proof/1767417547255_income-proof.pdf"
    },
    {
      "sDocumentType": "itr",
      "sS3Key": "visawise/applications/itr/1767417547256_income-tax-returns-last-2-years.pdf",
      "sS3Url": "https://fastttlink-media.s3.ap-south-1.amazonaws.com/visawise/applications/itr/1767417547256_income-tax-returns-last-2-years.pdf"
    },
    {
      "sDocumentType": "leisure_proof",
      "sS3Key": "visawise/applications/leisure_proof/1767417547258_itinerary.pdf",
      "sS3Url": "https://fastttlink-media.s3.ap-south-1.amazonaws.com/visawise/applications/leisure_proof/1767417547258_itinerary.pdf"
    },
    {
      "sDocumentType": "return_ticket",
      "sS3Key": "visawise/applications/return_ticket/1767417547259_return-ticket.pdf",
      "sS3Url": "https://fastttlink-media.s3.ap-south-1.amazonaws.com/visawise/applications/return_ticket/1767417547259_return-ticket.pdf"
    }
  ],
  "applicationData": {
    "sPassportNumber": "A1234567",
    "dPassportExpiry": "2025-12-31",
    "sEmploymentStatus": "Employed",
    "sTravelDates": "01/12/2024 - 15/12/2024",
    "sCoverLetter": "I am planning to visit Australia for tourism purposes. My travel dates are from December 1, 2024 to December 15, 2024."
  }
}
```

**Response:**
```json
{
  "status": 200,
  "message": "Application saved successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439013",
    "iUserId": "507f1f77bcf86cd799439011",
    "iCountryId": "69589f26a9c370e5771451ca",
    "iVisaTypeId": "507f1f77bcf86cd799439012",
    "aDocuments": [...],
    "oApplicationData": {...},
    "eStatus": "Draft",
    "dCreatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/api/applications/v1 \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "507f1f77bcf86cd799439011",
    "countryId": "69589f26a9c370e5771451ca",
    "visaTypeId": "507f1f77bcf86cd799439012",
    "documents": [
      {
        "sDocumentType": "passport_photo",
        "sS3Key": "visawise/applications/passport_photo/1767417547229_passport-photo.jpg",
        "sS3Url": "https://fastttlink-media.s3.ap-south-1.amazonaws.com/visawise/applications/passport_photo/1767417547229_passport-photo.jpg"
      }
    ],
    "applicationData": {
      "sTravelDates": "01/12/2024 - 15/12/2024"
    }
  }'
```

---

### Step 4: Validate Application (AFTER CREATING)
**Endpoint:** `POST /api/applications/:applicationId/validate/v1`

**Important:** You CANNOT validate without creating the application first because:
- Validation requires `applicationId` which is returned from Step 3
- Validation reads documents from the application record

**Request:**
```
POST /api/applications/507f1f77bcf86cd799439013/validate/v1
```

**Response (Validation Failed):**
```json
{
  "status": 200,
  "data": {
    "bIsValid": false,
    "aMissingDocuments": [
      "passport_number",
      "passport_expiry"
    ],
    "aInvalidDocuments": [
      {
        "sDocumentType": "cover_letter",
        "sReason": "Travel dates mismatch: Application shows '01/12/2024 - 15/12/2024' but cover letter mentions different dates: 10/12/2024, 20/12/2024"
      }
    ],
    "aValidDocuments": [
      "passport_photo",
      "visa_application_form",
      "accommodation_proof"
    ]
  }
}
```

**Response (Validation Success):**
```json
{
  "status": 200,
  "data": {
    "bIsValid": true,
    "aMissingDocuments": [],
    "aInvalidDocuments": [],
    "aValidDocuments": [
      "passport_photo",
      "visa_application_form",
      "cover_letter",
      "accommodation_proof",
      "bank_statements",
      "income_proof",
      "itr",
      "leisure_proof",
      "return_ticket"
    ]
  }
}
```

---

### Step 5: Edit Application (If Validation Failed)
**Endpoint:** `POST /api/applications/v1` (Same as Step 3)

**How it works:**
- If application exists with status "Draft" or "Rejected", it will UPDATE the existing application
- You can update documents, add missing documents, or fix application data
- After editing, call validate again

**Example: Adding missing documents or fixing issues:**
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "countryId": "69589f26a9c370e5771451ca",
  "visaTypeId": "507f1f77bcf86cd799439012",
  "documents": [
    // ... existing documents ...
    // Add new documents or replace invalid ones
  ],
  "applicationData": {
    // Update travel dates to match cover letter
    "sTravelDates": "10/12/2024 - 20/12/2024",
    // ... other fields
  }
}
```

---

## Complete Flow Summary

```
1. Get Presigned URLs → POST /api/presigned-url/v1
   ↓
2. Upload Files to S3 (using presigned URLs)
   ↓
3. Create Application → POST /api/applications/v1
   ↓ (Save applicationId from response)
4. Validate Application → POST /api/applications/{applicationId}/validate/v1
   ↓
5a. If Validated ✅ → Done!
   ↓
5b. If Rejected ❌ → Edit Application → POST /api/applications/v1
   ↓ (Updates existing Draft/Rejected application)
6. Validate Again → POST /api/applications/{applicationId}/validate/v1
   ↓
7. Repeat steps 5-6 until validated
```

---

## Key Points

1. **MUST create application first** - Validation requires `applicationId`
2. **Application status flow:** `Draft` → `Validated` or `Rejected`
3. **Edit functionality:** Call create endpoint again with same userId/countryId/visaTypeId to update Draft/Rejected applications
4. **Validation runs OCR** on all documents and checks:
   - Document keywords match
   - Travel dates match between application and cover letter
   - All required documents are present
5. **After validation fails**, you can edit and validate again

