const mongoose = require('mongoose')
const { DB } = require('../../databse/mongoose')

const otpSchema = new mongoose.Schema({
  sMobNum: {
    type: String,
    required: true,
    index: true
  },
  sCode: {
    type: String,
    required: true
  },
  bIsVerify: {
    type: Boolean,
    default: false
  },
  nFailedAttempts: {
    type: Number,
    default: 0
  },
  dExpiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 10 * 60 * 1000)
  },
  dCreatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'dCreatedAt' }
})

otpSchema.index({ sMobNum: 1, dCreatedAt: -1 })
otpSchema.index({ dExpiresAt: 1 }, { expireAfterSeconds: 0 })

const OTP = DB.model('OTP', otpSchema)

module.exports = OTP

