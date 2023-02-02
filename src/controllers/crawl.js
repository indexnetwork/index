const indexer = require('./indexer.js')
const striptags = require('striptags');
const { Lambda } = require("aws-sdk");
const lambda = new Lambda({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_S3_REGION,
    version: "v4",
});


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
    
    if(response.meta.site && response.meta.title && !response.meta.title.includes(response.meta.site)){
        response.meta.title = `${response.meta.site} | ${response.meta.title}`
    }else if(response.meta.site){
        response.meta.title = response.meta.site
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



const getContents = async (url) =>  {

    lambda.invoke({
        FunctionName: "indexas-crawler-dev-crawl",
        Payload: JSON.stringify({ url }),
    }, async (err, data) => {
        console.log(err, data)
        const payload = data && JSON.parse(data.Payload);
        if (err) console.error(err, err.stack);
        else if (payload && payload.content) {
            payload.content = striptags(payload.content)
                .replace(/(?:\r\n|\r|\n)/g, '...')
                .replaceAll('.......','...');
            await indexer.updateLinkContent(url, payload.content)
        }
    });
};

exports.metadata = async (req, res) => {

    let { url } = req.query;

    getContents(url)

    let response = await getIframelyData(url)


    res.json(response)

};

