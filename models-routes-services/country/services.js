const { status } = require('../../helpers/api.responses')
const Country = require('./models')
const VisaType = require('./visatype.model')
const Application = require('./application.model')
const { catchError } = require('../../helpers/utilities.services')
const { signedUrl, checkValidFileType } = require('../../helpers/s3.service')
const { validateDocument } = require('../../helpers/ocr.service')

function extractDatesFromText(text) {
  if (!text) return []
  const datePatterns = [
    /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/g,
    /\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{2,4})\b/gi,
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{2,4})\b/gi
  ]

  const dates = []
  datePatterns.forEach(pattern => {
    const matches = text.matchAll(pattern)
    for (const match of matches) {
      dates.push(match[0])
    }
  })
  return dates
}

function parseTravelDates(travelDatesString) {
  if (!travelDatesString) return null

  const dateRangePattern = /(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})\s*[-–—]\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/i
  const match = travelDatesString.match(dateRangePattern)

  if (match) {
    return {
      startDate: match[1],
      endDate: match[2]
    }
  }

  const singleDatePattern = /(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/i
  const singleMatch = travelDatesString.match(singleDatePattern)
  if (singleMatch) {
    return {
      startDate: singleMatch[1],
      endDate: singleMatch[1]
    }
  }

  return null
}

function normalizeDate(dateString) {
  if (!dateString) return null
  return dateString.replace(/[/\-.]/g, '/').toLowerCase()
}

