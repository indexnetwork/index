const AWS = require('aws-sdk')
const lambda = new AWS.Lambda({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_S3_REGION,
  version: 'v4',
})

const searchClient = require('../services/elastic')

module.exports = getLinkContent = async (createdLinks, db) => {
  try {
    createdLinks.forEach((link) => {
      lambda.invoke(
        {
          FunctionName: 'indexas-crawler-dev-crawl',
          Payload: JSON.stringify({ url: link.url }),
        },
        async (err, data) => {
          let payload = data && JSON.parse(data.Payload)
          if (err) console.error(err, err.stack)
          else if (payload && payload.content) {
            let __link = await link.update({
              content: payload.content,
            })
            await searchClient.updateLink(__link)
          }
        }
      )
    })
  } catch (e) {
    console.log(e)
  }
}


/*
lambda.invoke(
  {
    FunctionName: 'archiver-dev-archive',
    Payload: JSON.stringify({ url: link.url }),
  },
  async (err, data) => {
    let payload = data && JSON.parse(data.Payload)
    if (err) console.error(err, err.stack)
    else if (payload && payload.body) {
      await db.archives.create({
        link_id: link.id,
        url: payload.body,
      })
      __link.set('archive', payload.body, { raw: true })

    }
  }
)
*/
