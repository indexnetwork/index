const { Actor} = require('apify');
const Apify = require('apify');
const { PuppeteerCrawler, Configuration, RequestList, RequestQueue, sleep }  = require("crawlee");
const {Readability} =  require("@mozilla/readability");
const indexer = require('./indexer.js')
const fs = require("fs");
const striptags = require("striptags")


exports.getQueue = async () => {

	console.log("getQUEUEUE")
	await Actor.init();

	
	const requestList = await RequestList.open('my-list', [], {
		keepDuplicateUrls: true
	});


	const queue = await Actor.openRequestQueue();

	const readabilityJsStr = fs.readFileSync("./node_modules/@mozilla/readability/Readability.js", {
	  encoding: "utf-8",
	});


	function executor() {
	  return new Readability({}, document).parse();
	}

	const crawler = new PuppeteerCrawler({
		requestList,
	    requestQueue: queue,
	    useSessionPool: false,
	    persistCookiesPerSession: false,
	    headless: true,
	    keepAlive: true,
		minConcurrency: 5,
		maxConcurrency: 15,
	    launchContext: {
	        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36"
	    },
	    requestHandler: async ({ request, page, session }) => {

	        await page.title();
	        await sleep(3_000);


	        const resultArticle = await page.evaluate(`
	            (function(){
	                ${readabilityJsStr}
	                ${executor}
	                return executor();
	            }())
	        `);     



	        const content = striptags(resultArticle.textContent)
	        .replace(/(?:\r\n|\r|\n)/g, '...')
	        .replaceAll('.......','...');

	        await indexer.updateLinkContent(request.url, content)    

	        queue.markRequestHandled(request)


	    },
	});

	crawler.run();

	return crawler

}

