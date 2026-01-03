# VisaVision API Documentation - Document Upload & OCR Validation

## Complete Flow: Document Upload and OCR Validation

### Step 1: Get Presigned URLs for Document Upload

**Endpoint:** `POST /api/presigned-url/v1`

**Description:** Get presigned URLs from S3 to upload documents directly from frontend.

**Request Body:**
```json
{
  "aDocuments": [
    {
      "sFileName": "passport-photo-1.jpg",
      "sContentType": "image/jpeg",
      "sDocumentType": "passport_photo"
    },
    {
      "sFileName": "passport-photo-2.jpg",
      "sContentType": "image/jpeg",
      "sDocumentType": "passport_photo"
    },
    {
      "sFileName": "visa-application-form.pdf",
      "sContentType": "application/pdf",
      "sDocumentType": "visa_application_form"
    },
    {
      "sFileName": "cover-letter.pdf",
      "sContentType": "application/pdf",
      "sDocumentType": "cover_letter"
    },
    {
      "sFileName": "accommodation-proof.pdf",
      "sContentType": "application/pdf",
      "sDocumentType": "accommodation_proof"
    },
    {
      "sFileName": "bank-statements-last-6-months.pdf",
      "sContentType": "application/pdf",
      "sDocumentType": "bank_statements"
    },
    {
      "sFileName": "income-proof.pdf",
      "sContentType": "application/pdf",
      "sDocumentType": "income_proof"
    },
    {
      "sFileName": "income-tax-returns-last-2-years.pdf",
      "sContentType": "application/pdf",
      "sDocumentType": "itr"
    },
    {
      "sFileName": "itinerary.pdf",
      "sContentType": "application/pdf",
      "sDocumentType": "leisure_proof"
    },
    {
      "sFileName": "return-ticket.pdf",
      "sContentType": "application/pdf",
      "sDocumentType": "return_ticket"
    }
  ]
}
```

**Complete Payload for Tourist Visa Application (All Documents):**

**Response:**
```json
{
  "status": 200,
  "data": [
    {
      "sDocumentType": "passport_photo",
      "sFileName": "passport-photo.jpg",
      "sUrl": "https://s3.amazonaws.com/bucket-name/applications/passport_photo/1234567890_passport-photo.jpg?X-Amz-Algorithm=...",
      "sPath": "applications/passport_photo/1234567890_passport-photo.jpg"
    },
    {
      "sDocumentType": "bank_statements",
      "sFileName": "bank-statement.pdf",
      "sUrl": "https://s3.amazonaws.com/bucket-name/applications/bank_statements/1234567891_bank-statement.pdf?X-Amz-Algorithm=...",
      "sPath": "applications/bank_statements/1234567891_bank-statement.pdf"
    },
    {
      "sDocumentType": "cover_letter",
      "sFileName": "cover-letter.pdf",
      "sUrl": "https://s3.amazonaws.com/bucket-name/applications/cover_letter/1234567892_cover-letter.pdf?X-Amz-Algorithm=...",
      "sPath": "applications/cover_letter/1234567892_cover-letter.pdf"
    }
  ]
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/api/presigned-url/v1 \
  -H "Content-Type: application/json" \
  -d '{
    "aDocuments": [
      {
        "sFileName": "passport-photo.jpg",
        "sContentType": "image/jpeg",
        "sDocumentType": "passport_photo"
      }
    ]
  }'
```

---

### Step 2: Upload Documents to S3 Using Presigned URLs

**Description:** Upload files directly to S3 using the presigned URLs received in Step 1.

**Method:** `PUT` (to the presigned URL)

**Headers:**
```
Content-Type: <sContentType from Step 1>
```

**Body:** File binary data