function parseDate(dateString) {
  if (!dateString) return null
  const formats = [
    /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/,
    /(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/
  ]
  for (const format of formats) {
    const match = dateString.match(format)
    if (match) {
      let day, month, year
      if (match[3] && match[3].length === 4) {
        day = parseInt(match[1], 10)
        month = parseInt(match[2], 10)
        year = parseInt(match[3], 10)
      } else {
        day = parseInt(match[1], 10)
        month = parseInt(match[2], 10)
        year = parseInt(match[3], 10)
        if (year < 100) year += 2000
      }
      if (month > 12) {
        [day, month] = [month, day]
      }
      return new Date(year, month - 1, day)
    }
  }
  return null
}

function validatePassportExpiry(application) {
  const passportExpiry = application.oApplicationData?.dPassportExpiry
  const travelDates = application.oApplicationData?.sTravelDates

  if (!passportExpiry || !travelDates) {
    return { bIsValid: true, sReason: '' }
  }

  const parsedTravelDates = parseTravelDates(travelDates)
  if (!parsedTravelDates) {
    return { bIsValid: true, sReason: '' }
  }

  const expiryDate = passportExpiry instanceof Date ? passportExpiry : new Date(passportExpiry)
  const travelStartDate = parseDate(parsedTravelDates.startDate)
  const travelEndDate = parseDate(parsedTravelDates.endDate)

  if (!travelStartDate || !travelEndDate) {
    return { bIsValid: true, sReason: '' }
  }

  if (travelStartDate > expiryDate || travelEndDate > expiryDate) {
    return {
      bIsValid: false,
      sReason: `Travel dates (${travelDates}) must be before passport expiry date (${expiryDate.toLocaleDateString()})`
    }
  }

  return { bIsValid: true, sReason: 'Passport expiry date is valid' }
}

async function validateVisaApplicationForm(documents) {
  const visaFormDoc = documents.find(
    doc => doc.sDocumentType?.toLowerCase().replace(/\s+/g, '_') === 'visa_application_form'
  )

  if (!visaFormDoc || !visaFormDoc.sS3Key) {
    return { bIsValid: true, sReason: 'Visa application form not found or not uploaded' }
  }

  if (!visaFormDoc.oValidationResult?.bIsValid) {
    return { bIsValid: false, sReason: 'Visa application form validation failed. Please upload a valid form.' }
  }

  const extractedData = visaFormDoc.oValidationResult?.oExtractedData || {}
  const formText = extractedData.fullText || ''

  if (!formText || formText.trim().length === 0) {
    return { bIsValid: false, sReason: 'Could not extract text from visa application form. Please ensure the form is clear and readable.' }
  }

  const requiredFields = [
    'name', 'first name', 'last name', 'full name',
    'passport', 'passport number', 'passport no',
    'date of birth', 'dob', 'birth date',
    'nationality', 'country',
    'address', 'residence',
    'purpose', 'purpose of visit', 'reason for visit'
  ]

  const lowerText = formText.toLowerCase()
  const foundFields = requiredFields.filter(field => lowerText.includes(field))

  if (foundFields.length < 3) {
    return {
      bIsValid: false,
      sReason: `Visa application form appears incomplete. Found only ${foundFields.length} of ${requiredFields.length} required fields. Please ensure all fields are filled properly.`
    }
  }

  const emptyFieldPatterns = [
    /name\s*:?\s*$/i,
    /passport\s*(number|no)?\s*:?\s*$/i,
    /date\s*of\s*birth\s*:?\s*$/i,
    /address\s*:?\s*$/i
  ]

  const hasEmptyFields = emptyFieldPatterns.some(pattern => {
    const match = formText.match(pattern)
    return match && match.index !== undefined
  })

  if (hasEmptyFields) {
    return {
      bIsValid: false,
      sReason: 'Visa application form has empty required fields. Please fill all mandatory fields before submitting.'
    }
  }

  return { bIsValid: true, sReason: 'Visa application form is properly filled' }
}

async function validateTravelDates(application, documents) {
  const travelDates = application.oApplicationData?.sTravelDates
  if (!travelDates) {
    return { bIsValid: true, sReason: '' }
  }

  const parsedTravelDates = parseTravelDates(travelDates)
  if (!parsedTravelDates) {
    return { bIsValid: true, sReason: 'Could not parse travel dates format' }
  }

  const coverLetterDoc = documents.find(
    doc => doc.sDocumentType?.toLowerCase().replace(/\s+/g, '_') === 'cover_letter'
  )

  if (!coverLetterDoc || !coverLetterDoc.sS3Key) {
    return { bIsValid: true, sReason: 'Cover letter not found or not uploaded' }
  }

  if (!coverLetterDoc.oValidationResult?.bIsValid) {
    return { bIsValid: false, sReason: 'Cover letter validation failed. Please upload a valid cover letter.' }
  }

  const extractedData = coverLetterDoc.oValidationResult?.oExtractedData || {}
  const coverLetterText = extractedData.fullText || ''

  if (!coverLetterText || coverLetterText.trim().length === 0) {
    return { bIsValid: false, sReason: 'Could not extract text from cover letter. Please ensure the document is clear and readable.' }
  }

  const extractedDates = extractDatesFromText(coverLetterText)
  if (extractedDates.length === 0) {
    return { bIsValid: false, sReason: 'No dates found in cover letter. Travel dates must be mentioned in the cover letter.' }
  }

  const normalizedTravelStart = normalizeDate(parsedTravelDates.startDate)
  const normalizedTravelEnd = normalizeDate(parsedTravelDates.endDate)
  const normalizedCoverDates = extractedDates.map(normalizeDate)

  const hasMatchingDate = normalizedCoverDates.some(coverDate => {
    if (!coverDate) return false
    return coverDate.includes(normalizedTravelStart) ||
      coverDate.includes(normalizedTravelEnd) ||
      normalizedTravelStart.includes(coverDate) ||
      normalizedTravelEnd.includes(coverDate)
  })

  if (!hasMatchingDate) {
    return {
      bIsValid: false,
      sReason: `Travel dates mismatch: Application shows "${travelDates}" but cover letter mentions different dates: ${extractedDates.join(', ')}`
    }
  }

  return { bIsValid: true, sReason: 'Travel dates match with cover letter' }
}

function extractPassportNumber(text) {
  if (!text) return null
  const patterns = [
    /passport\s*(number|no|#)?\s*:?\s*([A-Z0-9]{6,12})/i,
    /passport\s*:?\s*([A-Z0-9]{6,12})/i,
    /([A-Z]{1,2}\d{6,9})/i
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      return match[2] || match[1]
    }
  }
  return null
}

function extractDatesFromDocument(text) {
  if (!text) return []
  const dates = extractDatesFromText(text)
  return dates.map(date => parseDate(date)).filter(date => date !== null)
}

async function validateReturnTicket(application, documents) {
  const travelDates = application.oApplicationData?.sTravelDates
  if (!travelDates) {
    return { bIsValid: true, sReason: '' }
  }

  const returnTicketDoc = documents.find(
    doc => doc.sDocumentType?.toLowerCase().replace(/\s+/g, '_') === 'return_ticket'
  )

  if (!returnTicketDoc || !returnTicketDoc.sS3Key) {
    return { bIsValid: true, sReason: 'Return ticket not found or not uploaded' }
  }

  if (!returnTicketDoc.oValidationResult?.bIsValid) {
    return { bIsValid: false, sReason: 'Return ticket validation failed. Please upload a valid return ticket.' }
  }

  const extractedData = returnTicketDoc.oValidationResult?.oExtractedData || {}
  const ticketText = extractedData.fullText || ''

  if (!ticketText || ticketText.trim().length === 0) {
    return { bIsValid: false, sReason: 'Could not extract text from return ticket. Please ensure the document is clear and readable.' }
  }

  const parsedTravelDates = parseTravelDates(travelDates)
  if (!parsedTravelDates) {
    return { bIsValid: true, sReason: '' }
  }

  const ticketDates = extractDatesFromDocument(ticketText)
  const travelStartDate = parseDate(parsedTravelDates.startDate)
  const travelEndDate = parseDate(parsedTravelDates.endDate)

  if (ticketDates.length === 0) {
    return { bIsValid: false, sReason: 'No dates found in return ticket. Please ensure travel dates are clearly visible.' }
  }

  const hasMatchingDate = ticketDates.some(ticketDate => {
    if (!travelStartDate || !travelEndDate) return false
    const daysDiff = Math.abs((ticketDate - travelEndDate) / (1000 * 60 * 60 * 24))
    return daysDiff <= 7
  })

  if (!hasMatchingDate) {
    return {
      bIsValid: false,
      sReason: `Return ticket dates do not match travel dates (${travelDates}). Return ticket should be within 7 days of travel end date.`
    }
  }

  return { bIsValid: true, sReason: 'Return ticket dates match travel dates' }
}

async function validateAccommodationProof(application, documents) {
  const travelDates = application.oApplicationData?.sTravelDates
  if (!travelDates) {
    return { bIsValid: true, sReason: '' }
  }

  const accommodationDoc = documents.find(
    doc => doc.sDocumentType?.toLowerCase().replace(/\s+/g, '_') === 'accommodation_proof'
  )

  if (!accommodationDoc || !accommodationDoc.sS3Key) {
    return { bIsValid: true, sReason: 'Accommodation proof not found or not uploaded' }
  }

  if (!accommodationDoc.oValidationResult?.bIsValid) {
    return { bIsValid: false, sReason: 'Accommodation proof validation failed. Please upload a valid accommodation proof.' }
  }

  const extractedData = accommodationDoc.oValidationResult?.oExtractedData || {}
  const accommodationText = extractedData.fullText || ''

  if (!accommodationText || accommodationText.trim().length === 0) {
    return { bIsValid: false, sReason: 'Could not extract text from accommodation proof. Please ensure the document is clear and readable.' }
  }

  const parsedTravelDates = parseTravelDates(travelDates)
  if (!parsedTravelDates) {
    return { bIsValid: true, sReason: '' }
  }

  const accommodationDates = extractDatesFromDocument(accommodationText)
  const travelStartDate = parseDate(parsedTravelDates.startDate)
  const travelEndDate = parseDate(parsedTravelDates.endDate)

  if (accommodationDates.length === 0) {
    return { bIsValid: false, sReason: 'No dates found in accommodation proof. Please ensure check-in and check-out dates are clearly visible.' }
  }

  const hasOverlappingDates = accommodationDates.some(accDate => {
    if (!travelStartDate || !travelEndDate) return false
    return accDate >= travelStartDate && accDate <= travelEndDate
  })

  if (!hasOverlappingDates) {
    return {
      bIsValid: false,
      sReason: `Accommodation dates do not match travel dates (${travelDates}). Accommodation should cover your travel period.`
    }
  }

  return { bIsValid: true, sReason: 'Accommodation dates match travel dates' }
}

async function validatePassportNumberConsistency(application, documents) {
  const appPassportNumber = application.oApplicationData?.sPassportNumber
  if (!appPassportNumber) {
    return { bIsValid: true, sReason: '' }
  }

  const normalizedAppPassport = appPassportNumber.trim().toUpperCase()

  const documentsToCheck = [
    'visa_application_form',
    'passport_photo',
    'passport_number'
  ]

  const mismatches = []

  for (const docType of documentsToCheck) {
    const doc = documents.find(
      d => d.sDocumentType?.toLowerCase().replace(/\s+/g, '_') === docType
    )

    if (!doc || !doc.sS3Key || !doc.oValidationResult?.bIsValid) {
      continue
    }

    const extractedData = doc.oValidationResult?.oExtractedData || {}
    const docText = extractedData.fullText || ''

    if (!docText) continue

    const extractedPassport = extractPassportNumber(docText)
    if (extractedPassport) {
      const normalizedExtracted = extractedPassport.trim().toUpperCase()
      if (normalizedExtracted !== normalizedAppPassport) {
        mismatches.push({
          documentType: docType,
          found: extractedPassport,
          expected: appPassportNumber
        })
      }
    }
  }

  if (mismatches.length > 0) {
    const mismatchDetails = mismatches.map(m => `${m.documentType}: found "${m.found}" but expected "${m.expected}"`).join(', ')
    return {
      bIsValid: false,
      sReason: `Passport number mismatch across documents. ${mismatchDetails}`
    }
  }

  return { bIsValid: true, sReason: 'Passport number is consistent across all documents' }
}

async function validateBankStatements(documents) {
  const bankStatementsDoc = documents.find(
    doc => doc.sDocumentType?.toLowerCase().replace(/\s+/g, '_') === 'bank_statements'
  )

  if (!bankStatementsDoc || !bankStatementsDoc.sS3Key) {
    return { bIsValid: true, sReason: 'Bank statements not found or not uploaded' }
  }

  if (!bankStatementsDoc.oValidationResult?.bIsValid) {
    return { bIsValid: false, sReason: 'Bank statements validation failed. Please upload valid bank statements.' }
  }

  const extractedData = bankStatementsDoc.oValidationResult?.oExtractedData || {}
  const statementsText = extractedData.fullText || ''

  if (!statementsText || statementsText.trim().length === 0) {
    return { bIsValid: false, sReason: 'Could not extract text from bank statements. Please ensure the document is clear and readable.' }
  }

  const statementDates = extractDatesFromDocument(statementsText)
  const now = new Date()
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate())

  if (statementDates.length === 0) {
    return { bIsValid: false, sReason: 'No dates found in bank statements. Please ensure statements are from the last 6 months.' }
  }

  const recentDates = statementDates.filter(date => date >= sixMonthsAgo)

  if (recentDates.length === 0) {
    return {
      bIsValid: false,
      sReason: 'Bank statements are not recent. Please provide bank statements from the last 6 months.'
    }
  }

  return { bIsValid: true, sReason: 'Bank statements are recent and valid' }
}

