const slugify = require('slugify')
const _ = require('lodash')

const db = require('../models')
const websocket = require('../websocket')
const searchClient = require('../services/elastic')

//Todo bu arkadası hic begenmiyorum.
const { buildLinks } = require('./link')

//TODO Bu iki abi şüpheli
const generateSchema = require('../utils/schema')

const postmark = require('postmark')

module.exports.show = async (req, res) => {
  const { topic } = req

  //TODO Plain muhabbetini serializer'a bırakmak lazım.
  //const _topic = topic.get({ plain: true })
  //const schema = generateSchema(_topic)

  //TODO Bu schema nedir? Neden buradadır?
  //topic.set('schema', schema, { raw: true })
  return res.json(topic)
}

module.exports.create = async (req, res) => {
  //TODO bunları request objesi altından cekmeliyim, böyle cok dagınık. @Deniz? 
  let { title, links, public_rights } = res.locals.validation.value

  const topic = await db.topics.create({
    title,
    public_rights,
  })  

  topic.set({
    slug: slugify(`${title}-${topic.id}`, { lower: true })
  })

  await topic.save()
  await topic.addUser(req.user, { through: { role: 'owner' } })

  let _links = links && links.length > 0 && (await buildLinks(links, topic.id))
  //Todo dirty.
  let dbLinks = null
  if (_links) dbLinks = await db.links.bulkCreate(_links)
  topic.set('links', dbLinks || [], { raw: true })
  topic.authorize(req.user)

  await searchClient.indexTopic(topic)
  await searchClient.indexLinks(topic, dbLinks)

  return res.json(topic)
}

module.exports.update = async (req, res) => {
  let { topic } = req

  let { public_rights, title, users } = res.locals.validation.value

  if (title) {
    topic.title = title
    topic.slug = slugify(`${title}-${topic.id}`, { lower: true })
  }
  if (public_rights) {
    topic.public_rights = public_rights
  }

  await topic.save()

  if (title) {
    await searchClient.updateTopic(topic)
  }

  let _users = []

  //Todo bunu ayrı endpoint'e almak lazım. @Deniz
  if (users) {
    for await (u of users) {
      let targetUser = await db.users.findOne({
        where: {
          id: u.id,
        },
        attributes: {
          include: ['email'],
        },
      })
      //TODO Temp nedir acil deniz'e sor.
      if (u.temp) {
        const topicUser = await topic.hasUser(targetUser)
        if (!topicUser) {
          _users.push({
            user: targetUser,
            new: true,
            role: u.user_topics.role,
          })
        }
      } else {
        const userTopic = await db.user_topics.findOne({
          where: {
            topic_id: topic.id,
            user_id: u.id,
          },
        })
        if (userTopic.role === 'owner') continue
        else if (u.user_topics.role === 'remove') {
          _users.push({
            user: targetUser,
            role: 'remove',
          })
        } else {
          _users.push({
            user: targetUser,
            role: u.user_topics.role,
            userTopic,
          })
        }
      }
    }
  }

  if (_users.length > 0) {
    for await (user of _users) {
      let index = topic.users.findIndex(
        (u) => u.id === user.user.id
      )
      if (user.new) {
        const user_topics = await topic.addUser(user.user, {
          through: { role: user.role },
        })
        user.user.user_topics = user_topics[0]
        topic.users.push(user.user)
      } else if (user.role === 'remove') {
        await topic.removeUser(user.user.id)
        topic.users.splice(index, 1)
      } else {
        user.userTopic = await user.userTopic.update({ role: user.role })
        await user.userTopic.save()
        user.user.user_topics = user.userTopic
        topic.users[index] = user.user
      }
    }
  }

  

  let _topic = topic.toJSON({
    socket: true,
  })

  let links = null
  if (
    (public_rights && public_rights !== 'off') ||
    _users.some((u) => u.role !== 'remove')
  ) {
    //Todo optimize.
    links = await db.links.findAll({
      where: { topic_id: topic.get('id') },
      attributes: { exclude: 'content' },
    })
  }

  if (_users.length > 0) {
    for (user of _users) {
      if (user.new) {
        websocket.addUser(res.io, {
          ..._topic,
          links,
          user: user.user,
        })
        const client = new postmark.ServerClient(
          process.env.POSTMARK_SERVER_TOKEN
        )
        if (process.env.NODE_ENV !== 'test')
          client
            .sendEmailWithTemplate({
              From: process.env.EMAIL_FROM,
              To: user.user.email,
              TemplateId: process.env.POSTMARK_TEMPLATE_INVITATION,
              TemplateModel: {
                title: topic.title,
                name: user.user.name || user.user.username,
                referrer: req.user.name || req.user.username,
                action_url: `https://index.as/${req.user.username}/${topic.slug}`,
              },
            })
            .then(() => {})
            .catch((e) => console.log(e))
      } else if (user.role === 'remove') {
        websocket.removeUser(res.io, {
          ..._topic,
          user: user.user,
          requester: req.user.id,
        })
      } else {
        websocket.updateUser(res.io, {
          ..._topic,
          user: user.user,
        })
      }
    }
  }

  if (users) {
    if (process.env.NODE_ENV !== 'test')
      websocket.updateTopic(res.io, {
        ..._topic,
        requester: req.user.id,
        editorOnly: true,
      })
  }

  if (title)
    if (process.env.NODE_ENV !== 'test')
      websocket.updateTopic(res.io, {
        ..._topic,
        requester: req.user.id,
      })

  if (public_rights)
    if (process.env.NODE_ENV !== 'test')
      websocket.modifyPublic(res.io, {
        ..._topic,
        links,
        requester: req.user.id,
      })

  return res.json(topic)
}

