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
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{2,4})\b/gi,
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{2,4})\b/gi,
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})\b/gi,
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+to\s+(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{2,4})\b/gi,
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+to\s+(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{2,4})\b/gi,
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\s+to\s+(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{2,4})\b/gi,
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{2,4})\s+to\s+(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{2,4})\b/gi
  ]

  const dates = []
  datePatterns.forEach(pattern => {
    const matches = text.matchAll(pattern)
    for (const match of matches) {
      if (match[0]) {
        dates.push(match[0])
        // For date ranges like "9th to 16th March 2026", extract individual dates
        if (match.length >= 5 && match[1] && match[3] && match[4]) {
          const month = match[3]
          const year = match[4]
          dates.push(`${match[1]} ${month} ${year}`)
          dates.push(`${match[2]} ${month} ${year}`)
        }
        // For date ranges like "March 9th to 16th March 2026"
        if (match.length >= 6 && match[1] && match[2] && match[4] && match[5]) {
          dates.push(`${match[1]} ${match[2]} ${match[5]}`)
          dates.push(`${match[4]} ${match[5]}`)
        }
      }
    }
  })
  return [...new Set(dates)]
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

  // Handle month names with ordinals: "9th March 2026", "March 9th, 2026"
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
  const monthPattern = new RegExp(`(?:^|\\s)(${monthNames.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{2,4})`, 'i')
  const monthPattern2 = new RegExp(`(?:^|\\s)(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthNames.join('|')})\\s+(\\d{2,4})`, 'i')

  let match = dateString.match(monthPattern)
  if (match) {
    const monthName = match[1].toLowerCase()
    const monthIndex = monthNames.indexOf(monthName)
    const day = parseInt(match[2], 10)
    let year = parseInt(match[3], 10)
    if (year < 100) year += 2000
    if (monthIndex >= 0 && day >= 1 && day <= 31) {
      return new Date(year, monthIndex, day)
    }
  }

  match = dateString.match(monthPattern2)
  if (match) {
    const day = parseInt(match[1], 10)
    const monthName = match[2].toLowerCase()
    const monthIndex = monthNames.indexOf(monthName)
    let year = parseInt(match[3], 10)
    if (year < 100) year += 2000
    if (monthIndex >= 0 && day >= 1 && day <= 31) {
      return new Date(year, monthIndex, day)
    }
  }

  // Handle numeric formats: DD/MM/YYYY, MM/DD/YYYY, YYYY/MM/DD
  const formats = [
    /(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/,
    /(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/
  ]
  for (const format of formats) {
    const match = dateString.match(format)
    if (match) {
      let day, month, year
      if (match[3] && match[3].length === 4) {
        // YYYY/MM/DD format
        year = parseInt(match[1], 10)
        month = parseInt(match[2], 10)
        day = parseInt(match[3], 10)
      } else {
        day = parseInt(match[1], 10)
        month = parseInt(match[2], 10)
        year = parseInt(match[3], 10)
        if (year < 100) year += 2000

        // Try to determine format: if month > 12, swap day and month
        // Also check if it's likely DD/MM (common in international formats)
        // For dates like 1/10/2026, assume DD/MM if day <= 12 and month <= 12
        if (month > 12 && day <= 12) {
          [day, month] = [month, day]
        } else if (day > 12 && month <= 12) {
          // Keep as is (DD/MM format)
        } else if (day <= 12 && month <= 12) {
          // Ambiguous: try both formats, prefer DD/MM for international
          // But if day > month, likely MM/DD, so swap
          if (day > month) {
            [day, month] = [month, day]
          }
        }
      }
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return new Date(year, month - 1, day)
      }
    }
  }
  return null
}

async function validatePassportExpiry(application, documents = []) {
  const passportExpiry = application.dPassportExpiry
  const travelDates = application.sTravelDates
  const currentDate = new Date()
  const sixMonthsFromNow = new Date(currentDate)
  sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6)

  // Check if passport expiry is at least 6 months from current date
  if (passportExpiry) {
    let expiryDate = passportExpiry instanceof Date ? passportExpiry : new Date(passportExpiry)

    // Handle invalid dates
    if (isNaN(expiryDate.getTime())) {
      // Try parsing as string if Date constructor failed
      const dateStr = passportExpiry.toString()
      const parsed = parseDate(dateStr)
      if (parsed) {
        expiryDate = parsed
      } else {
        return {
          bIsValid: false,
          sReason: `Invalid passport expiry date format: ${passportExpiry}`
        }
      }
    }

    if (expiryDate < sixMonthsFromNow) {
      return {
        bIsValid: false,
        sReason: `Passport expiry date (${expiryDate.toLocaleDateString()}) must be at least 6 months from today (${sixMonthsFromNow.toLocaleDateString()})`
      }
    }
  }

  // Extract passport expiry from documents and cross-check
  const documentsToCheck = ['passport_photo', 'visa_application_form', 'passport_number']
  let extractedExpiryDate = null

  for (const docType of documentsToCheck) {
    const doc = documents.find(
      d => d.sDocumentType?.toLowerCase().replace(/\s+/g, '_') === docType
    )

    if (doc && doc.sS3Key && doc.oValidationResult?.bIsValid) {
      const extractedData = doc.oValidationResult?.oExtractedData || {}
      const docText = extractedData.fullText || ''

      if (docText) {
        const expiry = extractPassportExpiryDate(docText)
        if (expiry) {
          extractedExpiryDate = expiry
          break
        }
      }
    }
  }

  // Cross-check extracted expiry date with application expiry date
  if (extractedExpiryDate && passportExpiry) {
    const expiryDate = passportExpiry instanceof Date ? passportExpiry : new Date(passportExpiry)
    const daysDiff = Math.abs((expiryDate - extractedExpiryDate) / (1000 * 60 * 60 * 24))

    if (daysDiff > 7) {
      return {
        bIsValid: false,
        sReason: `Passport expiry date mismatch: Application shows ${expiryDate.toLocaleDateString()} but document shows ${extractedExpiryDate.toLocaleDateString()}`
      }
    }
  }

  // Use extracted expiry date if application doesn't have one
  const finalExpiryDate = passportExpiry
    ? (passportExpiry instanceof Date ? passportExpiry : new Date(passportExpiry))
    : extractedExpiryDate

  // Check travel dates against passport expiry
  if (travelDates && finalExpiryDate) {
    const parsedTravelDates = parseTravelDates(travelDates)
    if (parsedTravelDates) {
      const travelStartDate = parseDate(parsedTravelDates.startDate)
      const travelEndDate = parseDate(parsedTravelDates.endDate)

      if (travelStartDate && travelEndDate) {
        if (travelStartDate > finalExpiryDate || travelEndDate > finalExpiryDate) {
          return {
            bIsValid: false,
            sReason: `Travel dates (${travelDates}) must be before passport expiry date (${finalExpiryDate.toLocaleDateString()})`
          }
        }
      }
    }
  }

  if (!passportExpiry && !extractedExpiryDate) {
    return { bIsValid: true, sReason: '' }
  }

  return { bIsValid: true, sReason: 'Passport expiry date is valid (at least 6 months from today)' }
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
  const travelDates = application.sTravelDates
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

  // Always check extracted text, even if OCR validation failed
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