async function validateITR(documents) {
  const itrDoc = documents.find(
    doc => doc.sDocumentType?.toLowerCase().replace(/\s+/g, '_') === 'itr'
  )

  if (!itrDoc || !itrDoc.sS3Key) {
    return { bIsValid: true, sReason: 'ITR not found or not uploaded' }
  }

  if (!itrDoc.oValidationResult?.bIsValid) {
    return { bIsValid: false, sReason: 'ITR validation failed. Please upload valid ITR documents.' }
  }

  const extractedData = itrDoc.oValidationResult?.oExtractedData || {}
  const itrText = extractedData.fullText || ''

  if (!itrText || itrText.trim().length === 0) {
    return { bIsValid: false, sReason: 'Could not extract text from ITR. Please ensure the document is clear and readable.' }
  }

  const itrDates = extractDatesFromDocument(itrText)
  const now = new Date()
  const threeYearsAgo = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate())

  if (itrDates.length === 0) {
    return { bIsValid: false, sReason: 'No dates found in ITR. Please ensure ITR documents are from the last 3 years.' }
  }

  const recentDates = itrDates.filter(date => date >= threeYearsAgo)

  if (recentDates.length === 0) {
    return {
      bIsValid: false,
      sReason: 'ITR documents are not recent. Please provide ITR from the last 3 years.'
    }
  }

  return { bIsValid: true, sReason: 'ITR documents are recent and valid' }
}

