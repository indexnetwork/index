const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const postmark = require('postmark')
const _ = require('lodash')
const Sequelize = require('sequelize')
const upload = require('../services/s3')
const { getToken } = require('../middlewares/jwt')
const validator = require('validator')
const searchClient = require('../services/elastic')
const db = require('../models')


module.exports.serialize = (user, done) => {
  done(null, user.id)
}

module.exports.deserialize = async (id, done) => {
  const user = await db.users.findOne({
    where: {
      id: id,
    },
  })
  done(null, user)
}

module.exports.confirm = async (req, res) => {
  const { confirm } = req.query
  const user = await db.users.scope('all').findOne({
    where: {
      confirmation_key: confirm,
    },
  })

  if (!user || req.user.username !== user.username) {
    return res.status(403).json({
      error: {
        fields: {
          email: 'Invalid key!',
        },
      },
    })
  }

  await user.update({
    confirmation_key: '',
  })

  return res.status(200).json({
    msg: 'Confirmed.',
  })
}

module.exports.sendConfirmation = async (req, res) => {
  const { user } = req

  if (!user) {
    return res.status(400).json({
      error: {
        fields: {
          email: 'Invalid user!',
        },
      },
    })
  }

  let email = user.email

  let _user = await db.users.scope('all').findOne({ where: { email } })

  const client = new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN)

  if (process.env.NODE_ENV !== 'test' && user.confirmation_key)
    client
      .sendEmailWithTemplate({
        From: process.env.EMAIL_FROM,
        To: user.email,
        TemplateId: process.env.POSTMARK_TEMPLATE_EMAIL_CONFIRM,
        TemplateModel: {
          name: user.name || user.username,
          action_url: `https://index.as/?confirm=${_user.confirmation_key}`,
        },
      })
      .then(() => {})
      .catch((e) => console.log(e))

  return res.status(200).json({
    msg: 'Email sent!',
  })
}

module.exports.login = async (req, res) => {
  const { email, password } = req.body
  let user = null
  if (validator.isEmail(email)) {
    user = await db.users.scope('all').findOne({ where: { email } })
  } else {
    let username = email
    user = await db.users.scope('all').findOne({ where: { username } })
  }
  if (!user) {
    return res.status(401).json({
      error: {
        fields: {
          email: 'Invalid email!',
        },
      },
    })
  }

  const isValid = await bcrypt.compare(password, user.password)

  if (!isValid) {
    return res.status(401).json({
      error: {
        fields: {
          password: 'Invalid password!',
        },
      },
    })
  }
  return res.send({ token: getToken(user) })
}

module.exports.register = async (req, res) => {
  const checkEmail = await db.users.findOne({
    where: {
      email: {
        [Sequelize.Op.iLike]: req.body.email,
      },
    },
  })
  if (checkEmail) {
    return res.status(403).json({
      error: {
        fields: {
          email: 'An account with this email already exists!',
        },
      },
    })
  }

  const checkUsername = await db.users.findOne({
    where: {
      username: {
        [Sequelize.Op.iLike]: req.body.username,
      },
    },
  })
  if (checkUsername) {
    return res.status(403).json({
      error: {
        fields: {
          username: 'An account with this username already exists!',
        },
      },
    })
  }

  if (req.body.password.length < 8) {
    return res.status(422).json({
      error: {
        fields: {
          password: 'Password must be longer than 8 characters.',
        },
      },
    })
  }

  const token = crypto.randomBytes(16).toString('hex')

  const user = await db.users.create({
    email: req.body.email,
    username: req.body.username,
    password: req.body.password,
    confirmation_key: token,
  })

  const client = new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN)

  if (process.env.NODE_ENV !== 'test')
    await client
      .sendEmailWithTemplate({
        From: process.env.EMAIL_FROM,
        To: req.body.email,
        TemplateId: process.env.POSTMARK_TEMPLATE_EMAIL_CONFIRM,
        TemplateModel: {
          name: req.body.name || req.body.username,
          action_url: `https://index.as/?confirm=${token}`,
        },
      })
      .then(() => {})
      .catch((e) => console.log(e))

  return res.send({ token: getToken(user) })
}

