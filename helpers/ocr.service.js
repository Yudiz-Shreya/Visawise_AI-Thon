const { createWorker } = require('tesseract.js')
const { s3Client } = require('./s3.service')
const { GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3')
const config = require('../config/config')
const pdf = require('pdf-parse')

let pdfjsLib = null
let canvas = null

try {
  pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js')
  canvas = require('canvas')
} catch (error) {
  // pdfjs-dist or canvas not installed, will use pdf-parse only
}

async function checkFileExists(key) {
  try {
    const headCommand = new HeadObjectCommand({
      Bucket: config.S3_BUCKET_NAME,
      Key: key
    })
    await s3Client.send(headCommand)
    return true
  } catch (error) {
    if (error.Code === 'NotFound' || error.Code === 'NoSuchKey') {
      return false
    }
    throw error
  }
}

async function extractTextFromS3(s3Key) {
  const projectFolder = config.S3_PROJECT_FOLDER || 'visawise/'
  const normalizedFolder = projectFolder.endsWith('/') ? projectFolder : projectFolder + '/'

  const possibleKeys = []
  if (s3Key.startsWith(normalizedFolder)) {
    possibleKeys.push(s3Key)
    possibleKeys.push(s3Key.replace(normalizedFolder, ''))
  } else {
    possibleKeys.push(normalizedFolder + (s3Key.startsWith('/') ? s3Key.substring(1) : s3Key))
    possibleKeys.push(s3Key)
  }

  let workingKey = null
  for (const key of possibleKeys) {
    const exists = await checkFileExists(key)
    if (exists) {
      workingKey = key
      break
    }
  }

  if (!workingKey) {
    throw new Error(`File not found in S3. Tried keys: ${possibleKeys.join(', ')}. Please ensure the file was uploaded correctly and the S3 key in the database matches the actual file location.`)
  }

  const command = new GetObjectCommand({
    Bucket: config.S3_BUCKET_NAME,
    Key: workingKey
  })

  const s3Object = await s3Client.send(command)
  const chunks = []
  for await (const chunk of s3Object.Body) {
    chunks.push(chunk)
  }
  const fileBuffer = Buffer.concat(chunks)

  const fileExtension = workingKey.split('.').pop().toLowerCase()
  const isImage = ['jpg', 'jpeg', 'png'].includes(fileExtension)
  const isPdf = fileExtension === 'pdf'

  if (isImage) {
    try {
      const worker = await createWorker('eng')
      const { data: { text } } = await worker.recognize(fileBuffer)
      await worker.terminate()
      return text || ''
    } catch (error) {
      throw new Error(`Failed to extract text from image: ${error.message}`)
    }
  } else if (isPdf) {
    let extractedText = ''
    let pdfError = null

    // Try pdf-parse first
    try {
      const pdfData = await pdf(fileBuffer)
      extractedText = pdfData.text || ''
      if (extractedText.trim().length > 0) {
        return extractedText
      }
    } catch (error) {
      pdfError = error
    }

    // Fall back to OCR if pdf-parse failed or returned no text
    // Convert PDF pages to images first, then use OCR (if pdfjs-dist and canvas are available)
    if (pdfjsLib && canvas) {
      try {
        const loadingTask = pdfjsLib.getDocument({ data: fileBuffer })
        const pdfDocument = await loadingTask.promise
        const numPages = pdfDocument.numPages

        const worker = await createWorker('eng')
        let allText = ''

        // Process first 3 pages (to avoid processing too many pages)
        const pagesToProcess = Math.min(numPages, 3)

        for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
          try {
            const page = await pdfDocument.getPage(pageNum)
            const viewport = page.getViewport({ scale: 2.0 })

            const pdfCanvas = canvas.createCanvas(viewport.width, viewport.height)
            const context = pdfCanvas.getContext('2d')

            await page.render({
              canvasContext: context,
              viewport
            }).promise

            const imageBuffer = pdfCanvas.toBuffer('image/png')
            const { data: { text } } = await worker.recognize(imageBuffer)

            if (text && text.trim().length > 0) {
              allText += text + '\n'
            }
          } catch (pageError) {
            // Continue with next page if one fails
            continue
          }
        }

        await worker.terminate()

        if (allText && allText.trim().length > 0) {
          return allText.trim()
        }
      } catch (ocrError) {
        // If OCR fails, fall through to return pdf-parse result or throw error
      }
    }

    // If OCR not available or failed, return whatever pdf-parse got
    if (extractedText) {
      return extractedText
    }

    // If both methods failed and no text extracted
    throw new Error(`Failed to extract text from PDF. pdf-parse error: ${pdfError?.message || 'unknown'}. ${pdfjsLib && canvas ? 'OCR conversion also failed.' : 'PDF to image conversion libraries not installed. Please install pdfjs-dist and canvas for OCR support on PDFs.'}`)
  } else {
    return fileBuffer.toString('utf-8')
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
