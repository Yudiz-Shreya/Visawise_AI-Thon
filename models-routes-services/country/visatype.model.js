const mongoose = require('mongoose')
const { DB } = require('../../databse/mongoose')

const visaTypeSchema = new mongoose.Schema({
  iCountryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Country',
    required: true,
    index: true
  },
  sType: {
    type: String,
    required: true,
    enum: ['Tourist', 'Business', 'Student', 'Work'],
    trim: true
  },
  sDuration: {
    type: String,
    required: true,
    trim: true
  },
  sProcessingTime: {
    type: String,
    required: true,
    trim: true
  },
  nDocumentsRequired: {
    type: Number,
    required: true,
    default: 0
  },
  aRequiredDocuments: [{
    sName: {
      type: String,
      trim: true
    },
    sDescription: {
      type: String,
      trim: true
    },
    bIsMandatory: {
      type: Boolean,
      default: true
    }
  }],
  nFee: {
    type: Number,
    default: 0
  },
  sCurrency: {
    type: String,
    default: 'USD',
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

visaTypeSchema.index({ iCountryId: 1, sType: 1 })
visaTypeSchema.index({ eStatus: 1 })

const VisaType = DB.model('visatypes', visaTypeSchema)

module.exports = VisaType
