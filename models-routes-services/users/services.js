const { status } = require('../../helpers/api.responses')
const User = require('./model')
const OTP = require('./otp.model')
const { catchError } = require('../../helpers/utilities.services')

function generateOTP(length = 6) {
  const digits = '0123456789'
  let otp = ''
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * 10)]
  }
  return otp
}

function validateMobileNumber(mobile) {
  const mobileRegex = /^[0-9]{10}$/
  return mobileRegex.test(mobile)
}

class UserOtp {
  async sendOTP(req, res) {
    try {
      const { mobileNumber } = req.body

      if (!mobileNumber) {
        return res.status(status.BadRequest).json({
          status: status.BadRequest,
          message: 'Mobile number is required'
        })
      }

      const cleanMobile = mobileNumber.replace(/\D/g, '')
      if (!validateMobileNumber(cleanMobile)) {
        return res.status(status.BadRequest).json({
          status: status.BadRequest,
          message: 'Invalid mobile number. Please enter a valid 10-digit number'
        })
      }

      const thirtySecondsAgo = new Date(Date.now() - 30 * 1000)
      const recentOTP = await OTP.findOne({
        sMobNum: cleanMobile,
        dCreatedAt: { $gte: thirtySecondsAgo }
      }).sort({ dCreatedAt: -1 })

      if (recentOTP) {
        return res.status(status.TooManyRequest).json({
          status: status.TooManyRequest,
          message: 'Please wait 30 seconds before requesting a new OTP'
        })
      }

      const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const otpCount = await OTP.countDocuments({
        sMobNum: cleanMobile,
        dCreatedAt: { $gte: last24Hours }
      })

      if (otpCount >= 20) {
        return res.status(status.TooManyRequest).json({
          status: status.TooManyRequest,
          message: 'OTP request limit reached. Please try again after 24 hours'
        })
      }

      const sCode = process.env.NODE_ENV === 'production' ? generateOTP(6) : '0000'

      await OTP.create({
        sMobNum: cleanMobile,
        sCode,
        dExpiresAt: new Date(Date.now() + 10 * 60 * 1000)
      })

      if (process.env.NODE_ENV === 'production') {
        console.log('SMS OTP sent to:', cleanMobile)
      } else {
        console.log('OTP for', cleanMobile, ':', sCode)
      }

      return res.status(status.OK).json({
        status: status.OK,
        message: 'OTP sent successfully'
      })
    } catch (error) {
      return catchError('UserOtp.sendOTP', error, req, res)
    }
  }

  async verifyOTP(req, res) {
    try {
      const { mobileNumber, otp } = req.body

      if (!mobileNumber || !otp) {
        return res.status(status.BadRequest).json({
          status: status.BadRequest,
          message: 'Mobile number and OTP are required'
        })
      }

      const cleanMobile = mobileNumber.replace(/\D/g, '')
      if (!validateMobileNumber(cleanMobile)) {
        return res.status(status.BadRequest).json({
          status: status.BadRequest,
          message: 'Invalid mobile number'
        })
      }

      const otpRecord = await OTP.findOne({
        sMobNum: cleanMobile,
        bIsVerify: false
      }).sort({ dCreatedAt: -1 })

      if (!otpRecord) {
        return res.status(status.BadRequest).json({
          status: status.BadRequest,
          message: 'No OTP found. Please request a new OTP'
        })
      }

      if (otpRecord.dExpiresAt < new Date()) {
        return res.status(status.BadRequest).json({
          status: status.BadRequest,
          message: 'OTP has expired. Please request a new OTP'
        })
      }

      if (otpRecord.nFailedAttempts >= 5) {
        return res.status(status.TooManyRequest).json({
          status: status.TooManyRequest,
          message: 'Too many failed attempts. Please request a new OTP'
        })
      }

      if (otpRecord.sCode !== otp) {
        await OTP.updateOne(
          { _id: otpRecord._id },
          { $inc: { nFailedAttempts: 1 } }
        )
        return res.status(status.Unauthorized).json({
          status: status.Unauthorized,
          message: 'Invalid OTP'
        })
      }

      await OTP.updateOne(
        { _id: otpRecord._id },
        { bIsVerify: true }
      )

      let user = await User.findOne({ sMobNum: cleanMobile })

      if (!user) {
        user = await User.create({
          sMobNum: cleanMobile,
          bIsMobVerified: true
        })
      } else {
        user.bIsMobVerified = true
        await user.save()
      }

      return res.status(status.OK).json({
        status: status.OK,
        message: 'OTP verified successfully',
        data: {
          userId: user._id,
          mobileNumber: user.sMobNum,
          isVerified: user.bIsMobVerified
        }
      })
    } catch (error) {
      return catchError('UserOtp.verifyOTP', error, req, res)
    }
  }
}

module.exports = new UserOtp()
