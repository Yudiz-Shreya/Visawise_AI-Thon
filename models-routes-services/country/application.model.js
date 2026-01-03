const mongoose = require('mongoose')
const { DB } = require('../../databse/mongoose')

const applicationSchema = new mongoose.Schema({
  iUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'users',
    required: true,
    index: true
  },
  iCountryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'countries',
    required: true,
    index: true
  },
  iVisaTypeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'visatypes',
    required: true,
    index: true
  },
  aDocuments: [{
    sDocumentType: {
      type: String,
      required: true,
      trim: true
    },
    sS3Key: {
      type: String,
      trim: true
    },
    bIsValidated: {
      type: Boolean,
      default: false
    },
    oValidationResult: {
      bIsValid: {
        type: Boolean,
        default: false
      },
      sReason: {
        type: String,
        trim: true
      },
      oExtractedData: {
        type: mongoose.Schema.Types.Mixed
      }
    },
    dUploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  sPassportNumber: {
    type: String,
    trim: true
  },
  dPassportExpiry: {
    type: Date
  },
  sEmploymentStatus: {
    type: String,
    trim: true
  },
  sTravelDates: {
    type: String,
    trim: true
  },
  sCoverLetter: {
    type: String,
    trim: true
  },
  eStatus: {
    type: String,
    enum: ['Draft', 'Submitted', 'Validated', 'Rejected'],
    default: 'Draft'
  },
  oValidationResult: {
    bIsValid: {
      type: Boolean,
      default: false
    },
    aMissingDocuments: [{
      type: String
    }],
    aInvalidDocuments: [{
      sDocumentType: String,
      sReason: String
    }],
    aValidDocuments: [{
      type: String
    }]
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

applicationSchema.index({ iUserId: 1, dCreatedAt: -1 })
applicationSchema.index({ eStatus: 1 })

const Application = DB.model('Application', applicationSchema)

module.exports = Application
