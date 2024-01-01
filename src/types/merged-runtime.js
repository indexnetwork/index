// This is an auto-generated file, do not edit manually
export const definition = {
    "models": {
        "Index": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c9162vznoyx1zyxj1h9fu83x8xyg4ct7ym6hrww3gexn7dzv5px",
            "accountRelation": {"type": "list"}
        },
        "IndexItem": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c8pkz8j02fd9a72xb8oq3hslqb1540qyuuzujloeqkp9krxfdcs",
            "accountRelation": {"type": "list"}
        },
        "Embedding": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6catsajwc0uiscteroya5ypwr1yemwm3l7nbjru6z0ormihmty1y",
            "accountRelation": {"type": "list"}
        },
        "WebPage": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6cazch4zhh58q8ih5jj4sswjqw17zdyjm34n89io3avikae4t6vs",
            "accountRelation": {"type": "list"}
        },
        "DIDIndex": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c5w69hk7tgjx6kdh4k9csv3n81fj0nl0pv604pvw0djygshiig2",
            "accountRelation": {"type": "list"}
        },
        "Profile": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c9uqqkdqfxknhb139c0j5fvz4js7pzf1z8q75ltt13qsz8etus7",
            "accountRelation": {"type": "single"}
        }
    },
    "objects": {
        "Index": {
            "title": {"type": "string", "required": true},
            "createdAt": {"type": "datetime", "required": true, "indexed": true},
            "deletedAt": {"type": "datetime", "required": false},
            "updatedAt": {"type": "datetime", "required": true, "indexed": true},
            "signerFunction": {"type": "cid", "required": false},
            "signerPublicKey": {"type": "string", "required": false, "indexed": true},
            "items": {
                "type": "view",
                "viewType": "relation",
                "relation": {
                    "source": "queryConnection",
                    "model": "kjzl6hvfrbw6c8pkz8j02fd9a72xb8oq3hslqb1540qyuuzujloeqkp9krxfdcs",
                    "property": "indexId"
                }
            },
            "did": {
                "type": "view",
                "viewType": "relation",
                "relation": {
                    "source": "queryConnection",
                    "model": "kjzl6hvfrbw6c5w69hk7tgjx6kdh4k9csv3n81fj0nl0pv604pvw0djygshiig2",
                    "property": "indexId"
                }
            }
        },
        "IndexItem": {
            "itemId": {"type": "streamid", "required": true, "indexed": true},
            "indexId": {"type": "streamid", "required": true, "indexed": true},
            "createdAt": {"type": "datetime", "required": true, "indexed": true},
            "deletedAt": {"type": "datetime", "required": false, "indexed": true},
            "updatedAt": {"type": "datetime", "required": true, "indexed": true},
            "item": {
                "type": "view",
                "viewType": "relation",
                "relation": {"source": "document", "model": null, "property": "itemId"}
            },
            "index": {
                "type": "view",
                "viewType": "relation",
                "relation": {
                    "source": "document",
                    "model": "kjzl6hvfrbw6c9162vznoyx1zyxj1h9fu83x8xyg4ct7ym6hrww3gexn7dzv5px",
                    "property": "indexId"
                }
            }
        },
        "Embedding": {
            "itemId": {"type": "streamid", "required": true, "indexed": true},
            "vector": {"type": "list", "required": true, "item": {"type": "float", "required": true}},
            "context": {"type": "string", "required": false},
            "indexId": {"type": "streamid", "required": true, "indexed": true},
            "category": {"type": "string", "required": true, "indexed": true},
            "createdAt": {"type": "datetime", "required": true, "indexed": true},
            "deletedAt": {"type": "datetime", "required": false, "indexed": true},
            "modelName": {"type": "string", "required": true, "indexed": true},
            "updatedAt": {"type": "datetime", "required": true, "indexed": true},
            "description": {"type": "string", "required": true},
            "item": {
                "type": "view",
                "viewType": "relation",
                "relation": {"source": "document", "model": null, "property": "itemId"}
            },
            "index": {
                "type": "view",
                "viewType": "relation",
                "relation": {
                    "source": "document",
                    "model": "kjzl6hvfrbw6c9162vznoyx1zyxj1h9fu83x8xyg4ct7ym6hrww3gexn7dzv5px",
                    "property": "indexId"
                }
            }
        },
        "WebPage": {
            "url": {"type": "uri", "required": true},
            "title": {"type": "string", "required": false},
            "content": {"type": "string", "required": false},
            "favicon": {"type": "string", "required": false},
            "createdAt": {"type": "datetime", "required": true},
            "deletedAt": {"type": "datetime", "required": false},
            "updatedAt": {"type": "datetime", "required": true}
        },
        "DIDIndex": {
            "type": {"type": "string", "required": false, "indexed": true},
            "indexId": {"type": "streamid", "required": true, "indexed": true},
            "createdAt": {"type": "datetime", "required": true, "indexed": true},
            "deletedAt": {"type": "datetime", "required": false},
            "updatedAt": {"type": "datetime", "required": true, "indexed": true},
            "index": {
                "type": "view",
                "viewType": "relation",
                "relation": {
                    "source": "document",
                    "model": "kjzl6hvfrbw6c9162vznoyx1zyxj1h9fu83x8xyg4ct7ym6hrww3gexn7dzv5px",
                    "property": "indexId"
                }
            },
            "controllerDID": {"type": "view", "viewType": "documentAccount"}
        },
        "Profile": {
            "bio": {"type": "string", "required": false},
            "name": {"type": "string", "required": false},
            "avatar": {"type": "cid", "required": false},
            "createdAt": {"type": "datetime", "required": true},
            "deletedAt": {"type": "datetime", "required": false},
            "updatedAt": {"type": "datetime", "required": true},
            "controllerDID": {"type": "view", "viewType": "documentAccount"}
        }
    },
    "enums": {},
    "accountData": {
        "indexList": {"type": "connection", "name": "Index"},
        "indexItemList": {"type": "connection", "name": "IndexItem"},
        "embeddingList": {"type": "connection", "name": "Embedding"},
        "webPageList": {"type": "connection", "name": "WebPage"},
        "didIndexList": {"type": "connection", "name": "DIDIndex"},
        "profile": {"type": "node", "name": "Profile"}
    }
}