async function validateIncomeProof(application, documents) {
  const employmentStatus = application.oApplicationData?.sEmploymentStatus
  if (!employmentStatus) {
    return { bIsValid: true, sReason: '' }
  }

  const incomeProofDoc = documents.find(
    doc => doc.sDocumentType?.toLowerCase().replace(/\s+/g, '_') === 'income_proof'
  )

  if (!incomeProofDoc || !incomeProofDoc.sS3Key) {
    return { bIsValid: true, sReason: 'Income proof not found or not uploaded' }
  }

  if (!incomeProofDoc.oValidationResult?.bIsValid) {
    return { bIsValid: false, sReason: 'Income proof validation failed. Please upload valid income proof.' }
  }

  const extractedData = incomeProofDoc.oValidationResult?.oExtractedData || {}
  const incomeText = extractedData.fullText || ''

  if (!incomeText || incomeText.trim().length === 0) {
    return { bIsValid: false, sReason: 'Could not extract text from income proof. Please ensure the document is clear and readable.' }
  }

  const lowerEmploymentStatus = employmentStatus.toLowerCase()
  const lowerIncomeText = incomeText.toLowerCase()

  const employmentKeywords = {
    employed: ['salary', 'employment', 'employer', 'job', 'work', 'company'],
    'self-employed': ['business', 'self-employed', 'proprietor', 'entrepreneur', 'freelance'],
    student: ['student', 'education', 'university', 'college', 'scholarship'],
    retired: ['retired', 'pension', 'retirement']
  }

  const relevantKeywords = employmentKeywords[lowerEmploymentStatus] || []
  const hasMatchingKeywords = relevantKeywords.some(keyword => lowerIncomeText.includes(keyword))

  if (relevantKeywords.length > 0 && !hasMatchingKeywords) {
    return {
      bIsValid: false,
      sReason: `Income proof does not match employment status "${employmentStatus}". Please provide income proof that matches your employment status.`
    }
  }

  return { bIsValid: true, sReason: 'Income proof matches employment status' }
}

