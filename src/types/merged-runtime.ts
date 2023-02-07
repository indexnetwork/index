// This is an auto-generated file, do not edit manually
export const definition = {
	models: {
		Index: { id: "kjzl6hvfrbw6c8mi3r321zv8aujo0pz75u3hd75nmnw8cohfakz650td4c7qxxf", accountRelation: { type: "list" } }, Link: { id: "kjzl6hvfrbw6c732vo3usihwsmaudk78by48c6fy7qxxwkmn9yrryza13jyg6kt", accountRelation: { type: "list" } }, UserIndex: { id: "kjzl6hvfrbw6c9uhr6wtbziqokgadeavvh1y9u7qbs6u3jmwz7nmxexwb0mgj52", accountRelation: { type: "list" } }, IndexasProfile: { id: "kjzl6hvfrbw6c8a46cmpj0e7rg35pm9230ea7r5xqeuuvo3k0shdemlyp8bskjc", accountRelation: { type: "single" } },
	},
	objects: {
		Index: {
			title: { type: "string", required: true }, created_at: { type: "datetime", required: true }, deleted_at: { type: "datetime", required: false }, updated_at: { type: "datetime", required: true }, collab_action: { type: "string", required: false }, owner: { type: "view", viewType: "documentAccount" }, version: { type: "view", viewType: "documentVersion" }, links: { type: "view", viewType: "relation", relation: { source: "queryConnection", model: "kjzl6hvfrbw6c732vo3usihwsmaudk78by48c6fy7qxxwkmn9yrryza13jyg6kt", property: "index_id" } }, links_count: { type: "view", viewType: "relation", relation: { source: "queryCount", model: "kjzl6hvfrbw6c732vo3usihwsmaudk78by48c6fy7qxxwkmn9yrryza13jyg6kt", property: "index_id" } },
		},
		Link: {
			url: { type: "string", required: true }, tags: { type: "list", required: false, item: { type: "string", required: false } }, title: { type: "string", required: false }, content: { type: "string", required: false }, favicon: { type: "string", required: false }, index_id: { type: "streamid", required: true }, created_at: { type: "datetime", required: true }, deleted_at: { type: "datetime", required: false }, updated_at: { type: "datetime", required: true }, indexer_did: { type: "did", required: true }, index: { type: "view", viewType: "relation", relation: { source: "document", model: "kjzl6hvfrbw6c8mi3r321zv8aujo0pz75u3hd75nmnw8cohfakz650td4c7qxxf", property: "index_id" } }, owner: { type: "view", viewType: "documentAccount" }, version: { type: "view", viewType: "documentVersion" },
		},
		UserIndex: {
			type: { type: "string", required: false }, index_id: { type: "streamid", required: true }, created_at: { type: "datetime", required: true }, deleted_at: { type: "datetime", required: false }, index: { type: "view", viewType: "relation", relation: { source: "document", model: "kjzl6hvfrbw6c8mi3r321zv8aujo0pz75u3hd75nmnw8cohfakz650td4c7qxxf", property: "index_id" } }, owner: { type: "view", viewType: "documentAccount" }, version: { type: "view", viewType: "documentVersion" },
		},
		IndexasProfile: { pfp: { type: "string", required: false }, name: { type: "string", required: false }, description: { type: "string", required: false } },
	},
	enums: {},
	accountData: {
		indexList: { type: "connection", name: "Index" }, linkList: { type: "connection", name: "Link" }, userIndexList: { type: "connection", name: "UserIndex" }, indexasProfile: { type: "node", name: "IndexasProfile" },
	},
};
