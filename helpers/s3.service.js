const config = require('../config/config')
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')

const s3Client = new S3Client({
  region: config.AWS_REGION,
  credentials: {
    accessKeyId: config.AWS_ACCESS_KEY,
    secretAccessKey: config.AWS_SECRET_KEY
  }
})

function checkValidFileType(sFileName, sContentType) {
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  const fileExtension = sFileName.split('.').pop().toLowerCase()
  const allowedExtensions = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx']

  if (!allowedTypes.includes(sContentType.toLowerCase()) && !allowedExtensions.includes(fileExtension)) {
    return false
  }
  return true
}

async function getPreSignedUrl(sFileName, sContentType, path) {
  try {
    sFileName = sFileName.replace(/\//g, '-').replace(/\s/g, '-')
    const fileKey = `${Date.now()}_${sFileName}`
    const s3Path = path || 'documents/'

    const params = {
      Bucket: config.S3_BUCKET_NAME,
      Key: s3Path + fileKey,
      ContentType: sContentType
    }

    const expiresIn = 300
    const command = new PutObjectCommand(params)
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn })

    return { sUrl: signedUrl, sPath: s3Path + fileKey }
  } catch (error) {
    console.error('S3 signed URL error:', error)
    throw error
  }
}

module.exports = {
  getPreSignedUrl,
  checkValidFileType,
  s3Client
}
