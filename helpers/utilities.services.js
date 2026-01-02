const { status } = require('http-status')
const catchError = (name, error, req, res) => {
  handleCatchError(error)
  return res.status(status.INTERNAL_SERVER_ERROR).json({
    status: status.INTERNAL_SERVER_ERROR,
    message: 'Something went wrong'
  })
}

const handleCatchError = (error) => {
  // Hook error reporting here if needed (e.g., Sentry)
  const { data = undefined, status = undefined } = error.response ?? {}
  console.trace(error)
  if (error?.code === 'EAUTH' && error?.responseCode === 535) return console.log('**********ERROR***********', 'Username and Password not accepted')
  if (!status) console.log('**********ERROR***********', error)
  else console.log('**********ERROR***********', { status, data, error: data.errors })
}

function generateResponse(res, status, message, data) {
  if (!data) {
    return res.status(status).json({ message })
  } else {
    return res.status(status).json({ message, data })
  }
}

// Escapes and converts a search string into a case-insensitive RegExp
function defaultSearch(sSearch) {
  if (!sSearch) return undefined
  const escaped = String(sSearch).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(escaped, 'i')
}

// Generic pagination/sorting/search normalizer
function getPaginationValues(obj) {
  let { nSkip = 1, nLimit = 10, sSortBy, nOrder, sSearch } = obj

  // Accept common aliases too (page/limit/sortBy/search)
  if (obj.page && !obj.nSkip) nSkip = parseInt(obj.page, 10)
  if (obj.limit && !obj.nLimit) nLimit = parseInt(obj.limit, 10)
  if (!sSortBy) sSortBy = obj.sortBy || 'dCreatedAt'
  if (sSearch == null) sSearch = obj.search

  nLimit = Number.isFinite(Number(nLimit)) ? Number(nLimit) : 10
  nSkip = (nSkip <= 1) ? 0 : ((nSkip - 1) * nLimit)

  const orderBy = (Number(nOrder) === 1) ? 1 : -1
  if (!sSortBy) sSortBy = 'dCreatedAt'

  const sorting = { [sSortBy]: orderBy }
  if (sSortBy === 'nCount') sorting.dCreatedAt = 1

  sSearch = defaultSearch(sSearch)

  return { nSkip, nLimit, sorting, sSearch }
}
module.exports = {
  catchError,
  handleCatchError,
  generateResponse,
  defaultSearch,
  getPaginationValues
}