**JavaScript Example:**
```javascript
async function uploadToS3(presignedUrl, file, contentType) {
  const response = await fetch(presignedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType
    },
    body: file
  })
  
  if (response.ok) {
    console.log('File uploaded successfully')
    return true
  }
  throw new Error('Upload failed')
}

// Usage
const presignedResponse = await fetch('/api/presigned-urls', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    aDocuments: [{
      sFileName: file.name,
      sContentType: file.type,
      sDocumentType: 'passport_photo'
    }]
  })
})

const { data } = await presignedResponse.json()
const { sUrl, sPath, sContentType } = data[0]

await uploadToS3(sUrl, file, sContentType)
// Save sPath for next step
```

**cURL Example:**
```bash
curl -X PUT "https://s3.amazonaws.com/bucket-name/applications/passport_photo/1234567890_passport-photo.jpg?X-Amz-Algorithm=..." \
  -H "Content-Type: image/jpeg" \
  --data-binary @passport-photo.jpg
```

---

### Step 3: Create/Update Application with Document References

**Endpoint:** `POST /api/applications/v1`

**Description:** Save application with uploaded document S3 paths and application data.

**Request Body:**
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "countryId": "69589f26a9c370e5771451ca",
  "visaTypeId": "507f1f77bcf86cd799439012",
  "documents": [
    {
      "sDocumentType": "passport_photo",
      "sS3Key": "applications/passport_photo/1234567890_passport-photo.jpg",
      "sS3Url": "https://s3.amazonaws.com/bucket-name/applications/passport_photo/1234567890_passport-photo.jpg"
    },
    {
      "sDocumentType": "bank_statements",
      "sS3Key": "applications/bank_statements/1234567891_bank-statement.pdf",
      "sS3Url": "https://s3.amazonaws.com/bucket-name/applications/bank_statements/1234567891_bank-statement.pdf"
    },
    {
      "sDocumentType": "cover_letter",
      "sS3Key": "applications/cover_letter/1234567892_cover-letter.pdf",
      "sS3Url": "https://s3.amazonaws.com/bucket-name/applications/cover_letter/1234567892_cover-letter.pdf"
    }
  ],
  "applicationData": {
    "sPassportNumber": "A1234567",
    "dPassportExpiry": "2025-12-31",
    "sEmploymentStatus": "Employed",
    "sTravelDates": "01/12/2024 - 15/12/2024",
    "sCoverLetter": "I am planning to visit Australia for tourism..."
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
        "sS3Key": "applications/passport_photo/1234567890_passport-photo.jpg",
        "sS3Url": "https://s3.amazonaws.com/bucket-name/applications/passport_photo/1234567890_passport-photo.jpg"
      }
    ],
    "applicationData": {
      "sTravelDates": "01/12/2024 - 15/12/2024"
    }
  }'
```

---

### Step 4: Validate Application (OCR Validation)

**Endpoint:** `POST /api/applications/:applicationId/validate/v1`

**Description:** Validates all documents using OCR, checks for missing documents, and validates date consistency between travel dates and cover letter.

**Request:**
```
POST /api/applications/507f1f77bcf86cd799439013/validate/v1
```

**Response:**
```json
{
  "status": 200,
  "data": {
    "bIsValid": false,
    "aMissingDocuments": [
      "passport_number",
      "visa_application_form"
    ],
    "aInvalidDocuments": [
      {
        "sDocumentType": "cover_letter",
        "sReason": "Travel dates mismatch: Application shows '01/12/2024 - 15/12/2024' but cover letter mentions different dates: 10/12/2024, 20/12/2024"
      },
      {
        "sDocumentType": "bank_statements",
        "sReason": "Document does not contain required keywords for bank_statements. Found: 1 of 6 required keywords"
      }
    ],
    "aValidDocuments": [
      "passport_photo",
      "accommodation_proof"
    ]
  }
}
```

**Success Response (All Valid):**
```json
{
  "status": 200,
  "data": {
    "bIsValid": true,
    "aMissingDocuments": [],
    "aInvalidDocuments": [],
    "aValidDocuments": [
      "passport_photo",
      "passport_number",
      "passport_expiry",
      "visa_application_form",
      "cover_letter",
      "accommodation_proof",
      "bank_statements",
      "income_proof",
      "itr",
      "employment_status",
      "travel_dates",
      "leisure_proof",
      "return_ticket"
    ]
  }
}
```

**cURL Example:**
```bash
curl -X POST http://localhost:3000/api/applications/507f1f77bcf86cd799439013/validate/v1
```

---

## Complete Frontend Flow Example

```javascript
// Complete flow from frontend perspective

