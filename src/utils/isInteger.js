const isInteger = (id) => {
  if (
    id &&
    id % 1 === 0 &&
    Number.MAX_SAFE_INTEGER > id &&
    id > Number.MIN_SAFE_INTEGER
  )
    return id
  else return false
}

module.exports = isInteger
