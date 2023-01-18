const db = require('../models')

const cleanup = async () => {
  let links = await db.links.findAll()
  let topics = await db.topics.findAll()
  let userTopics = await db.user_topics.findAll()
  for await (link of links) {
    let topic = await db.topics.findOne({
      where: {
        id: link.topic_id,
      },
    })
    if (!topic) await link.destroy()
  }
  for await (topic of topics) {
    let clonedFrom = await db.topics.findOne({
      where: {
        id: topic.cloned_from,
      },
    })
    if (!clonedFrom)
      await topic.update({
        cloned_from: null,
      })
    let userTopic = await db.user_topics.findOne({
      where: {
        topic_id: topic.id,
        role: 'owner',
      },
    })
    if (!userTopic) await topic.destroy()
  }
  for await (userTopic of userTopics) {
    let user = await db.users.findOne({
      where: {
        id: userTopic.user_id,
      },
    })
    let topic = await db.topics.findOne({
      where: {
        id: userTopic.topic_id,
      },
    })
    if (!user || !topic) await userTopic.destroy()
  }
}

module.exports = cleanup
