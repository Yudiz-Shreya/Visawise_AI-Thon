const { createWorker } = require('tesseract.js')
const { s3Client } = require('./s3.service')
const { GetObjectCommand } = require('@aws-sdk/client-s3')
const config = require('../config/config')

const DOCUMENT_PATTERNS = {
  passport_number: {
    keywords: ['passport', 'republic', 'passport number', 'passport no'],
    fields: ['passport_number']
  },
  passport_expiry: {
    keywords: ['passport', 'expiry', 'expiration', 'valid until', 'date of expiry'],
    fields: ['passport_expiry']
  },
  passport_photo: {
    keywords: ['passport', 'photo', 'photograph', 'picture'],
    fields: []
  },
  visa_application_form: {
    keywords: ['visa', 'application', 'form', 'visa application form'],
    fields: []
  },
  cover_letter: {
    keywords: ['cover letter', 'purpose', 'travel', 'visa application', 'letter'],
    fields: ['travel_date', 'departure_date', 'arrival_date', 'visit_date']
  },
  accommodation_proof: {
    keywords: ['hotel', 'booking', 'accommodation', 'reservation', 'check-in', 'check-out', 'lodging'],
    fields: ['hotel_name', 'check_in', 'check_out']
  },
  bank_statements: {
    keywords: ['bank', 'statement', 'account', 'balance', 'transaction', 'banking'],
    fields: ['account_number', 'bank_name', 'balance']
  },
  income_proof: {
    keywords: ['income', 'salary', 'earning', 'pay', 'wage', 'compensation'],
    fields: ['income_amount', 'employer']
  },
  itr: {
    keywords: ['income tax', 'itr', 'assessment', 'pan', 'financial year', 'tax return'],
    fields: ['pan_number', 'assessment_year', 'total_income']
  },
  employment_status: {
    keywords: ['employment', 'employer', 'salary', 'designation', 'company', 'job', 'occupation'],
    fields: ['employer_name', 'designation', 'salary']
  },
  travel_dates: {
    keywords: ['travel', 'date', 'departure', 'arrival', 'journey', 'trip'],
    fields: ['departure_date', 'arrival_date']
  },
  leisure_proof: {
    keywords: ['itinerary', 'travel plan', 'schedule', 'tour', 'sightseeing', 'leisure'],
    fields: []
  },
  return_ticket: {
    keywords: ['ticket', 'flight', 'airline', 'departure', 'arrival', 'return', 'onward'],
    fields: ['airline', 'departure_date', 'arrival_date', 'ticket_number']
  }
}

async function extractTextFromS3(s3Key) {
  try {
    const command = new GetObjectCommand({
      Bucket: config.S3_BUCKET_NAME,
      Key: s3Key
    })

    const s3Object = await s3Client.send(command)
    const chunks = []
    for await (const chunk of s3Object.Body) {
      chunks.push(chunk)
    }
    const fileBuffer = Buffer.concat(chunks)

    const fileExtension = s3Key.split('.').pop().toLowerCase()
    const isImage = ['jpg', 'jpeg', 'png'].includes(fileExtension)
    const isPdf = fileExtension === 'pdf'

    if (isImage) {
      const worker = await createWorker('eng')
      const { data: { text } } = await worker.recognize(fileBuffer)
      await worker.terminate()
      return text
    } else if (isPdf) {
      try {
        const pdfText = fileBuffer.toString('utf-8')
        if (pdfText.length > 100) {
          return pdfText
        }
      } catch (error) {
        console.log('PDF text extraction failed, trying OCR on PDF...')
      }
      const worker = await createWorker('eng')
      const { data: { text } } = await worker.recognize(fileBuffer)
      await worker.terminate()
      return text
    } else {
      return fileBuffer.toString('utf-8')
    }
  } catch (error) {
    console.error('Error extracting text from S3:', error)
    throw error
  }
}

async function validateDocument(documentType, s3Key) {
  try {
    if (process.env.NODE_ENV !== 'production' || config.OCR_PROVIDER === 'TEST') {
      return {
        isValid: true,
        reason: 'Document validated successfully (test mode)',
        extractedData: {}
      }
    }

    const normalizedDocType = documentType.toLowerCase().replace(/\s+/g, '_')
    const pattern = DOCUMENT_PATTERNS[normalizedDocType] || DOCUMENT_PATTERNS[documentType.toLowerCase()]

    if (!pattern) {
      return {
        isValid: true,
        reason: `Document type ${documentType} validation skipped (pattern not defined)`,
        extractedData: {}
      }
    }

    const extractedText = await extractTextFromS3(s3Key)
    const lowerContent = extractedText.toLowerCase()

    const foundKeywords = pattern.keywords.filter(keyword =>
      lowerContent.includes(keyword.toLowerCase())
    )

    if (foundKeywords.length < 2) {
      return {
        isValid: false,
        reason: `Document does not contain required keywords for ${documentType}. Found: ${foundKeywords.length} of ${pattern.keywords.length} required keywords`,
        extractedData: {}
      }
    }

    const extractedData = {
      fullText: extractedText
    }
    pattern.fields.forEach(field => {
      const regex = new RegExp(`${field.replace(/_/g, '\\s*')}[\\s:]*([A-Z0-9\\s,.-]+)`, 'i')
      const match = extractedText.match(regex)
      if (match) {
        extractedData[field] = match[1].trim()
      }
    })

    return {
      isValid: true,
      reason: 'Document validated successfully using OCR',
      extractedData
    }
  } catch (error) {
    console.error('OCR validation error:', error)
    return {
      isValid: false,
      reason: `Error validating document: ${error.message}`,
      extractedData: {}
    }
  }
}

module.exports = {
  validateDocument,
  DOCUMENT_PATTERNS
}
