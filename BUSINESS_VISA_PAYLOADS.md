# Business Visa API Payloads

## 1. Get Presigned URLs for Business Visa Documents

**Endpoint:** `POST /api/presigned-url/v1`

**Request Payload:**
```json
{
  "aDocuments": [
    {
      "sFileName": "sponsorship-letter.pdf",
      "sContentType": "application/pdf",
      "sDocumentType": "sponsorship_letter"
    },
    {
      "sFileName": "flight-itinerary.pdf",
      "sContentType": "application/pdf",
      "sDocumentType": "flight_cover_letter"
    },
    {
      "sFileName": "travel-insurance.pdf",
      "sContentType": "application/pdf",
      "sDocumentType": "travel_insurance"
    },
    {
      "sFileName": "invitation-letter.pdf",
      "sContentType": "application/pdf",
      "sDocumentType": "invitation_letter"
    },
    {
      "sFileName": "passport-photo.jpg",
      "sContentType": "image/jpeg",
      "sDocumentType": "passport_photo"
    },
    {
      "sFileName": "visa-application-form.pdf",
      "sContentType": "application/pdf",
      "sDocumentType": "visa_application_form"
    }
  ]
}
```

**Response:**
```json
{
  "status": 200,
  "data": [
    {
      "sDocumentType": "sponsorship_letter",
      "sFileName": "sponsorship-letter.pdf",
      "sUrl": "https://s3.amazonaws.com/bucket-name/applications/sponsorship_letter/1234567890_sponsorship-letter.pdf?X-Amz-Algorithm=...",
      "sPath": "applications/sponsorship_letter/1234567890_sponsorship-letter.pdf",
      "sContentType": "application/pdf"
    },
    {
      "sDocumentType": "flight_cover_letter",
      "sFileName": "flight-itinerary.pdf",
      "sUrl": "https://s3.amazonaws.com/bucket-name/applications/flight_cover_letter/1234567890_flight-itinerary.pdf?X-Amz-Algorithm=...",
      "sPath": "applications/flight_cover_letter/1234567890_flight-itinerary.pdf",
      "sContentType": "application/pdf"
    },
    {
      "sDocumentType": "travel_insurance",
      "sFileName": "travel-insurance.pdf",
      "sUrl": "https://s3.amazonaws.com/bucket-name/applications/travel_insurance/1234567890_travel-insurance.pdf?X-Amz-Algorithm=...",
      "sPath": "applications/travel_insurance/1234567890_travel-insurance.pdf",
      "sContentType": "application/pdf"
    },
    {
      "sDocumentType": "invitation_letter",
      "sFileName": "invitation-letter.pdf",
      "sUrl": "https://s3.amazonaws.com/bucket-name/applications/invitation_letter/1234567890_invitation-letter.pdf?X-Amz-Algorithm=...",
      "sPath": "applications/invitation_letter/1234567890_invitation-letter.pdf",
      "sContentType": "application/pdf"
    },
    {
      "sDocumentType": "passport_photo",
      "sFileName": "passport-photo.jpg",
      "sUrl": "https://s3.amazonaws.com/bucket-name/applications/passport_photo/1234567890_passport-photo.jpg?X-Amz-Algorithm=...",
      "sPath": "applications/passport_photo/1234567890_passport-photo.jpg",
      "sContentType": "image/jpeg"
    },
    {
      "sDocumentType": "visa_application_form",
      "sFileName": "visa-application-form.pdf",
      "sUrl": "https://s3.amazonaws.com/bucket-name/applications/visa_application_form/1234567890_visa-application-form.pdf?X-Amz-Algorithm=...",
      "sPath": "applications/visa_application_form/1234567890_visa-application-form.pdf",
      "sContentType": "application/pdf"
    }
  ]
}
```

---

## 2. Create/Update Business Visa Application

**Endpoint:** `POST /api/applications/v1`

