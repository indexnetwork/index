const getIframelyData = async (url) => {
    
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
    
    if(response.meta.site && !response.meta.title.includes(response.meta.site)){
        response.meta.title = `${response.meta.site} | ${response.meta.title}`
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


exports.metadata = async (req, res) => {

    let { url } = req.query;
    let response = await getIframelyData(url)
    res.json(response)

};

exports.content = async (req, res, next) => {
    res.json({})
};

