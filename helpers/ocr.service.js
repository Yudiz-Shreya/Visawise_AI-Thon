const { createWorker } = require('tesseract.js')
const { s3Client } = require('./s3.service')
const { GetObjectCommand } = require('@aws-sdk/client-s3')
const config = require('../config/config')
const pdf = require('pdf-parse')

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
      try {
        const worker = await createWorker('eng')
        const { data: { text } } = await worker.recognize(fileBuffer)
        await worker.terminate()
        return text || ''
      } catch (error) {
        console.error('OCR error for image:', error)
        throw new Error(`Failed to extract text from image: ${error.message}`)
      }
    } else if (isPdf) {
      try {
        const pdfData = await pdf(fileBuffer)
        const extractedText = pdfData.text || ''
        if (extractedText.trim().length > 0) {
          return extractedText
        }
        console.log('PDF has no extractable text, trying OCR on first page...')
        const worker = await createWorker('eng')
        const { data: { text } } = await worker.recognize(fileBuffer)
        await worker.terminate()
        return text || ''
      } catch (error) {
        console.error('PDF extraction error:', error)
        throw new Error(`Failed to extract text from PDF: ${error.message}`)
      }
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
    if (config.OCR_PROVIDER === 'TEST') {
      return {
        isValid: true,
        reason: 'Document validated successfully (test mode)',
        extractedData: {
          fullText: 'Test mode - no text extracted'
        }
      }
    }

    if (!s3Key) {
      return {
        isValid: false,
        reason: 'S3 key is missing',
        extractedData: {}
      }
    }

    const extractedText = await extractTextFromS3(s3Key)

    if (!extractedText || extractedText.trim().length === 0) {
      return {
        isValid: false,
        reason: `Could not extract text from ${documentType}. Please ensure the document is clear and readable.`,
        extractedData: {
          fullText: ''
        }
      }
    }

    const extractedData = {
      fullText: extractedText.trim()
    }

    return {
      isValid: true,
      reason: 'Document validated successfully using OCR',
      extractedData
    }
  } catch (error) {
    console.error('OCR validation error for', documentType, ':', error)
    return {
      isValid: false,
      reason: `Could not extract text from ${documentType}. ${error.message || 'Please ensure the document is clear and readable.'}`,
      extractedData: {
        fullText: '',
        error: error.message
      }
    }
  }
}

module.exports = {
  validateDocument
}