**Request Payload:**
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "countryId": "69589f26a9c370e5771451ca",
  "visaTypeId": "507f1f77bcf86cd799439012",
  "documents": [
    {
      "sDocumentType": "sponsorship_letter",
      "sS3Key": "applications/sponsorship_letter/1234567890_sponsorship-letter.pdf",
      "sS3Url": "https://s3.amazonaws.com/bucket-name/applications/sponsorship_letter/1234567890_sponsorship-letter.pdf"
    },
    {
      "sDocumentType": "flight_cover_letter",
      "sS3Key": "applications/flight_cover_letter/1234567890_flight-itinerary.pdf",
      "sS3Url": "https://s3.amazonaws.com/bucket-name/applications/flight_cover_letter/1234567890_flight-itinerary.pdf"
    },
    {
      "sDocumentType": "travel_insurance",
      "sS3Key": "applications/travel_insurance/1234567890_travel-insurance.pdf",
      "sS3Url": "https://s3.amazonaws.com/bucket-name/applications/travel_insurance/1234567890_travel-insurance.pdf"
    },
    {
      "sDocumentType": "invitation_letter",
      "sS3Key": "applications/invitation_letter/1234567890_invitation-letter.pdf",
      "sS3Url": "https://s3.amazonaws.com/bucket-name/applications/invitation_letter/1234567890_invitation-letter.pdf"
    },
    {
      "sDocumentType": "passport_photo",
      "sS3Key": "applications/passport_photo/1234567890_passport-photo.jpg",
      "sS3Url": "https://s3.amazonaws.com/bucket-name/applications/passport_photo/1234567890_passport-photo.jpg"
    },
    {
      "sDocumentType": "visa_application_form",
      "sS3Key": "applications/visa_application_form/1234567890_visa-application-form.pdf",
      "sS3Url": "https://s3.amazonaws.com/bucket-name/applications/visa_application_form/1234567890_visa-application-form.pdf"
    }
  ],
  "applicationData": {
    "sPassportNumber": "A1234567",
    "dPassportExpiry": "2025-12-31T00:00:00.000Z",
    "sEmploymentStatus": "Employed",
    "sTravelDates": "18/01/2025 - 18/02/2025"
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
    "aDocuments": [
      {
        "sDocumentType": "sponsorship_letter",
        "sS3Key": "applications/sponsorship_letter/1234567890_sponsorship-letter.pdf",
        "sS3Url": "https://s3.amazonaws.com/bucket-name/applications/sponsorship_letter/1234567890_sponsorship-letter.pdf",
        "bIsValidated": false,
        "oValidationResult": {
          "bIsValid": false
        },
        "dUploadedAt": "2025-01-10T10:00:00.000Z"
      }
    ],
    "oApplicationData": {
      "sPassportNumber": "A1234567",
      "dPassportExpiry": "2025-12-31T00:00:00.000Z",
      "sEmploymentStatus": "Employed",
      "sTravelDates": "18/01/2025 - 18/02/2025"
    },
    "eStatus": "Draft",
    "dCreatedAt": "2025-01-10T10:00:00.000Z",
    "dUpdatedAt": "2025-01-10T10:00:00.000Z"
  }
}
```

---

## 3. Validate Business Visa Application

**Endpoint:** `POST /api/applications/:applicationId/validate/v1`

**Request:** No body required, just the applicationId in URL

**Example:** `POST /api/applications/507f1f77bcf86cd799439013/validate/v1`

**Response (Success):**
```json
{
  "status": 200,
  "data": {
    "bIsValid": true,
    "aMissingDocuments": [],
    "aInvalidDocuments": [],
    "aValidDocuments": [
      "sponsorship_letter",
      "flight_cover_letter",
      "travel_insurance",
      "invitation_letter",
      "passport_photo",
      "visa_application_form"
    ]
  }
}
```

**Response (Validation Failed - Name Mismatch):**
```json
{
  "status": 200,
  "data": {
    "bIsValid": false,
    "aMissingDocuments": [],
    "aInvalidDocuments": [
      {
        "sDocumentType": "flight_cover_letter",
        "sReason": "Passenger names in flight itinerary (ALI KHAN) do not match names in sponsorship letter (KIARA SINGH)"
      }
    ],
    "aValidDocuments": [
      "sponsorship_letter",
      "travel_insurance",
      "invitation_letter"
    ]
  }
}
```

**Response (Validation Failed - Date Mismatch):**
```json
{
  "status": 200,
  "data": {
    "bIsValid": false,
    "aMissingDocuments": [],
    "aInvalidDocuments": [
      {
        "sDocumentType": "flight_cover_letter",
        "sReason": "Flight dates do not match travel dates mentioned in sponsorship letter"
      }
    ],
    "aValidDocuments": [
      "sponsorship_letter",
      "travel_insurance",
      "invitation_letter"
    ]
  }
}
```

---

## Required Documents for Business Visa

### Mandatory Documents:
1. **sponsorship_letter** - Company sponsorship letter
2. **flight_cover_letter** - Flight itinerary/ticket
3. **travel_insurance** - Travel insurance policy
4. **invitation_letter** - Invitation letter for business event/meeting

### Optional Documents (Recommended):
5. **passport_photo** - Passport size photograph
6. **visa_application_form** - Completed visa application form

---

## Document Type Reference

| Document Type | Description | Required |
|--------------|-------------|----------|
| `sponsorship_letter` | Company sponsorship letter | ✅ Yes |
| `flight_cover_letter` | Flight itinerary/ticket | ✅ Yes |
| `travel_insurance` | Travel insurance policy | ✅ Yes |
| `invitation_letter` | Invitation letter | ✅ Yes |
| `passport_photo` | Passport size photo | ⚠️ Optional |
| `visa_application_form` | Visa application form | ⚠️ Optional |

---

## Cross-Validation Rules

The system validates:

1. **Name Matching:**
   - Names in flight itinerary must match names in sponsorship letter
   - Names in invitation letter must match names in sponsorship letter
   - All names must match exactly (first name + last name)

2. **Date Matching:**
   - Flight dates must match travel dates in sponsorship letter (within 7 days tolerance)
   - Invitation letter dates must match travel dates in sponsorship letter (within 7 days tolerance)
   - Travel insurance coverage period should cover travel dates

3. **Document Validation:**
   - All documents must be readable (OCR extraction successful)
   - Documents must contain relevant keywords
   - Documents must be properly formatted

---

## Complete Flow Example

```javascript
// Step 1: Get Presigned URLs
const presignedResponse = await fetch('/api/presigned-url/v1', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    aDocuments: [
      { sFileName: 'sponsorship-letter.pdf', sContentType: 'application/pdf', sDocumentType: 'sponsorship_letter' },
      { sFileName: 'flight-itinerary.pdf', sContentType: 'application/pdf', sDocumentType: 'flight_cover_letter' },
      { sFileName: 'travel-insurance.pdf', sContentType: 'application/pdf', sDocumentType: 'travel_insurance' },
      { sFileName: 'invitation-letter.pdf', sContentType: 'application/pdf', sDocumentType: 'invitation_letter' }
    ]
  })
})

