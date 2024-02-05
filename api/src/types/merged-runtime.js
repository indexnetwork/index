// This is an auto-generated file, do not edit manually
export const definition = {
    "models": {
        "Index": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c6wr91bqjojw1znltqso445kevew3hiywjl1ior4fga60arj9xo",
            "accountRelation": {"type": "list"}
        },
        "IndexItem": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c66p7dxhk35uass66v2q42b2sdbaw7smitphfv60y9tux4obxu4",
            "accountRelation": {"type": "list"}
        },
        "Embedding": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c5wx4eb9mmw2su1q7y4m65wd8m887ulubbfn5iawpy6ukprq4va",
            "accountRelation": {"type": "list"}
        },
        "WebPage": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c5ehmhlme25mhizo670ro6jeu6h50m9fqnie4phkqy9vip8w8t0",
            "accountRelation": {"type": "list"}
        },
        "DIDIndex": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c7wlj08gruhq6gkatb8heg07btxzzeotumzpkftsnmxrf51l0b0",
            "accountRelation": {"type": "list"}
        },
        "Profile": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c6a1qzykoqwu191lnpci1z6kp7ww18dycm9ono1r37un63my1hd",
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
                    "model": "kjzl6hvfrbw6c66p7dxhk35uass66v2q42b2sdbaw7smitphfv60y9tux4obxu4",
                    "property": "indexId"
                }
            },
            "did": {
                "type": "view",
                "viewType": "relation",
                "relation": {
                    "source": "queryConnection",
                    "model": "kjzl6hvfrbw6c7wlj08gruhq6gkatb8heg07btxzzeotumzpkftsnmxrf51l0b0",
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
                    "model": "kjzl6hvfrbw6c6wr91bqjojw1znltqso445kevew3hiywjl1ior4fga60arj9xo",
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
                    "model": "kjzl6hvfrbw6c6wr91bqjojw1znltqso445kevew3hiywjl1ior4fga60arj9xo",
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
                    "model": "kjzl6hvfrbw6c6wr91bqjojw1znltqso445kevew3hiywjl1ior4fga60arj9xo",
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
