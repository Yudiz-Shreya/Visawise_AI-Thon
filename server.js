require('dotenv').config()
const express = require('express')
const http = require('http')
const config = require('./config/config')
const app = express()
const server = http.createServer(app)

require('./middleware/index')(app)
require('./middleware/routes')(app)

app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

app.set('view engine', 'ejs')

server.listen(config.PORT, () => {
  console.log(`Server is running on port: ${config.PORT}`)
})