const { data: presignedData } = await presignedResponse.json()

// Step 2: Upload files to S3
for (let i = 0; i < files.length; i++) {
  const { sUrl, sContentType } = presignedData[i]
  await fetch(sUrl, {
    method: 'PUT',
    headers: { 'Content-Type': sContentType },
    body: files[i]
  })
}

// Step 3: Create Application
const applicationResponse = await fetch('/api/applications/v1', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: '507f1f77bcf86cd799439011',
    countryId: '69589f26a9c370e5771451ca',
    visaTypeId: '507f1f77bcf86cd799439012',
    documents: presignedData.map(item => ({
      sDocumentType: item.sDocumentType,
      sS3Key: item.sPath,
      sS3Url: `https://s3.amazonaws.com/bucket-name/${item.sPath}`
    })),
    applicationData: {
      sPassportNumber: 'A1234567',
      dPassportExpiry: '2025-12-31T00:00:00.000Z',
      sEmploymentStatus: 'Employed',
      sTravelDates: '18/01/2025 - 18/02/2025'
    }
  })
})

const { data: application } = await applicationResponse.json()
const applicationId = application._id

// Step 4: Validate Application
const validateResponse = await fetch(`/api/applications/${applicationId}/validate/v1`, {
  method: 'POST'
})

const { data: validationResult } = await validateResponse.json()
console.log('Validation Result:', validationResult)
```