function extractPassportExpiryDate(text) {
  if (!text) return null
  const patterns = [
    /passport\s*(?:expir|exp|valid|validity)\s*(?:date|until|till|until|expires)?\s*:?\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/i,
    /(?:expir|exp|valid|validity)\s*(?:date|until|till|until|expires)?\s*:?\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/i,
    /(?:date\s*of\s*expir|expir\s*date)\s*:?\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/i,
    /valid\s*(?:until|till|until|expires|upto)\s*:?\s*(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/i
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const parsedDate = parseDate(match[1])
      if (parsedDate) {
        return parsedDate
      }
    }
  }
  return null
}

function extractNames(text) {
  if (!text) return []
  const names = []
  const patterns = [
    /(?:mr|mrs|miss|ms)\.?\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+)/gi,
    /passenger[s]?:?\s*([A-Z][A-Z\s,]+)/gi,
    /name[s]?:?\s*([A-Z][A-Z\s,]+)/gi,
    /([A-Z][A-Za-z]+\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*)/g
  ]
  patterns.forEach(pattern => {
    const matches = text.matchAll(pattern)
    for (const match of matches) {
      const name = match[1]?.trim()
      if (name && name.length > 3) {
        const normalizedName = name.toUpperCase().replace(/[^A-Z\s]/g, '').trim()
        if (normalizedName.split(/\s+/).length >= 2) {
          names.push(normalizedName)
        }
      }
    }
  })
  return [...new Set(names)]
}

function extractCompanyName(text) {
  if (!text) return null
  const patterns = [
    /(?:company|employer|organization|corporation)[\s:]+([A-Z][A-Za-z\s&]+(?:Limited|Ltd|LLC|Inc|Corporation|Corp|Solutions|Technologies|Systems))/i,
    /([A-Z][A-Za-z\s&]+(?:Limited|Ltd|LLC|Inc|Corporation|Corp))\s+(?:is|are|was|were|will)/i,
    /(?:we|our company)[\s,]+([A-Z][A-Za-z\s&]+(?:Limited|Ltd|LLC|Inc))/i
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      return match[1]?.trim()
    }
  }
  return null
}

function extractDestinations(text) {
  if (!text) return []
  const destinations = []
  const patterns = [
    /(?:to|destination|traveling to|visiting|visit to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/gi,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:spain|barcelona|madrid|zurich|doha|delhi|ahmedabad)/gi,
    /(?:barcelona|madrid|spain|zurich|doha|delhi|ahmedabad)/gi
  ]
  patterns.forEach(pattern => {
    const matches = text.matchAll(pattern)
    for (const match of matches) {
      const dest = match[1] || match[0]
      if (dest) {
        destinations.push(dest.trim())
      }
    }
  })
  return [...new Set(destinations)]
}

function extractFlightDates(text) {
  if (!text) return []
  const flightDates = []
  const datePatterns = [
    /(?:departure|depart|leaving|flight date)[\s:]+(\d{1,2}[\s/\-.](\?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s/\-.]\d{2,4})/gi,
    /(?:arrival|arrive|arriving)[\s:]+(\d{1,2}[\s/\-.](\?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s/\-.]\d{2,4})/gi,
    /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}/gi
  ]
  datePatterns.forEach(pattern => {
    const matches = text.matchAll(pattern)
    for (const match of matches) {
      const dateStr = match[1] || match[0]
      const parsed = parseDate(dateStr)
      if (parsed) {
        flightDates.push(parsed)
      }
    }
  })
  const allDates = extractDatesFromDocument(text)
  return [...new Set([...flightDates, ...allDates])]
}

function namesMatch(name1, name2) {
  if (!name1 || !name2) return false
  const n1 = name1.toUpperCase().replace(/[^A-Z\s]/g, '').trim()
  const n2 = name2.toUpperCase().replace(/[^A-Z\s]/g, '').trim()

  if (n1 === n2) return true

  const parts1 = n1.split(/\s+/).filter(p => p.length > 2)
  const parts2 = n2.split(/\s+/).filter(p => p.length > 2)

  if (parts1.length === 0 || parts2.length === 0) return false

  const firstNamesMatch = parts1[0] === parts2[0]
  const lastNamesMatch = parts1[parts1.length - 1] === parts2[parts2.length - 1]

  if (firstNamesMatch && lastNamesMatch) return true

  if (parts1.length >= 2 && parts2.length >= 2) {
    const allParts1Match = parts1.every(p1 => parts2.some(p2 => p1 === p2))
    const allParts2Match = parts2.every(p2 => parts1.some(p1 => p1 === p2))
    if (allParts1Match && allParts2Match && parts1.length === parts2.length) return true
  }

  return false
}

function datesOverlap(date1, date2, toleranceDays = 3) {
  if (!date1 || !date2) return false
  const d1 = date1 instanceof Date ? date1 : parseDate(date1)
  const d2 = date2 instanceof Date ? date2 : parseDate(date2)
  if (!d1 || !d2) return false
  const diff = Math.abs((d1 - d2) / (1000 * 60 * 60 * 24))
  return diff <= toleranceDays
}

function datesInRange(checkDate, startDate, endDate, toleranceDays = 3) {
  if (!checkDate || !startDate || !endDate) return false
  const check = checkDate instanceof Date ? checkDate : parseDate(checkDate)
  const start = startDate instanceof Date ? startDate : parseDate(startDate)
  const end = endDate instanceof Date ? endDate : parseDate(endDate)
  if (!check || !start || !end) return false
  return check >= new Date(start.getTime() - toleranceDays * 24 * 60 * 60 * 1000) &&
    check <= new Date(end.getTime() + toleranceDays * 24 * 60 * 60 * 1000)
}

