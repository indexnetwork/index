// This is an auto-generated file, do not edit manually
export const definition = {
    "models": {
        "Index": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c9jkqpil5x6m14kobigaatfx35th0u3rdcd8tqfpz4eeuja04nm",
            "accountRelation": {"type": "list"}
        },
        "IndexItem": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c8z4qq7wy7p1xhemzoq2lnhvq04xcs5re7c6j1kip9vwgt4usl2",
            "accountRelation": {"type": "list"}
        },
        "Embedding": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c71l0b0p93bprl050xe9lanat8403a3z1zha1t4sys9u098arm8",
            "accountRelation": {"type": "list"}
        },
        "WebPage": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c63kez9uo8joei35x0oy00c4obvoqo2lrevtkm74bragdg3ajpl",
            "accountRelation": {"type": "list"}
        },
        "DIDIndex": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c7lebz1agxo8eph302gdow757f3wpttkut485o4xrd8jtednsvg",
            "accountRelation": {"type": "list"}
        },
        "Profile": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c7b0ucpni3cbslclej6aphfrnyqdv8awj0iwnqlx6xjbzrgc6nd",
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
                    "model": "kjzl6hvfrbw6c8z4qq7wy7p1xhemzoq2lnhvq04xcs5re7c6j1kip9vwgt4usl2",
                    "property": "indexId"
                }
            },
            "did": {
                "type": "view",
                "viewType": "relation",
                "relation": {
                    "source": "queryConnection",
                    "model": "kjzl6hvfrbw6c7lebz1agxo8eph302gdow757f3wpttkut485o4xrd8jtednsvg",
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
                    "model": "kjzl6hvfrbw6c9jkqpil5x6m14kobigaatfx35th0u3rdcd8tqfpz4eeuja04nm",
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
                    "model": "kjzl6hvfrbw6c9jkqpil5x6m14kobigaatfx35th0u3rdcd8tqfpz4eeuja04nm",
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
            "deletedAt": {"type": "datetime", "required": false, "indexed": true},
            "updatedAt": {"type": "datetime", "required": true, "indexed": true},
            "index": {
                "type": "view",
                "viewType": "relation",
                "relation": {
                    "source": "document",
                    "model": "kjzl6hvfrbw6c9jkqpil5x6m14kobigaatfx35th0u3rdcd8tqfpz4eeuja04nm",
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
