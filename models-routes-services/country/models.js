const mongoose = require('mongoose')
const { DB } = require('../../databse/mongoose')

const countrySchema = new mongoose.Schema({
  sName: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  sCode: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  eStatus: {
    type: String,
    enum: ['Y', 'N'],
    default: 'Y'
  },
  dCreatedAt: {
    type: Date,
    default: Date.now
  },
  dUpdatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'dCreatedAt', updatedAt: 'dUpdatedAt' }
})

countrySchema.index({ eStatus: 1 })

const Country = DB.model('countries', countrySchema)

module.exports = Country
