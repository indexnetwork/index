const indexer = require('./indexer.js')
const striptags = require('striptags');


exports.getMetadata = async (url) => {
    
    let results = await fetch(`https://iframe.ly/api/iframely?api_key=${process.env.IFRAMELY_API_KEY}&url=${url}&ssl=1&title=1`, {
        method: 'GET',
        headers: {
            "Content-Type": "application/json"
        }
    })

    let response = await results.json();

    if(!response || response.error){
        return {
            url: url,
            title: (new URL(url)).hostname
        }
    }
    
    if(response.meta.site && response.meta.title && response.meta.title.length > 0 && !response.meta.title.includes(response.meta.site)){
        response.meta.title = `${response.meta.site} | ${response.meta.title}`
    }else if(response.meta.site){
        response.meta.title = response.meta.site
    }else{
        response.meta.title = (new URL(url)).hostname
    }

    if(response.links && response.links.icon){
        return {
          url: response.meta.canonical,
          title: response.meta.title,
          favicon: response.links.icon[0].href,
        }  
    }
    
    return {
      url: response.meta.canonical,
      title: response.meta.title
    }  
}