module.exports.forgotPassword = async (req, res) => {
  const { email } = req.body

  const user = await db.users.scope('all').findOne({ where: { email } })

  if (!user) {
    return res.status(400).json({
      error: {
        fields: {
          email: 'User not found!',
        },
      },
    })
  }

  const token = crypto.randomBytes(16).toString('hex')

  await user.update({ token })

  const client = new postmark.ServerClient(process.env.POSTMARK_SERVER_TOKEN)

  if (process.env.NODE_ENV !== 'test')
    client
      .sendEmailWithTemplate({
        From: process.env.EMAIL_FROM,
        To: user.email,
        TemplateId: process.env.POSTMARK_TEMPLATE_PASSWORD_RESET,
        TemplateModel: {
          name: user.name || user.username,
          action_url: `https://index.as/reset-password?token=${token}`,
        },
      })
      .then(() => {})
      .catch((e) => console.log(e))

  return res.json({
    message: `We sent a message to ${user.email} so you can pick your new password.`,
  })
}

module.exports.resetPassword = async (req, res) => {
  const { password, token } = res.locals.validation.value

  const user = await db.users.scope('all').findOne({
    where: {
      token,
    },
  })

  if (!user) {
    return res.status(403).json({
      error: {
        message: 'Invalid token!',
      },
    })
  }

  if (password.length < 8) {
    return res.status(422).json({
      error: {
        fields: {
          password: 'Password must be longer than 8 characters.',
        },
      },
    })
  }

  const hashedPassword = await bcrypt.hash(password, 10)

  await user.update({
    password: hashedPassword,
    token: '',
    confirmation_key: '',
  })

  return res.json({ message: 'Your password has been changed successfully!' })
}

module.exports.updateUser = async (req, res) => {
  let duplicateEmail = await db.users.findOne({
    where: {
      email: req.body.email,
    },
  })

  let duplicateUsername = await db.users.findOne({
    where: {
      username: req.body.username,
    },
  })

  if (duplicateEmail && req.user.email !== req.body.email) {
    return res.status(403).json({
      error: {
        fields: {
          email: 'Email already exists.',
        },
      },
    })
  }

  if (duplicateUsername && req.user.username !== req.body.username) {
    return res.status(403).json({
      error: {
        fields: {
          username: 'Username already exists.',
        },
      },
    })
  }

  const user = await req.user.update(res.locals.validation.value)
  //TODO remove this.
  searchClient.updateUser(
    user.get({
      plain: true,
    })
  )
  let token = getToken(user)
  user.token = token
  return res.json(user)
}

module.exports.updatePicture = async (req, res) => {
  const handler = upload.single('file')
  handler(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        error: {
          message: err.message,
        },
      })
    }
    if (!req.file) req.user.profile_picture = ''
    else req.user.profile_picture = `${process.env.STATIC_HOST}/${req.file.key}`
    req.user = await req.user.save()
    updateUser({
      id: req.user.id,
      profile_picture: req.user.profile_picture,
    })
    return res.json({
      avatar: req.user.profile_picture,
      token: getToken(req.user),
    })
  })
}

// Get current user with topics
module.exports.me = async (req, res) => {
  let { user } = req
  let { offset, limit, cat } = res.locals.validation.value

  user = user.get({
    plain: true,
  })

  let q = ''

  let topicData = {}

  if (cat == 'all') {
    topicData = await searchClient.homeSearch(user.id, q, offset, limit)
  } else if (cat == 'owner') {
    topicData = await searchClient.ownedSearch(user.id, q, offset, limit)
  } else if (cat == 'shared') {
    topicData = await searchClient.sharedSearch(user.id, q, offset, limit)
  }

  topicData.topics = topicData.topics.map(t => t.authorize(req.user))

  user = Object.assign(user, topicData)

  return res.json(user)
}

module.exports.myTopics = async (req, res) => {
  let { user } = req
  let { offset, limit } = req.query
  user = user.get({
    plain: true,
  })

  let q = ''

  let topicData = {}

  topicData = await searchClient.ownedSearch(user.id, q, offset, limit)
  topicData.topics = topicData.topics.map(t => t.authorize(req.user))

  return res.json(topicData.topics)
}