module.exports.delete = async (req, res) => {
  const { topic } = req

  if (!req.user.isOwner(topic)) {
    return res.status(401).json({
      error: {
        message: 'Unauthorized!',
      },
    })
  }

  const _topic = topic.toJSON({
    socket: true,
  })

  await topic.destroy()

  await db.user_topics.destroy({
    where: {
      topic_id: req.topic.id,
    },
  })

  await db.links.destroy({
    where: {
      topic_id: req.topic.id,
    },
  })

  //Env kontrolü burada olmamalı.
  if (process.env.NODE_ENV !== 'test')
    websocket.deleteTopic(res.io, { ..._topic, requester: req.user.id })
  await searchClient.removeTopic(_topic.id)

  return res.status(200).json({
    message: 'Your topic has been deleted successfully!',
  })
}

module.exports.clone = async (req, res) => {
  
  const source = req.topic
  await source.getLinks()

  let params = {
    cloned_from: topic.id,
    title: 'Clone - ' + topic.title,
    public_rights: 'off',
  }

  
  const clone = await db.topics.create(params)

  clonse.slug = slugify(`${clone.title}-${clone.id}`, {
    lower: true,
  })

  await clone.save()
  await clone.addUser(req.user, { through: { role: 'owner' } })
  //TODO check clone.user
  //Todo check order: [[db.sequelize.literal(`"users->user_topics".created_at`), 'ASC']],

  const links = source.get('links').map((l) => {
    l = l.get({ plain: true })
    delete l.id
    l.topic_id = clone.id
    return l
  })

  //Todo dirty.
  let dbLinks = null
  if (_links) dbLinks = await db.links.bulkCreate(_links)
  clone.set('links', dbLinks || [], { raw: true })

  clone.authorize(req.user)
  await searchClient.indexTopic(clone)
  await searchClient.indexLinks(clone, dbLinks)

  return res.json(clone)
}

module.exports.search = async (req, res) => {
  let { q, username, offset, limit, cat } = res.locals.validation.value

  if (!username) {
    if (req.user) {
      username = req.user.id
    } else {
      return res.status(404).json({
        error: {
          message: 'You must specify a user!',
        },
      })
    }
  }

  let topicData = null
  if (username !== req.user.id)
    topicData = await searchClient.profileSearch(username, q,  offset, limit)
  else if (cat == 'all') {
    topicData = await searchClient.homeSearch(username, q, offset, limit)
  } else if (cat == 'owner') {
    topicData = await searchClient.ownedSearch(username, q, offset, limit)
  } else if (cat == 'shared') {
    topicData = await searchClient.sharedSearch(username, q, offset, limit)
  }
  
  topicData.topics = topicData.topics.map(t => t.authorize(req.user))

  return res.json(topicData)
}

module.exports.leave = async (req, res) => {
  const { topic } = req

  let targetUser = await topic.getUsers({ where: { id: req.user.id } })

  if (targetUser.length < 1) {
    return res.status(404).json({
      error: {
        message: 'User not found',
      },
    })
  }

  targetUser = targetUser[0]

  if (targetUser.user_topics.role == 'owner') {
    return res.status(403).json({
      error: {
        message: 'Topic owner cannot leave topic',
      },
    })
  }

  await topic.removeUser(targetUser.id)
  targetUser = targetUser.get({
    plain: true,
  })

  let _topic = topic.toJSON({
    socket: true,
  })

  let usr = _topic.users.findIndex((u) => {
    u.id === targetUser.id
  })
  _topic.users.splice(usr, 1)

  let obj = {
    ..._topic,
    user: targetUser,
    requester: req.user.id,
  }

  if (process.env.NODE_ENV !== 'test') websocket.userLeft(res.io, obj)

  topic.set('users', _topic.users, { raw: true })
  return res.json({ message: 'User has been removed from this topic.' })
}
