const express = require('express')
const router = express.Router()
const services = require('./services')

router.get('/countries/list/v1', services.getCountries)
router.get('/countries/:countryId/visa-types/list/v1', services.getVisaTypes)
router.get('/visa-types/:visaTypeId/documents/list/v1', services.getRequiredDocuments)
router.post('/presigned-url/v1', services.getPresignedUrls)
router.post('/applications/v1', services.createOrUpdateApplication)

module.exports = router
