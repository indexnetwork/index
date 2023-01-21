const generateSchema = (topic) => {
  const _links = topic.links.map((_link, i) => {
    let link = _link.get({ plain: true })
    return {
      '@type': 'ListItem',
      url: link.url,
      name: link.title,
      position: i + 1,
    }
  })
  const owner = topic.users.find((u) => u.user_topics.role === 'owner')
  const linksString = JSON.stringify(_links)
  const schema = `
{
   "@context":"http://schema.org/",
   "@type":"ItemList",
   "mainEntityOfPage":{
      "@type":"CollectionPage",
      "@id": "https//index.as/${owner.username}/${topic.slug}"
   },
   "itemListElement":${linksString},
   "numberOfItems":${topic.links.length}
}`

  return schema
}

module.exports = generateSchema
