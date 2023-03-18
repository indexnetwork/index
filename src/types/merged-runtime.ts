export const definition = {
	models: {
		Index: {
			id: "kjzl6hvfrbw6c9bh2wggilqiije6udtgohahloxhuhbkm0igfjd3pm05z80164h",
			accountRelation: { type: "list" },
		},
		Link: {
			id: "kjzl6hvfrbw6c569n1q6egc47s4u2213x1rs4jjygrgszjmdo3nedbrnt8dl46q",
			accountRelation: { type: "list" },
		},
		IndexLink: {
			id: "kjzl6hvfrbw6capisi7cx0ffmrshdiznmt127j2ldacp387g0xhedhrqbgnem31",
			accountRelation: { type: "list" },
		},
		BasicProfile: {
			id: "kjzl6hvfrbw6c67dwa9r9k34j8w7ht8d8qcu4j620i5usbfmyb8iqqemwvc9zlk",
			accountRelation: { type: "single" },
		},
		UserIndex: {
			id: "kjzl6hvfrbw6c8x0tvgf98z805tg08s6fn9tre7wiusghayi8f83rcoyh3hdo9b",
			accountRelation: { type: "list" },
		},
	},
	objects: {
		Index: {
			title: { type: "string", required: true },
			created_at: { type: "datetime", required: true },
			deleted_at: { type: "datetime", required: false },
			updated_at: { type: "datetime", required: true },
			collab_action: { type: "string", required: false },
			version: { type: "view", viewType: "documentVersion" },
			controller_did: { type: "view", viewType: "documentAccount" },
			links: {
				type: "view",
				viewType: "relation",
				relation: {
					source: "queryConnection",
					model: "kjzl6hvfrbw6capisi7cx0ffmrshdiznmt127j2ldacp387g0xhedhrqbgnem31",
					property: "index_id",
				},
			},
			links_count: {
				type: "view",
				viewType: "relation",
				relation: {
					source: "queryCount",
					model: "kjzl6hvfrbw6capisi7cx0ffmrshdiznmt127j2ldacp387g0xhedhrqbgnem31",
					property: "index_id",
				},
			},
		},
		Link: {
			url: { type: "string", required: true },
			tags: { type: "list", required: false, item: { type: "string", required: false } },
			title: { type: "string", required: false },
			content: { type: "string", required: false },
			favicon: { type: "string", required: false },
			created_at: { type: "datetime", required: true },
			deleted_at: { type: "datetime", required: false },
			updated_at: { type: "datetime", required: true },
			version: { type: "view", viewType: "documentVersion" },
			controller_did: { type: "view", viewType: "documentAccount" },
		},
		IndexLink: {
			link_id: { type: "streamid", required: true },
			index_id: { type: "streamid", required: true },
			created_at: { type: "datetime", required: true },
			deleted_at: { type: "datetime", required: false },
			updated_at: { type: "datetime", required: true },
			indexer_did: { type: "did", required: true },
			link: {
				type: "view",
				viewType: "relation",
				relation: {
					source: "document",
					model: "kjzl6hvfrbw6c569n1q6egc47s4u2213x1rs4jjygrgszjmdo3nedbrnt8dl46q",
					property: "link_id",
				},
			},
			index: {
				type: "view",
				viewType: "relation",
				relation: {
					source: "document",
					model: "kjzl6hvfrbw6c9bh2wggilqiije6udtgohahloxhuhbkm0igfjd3pm05z80164h",
					property: "index_id",
				},
			},
		},
		BasicProfile: {
			name: { type: "string", required: true },
			emoji: { type: "string", required: false },
			gender: { type: "string", required: false },
			description: { type: "string", required: false },
		},
		UserIndex: {
			type: { type: "string", required: false },
			index_id: { type: "streamid", required: true },
			created_at: { type: "datetime", required: true },
			deleted_at: { type: "datetime", required: false },
			index: {
				type: "view",
				viewType: "relation",
				relation: {
					source: "document",
					model: "kjzl6hvfrbw6c9bh2wggilqiije6udtgohahloxhuhbkm0igfjd3pm05z80164h",
					property: "index_id",
				},
			},
			version: { type: "view", viewType: "documentVersion" },
			controller_did: { type: "view", viewType: "documentAccount" },
		},
	},
	enums: {},
	accountData: {
		indexList: { type: "connection", name: "Index" },
		linkList: { type: "connection", name: "Link" },
		indexLinkList: { type: "connection", name: "IndexLink" },
		basicProfile: { type: "node", name: "BasicProfile" },
		userIndexList: { type: "connection", name: "UserIndex" },
	},
};
