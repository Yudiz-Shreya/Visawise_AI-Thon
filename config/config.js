const config = {
  PORT: process.env.PORT || 3000,
  DB_URL: process.env.DB_URL || process.env.MONGODB_URI || 'mongodb://localhost:27017/visawise',
  DB_POOLSIZE: process.env.DB_POOLSIZE || 10,
  AWS_ACCESS_KEY: process.env.AWS_ACCESS_KEY,
  AWS_SECRET_KEY: process.env.AWS_SECRET_KEY,
  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
  S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
  S3_BUCKET_URL: process.env.S3_BUCKET_URL,
  OCR_PROVIDER: process.env.OCR_PROVIDER || 'TEST'
}

module.exports = config
