const { status, jsonStatus } = require('../helpers/api.responses')

module.exports = (app) => {
  // Admin Module Routes
  app.use('/api', [
    require('../models-routes-services/country/routes'), // Notification routes
    require('../models-routes-services/users/routes')
  ])

  app.get('/health-check', (req, res) => {
    const sDate = new Date().toJSON()
    return res.status(status.OK).jsonp({ status: jsonStatus.OK, sDate })
  })
}
