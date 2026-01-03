const mongoose = require('mongoose')
const { DB } = require('../../databse/mongoose')

const userSchema = new mongoose.Schema({
  sMobNum: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  bIsMobVerified: {
    type: Boolean,
    default: false
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

const User = DB.model('users', userSchema)

module.exports = User
