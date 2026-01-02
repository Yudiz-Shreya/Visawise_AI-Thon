const mongoose = require('mongoose')

const config = require('../config/config')
const { handleCatchError } = require('../helpers/utilities.service')

const DB = connection(
  config.DB_URL,
  parseInt(config.DB_POOLSIZE) || 10,
  'visawise-ai-thon'
)

function connection(DB_URL, maxPoolSize = 10, DB) {
  try {
    const dbConfig = {
      maxPoolSize,
      readPreference: 'secondaryPreferred'
    }
    // if (process.env.MONGO_DEBUG === 'true') mongoose.set('debug', true)

    const conn = mongoose.createConnection(DB_URL, dbConfig)

    conn.on('connected', () => console.log(`Connected to ${DB} database.`))
    return conn
  } catch (error) {
    console.log('error', error)
    handleCatchError(error)
  }
}

module.exports = {
  DB
}
