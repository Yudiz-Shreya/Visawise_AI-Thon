const config = require('../config/config')
const { handleCatchError } = require('./utilities.services')
const { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const { Upload } = require('@aws-sdk/lib-storage')

const s3Client = new S3Client({
  region: config.AWS_REGION,
  credentials: {
    accessKeyId: config.AWS_ACCESS_KEY,
    secretAccessKey: config.AWS_SECRET_KEY
  }
})

function getProjectPath(path) {
  const projectFolder = config.S3_PROJECT_FOLDER || 'visawise/'
  const normalizedPath = path.startsWith('/') ? path.substring(1) : path
  const normalizedFolder = projectFolder.endsWith('/') ? projectFolder : projectFolder + '/'
  return normalizedFolder + normalizedPath
}

function checkValidFileType(sFileName, sContentType) {
  const allowedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  const fileExtension = sFileName.split('.').pop().toLowerCase()
  const allowedExtensions = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx']

  if (!allowedTypes.includes(sContentType.toLowerCase()) && !allowedExtensions.includes(fileExtension)) {
    return false
  }
  return true
}

async function signedUrl(sFileName, sContentType, path) {
  try {
    sFileName = sFileName.replace('/', '-')
    sFileName = sFileName.replace(/\s/gi, '-')
    const fileKey = `${Date.now()}_${sFileName}`
    const s3Path = getProjectPath(path)
    const params = {
      Bucket: config.S3_BUCKET_NAME,
      Key: s3Path + fileKey,
      ContentType: sContentType
    }
    const expiresIn = 900
    const command = new PutObjectCommand(params)
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn })
    return { sUrl: signedUrl, sPath: s3Path + fileKey }
  } catch (error) {
    handleCatchError(error)
    throw error
  }
}

async function deleteObject(s3Params) {
  try {
    const updatedParams = { ...s3Params }
    if (updatedParams.Key && !updatedParams.Key.startsWith(config.S3_PROJECT_FOLDER)) {
      updatedParams.Key = getProjectPath(updatedParams.Key)
    }
    const headCommand = new HeadObjectCommand(updatedParams)
    const headResponse = await s3Client.send(headCommand)
    if (headResponse) {
      const deleteCommand = new DeleteObjectCommand(updatedParams)
      const response = await s3Client.send(deleteCommand)
      return response
    }
  } catch (error) {
    handleCatchError(error)
  }
}

async function putObj(sFileName, sContentType, path, fileStream, deposition) {
  try {
    sFileName = sFileName.replace('/', '-')
    sFileName = sFileName.replace(/\s/gi, '-')
    let fileKey = ''
    const s3Path = getProjectPath(path)
    fileKey = `${Date.now()}_${sFileName}`
    const params = {
      Bucket: config.S3_BUCKET_NAME,
      Key: s3Path + fileKey,
      ContentType: sContentType,
      Body: fileStream
    }
    if (deposition) params.ContentDisposition = deposition
    const command = new PutObjectCommand(params)
    const response = await s3Client.send(command)
    response.key = params.Key
    response.Key = params.Key
    return response
  } catch (error) {
    handleCatchError(error)
  }
}

async function s3GetObjSignedUrl(params) {
  try {
    const updatedParams = { ...params }
    if (updatedParams.Key && !updatedParams.Key.startsWith(config.S3_PROJECT_FOLDER)) {
      updatedParams.Key = getProjectPath(updatedParams.Key)
    }
    const command = new GetObjectCommand(updatedParams)
    const url = await getSignedUrl(s3Client, command, { expiresIn: 300 })
    return url
  } catch (error) {
    handleCatchError(error)
  }
}

async function streamObject(Bucket, Key, ContentType, Body) {
  try {
    const projectKey = getProjectPath(Key)
    const params = { Bucket, Key: projectKey, Body, ContentType }
    const uploader = new Upload({ client: s3Client, params })
    const res = await uploader.done()
    return (res?.$metadata?.httpStatusCode === 200)
  } catch (error) {
    handleCatchError(error)
    return false
  }
}

module.exports = {
  signedUrl,
  deleteObject,
  putObj,
  s3GetObjSignedUrl,
  streamObject,
  checkValidFileType,
  s3Client
}
