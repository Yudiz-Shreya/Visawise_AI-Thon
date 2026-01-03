const express = require('express')
const router = express.Router()
const services = require('./services')

router.post('/send-otp', services.sendOTP)
router.post('/verify-otp', services.verifyOTP)

module.exports = router