async function validateLeisureProof(application, documents) {
  const travelDates = application.oApplicationData?.sTravelDates
  if (!travelDates) {
    return { bIsValid: true, sReason: '' }
  }

  const leisureDoc = documents.find(
    doc => doc.sDocumentType?.toLowerCase().replace(/\s+/g, '_') === 'leisure_proof'
  )

  if (!leisureDoc || !leisureDoc.sS3Key) {
    return { bIsValid: true, sReason: 'Leisure proof/itinerary not found or not uploaded' }
  }

  if (!leisureDoc.oValidationResult?.bIsValid) {
    return { bIsValid: false, sReason: 'Leisure proof validation failed. Please upload a valid itinerary.' }
  }

  const extractedData = leisureDoc.oValidationResult?.oExtractedData || {}
  const leisureText = extractedData.fullText || ''

  if (!leisureText || leisureText.trim().length === 0) {
    return { bIsValid: false, sReason: 'Could not extract text from leisure proof. Please ensure the document is clear and readable.' }
  }

  const parsedTravelDates = parseTravelDates(travelDates)
  if (!parsedTravelDates) {
    return { bIsValid: true, sReason: '' }
  }

  const leisureDates = extractDatesFromDocument(leisureText)
  const travelStartDate = parseDate(parsedTravelDates.startDate)
  const travelEndDate = parseDate(parsedTravelDates.endDate)

  if (leisureDates.length === 0) {
    return { bIsValid: false, sReason: 'No dates found in leisure proof/itinerary. Please ensure travel dates are clearly visible.' }
  }

  const hasMatchingDate = leisureDates.some(leisureDate => {
    if (!travelStartDate || !travelEndDate) return false
    return leisureDate >= travelStartDate && leisureDate <= travelEndDate
  })

  if (!hasMatchingDate) {
    return {
      bIsValid: false,
      sReason: `Leisure proof/itinerary dates do not match travel dates (${travelDates}). Itinerary should cover your travel period.`
    }
  }

  return { bIsValid: true, sReason: 'Leisure proof dates match travel dates' }
}

class CountryService {
  async getCountries(req, res) {
    try {
      const countries = await Country.find({ eStatus: 'Y' })
        .select('sName sCode')
        .sort({ sName: 1 })
        .lean()

      return res.status(status.OK).json({
        status: status.OK,
        data: countries
      })
    } catch (error) {
      return catchError('CountryService.getCountries', error, req, res)
    }
  }

  async getVisaTypes(req, res) {
    try {
      const { countryId } = req.params

      if (!countryId) {
        return res.status(status.BadRequest).json({
          status: status.BadRequest,
          message: 'Country ID is required'
        })
      }

      const visaTypes = await VisaType.find({
        iCountryId: countryId,
        eStatus: 'Y'
      })
        .select('sType sDuration sProcessingTime nDocumentsRequired nFee sCurrency')
        .sort({ sType: 1 })
        .lean()

      return res.status(status.OK).json({
        status: status.OK,
        data: visaTypes
      })
    } catch (error) {
      return catchError('CountryService.getVisaTypes', error, req, res)
    }
  }

  async getRequiredDocuments(req, res) {
    try {
      const { visaTypeId } = req.params

      if (!visaTypeId) {
        return res.status(status.BadRequest).json({
          status: status.BadRequest,
          message: 'Visa Type ID is required'
        })
      }

      const visaType = await VisaType.findById(visaTypeId)
        .select('sType aRequiredDocuments nDocumentsRequired')
        .lean()

      if (!visaType) {
        return res.status(status.NotFound).json({
          status: status.NotFound,
          message: 'Visa type not found'
        })
      }

      return res.status(status.OK).json({
        status: status.OK,
        data: {
          visaType: visaType.sType,
          documentsRequired: visaType.nDocumentsRequired,
          requiredDocuments: visaType.aRequiredDocuments
        }
      })
    } catch (error) {
      return catchError('CountryService.getRequiredDocuments', error, req, res)
    }
  }

  async getPresignedUrls(req, res) {
    try {
      const { aDocuments } = req.body

      if (!aDocuments || !Array.isArray(aDocuments) || aDocuments.length === 0) {
        return res.status(status.BadRequest).json({
          status: status.BadRequest,
          message: 'Documents array is required'
        })
      }

      const data = []
      for (const document of aDocuments) {
        const { sFileName, sContentType, sDocumentType } = document

        if (!sFileName || !sContentType || !sDocumentType) {
          return res.status(status.BadRequest).json({
            status: status.BadRequest,
            message: 'FileName, ContentType, and DocumentType are required for each document'
          })
        }

        const valid = checkValidFileType(sFileName, sContentType)
        if (!valid) {
          return res.status(status.BadRequest).json({
            status: status.BadRequest,
            message: `Invalid file type for ${sFileName}. Allowed: PDF, JPG, PNG, DOC, DOCX`
          })
        }

        const path = `applications/${sDocumentType}/`
        const response = await signedUrl(sFileName, sContentType, path)
        data.push({
          sDocumentType,
          sFileName,
          ...response
        })
      }

      return res.status(status.OK).json({
        status: status.OK,
        data
      })
    } catch (error) {
      return catchError('CountryService.getPresignedUrls', error, req, res)
    }
  }

