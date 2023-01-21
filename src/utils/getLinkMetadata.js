const axios = require('axios')

const getEmbedly = async (url) => {
  let resp = await axios.get(
    `https://api.embedly.com/1/extract?key=${process.env.EMBEDLY_API_KEY}&url=${url}`
  )
  return resp && resp.data
}

const transformEmbedly = (response) => {
  if (!response) {
    return false
  }

  if (response.provider_name && response.provider_name !== response.title) {
    response.title = `${response.provider_name} - ${response.title}`
  }
  return {
    url: response.url,
    title: response.title,
    description: response.description,
    language: response.language,
    favicon: response.favicon_url,
    images: response.images,
  }
}

const getLink = async (url) => {
  let embedly = await getEmbedly(url)
  let link = transformEmbedly(embedly)
  return link
}

module.exports = getLink