// Get user by username with topics
module.exports.username = async (req, res) => {
  const { username } = req.params
  let { offset, limit } = req.query
  let user = await db.users.findOne({ where: { username } })

  if (!offset) offset = 0
  if (!limit) limit = 100

  if (!user) {
    return res.status(404).json({
      error: {
        message: 'User not found!',
      },
    })
  }

  user = user.get({
    plain: true,
  })

  let topics = await searchClient.profileSearch(user.id, '', offset, limit)

  topics = topics.map(t => t.authorize(req.user))

  user = Object.assign(user, topics)
  return res.json(user)
}

module.exports.search = async (req, res) => {
  const { q } = req.query

  const users = await db.users.findAll({
    where: {
      [db.Sequelize.Op.or]: [
        {
          username: {
            [db.Sequelize.Op.iLike]: q + '%',
          },
        },
        {
          email: {
            [db.Sequelize.Op.iLike]: q + '%',
          },
        },
        {
          name: {
            [db.Sequelize.Op.iLike]: q + '%',
          },
        },
      ],
    },
    limit: 10,
  })

  return res.json(users)
}

module.exports.loginSuccess = async (req, res) => {
  let user = req.user
  res.clearCookie('session', {
    domain: process.env.NODE_ENV === 'dev' ? 'localhost' : '.index.as',
  })
  res.clearCookie('session.sig', {
    domain: process.env.NODE_ENV === 'dev' ? 'localhost' : '.index.as',
  })
  if (user.id) return res.json({ token: getToken(user) })
  else
    return res.status(401).json({
      error: {
        message: 'Unauthorized',
      },
    })
}

module.exports.deleteMe = async (req, res) => {
  let user = req.user
  let id = user.id
  await db.users.destroy({
    where: {
      id,
    },
  })
  let userTopics = await db.user_topics.findAll({
    where: { user_id: id },
  })
  for await (userTopic of userTopics) {
    if (userTopic.role === 'owner') {
      let topic = await db.topics.findOne({
        where: {
          id: userTopic.topic_id,
        },
      })
      if (topic) {
        topic.destroy()
        await db.links.destroy({
          where: { topic_id: userTopic.topic_id },
        })
      }
    }
    await userTopic.destroy()
  }
  return res.status(200).json({
    message: 'Account deleted.',
  })
}

module.exports.generateKey = async (req, res) => {
  let { user } = req
  const token = crypto.randomBytes(16).toString('hex')
  let targetUser = await db.users.findOne({
    where: {
      id: user.id,
    },
  })
  await targetUser.update({ api_key: token })
  return res.status(200).json({
    api_key: token,
  })
}

module.exports.deleteKey = async (req, res) => {
  let { user } = req
  let targetUser = await db.users.findOne({
    where: {
      id: user.id,
    },
  })
  await targetUser.update({ api_key: null })
  return res.sendStatus(200)
}

module.exports.changePassword = async (req, res) => {
  let { body, user } = req

  if (req.body.password.length < 8) {
    return res.status(422).json({
      error: {
        fields: {
          password_: 'Password must be longer than 8 characters.',
        },
      },
    })
  }

  if (body.password !== body.confirmPassword) {
    return res.status(401).json({
      error: {
        fields: {
          password: "Passwords don't match!",
        },
      },
    })
  }

  const _user = await db.users.scope('all').findOne({ where: { id: user.id } })

  if (!req.user.no_password) {
    const isValid = await bcrypt.compare(body.currentPassword, _user.password)
    if (!isValid) {
      return res.status(403).json({
        error: {
          fields: {
            password: 'Invalid password!',
          },
        },
      })
    }
  }

  const hashedPassword = await bcrypt.hash(body.password, 10)

  await _user.update({
    password: hashedPassword,
    no_password: false,
  })

  return res.status(200).json({
    message: 'Password changed.',
  })
}

module.exports.zapier = async (req, res) => {
  let scope = 'zap'
  res.redirect(
    `https://zapier.com/oauth/authorize/?client_id=${process.env.ZAPIER_CLIENT_ID}&redirect_uri=https://index.as/auth/zapier/callback&scope=${scope}&response_type=token`
  )
}

module.exports.zapierCallback = async (req, res) => {
  let { user } = req
  let targetUser = await db.users.findOne({
    where: {
      id: user.id,
    },
  })
  let updatedUser = await targetUser.update({
    zapier_token: req.body.token,
  })
  res.json(updatedUser)
}