  async createOrUpdateApplication(req, res) {
    try {
      const { userId, countryId, visaTypeId, documents, applicationData } = req.body

      if (!userId || !countryId || !visaTypeId) {
        return res.status(status.BadRequest).json({
          status: status.BadRequest,
          message: 'UserId, CountryId, and VisaTypeId are required'
        })
      }

      const visaType = await VisaType.findById(visaTypeId).lean()
      if (!visaType) {
        return res.status(status.NotFound).json({
          status: status.NotFound,
          message: 'Visa type not found'
        })
      }

      let application = await Application.findOne({
        iUserId: userId,
        iCountryId: countryId,
        iVisaTypeId: visaTypeId,
        eStatus: 'Draft'
      })

      const documentArray = documents || []

      if (application) {
        application.aDocuments = documentArray
        if (applicationData) {
          application.oApplicationData = applicationData
        }
        await application.save()
      } else {
        application = await Application.create({
          iUserId: userId,
          iCountryId: countryId,
          iVisaTypeId: visaTypeId,
          aDocuments: documentArray,
          oApplicationData: applicationData || {}
        })
      }

      return res.status(status.OK).json({
        status: status.OK,
        message: 'Application saved successfully',
        data: application
      })
    } catch (error) {
      return catchError('CountryService.createOrUpdateApplication', error, req, res)
    }
  }