async function uploadAndValidateDocuments(userId, countryId, visaTypeId, files, applicationData) {
  try {
    // Step 1: Get presigned URLs
    const presignedResponse = await fetch('/api/presigned-url/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        aDocuments: files.map(file => ({
          sFileName: file.name,
          sContentType: file.type,
          sDocumentType: file.documentType
        }))
      })
    })
    
    const { data: presignedData } = await presignedResponse.json()
    
    // Step 2: Upload files to S3
    const uploadedDocuments = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const { sUrl, sPath, sContentType, sDocumentType } = presignedData[i]
      
      // Upload to S3
      await fetch(sUrl, {
        method: 'PUT',
        headers: { 'Content-Type': sContentType },
        body: file
      })
      
      uploadedDocuments.push({
        sDocumentType,
        sS3Key: sPath,
        sS3Url: `${process.env.S3_BUCKET_URL}${sPath}`
      })
    }
    
    // Step 3: Save application
    const applicationResponse = await fetch('/api/applications/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        countryId,
        visaTypeId,
        documents: uploadedDocuments,
        applicationData
      })
    })
    
    const { data: application } = await applicationResponse.json()
    
    // Step 4: Validate application (OCR)
    const validateResponse = await fetch(`/api/applications/${application._id}/validate/v1`, {
      method: 'POST'
    })
    
    const { data: validationResult } = await validateResponse.json()
    
    return {
      application,
      validationResult
    }
  } catch (error) {
    console.error('Error:', error)
    throw error
  }
}

// Usage
const result = await uploadAndValidateDocuments(
  '507f1f77bcf86cd799439011',
  '69589f26a9c370e5771451ca',
  '507f1f77bcf86cd799439012',
  [
    { name: 'passport.jpg', type: 'image/jpeg', documentType: 'passport_photo' },
    { name: 'bank-statement.pdf', type: 'application/pdf', documentType: 'bank_statements' }
  ],
  {
    sTravelDates: '01/12/2024 - 15/12/2024'
  }
)

console.log('Validation Result:', result.validationResult)
```

---

## Document Types Supported

The following document types are supported for OCR validation:

- `passport_number`
- `passport_expiry`
- `passport_photo`
- `visa_application_form`
- `cover_letter`
- `accommodation_proof`
- `bank_statements`
- `income_proof`
- `itr`
- `employment_status`
- `travel_dates`
- `leisure_proof`
- `return_ticket`

---

## OCR Validation Features

1. **Text Extraction**: Uses Tesseract.js to extract text from images (JPG, PNG) and PDFs
2. **Keyword Matching**: Validates documents contain required keywords
3. **Date Validation**: Compares travel dates in application with dates mentioned in cover letter
4. **Field Extraction**: Extracts specific fields like passport numbers, dates, etc.
5. **Error Reporting**: Detailed error messages for invalid documents

---

## Error Responses

### Invalid File Type
```json
{
  "status": 400,
  "message": "Invalid file type for passport-photo.jpg. Allowed: PDF, JPG, PNG, DOC, DOCX"
}
```

### Missing Documents
```json
{
  "status": 200,
  "data": {
    "bIsValid": false,
    "aMissingDocuments": ["passport_number", "bank_statements"]
  }
}
```

### OCR Validation Failed
```json
{
  "status": 200,
  "data": {
    "bIsValid": false,
    "aInvalidDocuments": [
      {
        "sDocumentType": "bank_statements",
        "sReason": "Document does not contain required keywords for bank_statements"
      }
    ]
  }
}
```

