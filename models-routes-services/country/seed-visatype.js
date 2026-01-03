const mongoose = require('mongoose')
const VisaType = require('./visatype.model')
const visaTypeData = require('./visatype-seed.json')

async function seedVisaTypes() {
  try {
    for (const visaType of visaTypeData) {
      const { iCountryId, ...visaTypeFields } = visaType

      const existingVisaType = await VisaType.findOne({
        iCountryId: new mongoose.Types.ObjectId(iCountryId),
        sType: visaTypeFields.sType
      })

      if (existingVisaType) {
        console.log(`Visa type ${visaTypeFields.sType} already exists, skipping...`)
        continue
      }

      await VisaType.create({
        ...visaTypeFields,
        iCountryId: new mongoose.Types.ObjectId(iCountryId)
      })
      console.log(`Created ${visaTypeFields.sType} visa`)
    }
    console.log('Visa types seeded successfully!')
    process.exit(0)
  } catch (error) {
    console.error('Error seeding visa types:', error)
    process.exit(1)
  }
}

seedVisaTypes()