  async validateApplication(req, res) {
    try {
      const { applicationId } = req.params

      if (!applicationId) {
        return res.status(status.BadRequest).json({
          status: status.BadRequest,
          message: 'Application ID is required'
        })
      }

      const application = await Application.findById(applicationId)
        .populate('iVisaTypeId', 'aRequiredDocuments nDocumentsRequired')

      if (!application) {
        return res.status(status.NotFound).json({
          status: status.NotFound,
          message: 'Application not found'
        })
      }

      const visaType = application.iVisaTypeId
      const requiredDocs = visaType.aRequiredDocuments.map(doc => doc.sName.toLowerCase().replace(/\s+/g, '_'))
      const uploadedDocs = application.aDocuments.map(doc => doc.sDocumentType.toLowerCase().replace(/\s+/g, '_'))

      const formFields = ['passport_number', 'passport_expiry', 'employment_status', 'travel_dates']
      const documentFields = requiredDocs.filter(doc => !formFields.includes(doc))

      const missingDocuments = documentFields.filter(
        doc => !uploadedDocs.includes(doc)
      )

      const missingFormFields = []
      const appData = application.oApplicationData || {}
      if (requiredDocs.includes('passport_number') && !appData.sPassportNumber) {
        missingFormFields.push('passport_number')
      }
      if (requiredDocs.includes('passport_expiry') && !appData.dPassportExpiry) {
        missingFormFields.push('passport_expiry')
      }
      if (requiredDocs.includes('employment_status') && !appData.sEmploymentStatus) {
        missingFormFields.push('employment_status')
      }
      if (requiredDocs.includes('travel_dates') && !appData.sTravelDates) {
        missingFormFields.push('travel_dates')
      }

      const validationResults = {
        bIsValid: true,
        aMissingDocuments: [],
        aInvalidDocuments: [],
        aValidDocuments: []
      }

      const updatedDocuments = []

      for (const document of application.aDocuments) {
        const docCopy = { ...document.toObject ? document.toObject() : document }

        if (!docCopy.sS3Key) {
          validationResults.aInvalidDocuments.push({
            sDocumentType: docCopy.sDocumentType,
            sReason: 'Document not uploaded'
          })
          validationResults.bIsValid = false
          docCopy.bIsValidated = false
          docCopy.oValidationResult = {
            bIsValid: false,
            sReason: 'Document not uploaded',
            oExtractedData: {}
          }
          updatedDocuments.push(docCopy)
          continue
        }

        const ocrResult = await validateDocument(docCopy.sDocumentType, docCopy.sS3Key)

        if (ocrResult.isValid) {
          if (!validationResults.aValidDocuments.includes(docCopy.sDocumentType)) {
            validationResults.aValidDocuments.push(docCopy.sDocumentType)
          }
          docCopy.bIsValidated = true
          docCopy.oValidationResult = {
            bIsValid: true,
            sReason: ocrResult.reason,
            oExtractedData: ocrResult.extractedData
          }
        } else {
          const existingInvalidIndex = validationResults.aInvalidDocuments.findIndex(
            doc => doc.sDocumentType === docCopy.sDocumentType
          )
          if (existingInvalidIndex < 0) {
            validationResults.aInvalidDocuments.push({
              sDocumentType: docCopy.sDocumentType,
              sReason: ocrResult.reason
            })
          }
          const validIndex = validationResults.aValidDocuments.indexOf(docCopy.sDocumentType)
          if (validIndex >= 0) {
            validationResults.aValidDocuments.splice(validIndex, 1)
          }
          validationResults.bIsValid = false
          docCopy.bIsValidated = false
          docCopy.oValidationResult = {
            bIsValid: false,
            sReason: ocrResult.reason,
            oExtractedData: ocrResult.extractedData
          }
        }
        updatedDocuments.push(docCopy)
      }

      const allMissing = [...missingDocuments, ...missingFormFields]
      if (allMissing.length > 0) {
        validationResults.aMissingDocuments = allMissing
        validationResults.bIsValid = false
      }

      const passportExpiryResult = validatePassportExpiry(application)
      if (!passportExpiryResult.bIsValid) {
        validationResults.bIsValid = false
        const existingInvalidIndex = validationResults.aInvalidDocuments.findIndex(
          doc => doc.sDocumentType === 'passport_expiry'
        )
        if (existingInvalidIndex >= 0) {
          validationResults.aInvalidDocuments[existingInvalidIndex].sReason = passportExpiryResult.sReason
        } else {
          validationResults.aInvalidDocuments.push({
            sDocumentType: 'passport_expiry',
            sReason: passportExpiryResult.sReason
          })
        }
        if (validationResults.aMissingDocuments.includes('passport_expiry')) {
          validationResults.aMissingDocuments = validationResults.aMissingDocuments.filter(
            doc => doc !== 'passport_expiry'
          )
        }
      }

      const visaFormResult = await validateVisaApplicationForm(updatedDocuments)
      if (!visaFormResult.bIsValid) {
        validationResults.bIsValid = false
        const existingInvalidIndex = validationResults.aInvalidDocuments.findIndex(
          doc => doc.sDocumentType === 'visa_application_form'
        )
        if (existingInvalidIndex >= 0) {
          validationResults.aInvalidDocuments[existingInvalidIndex].sReason = visaFormResult.sReason
        } else {
          const validIndex = validationResults.aValidDocuments.indexOf('visa_application_form')
          if (validIndex >= 0) {
            validationResults.aValidDocuments.splice(validIndex, 1)
          }
          validationResults.aInvalidDocuments.push({
            sDocumentType: 'visa_application_form',
            sReason: visaFormResult.sReason
          })
        }
      }

      const dateMismatchResult = await validateTravelDates(application, updatedDocuments)
      if (!dateMismatchResult.bIsValid) {
        validationResults.bIsValid = false
        const existingInvalidIndex = validationResults.aInvalidDocuments.findIndex(
          doc => doc.sDocumentType === 'cover_letter'
        )
        if (existingInvalidIndex >= 0) {
          validationResults.aInvalidDocuments[existingInvalidIndex].sReason = dateMismatchResult.sReason
        } else {
          const validIndex = validationResults.aValidDocuments.indexOf('cover_letter')
          if (validIndex >= 0) {
            validationResults.aValidDocuments.splice(validIndex, 1)
          }
          validationResults.aInvalidDocuments.push({
            sDocumentType: 'cover_letter',
            sReason: dateMismatchResult.sReason
          })
        }
      }

      const returnTicketResult = await validateReturnTicket(application, updatedDocuments)
      if (!returnTicketResult.bIsValid) {
        validationResults.bIsValid = false
        const existingInvalidIndex = validationResults.aInvalidDocuments.findIndex(
          doc => doc.sDocumentType === 'return_ticket'
        )
        if (existingInvalidIndex >= 0) {
          validationResults.aInvalidDocuments[existingInvalidIndex].sReason = returnTicketResult.sReason
        } else {
          const validIndex = validationResults.aValidDocuments.indexOf('return_ticket')
          if (validIndex >= 0) {
            validationResults.aValidDocuments.splice(validIndex, 1)
          }
          validationResults.aInvalidDocuments.push({
            sDocumentType: 'return_ticket',
            sReason: returnTicketResult.sReason
          })
        }
      }

      const accommodationResult = await validateAccommodationProof(application, updatedDocuments)
      if (!accommodationResult.bIsValid) {
        validationResults.bIsValid = false
        const existingInvalidIndex = validationResults.aInvalidDocuments.findIndex(
          doc => doc.sDocumentType === 'accommodation_proof'
        )
        if (existingInvalidIndex >= 0) {
          validationResults.aInvalidDocuments[existingInvalidIndex].sReason = accommodationResult.sReason
        } else {
          const validIndex = validationResults.aValidDocuments.indexOf('accommodation_proof')
          if (validIndex >= 0) {
            validationResults.aValidDocuments.splice(validIndex, 1)
          }
          validationResults.aInvalidDocuments.push({
            sDocumentType: 'accommodation_proof',
            sReason: accommodationResult.sReason
          })
        }
      }

      const passportNumberResult = await validatePassportNumberConsistency(application, updatedDocuments)
      if (!passportNumberResult.bIsValid) {
        validationResults.bIsValid = false
        validationResults.aInvalidDocuments.push({
          sDocumentType: 'passport_number',
          sReason: passportNumberResult.sReason
        })
        const validIndex = validationResults.aValidDocuments.indexOf('passport_number')
        if (validIndex >= 0) {
          validationResults.aValidDocuments.splice(validIndex, 1)
        }
      }

      const bankStatementsResult = await validateBankStatements(updatedDocuments)
      if (!bankStatementsResult.bIsValid) {
        validationResults.bIsValid = false
        const existingInvalidIndex = validationResults.aInvalidDocuments.findIndex(
          doc => doc.sDocumentType === 'bank_statements'
        )
        if (existingInvalidIndex >= 0) {
          validationResults.aInvalidDocuments[existingInvalidIndex].sReason = bankStatementsResult.sReason
        } else {
          const validIndex = validationResults.aValidDocuments.indexOf('bank_statements')
          if (validIndex >= 0) {
            validationResults.aValidDocuments.splice(validIndex, 1)
          }
          validationResults.aInvalidDocuments.push({
            sDocumentType: 'bank_statements',
            sReason: bankStatementsResult.sReason
          })
        }
      }

      const itrResult = await validateITR(updatedDocuments)
      if (!itrResult.bIsValid) {
        validationResults.bIsValid = false
        const existingInvalidIndex = validationResults.aInvalidDocuments.findIndex(
          doc => doc.sDocumentType === 'itr'
        )
        if (existingInvalidIndex >= 0) {
          validationResults.aInvalidDocuments[existingInvalidIndex].sReason = itrResult.sReason
        } else {
          const validIndex = validationResults.aValidDocuments.indexOf('itr')
          if (validIndex >= 0) {
            validationResults.aValidDocuments.splice(validIndex, 1)
          }
          validationResults.aInvalidDocuments.push({
            sDocumentType: 'itr',
            sReason: itrResult.sReason
          })
        }
      }

      const incomeProofResult = await validateIncomeProof(application, updatedDocuments)
      if (!incomeProofResult.bIsValid) {
        validationResults.bIsValid = false
        const existingInvalidIndex = validationResults.aInvalidDocuments.findIndex(
          doc => doc.sDocumentType === 'income_proof'
        )
        if (existingInvalidIndex >= 0) {
          validationResults.aInvalidDocuments[existingInvalidIndex].sReason = incomeProofResult.sReason
        } else {
          const validIndex = validationResults.aValidDocuments.indexOf('income_proof')
          if (validIndex >= 0) {
            validationResults.aValidDocuments.splice(validIndex, 1)
          }
          validationResults.aInvalidDocuments.push({
            sDocumentType: 'income_proof',
            sReason: incomeProofResult.sReason
          })
        }
      }

      const leisureProofResult = await validateLeisureProof(application, updatedDocuments)
      if (!leisureProofResult.bIsValid) {
        validationResults.bIsValid = false
        const existingInvalidIndex = validationResults.aInvalidDocuments.findIndex(
          doc => doc.sDocumentType === 'leisure_proof'
        )
        if (existingInvalidIndex >= 0) {
          validationResults.aInvalidDocuments[existingInvalidIndex].sReason = leisureProofResult.sReason
        } else {
          const validIndex = validationResults.aValidDocuments.indexOf('leisure_proof')
          if (validIndex >= 0) {
            validationResults.aValidDocuments.splice(validIndex, 1)
          }
          validationResults.aInvalidDocuments.push({
            sDocumentType: 'leisure_proof',
            sReason: leisureProofResult.sReason
          })
        }
      }

      application.aDocuments = updatedDocuments
      application.oValidationResult = validationResults
      application.eStatus = validationResults.bIsValid ? 'Validated' : 'Rejected'
      await application.save()

      return res.status(status.OK).json({
        status: status.OK,
        data: validationResults
      })
    } catch (error) {
      return catchError('CountryService.validateApplication', error, req, res)
    }
  }
}

module.exports = new CountryService()
