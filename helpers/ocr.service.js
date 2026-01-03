const { createWorker } = require('tesseract.js')
const { s3Client } = require('./s3.service')
const { GetObjectCommand } = require('@aws-sdk/client-s3')
const config = require('../config/config')

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

    const extractedText = await extractTextFromS3(s3Key)

    if (!extractedText || extractedText.trim().length === 0) {
      return {
        isValid: false,
        reason: `Could not extract text from ${documentType}. Please ensure the document is clear and readable.`,
        extractedData: {}
      }
    }

    const extractedData = {
      fullText: extractedText
    }

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
  validateDocument
}
