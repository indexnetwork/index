require('dotenv').config()
const search = require('./controllers/search.js')
const express = require('express')
const app = express()
const port = 3000

app.get('/search/indexes', search.index)
app.get('/search/links', search.link)

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