function extractDatesFromDocument(text) {
  if (!text) return []
  const dates = extractDatesFromText(text)
  return dates.map(date => parseDate(date)).filter(date => date !== null)
}

async function validateReturnTicket(application, documents) {
  const travelDates = application.sTravelDates
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
  const travelDates = application.sTravelDates
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
  const appPassportNumber = application.sPassportNumber
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
  const employmentStatus = application.sEmploymentStatus
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
  const travelDates = application.sTravelDates
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

async function validateSponsorshipLetter(documents, application = null) {
  const sponsorshipDoc = documents.find(
    doc => doc.sDocumentType?.toLowerCase().replace(/\s+/g, '_') === 'sponsorship_letter'
  )

  if (!sponsorshipDoc || !sponsorshipDoc.sS3Key) {
    return { bIsValid: false, sReason: 'Sponsorship letter from company is required for Business visa' }
  }

  if (!sponsorshipDoc.oValidationResult?.bIsValid) {
    return { bIsValid: false, sReason: 'Sponsorship letter validation failed. Please upload a valid sponsorship letter.' }
  }

  const extractedData = sponsorshipDoc.oValidationResult?.oExtractedData || {}
  const letterText = extractedData.fullText || ''

  if (!letterText || letterText.trim().length === 0) {
    return { bIsValid: false, sReason: 'Could not extract text from sponsorship letter. Please ensure the document is clear and readable.' }
  }

  const lowerText = letterText.toLowerCase()
  const requiredKeywords = ['company', 'sponsor', 'sponsorship', 'business', 'employer']
  const hasRequiredKeywords = requiredKeywords.some(keyword => lowerText.includes(keyword))

  if (!hasRequiredKeywords) {
    return { bIsValid: false, sReason: 'Sponsorship letter does not appear to be from a company. Please ensure it contains company sponsorship details.' }
  }

  const companyName = extractCompanyName(letterText)
  const travelDates = extractDatesFromDocument(letterText)
  const names = extractNames(letterText)
  const destinations = extractDestinations(letterText)

  const result = {
    bIsValid: true,
    sReason: 'Sponsorship letter is valid',
    extractedData: {
      companyName,
      travelDates,
      names,
      destinations,
      fullText: letterText
    }
  }

  sponsorshipDoc.oValidationResult.oExtractedData = {
    ...sponsorshipDoc.oValidationResult.oExtractedData,
    ...result.extractedData
  }

  return result
}

async function validateFlightCoverLetter(documents, application = null, otherDocsData = {}) {
  const flightCoverDoc = documents.find(
    doc => doc.sDocumentType?.toLowerCase().replace(/\s+/g, '_') === 'flight_cover_letter'
  )

  if (!flightCoverDoc || !flightCoverDoc.sS3Key) {
    return { bIsValid: false, sReason: 'Flight itinerary/ticket is required for Business visa' }
  }

  if (!flightCoverDoc.oValidationResult?.bIsValid) {
    return { bIsValid: false, sReason: 'Flight itinerary validation failed. Please upload a valid flight itinerary.' }
  }

  const extractedData = flightCoverDoc.oValidationResult?.oExtractedData || {}
  const letterText = extractedData.fullText || ''

  if (!letterText || letterText.trim().length === 0) {
    return { bIsValid: false, sReason: 'Could not extract text from flight itinerary. Please ensure the document is clear and readable.' }
  }

  const lowerText = letterText.toLowerCase()
  const flightKeywords = ['flight', 'airline', 'ticket', 'booking', 'travel', 'itinerary', 'departure', 'arrival', 'passenger']
  const hasFlightKeywords = flightKeywords.some(keyword => lowerText.includes(keyword))

  if (!hasFlightKeywords) {
    return { bIsValid: false, sReason: 'Document does not appear to contain flight information. Please ensure it includes flight booking details.' }
  }

  const flightDates = extractFlightDates(letterText)
  const names = extractNames(letterText)
  const destinations = extractDestinations(letterText)
  const passportNumbers = []
  const passportPattern = /passport\s*(?:number|no|#)?\s*:?\s*([A-Z0-9]{6,12})/gi
  const passportMatches = letterText.matchAll(passportPattern)
  for (const match of passportMatches) {
    if (match[1]) passportNumbers.push(match[1])
  }

  const result = {
    bIsValid: true,
    sReason: 'Flight itinerary is valid',
    extractedData: {
      flightDates,
      names,
      destinations,
      passportNumbers: [...new Set(passportNumbers)],
      fullText: letterText
    }
  }

  if (otherDocsData.sponsorshipDates && flightDates.length > 0) {
    const hasMatchingDate = flightDates.some(fd =>
      otherDocsData.sponsorshipDates.some(sd => datesOverlap(fd, sd, 7))
    )
    if (!hasMatchingDate) {
      result.bIsValid = false
      result.sReason = 'Flight dates do not match travel dates mentioned in sponsorship letter'
    }
  }

  if (otherDocsData.sponsorshipNames && names.length > 0) {
    const allNamesMatch = names.every(fn =>
      otherDocsData.sponsorshipNames.some(sn => namesMatch(fn, sn))
    ) && otherDocsData.sponsorshipNames.every(sn =>
      names.some(fn => namesMatch(fn, sn))
    )
    if (!allNamesMatch) {
      result.bIsValid = false
      const cleanFlightNames = names
        .map(n => {
          const parts = n.split(/\s+/).filter(p => p.length > 2 && !['CLASS', 'SERVICE', 'ECONOMY', 'AIRPORT', 'INFO', 'TERMINAL', 'FLIGHT', 'AIRBUS', 'BREAKFAST', 'PASSENGERS', 'CONFIRMATION', 'NUMBER', 'MY', 'TRIP'].includes(p.toUpperCase()))
          return parts.length >= 2 ? parts.join(' ') : null
        })
        .filter(n => n && n.length > 3)
        .slice(0, 5)
      const cleanSponsorNames = otherDocsData.sponsorshipNames
        .map(n => {
          const parts = n.split(/\s+/).filter(p => p.length > 2 && !['BUSINESS', 'VISA', 'TECH', 'LEAD', 'SOLUTIONS', 'LIMITED', 'CHIEF', 'EXECUTIVE'].includes(p.toUpperCase()))
          return parts.length >= 2 ? parts.join(' ') : null
        })
        .filter(n => n && n.length > 3)
        .slice(0, 5)
      result.sReason = `Passenger names in flight itinerary do not match names in sponsorship letter. Flight itinerary: ${cleanFlightNames.length > 0 ? cleanFlightNames.join(', ') : 'Unable to extract names'}. Sponsorship letter: ${cleanSponsorNames.length > 0 ? cleanSponsorNames.join(', ') : 'Unable to extract names'}`
    }
  }

  if (otherDocsData.invitationDates && flightDates.length > 0) {
    const hasMatchingDate = flightDates.some(fd =>
      otherDocsData.invitationDates.some(id => datesOverlap(fd, id, 7))
    )
    if (!hasMatchingDate && result.bIsValid) {
      result.sReason += '. Note: Flight dates should align with invitation letter dates'
    }
  }

  flightCoverDoc.oValidationResult.oExtractedData = {
    ...flightCoverDoc.oValidationResult.oExtractedData,
    ...result.extractedData
  }

  return result
}

async function validateTravelInsurance(documents, application = null, otherDocsData = {}) {
  const insuranceDoc = documents.find(
    doc => doc.sDocumentType?.toLowerCase().replace(/\s+/g, '_') === 'travel_insurance'
  )

  if (!insuranceDoc || !insuranceDoc.sS3Key) {
    return { bIsValid: false, sReason: 'Travel insurance is required for Business visa' }
  }

  if (!insuranceDoc.oValidationResult?.bIsValid) {
    return { bIsValid: false, sReason: 'Travel insurance validation failed. Please upload a valid travel insurance document.' }
  }

  const extractedData = insuranceDoc.oValidationResult?.oExtractedData || {}
  const insuranceText = extractedData.fullText || ''

  if (!insuranceText || insuranceText.trim().length === 0) {
    return { bIsValid: false, sReason: 'Could not extract text from travel insurance. Please ensure the document is clear and readable.' }
  }

  const lowerText = insuranceText.toLowerCase()
  const insuranceKeywords = ['insurance', 'coverage', 'policy', 'insured', 'premium', 'travel insurance', 'medical', 'evacuation', 'accident']
  const hasInsuranceKeywords = insuranceKeywords.some(keyword => lowerText.includes(keyword))

  if (!hasInsuranceKeywords) {
    return { bIsValid: false, sReason: 'Document does not appear to be a travel insurance policy. Please ensure it is a valid travel insurance document.' }
  }

  const policyDates = extractDatesFromDocument(insuranceText)
  const hasMedicalCoverage = /medical|health|treatment|evacuation|hospital/i.test(insuranceText)
  const hasMinimumCoverage = /(\$|USD|EUR|INR)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/.test(insuranceText)

  const result = {
    bIsValid: true,
    sReason: 'Travel insurance is valid',
    extractedData: {
      policyDates,
      hasMedicalCoverage,
      hasMinimumCoverage,
      fullText: insuranceText
    }
  }

  if (!hasMedicalCoverage) {
    result.sReason += '. Warning: Medical coverage should be included'
  }

  if (otherDocsData.sponsorshipDates && policyDates.length > 0) {
    const travelStart = otherDocsData.sponsorshipDates[0]
    const travelEnd = otherDocsData.sponsorshipDates[otherDocsData.sponsorshipDates.length - 1]
    if (travelStart && travelEnd) {
      const coversTravelPeriod = policyDates.some(pd =>
        datesInRange(pd, travelStart, travelEnd, 30)
      )
      if (!coversTravelPeriod && policyDates.length > 0) {
        result.sReason += '. Note: Verify insurance coverage period matches travel dates'
      }
    }
  }

  insuranceDoc.oValidationResult.oExtractedData = {
    ...insuranceDoc.oValidationResult.oExtractedData,
    ...result.extractedData
  }

  return result
}

async function validateInvitationLetter(documents, application = null, otherDocsData = {}) {
  const invitationDoc = documents.find(
    doc => doc.sDocumentType?.toLowerCase().replace(/\s+/g, '_') === 'invitation_letter'
  )

  if (!invitationDoc || !invitationDoc.sS3Key) {
    return { bIsValid: false, sReason: 'Invitation letter is required for Business visa' }
  }

  if (!invitationDoc.oValidationResult?.bIsValid) {
    return { bIsValid: false, sReason: 'Invitation letter validation failed. Please upload a valid invitation letter.' }
  }

  const extractedData = invitationDoc.oValidationResult?.oExtractedData || {}
  const letterText = extractedData.fullText || ''

  if (!letterText || letterText.trim().length === 0) {
    return { bIsValid: false, sReason: 'Could not extract text from invitation letter. Please ensure the document is clear and readable.' }
  }

  const lowerText = letterText.toLowerCase()
  const invitationKeywords = [
    'invitation',
    'invite',
    'invited',
    'you are invited',
    'we invite you',
    'we would like to invite',
    'pleasure to invite',
    'honor to invite',
    'delighted to invite',
    'welcome',
    'request',
    'host',
    'visit',
    'event',
    'conference',
    'exhibition',
    'seminar',
    'workshop',
    'meeting',
    'gathering',
    'celebration',
    'ceremony',
    'attending',
    'participation',
    'participate',
    'join us',
    'looking forward',
    'cordially invite',
    'kindly invite',
    'request your presence',
    'request the pleasure',
    'honored to have',
    'pleasure of your company',
    'request you to attend',
    'invitation to attend',
    'invitation letter',
    'letter of invitation',
    'official invitation',
    'formal invitation'
  ]

  // Check for exact keyword matches
  let hasInvitationKeywords = invitationKeywords.some(keyword => lowerText.includes(keyword))

  // If no exact match, try fuzzy matching for OCR errors
  if (!hasInvitationKeywords) {
    const fuzzyPatterns = [
      /invit/i,
      /invit[ae]d/i,
      /exhib/i,
      /confer/i,
      /event/i,
      /attend/i,
      /january|february|march|april|may|june|july|august|september|october|november|december/i,
      /barcelona|madrid|spain/i,
      /venue|location|address/i,
      /dear\s+[a-z]+/i,
      /yours\s+(sincerely|faithfully|truly)/i
    ]

    const keywordMatches = fuzzyPatterns.filter(pattern => pattern.test(lowerText))
    const hasEventDetails = /(?:event|conference|exhibition|meeting|seminar|workshop)[\s:]*[a-z0-9\s]+/i.test(lowerText)
    const hasDates = /(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?/i.test(lowerText)
    const hasVenue = /(?:venue|location|address|fira|barcelona|spain)/i.test(lowerText)
    const hasRecipientInfo = /(?:dear|mr|mrs|ms|name|full name|passport)/i.test(lowerText)

    // If we have multiple indicators, consider it valid despite OCR errors
    if (keywordMatches.length >= 2 || (hasEventDetails && hasDates && hasVenue) || (hasRecipientInfo && hasDates)) {
      hasInvitationKeywords = true
    }
  }

  // Additional check: if document has substantial text and contains date patterns + venue/event info
  if (!hasInvitationKeywords && letterText.trim().length > 100) {
    const hasDatePattern = /\d{1,2}(?:st|nd|rd|th)?\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)/i.test(letterText)
    const hasVenueOrEvent = /(?:barcelona|fira|venue|event|exhibition|conference|spain)/i.test(letterText)
    const hasNamePattern = /(?:dear|mr|mrs|ms|name|full name|passport number)/i.test(letterText)

    if (hasDatePattern && (hasVenueOrEvent || hasNamePattern)) {
      hasInvitationKeywords = true
    }
  }

  if (!hasInvitationKeywords) {
    return { bIsValid: false, sReason: 'Document does not appear to be an invitation letter. Please ensure it contains invitation details such as "you are invited", "we invite you", or similar phrases.' }
  }

  const invitationDates = extractDatesFromDocument(letterText)
  const names = extractNames(letterText)
  const destinations = extractDestinations(letterText)
  const passportNumber = extractPassportNumber(letterText)
  const eventName = letterText.match(/(?:event|conference|exhibition|meeting)[\s:]+([A-Z][A-Za-z\s&0-9]+)/i)?.[1]

  const result = {
    bIsValid: true,
    sReason: 'Invitation letter is valid',
    extractedData: {
      invitationDates,
      names,
      destinations,
      passportNumber,
      eventName,
      fullText: letterText
    }
  }

  if (otherDocsData.sponsorshipDates && invitationDates.length > 0) {
    const hasMatchingDate = invitationDates.some(id =>
      otherDocsData.sponsorshipDates.some(sd => datesOverlap(id, sd, 7))
    )
    if (!hasMatchingDate) {
      result.bIsValid = false
      result.sReason = 'Invitation letter dates do not match travel dates mentioned in sponsorship letter'
    }
  }

  if (otherDocsData.sponsorshipNames && names.length > 0) {
    const allNamesMatch = names.every(invName =>
      otherDocsData.sponsorshipNames.some(sn => namesMatch(invName, sn))
    ) && otherDocsData.sponsorshipNames.every(sn =>
      names.some(invName => namesMatch(invName, sn))
    )
    if (!allNamesMatch) {
      result.bIsValid = false
      const cleanInvNames = names
        .map(n => {
          const parts = n.split(/\s+/).filter(p => p.length > 2 && !['EVENT', 'CONFERENCE', 'EXHIBITION', 'MEETING', 'INVITATION', 'LETTER'].includes(p.toUpperCase()))
          return parts.length >= 2 ? parts.join(' ') : null
        })
        .filter(n => n && n.length > 3)
        .slice(0, 5)
      const cleanSponsorNames = otherDocsData.sponsorshipNames
        .map(n => {
          const parts = n.split(/\s+/).filter(p => p.length > 2 && !['BUSINESS', 'VISA', 'TECH', 'LEAD', 'SOLUTIONS', 'LIMITED', 'CHIEF', 'EXECUTIVE'].includes(p.toUpperCase()))
          return parts.length >= 2 ? parts.join(' ') : null
        })
        .filter(n => n && n.length > 3)
        .slice(0, 5)
      result.sReason = `Names in invitation letter do not match names in sponsorship letter. Invitation letter: ${cleanInvNames.length > 0 ? cleanInvNames.join(', ') : 'Unable to extract names'}. Sponsorship letter: ${cleanSponsorNames.length > 0 ? cleanSponsorNames.join(', ') : 'Unable to extract names'}`
    }
  }

  if (otherDocsData.flightDates && invitationDates.length > 0) {
    const hasMatchingDate = invitationDates.some(id =>
      otherDocsData.flightDates.some(fd => datesOverlap(id, fd, 7))
    )
    if (!hasMatchingDate && result.bIsValid) {
      result.sReason += '. Note: Invitation dates should align with flight dates'
    }
  }

  if (otherDocsData.sponsorshipCompany && destinations.length > 0) {
    const destinationMatch = destinations.some(d =>
      d.toLowerCase().includes('barcelona') ||
      d.toLowerCase().includes('spain') ||
      d.toLowerCase().includes('madrid')
    )
    if (!destinationMatch) {
      result.sReason += '. Note: Verify destination matches travel purpose'
    }
  }

  invitationDoc.oValidationResult.oExtractedData = {
    ...invitationDoc.oValidationResult.oExtractedData,
    ...result.extractedData
  }

  return result
}

async function validateFeeReceipt(documents) {
  const feeReceiptDoc = documents.find(
    doc => doc.sDocumentType?.toLowerCase().replace(/\s+/g, '_') === 'fee_receipt'
  )

  if (!feeReceiptDoc || !feeReceiptDoc.sS3Key) {
    return { bIsValid: false, sReason: 'Fee receipt is required for Student visa' }
  }

  if (!feeReceiptDoc.oValidationResult?.bIsValid) {
    return { bIsValid: false, sReason: 'Fee receipt validation failed. Please upload a valid fee receipt.' }
  }

  const extractedData = feeReceiptDoc.oValidationResult?.oExtractedData || {}
  const receiptText = extractedData.fullText || ''

  if (!receiptText || receiptText.trim().length === 0) {
    return { bIsValid: false, sReason: 'Could not extract text from fee receipt. Please ensure the document is clear and readable.' }
  }

  const lowerText = receiptText.toLowerCase()
  const receiptKeywords = ['receipt', 'fee', 'payment', 'paid', 'amount', 'tuition', 'registration']
  const hasReceiptKeywords = receiptKeywords.some(keyword => lowerText.includes(keyword))

  if (!hasReceiptKeywords) {
    return { bIsValid: false, sReason: 'Document does not appear to be a fee receipt. Please ensure it contains payment/fee information.' }
  }

  return { bIsValid: true, sReason: 'Fee receipt is valid' }
}

async function validateAcademicCertificate(documents) {
  const academicDoc = documents.find(
    doc => doc.sDocumentType?.toLowerCase().replace(/\s+/g, '_') === 'academic_certificate'
  )

  if (!academicDoc || !academicDoc.sS3Key) {
    return { bIsValid: false, sReason: 'Academic certificate is required for Student visa' }
  }

  if (!academicDoc.oValidationResult?.bIsValid) {
    return { bIsValid: false, sReason: 'Academic certificate validation failed. Please upload a valid academic certificate.' }
  }

  const extractedData = academicDoc.oValidationResult?.oExtractedData || {}
  const certificateText = extractedData.fullText || ''

  if (!certificateText || certificateText.trim().length === 0) {
    return { bIsValid: false, sReason: 'Could not extract text from academic certificate. Please ensure the document is clear and readable.' }
  }

  const lowerText = certificateText.toLowerCase()
  const academicKeywords = ['certificate', 'degree', 'diploma', 'academic', 'education', 'university', 'college', 'qualification', 'graduation']
  const hasAcademicKeywords = academicKeywords.some(keyword => lowerText.includes(keyword))

  if (!hasAcademicKeywords) {
    return { bIsValid: false, sReason: 'Document does not appear to be an academic certificate. Please ensure it is a valid educational certificate.' }
  }

  return { bIsValid: true, sReason: 'Academic certificate is valid' }
}

async function validateNOC(documents, application = null) {
  const nocDoc = documents.find(
    doc => doc.sDocumentType?.toLowerCase().replace(/\s+/g, '_') === 'noc'
  )

  if (!nocDoc || !nocDoc.sS3Key) {
    return { bIsValid: false, sReason: 'NOC (No Objection Certificate) is required for Tourist visa' }
  }

  // Always check extracted text, even if OCR validation failed
  const extractedData = nocDoc.oValidationResult?.oExtractedData || {}
  const nocText = extractedData.fullText || ''

  if (!nocText || nocText.trim().length === 0) {
    return { bIsValid: false, sReason: 'Could not extract text from NOC. Please ensure the document is clear and readable.' }
  }

  const lowerText = nocText.toLowerCase()
  const nocKeywords = ['noc', 'no objection', 'objection certificate', 'no objection certificate', 'leave approval', 'leave', 'approved', 'employer', 'authority', 'permission', 'granted', 'approved', 'support', 'application', 'visa officer', 'certificate']
  const hasNOCKeywords = nocKeywords.some(keyword => lowerText.includes(keyword))

  if (!hasNOCKeywords) {
    const hasSubstantialText = nocText.trim().length > 100
    // Check for company/employer patterns even if keywords not found
    const hasCompanyPattern = /(company|employer|organization|corporation|limited|ltd|solutions)/i.test(nocText)
    const hasDatePattern = /\d{1,2}[\s/\-.]\d{1,2}[\s/\-.]\d{2,4}/.test(nocText) || /(january|february|march|april|may|june|july|august|september|october|november|december)/i.test(nocText)
    const hasPassportPattern = /passport/i.test(nocText)
    const hasEmployeePattern = /(employee|full.time|position|duties|resume)/i.test(nocText)

    if (hasSubstantialText && (hasCompanyPattern || hasDatePattern || hasPassportPattern || hasEmployeePattern)) {
      return { bIsValid: true, sReason: 'NOC is valid' }
    }
    return { bIsValid: false, sReason: 'Document does not appear to be a valid NOC. Please ensure it contains No Objection Certificate details.' }
  }

  return { bIsValid: true, sReason: 'NOC is valid' }
}

async function validateItinerary(documents, application = null) {
  const itineraryDoc = documents.find(
    doc => doc.sDocumentType?.toLowerCase().replace(/\s+/g, '_') === 'itinerary'
  )

  if (!itineraryDoc || !itineraryDoc.sS3Key) {
    return { bIsValid: false, sReason: 'Itinerary not found or not uploaded' }
  }

  if (!itineraryDoc.oValidationResult?.bIsValid) {
    return { bIsValid: false, sReason: 'Itinerary validation failed. Please upload a valid travel itinerary.' }
  }

  const extractedData = itineraryDoc.oValidationResult?.oExtractedData || {}
  const itineraryText = extractedData.fullText || ''

  if (!itineraryText || itineraryText.trim().length === 0) {
    return { bIsValid: false, sReason: 'Could not extract text from itinerary. Please ensure the document is clear and readable.' }
  }

  const travelDates = application?.sTravelDates
  if (travelDates) {
    const parsedTravelDates = parseTravelDates(travelDates)
    if (parsedTravelDates) {
      const itineraryDates = extractDatesFromDocument(itineraryText)
      const travelStartDate = parseDate(parsedTravelDates.startDate)
      const travelEndDate = parseDate(parsedTravelDates.endDate)

      if (itineraryDates.length > 0 && travelStartDate && travelEndDate) {
        const hasMatchingDate = itineraryDates.some(itDate =>
          itDate >= travelStartDate && itDate <= travelEndDate
        )
        if (!hasMatchingDate) {
          return {
            bIsValid: false,
            sReason: `Itinerary dates do not match travel dates (${travelDates}). Itinerary should cover your travel period.`
          }
        }
      }
    }
  }

  return { bIsValid: true, sReason: 'Itinerary is valid' }
}

async function performValidation(application) {
  await application.populate('iVisaTypeId', 'aRequiredDocuments nDocumentsRequired sType')

  const visaType = application.iVisaTypeId
  const visaTypeName = visaType?.sType || ''
  const requiredDocs = visaType.aRequiredDocuments.map(doc => doc.sName.toLowerCase().replace(/\s+/g, '_'))
  const uploadedDocs = application.aDocuments.map(doc => doc.sDocumentType.toLowerCase().replace(/\s+/g, '_'))

  let visaSpecificRequiredDocs = []
  if (visaTypeName === 'Business') {
    visaSpecificRequiredDocs = ['sponsorship_letter', 'flight_cover_letter', 'travel_insurance', 'invitation_letter']
  } else if (visaTypeName === 'Student') {
    visaSpecificRequiredDocs = ['fee_receipt', 'academic_certificate']
  } else if (visaTypeName === 'Tourist') {
    visaSpecificRequiredDocs = ['cover_letter', 'noc', 'travel_insurance']
  }

  const formFields = ['passport_number', 'passport_expiry', 'employment_status', 'travel_dates']
  const documentFields = visaSpecificRequiredDocs.length > 0
    ? visaSpecificRequiredDocs
    : requiredDocs.filter(doc => !formFields.includes(doc))

  const missingDocuments = documentFields.filter(
    doc => !uploadedDocs.includes(doc)
  )

  if (visaTypeName === 'Tourist') {
    const hasReturnTicket = uploadedDocs.includes('return_ticket')
    const hasItinerary = uploadedDocs.includes('itinerary')
    if (!hasReturnTicket && !hasItinerary) {
      missingDocuments.push('return_ticket_or_itinerary')
    }
  }

  const missingFormFields = []
  if (requiredDocs.includes('passport_number') && !application.sPassportNumber) {
    missingFormFields.push('passport_number')
  }
  if (requiredDocs.includes('passport_expiry') && !application.dPassportExpiry) {
    missingFormFields.push('passport_expiry')
  }
  if (requiredDocs.includes('employment_status') && !application.sEmploymentStatus) {
    missingFormFields.push('employment_status')
  }
  if (requiredDocs.includes('travel_dates') && !application.sTravelDates) {
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

  const passportExpiryResult = await validatePassportExpiry(application, updatedDocuments)
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

  if (visaTypeName === 'Tourist') {
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

    const nocResult = await validateNOC(updatedDocuments, application)
    if (!nocResult.bIsValid) {
      validationResults.bIsValid = false
      const existingInvalidIndex = validationResults.aInvalidDocuments.findIndex(
        doc => doc.sDocumentType === 'noc'
      )
      if (existingInvalidIndex >= 0) {
        validationResults.aInvalidDocuments[existingInvalidIndex].sReason = nocResult.sReason
      } else {
        const validIndex = validationResults.aValidDocuments.indexOf('noc')
        if (validIndex >= 0) {
          validationResults.aValidDocuments.splice(validIndex, 1)
        }
        validationResults.aInvalidDocuments.push({
          sDocumentType: 'noc',
          sReason: nocResult.sReason
        })
      }
    } else if (nocResult.bIsValid) {
      if (!validationResults.aValidDocuments.includes('noc')) {
        validationResults.aValidDocuments.push('noc')
      }
    }

    const returnTicketResult = await validateReturnTicket(application, updatedDocuments)
    const itineraryResult = await validateItinerary(updatedDocuments, application)

    if (!returnTicketResult.bIsValid && !itineraryResult.bIsValid) {
      validationResults.bIsValid = false
      const existingReturnIndex = validationResults.aInvalidDocuments.findIndex(
        doc => doc.sDocumentType === 'return_ticket'
      )
      const existingItineraryIndex = validationResults.aInvalidDocuments.findIndex(
        doc => doc.sDocumentType === 'itinerary'
      )

      if (existingReturnIndex < 0 && existingItineraryIndex < 0) {
        validationResults.aInvalidDocuments.push({
          sDocumentType: 'return_ticket',
          sReason: 'Either return ticket or itinerary is required for Tourist visa. Please provide at least one.'
        })
      }
    } else {
      if (returnTicketResult.bIsValid && !validationResults.aValidDocuments.includes('return_ticket')) {
        validationResults.aValidDocuments.push('return_ticket')
      }
      if (itineraryResult.bIsValid && !validationResults.aValidDocuments.includes('itinerary')) {
        validationResults.aValidDocuments.push('itinerary')
      }
    }
  } else if (visaTypeName !== 'Business' && visaTypeName !== 'Student') {
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

  if (visaTypeName === 'Business') {
    const sponsorshipResult = await validateSponsorshipLetter(updatedDocuments, application)
    const sponsorshipData = sponsorshipResult.extractedData || {}

    if (!sponsorshipResult.bIsValid) {
      validationResults.bIsValid = false
      const existingInvalidIndex = validationResults.aInvalidDocuments.findIndex(
        doc => doc.sDocumentType === 'sponsorship_letter'
      )
      if (existingInvalidIndex >= 0) {
        validationResults.aInvalidDocuments[existingInvalidIndex].sReason = sponsorshipResult.sReason
      } else {
        const validIndex = validationResults.aValidDocuments.indexOf('sponsorship_letter')
        if (validIndex >= 0) {
          validationResults.aValidDocuments.splice(validIndex, 1)
        }
        validationResults.aInvalidDocuments.push({
          sDocumentType: 'sponsorship_letter',
          sReason: sponsorshipResult.sReason
        })
      }
    } else if (sponsorshipResult.bIsValid) {
      if (!validationResults.aValidDocuments.includes('sponsorship_letter')) {
        validationResults.aValidDocuments.push('sponsorship_letter')
      }
    }

    const otherDocsData = {
      sponsorshipDates: sponsorshipData.travelDates || [],
      sponsorshipNames: sponsorshipData.names || [],
      sponsorshipCompany: sponsorshipData.companyName,
      sponsorshipDestinations: sponsorshipData.destinations || []
    }

    const flightCoverResult = await validateFlightCoverLetter(updatedDocuments, application, otherDocsData)
    otherDocsData.flightDates = flightCoverResult.extractedData?.flightDates || []
    otherDocsData.flightNames = flightCoverResult.extractedData?.names || []

    if (!flightCoverResult.bIsValid) {
      validationResults.bIsValid = false
      const existingInvalidIndex = validationResults.aInvalidDocuments.findIndex(
        doc => doc.sDocumentType === 'flight_cover_letter'
      )
      if (existingInvalidIndex >= 0) {
        validationResults.aInvalidDocuments[existingInvalidIndex].sReason = flightCoverResult.sReason
      } else {
        const validIndex = validationResults.aValidDocuments.indexOf('flight_cover_letter')
        if (validIndex >= 0) {
          validationResults.aValidDocuments.splice(validIndex, 1)
        }
        validationResults.aInvalidDocuments.push({
          sDocumentType: 'flight_cover_letter',
          sReason: flightCoverResult.sReason
        })
      }
    } else if (flightCoverResult.bIsValid) {
      if (!validationResults.aValidDocuments.includes('flight_cover_letter')) {
        validationResults.aValidDocuments.push('flight_cover_letter')
      }
    }

    const travelInsuranceResult = await validateTravelInsurance(updatedDocuments, application, otherDocsData)
    if (!travelInsuranceResult.bIsValid) {
      validationResults.bIsValid = false
      const existingInvalidIndex = validationResults.aInvalidDocuments.findIndex(
        doc => doc.sDocumentType === 'travel_insurance'
      )
      if (existingInvalidIndex >= 0) {
        validationResults.aInvalidDocuments[existingInvalidIndex].sReason = travelInsuranceResult.sReason
      } else {
        const validIndex = validationResults.aValidDocuments.indexOf('travel_insurance')
        if (validIndex >= 0) {
          validationResults.aValidDocuments.splice(validIndex, 1)
        }
        validationResults.aInvalidDocuments.push({
          sDocumentType: 'travel_insurance',
          sReason: travelInsuranceResult.sReason
        })
      }
    } else if (travelInsuranceResult.bIsValid) {
      if (!validationResults.aValidDocuments.includes('travel_insurance')) {
        validationResults.aValidDocuments.push('travel_insurance')
      }
    }

    const invitationResult = await validateInvitationLetter(updatedDocuments, application, otherDocsData)
    if (!invitationResult.bIsValid) {
      validationResults.bIsValid = false
      const existingInvalidIndex = validationResults.aInvalidDocuments.findIndex(
        doc => doc.sDocumentType === 'invitation_letter'
      )
      if (existingInvalidIndex >= 0) {
        validationResults.aInvalidDocuments[existingInvalidIndex].sReason = invitationResult.sReason
      } else {
        const validIndex = validationResults.aValidDocuments.indexOf('invitation_letter')
        if (validIndex >= 0) {
          validationResults.aValidDocuments.splice(validIndex, 1)
        }
        validationResults.aInvalidDocuments.push({
          sDocumentType: 'invitation_letter',
          sReason: invitationResult.sReason
        })
      }
    } else if (invitationResult.bIsValid) {
      if (!validationResults.aValidDocuments.includes('invitation_letter')) {
        validationResults.aValidDocuments.push('invitation_letter')
      }
    }
  }

  if (visaTypeName === 'Student') {
    const feeReceiptResult = await validateFeeReceipt(updatedDocuments)
    if (!feeReceiptResult.bIsValid) {
      validationResults.bIsValid = false
      const existingInvalidIndex = validationResults.aInvalidDocuments.findIndex(
        doc => doc.sDocumentType === 'fee_receipt'
      )
      if (existingInvalidIndex >= 0) {
        validationResults.aInvalidDocuments[existingInvalidIndex].sReason = feeReceiptResult.sReason
      } else {
        const validIndex = validationResults.aValidDocuments.indexOf('fee_receipt')
        if (validIndex >= 0) {
          validationResults.aValidDocuments.splice(validIndex, 1)
        }
        validationResults.aInvalidDocuments.push({
          sDocumentType: 'fee_receipt',
          sReason: feeReceiptResult.sReason
        })
      }
    }

    const academicCertResult = await validateAcademicCertificate(updatedDocuments)
    if (!academicCertResult.bIsValid) {
      validationResults.bIsValid = false
      const existingInvalidIndex = validationResults.aInvalidDocuments.findIndex(
        doc => doc.sDocumentType === 'academic_certificate'
      )
      if (existingInvalidIndex >= 0) {
        validationResults.aInvalidDocuments[existingInvalidIndex].sReason = academicCertResult.sReason
      } else {
        const validIndex = validationResults.aValidDocuments.indexOf('academic_certificate')
        if (validIndex >= 0) {
          validationResults.aValidDocuments.splice(validIndex, 1)
        }
        validationResults.aInvalidDocuments.push({
          sDocumentType: 'academic_certificate',
          sReason: academicCertResult.sReason
        })
      }
    }
  }

  application.aDocuments = updatedDocuments
  application.oValidationResult = validationResults
  application.eStatus = validationResults.bIsValid ? 'Validated' : 'Rejected'
  await application.save()

  return validationResults
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
      const { userId, countryId, visaTypeId, documents, applicationData, sPassportNumber, dPassportExpiry, sEmploymentStatus, sTravelDates, sCoverLetter } = req.body

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

      const documentArray = (documents || []).map(doc => {
        const { sS3Url, ...docWithoutUrl } = doc
        return docWithoutUrl
      })

      // Merge top-level fields with applicationData (top-level takes precedence)
      const appData = {
        ...(applicationData || {}),
        ...(sPassportNumber !== undefined && { sPassportNumber }),
        ...(dPassportExpiry !== undefined && { dPassportExpiry }),
        ...(sEmploymentStatus !== undefined && { sEmploymentStatus }),
        ...(sTravelDates !== undefined && { sTravelDates }),
        ...(sCoverLetter !== undefined && { sCoverLetter })
      }

      if (application) {
        application.aDocuments = documentArray
        if (appData.sPassportNumber !== undefined) application.sPassportNumber = appData.sPassportNumber
        if (appData.dPassportExpiry !== undefined) application.dPassportExpiry = appData.dPassportExpiry
        if (appData.sEmploymentStatus !== undefined) application.sEmploymentStatus = appData.sEmploymentStatus
        if (appData.sTravelDates !== undefined) application.sTravelDates = appData.sTravelDates
        if (appData.sCoverLetter !== undefined) application.sCoverLetter = appData.sCoverLetter
        const { sPassportNumber, dPassportExpiry, sEmploymentStatus, sTravelDates, sCoverLetter, ...otherData } = appData
        if (Object.keys(otherData).length > 0) {
          application.oApplicationData = otherData
        }
        await application.save()
      } else {
        const { sPassportNumber, dPassportExpiry, sEmploymentStatus, sTravelDates, sCoverLetter, ...otherData } = appData
        application = await Application.create({
          iUserId: userId,
          iCountryId: countryId,
          iVisaTypeId: visaTypeId,
          aDocuments: documentArray,
          sPassportNumber,
          dPassportExpiry,
          sEmploymentStatus,
          sTravelDates,
          sCoverLetter,
          oApplicationData: Object.keys(otherData).length > 0 ? otherData : {}
        })
      }

      // Perform validation
      const validationResults = await performValidation(application)

      return res.status(status.OK).json({
        status: status.OK,
        data: validationResults
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

      if (!application) {
        return res.status(status.NotFound).json({
          status: status.NotFound,
          message: 'Application not found'
        })
      }

      const validationResults = await performValidation(application)

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
