const db = require('../models')

module.exports.search = async (req, res) => {
  const { q } = req.query

  const tags = await db.sequelize.query(
    `SELECT * FROM (SELECT DISTINCT unnest(tags) tags from links where topic_id in (select topic_id from user_topics where user_id = ${req.user.id})) as tags where tags like '${q}%'`,
    { type: db.sequelize.QueryTypes.SELECT }
  )
  console.log(tags)

  return res.json(tags.map((t) => t.tags))
}
