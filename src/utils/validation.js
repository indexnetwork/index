const Joi = require('@hapi/joi')
const { username } = require('../utils/regex')

const schemas = {
  addLink: Joi.array().items(
    Joi.object({
      title: Joi.string(),
      sort: Joi.number(),
      url: Joi.string().uri().required(),
      tags: Joi.array().items(Joi.string()),
    })
  ),
  updateLink: Joi.object({
    title: Joi.string(),
    sort: Joi.number(),
    tags: Joi.array().items(Joi.string()),
  }).or('title', 'sort', 'tags'),
  linkSearch: Joi.object({
    q: Joi.string().min(1),
  }),
  tagSearch: Joi.object({
    q: Joi.string().min(1),
  }),
  createTopic: Joi.object().keys({
    public_rights: Joi.string().valid('edit', 'view', 'off').default('off'),
    title: Joi.string().default('Untitled topic'),
    links: Joi.array()
      .items(
        Joi.object().keys({
          title: Joi.string(),
          sort: Joi.number().allow(null),
          url: Joi.string().uri().required(),
          tags: Joi.array().items(Joi.string()),
        })
      )
      .default([]),
  }),
  updateTopic: Joi.object().keys({
    users: Joi.array(),
    public_rights: Joi.string().valid('edit', 'view', 'off'),
    title: Joi.string(),
  }),
  topicSearch: Joi.object({
    q: Joi.string().min(1),
    username: Joi.string(),
    offset: Joi.number().default(0),
    limit: Joi.number().default(100),
    cat: Joi.string().default('all'),
  }),
  login: Joi.object({
    email: Joi.string().required(),
    password: Joi.string().required(),
  }),
  register: Joi.object({
    email: Joi.string().email().required(),
    username: Joi.string()
      .regex(username.pattern)
      .error((errors) => {
        return errors.map((error) => {
          switch (error.type) {
            case 'string.regex.base':
              return { message: username.message }
          }
        })
      }),
    password: Joi.string().required(),
  }),
  forgotPassword: Joi.object({
    email: Joi.string().email().required(),
  }),
  updateMe: Joi.object({
    name: Joi.string().allow('', null),
    username: Joi.string()
      .regex(username.pattern)
      .error((errors) => {
        return errors.map((error) => {
          switch (error.type) {
            case 'string.regex.base':
              return { message: username.message }
          }
        })
      }),
    email: Joi.string().email(),
    location: Joi.string().allow('', null),
    bio: Joi.string().allow('', null),
    visibility: Joi.boolean(),
    url_web: Joi.string().uri().allow('', null),
    url_twitter: Joi.string().uri().allow('', null),
    url_facebook: Joi.string().uri().allow('', null),
    url_instagram: Joi.string().uri().allow('', null),
    url_patreon: Joi.string().uri().allow('', null),
  }),
  getMe: Joi.object({
    offset: Joi.number().default(0),
    limit: Joi.number().default(100),
    cat: Joi.string().default('all'),
  }),
  userSearch: Joi.object({
    q: Joi.string().min(1),
  }),
  changePassword: Joi.object({
    password: Joi.string().required(),
    confirmPassword: Joi.string().required(),
    currentPassword: Joi.string().required(),
  }),
  resetPassword: Joi.object({
    password: Joi.string().required(),
    token: Joi.string().min(10).required(),
  }),
  updateInvitation: Joi.object({
    permission: Joi.string().valid('edit', 'view'),
  }),
}

const validate = (key) => {
  let schema = schemas[key]
  return (req, res, next) => {
    if (schema) {
      if (req.user.no_password && key === 'changePassword') {
        Object.assign(
          schema,
          schema.keys({
            currentPassword: Joi.string(),
          })
        )
      }
      let toValidate = Object.keys(req.body).length > 0 ? req.body : req.query
      const validation = schema.validate(toValidate)
      if (validation.error) {
        return res.status(400).json({
          error: {
            message: validation.error.message,
          },
        })
      }
      res.locals.validation = validation
    }
    next()
  }
}

module.exports = { validate }
