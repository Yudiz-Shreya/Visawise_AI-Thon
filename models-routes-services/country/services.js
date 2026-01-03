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

      const missingDocuments = requiredDocs.filter(
        doc => !uploadedDocs.includes(doc)
      )

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
          validationResults.aValidDocuments.push(docCopy.sDocumentType)
          docCopy.bIsValidated = true
          docCopy.oValidationResult = {
            bIsValid: true,
            sReason: ocrResult.reason,
            oExtractedData: ocrResult.extractedData
          }
        } else {
          validationResults.aInvalidDocuments.push({
            sDocumentType: docCopy.sDocumentType,
            sReason: ocrResult.reason
          })
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

      if (missingDocuments.length > 0) {
        validationResults.aMissingDocuments = missingDocuments
        validationResults.bIsValid = false
      }

      const dateMismatchResult = await validateTravelDates(application, updatedDocuments)
      if (!dateMismatchResult.bIsValid) {
        validationResults.bIsValid = false
        if (!validationResults.aInvalidDocuments) {
          validationResults.aInvalidDocuments = []
        }
        validationResults.aInvalidDocuments.push({
          sDocumentType: 'cover_letter',
          sReason: dateMismatchResult.sReason
        })
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
