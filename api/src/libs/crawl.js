import { Actor} from 'apify';
import { PuppeteerCrawler, RequestList, sleep } from "crawlee";
import {Readability} from "@mozilla/readability";
import * as indexer from './kafka-indexer.js';
import fs from "fs";
import striptags from "striptags";


export const getQueue = async () => {

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


export const getMetadata = async (url) => {

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

	const site = response.meta.site || (new URL(url)).hostname;

	if(response.meta.title && response.meta.title.length > 0 && !response.meta.title.includes(response.meta.site)){
		response.meta.title = `${site} | ${response.meta.title}`
	}else{
		response.meta.title = site;
	}

	if(response.links && response.links.icon){
		return {
			url: url,
			title: response.meta.title,
			favicon: response.links.icon[0].href,
		}
	}

	return {
		url: response.meta.canonical,
		title: response.meta.title
	}
}

