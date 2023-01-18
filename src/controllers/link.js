const db = require('../models')
const previewLink = require('../services/linkMetadata')
const websocket = require('../websocket')
const searchClient = require('../services/elastic')
const isInteger = require('../utils/isInteger')
const async = require('async')

//Todo model function
module.exports.buildLinks = async (links, topic_id) => {
  let minSort = await db.links.min('sort', {
    where: {
      topic_id,
    },
  })
  minSort = isNaN(minSort) ? 0 : minSort
  let _linkFunctions = links.map((link, index) => async () => {
    if (!link.title) {
      try {
        const linkData = await previewLink(link.url)
        link = Object.assign(link, linkData)
        if (linkData.title.length > 0) {
          link.title = linkData.title.trim()
        } else {
          link.title = link.url
        }
      } catch (error) {
        console.log(error)
        link.title = link.url
      }
    }
    link.sort = minSort + index - links.length
    link.topic_id = topic_id
  })
  await new Promise((resolve, reject) => {
    async.parallel(_linkFunctions, (err, results) => {
      resolve()
    })
  })
  return links
}

//TODO Sacma bi funksiyon,bakarız
module.exports.sortLinks = async (links, topic) => {

  //Todo optimize.
  const topicLinks = await db.links.findAll({
    where: { topic_id: topic.get('id') },
  })
  for await (const link of topicLinks) {
    let _link = links.find((l) => l.id === link.id)
    link.sort = _link && _link.sort
    await link.save()
  }
  return { topicLinks, links }
}

module.exports.sort = async (req, res, next) => {
  const { topic, body } = req
  let links = await this.sortLinks(body, topic)
  
  await searchClient.updateLinks(links.topicLinks)

  let _topic = topic.toJSON({ socket: true })
  websocket.updateLinkSort(res.io, {
    links: links.links,
    ..._topic,
    requester: req.user.id,
  })
  return res.sendStatus(200)
}

//Todo ok
module.exports.create = async (req, res) => {
  const { topic } = req
  let __links = req.body
  let links = []

  //TODO optimize this.
  for await (link of __links) {
    let _link = await db.links.findOne({
      where: {
        url: link.url,
        topic_id: topic.id,
      },
    })
    if (!_link) links.push(link)
  }

  let _links = await this.buildLinks(links, topic.id)

  // add links to DB
  const createdLinks = await db.links.bulkCreate(_links)

  // index added link
  await searchClient.indexLinks(topic, createdLinks)

  // send updated data via websocket
  let _topic = topic.toJSON({ socket: true })
  _topic.createdLinks = createdLinks
  
  if (process.env.NODE_ENV !== 'test')
    websocket.addLink(res.io, { ..._topic, requester: req.user.id })

  // get content for added links
  topic.changed('updated_at', true)
  await topic.save()

  await searchClient.updateTopic(topic)

  return res.json(createdLinks)
}

//Todo ok
module.exports.update = async (req, res) => {
  const { topic } = req

  if (!isInteger(req.params.link_id)) {
    return res.status(404).json({
      error: {
        message: 'Invalid link!',
      },
    })
  }

  let link = await db.links.findOne({
    where: {
      id: req.params.link_id,
      topic_id: topic.id,
    },
  })

  if (!link) {
    return res.status(404).json({
      error: {
        message: 'Link not found!',
      },
    })
  }

  // update link
  const linkParams = req.body
  link.set({ ...linkParams })
  await link.save()

  // update index
  await searchClient.updateLink(link)

  // send data via websocket
  let _topic = topic.toJSON({ socket: true })

  //TODO Böyle sıkıntılı islerden kacmak lazım
  _topic.updatedLink = link
  if (process.env.NODE_ENV !== 'test')
    websocket.updateLink(res.io, { ..._topic, requester: req.user.id })

  topic.changed('updated_at', true)
  await topic.save()

  await searchClient.updateTopic(topic)
  return res.json(link)
}

//Todo ok
module.exports.remove = async (req, res) => {
  const { topic } = req

  if (!isInteger(req.params.link_id)) {
    return res.status(404).json({
      error: {
        message: 'Invalid link!',
      },
    })
  }

  const link = await db.links.findOne({
    where: {
      id: req.params.link_id,
      topic_id: topic.id,
    },
  })

  if (!link) {
    return res.status(404).json({
      error: {
        message: 'Link not found!',
      },
    })
  }

  await searchClient.removeLink(link.id)

  let _topic = topic.toJSON({
    socket: true,
  })
  _topic.deletedLink = link
  
  await link.destroy()

  if (process.env.NODE_ENV !== 'test')
    websocket.deleteLink(res.io, { ..._topic, requester: req.user.id })

  topic.changed('updated_at', true)
  await topic.save()

  await searchClient.updateTopic(topic)

  return res.sendStatus(200)
}

module.exports.search = async (req, res) => {
  const { topic } = req

  const { q } = res.locals.validation.value

  let links = await searchClient.linkSearch(
    q,
    req.user.id,
    topic.get({
      plain: true,
    })
  )

  return res.json(links)
}
