// This is an auto-generated file, do not edit manually
export const definition = {
    "models": {
        "DIDIndex": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c6g36kssoddbzk5s540ztc7yh9rgx54hi42xfyislxasbtllj2j",
            "accountRelation": {"type": "set", "fields": ["indexId", "type"]}
        },
        "Embedding": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6cb2id6b5saxxyt032ts652ctnwxuv5nfu0p50pycxoj4vrtd2qh",
            "accountRelation": {"type": "list"}
        },
        "Index": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c9uou8ahg7iiwpdxy3xytuop7qz1cggory3uer1r2ozwucsrpfo",
            "accountRelation": {"type": "list"}
        },
        "IndexItem": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6cbbyu8ftr6aredftfq6xrww6h8lscajvgow0f0kygs8r8n1my40",
            "accountRelation": {"type": "list"}
        },
        "Profile": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6cb3ih99fy9ljt2ttycr213yyyxtu31fuoqbo1j78hj5zghz98v7",
            "accountRelation": {"type": "single"}
        },
        "WebPage": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6cbc4u4xfdq85bg8oo8w8z2acvhj7rd48atkzlrz59w2cljiw5lx",
            "accountRelation": {"type": "list"}
        }
    },
    "objects": {
        "DIDIndex": {
            "type": {"type": "string", "required": true, "immutable": true, "indexed": true},
            "indexId": {"type": "streamid", "required": true, "immutable": true, "indexed": true},
            "createdAt": {"type": "datetime", "required": true, "immutable": false, "indexed": true},
            "deletedAt": {"type": "datetime", "required": false, "immutable": false, "indexed": true},
            "updatedAt": {"type": "datetime", "required": true, "immutable": false, "indexed": true},
            "index": {
                "type": "view",
                "viewType": "relation",
                "relation": {
                    "source": "document",
                    "model": "kjzl6hvfrbw6c9uou8ahg7iiwpdxy3xytuop7qz1cggory3uer1r2ozwucsrpfo",
                    "property": "indexId"
                }
            },
            "controllerDID": {"type": "view", "viewType": "documentAccount"}
        },
        "Embedding": {
            "itemId": {"type": "streamid", "required": true, "immutable": false},
            "vector": {
                "type": "list",
                "required": true,
                "immutable": false,
                "item": {"type": "float", "required": true, "immutable": false}
            },
            "context": {"type": "string", "required": false, "immutable": false},
            "indexId": {"type": "streamid", "required": true, "immutable": false, "indexed": true},
            "category": {"type": "string", "required": true, "immutable": false, "indexed": true},
            "createdAt": {"type": "datetime", "required": true, "immutable": false, "indexed": true},
            "deletedAt": {"type": "datetime", "required": false, "immutable": false, "indexed": true},
            "modelName": {"type": "string", "required": true, "immutable": false, "indexed": true},
            "updatedAt": {"type": "datetime", "required": true, "immutable": false, "indexed": true},
            "description": {"type": "string", "required": true, "immutable": false},
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
                    "model": "kjzl6hvfrbw6c9uou8ahg7iiwpdxy3xytuop7qz1cggory3uer1r2ozwucsrpfo",
                    "property": "indexId"
                }
            }
        },
        "Index": {
            "title": {"type": "string", "required": true, "immutable": false},
            "createdAt": {"type": "datetime", "required": true, "immutable": false, "indexed": true},
            "deletedAt": {"type": "datetime", "required": false, "immutable": false, "indexed": true},
            "updatedAt": {"type": "datetime", "required": true, "immutable": false, "indexed": true},
            "signerFunction": {"type": "cid", "required": false, "immutable": false},
            "signerPublicKey": {"type": "string", "required": false, "immutable": false, "indexed": true},
            "items": {
                "type": "view",
                "viewType": "relation",
                "relation": {
                    "source": "queryConnection",
                    "model": "kjzl6hvfrbw6cbbyu8ftr6aredftfq6xrww6h8lscajvgow0f0kygs8r8n1my40",
                    "property": "indexId"
                }
            },
            "did": {
                "type": "view",
                "viewType": "relation",
                "relation": {
                    "source": "queryConnection",
                    "model": "kjzl6hvfrbw6c6g36kssoddbzk5s540ztc7yh9rgx54hi42xfyislxasbtllj2j",
                    "property": "indexId"
                }
            }
        },
        "IndexItem": {
            "itemId": {"type": "streamid", "required": true, "immutable": false, "indexed": true},
            "indexId": {"type": "streamid", "required": true, "immutable": false, "indexed": true},
            "createdAt": {"type": "datetime", "required": true, "immutable": false, "indexed": true},
            "deletedAt": {"type": "datetime", "required": false, "immutable": false, "indexed": true},
            "updatedAt": {"type": "datetime", "required": true, "immutable": false, "indexed": true},
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
                    "model": "kjzl6hvfrbw6c9uou8ahg7iiwpdxy3xytuop7qz1cggory3uer1r2ozwucsrpfo",
                    "property": "indexId"
                }
            }
        },
        "Profile": {
            "bio": {"type": "string", "required": false, "immutable": false},
            "name": {"type": "string", "required": false, "immutable": false},
            "avatar": {"type": "cid", "required": false, "immutable": false},
            "createdAt": {"type": "datetime", "required": true, "immutable": false},
            "deletedAt": {"type": "datetime", "required": false, "immutable": false},
            "updatedAt": {"type": "datetime", "required": true, "immutable": false},
            "controllerDID": {"type": "view", "viewType": "documentAccount"}
        },
        "WebPage": {
            "url": {"type": "string", "required": true, "immutable": false},
            "title": {"type": "string", "required": false, "immutable": false},
            "content": {"type": "string", "required": false, "immutable": false},
            "favicon": {"type": "string", "required": false, "immutable": false},
            "createdAt": {"type": "datetime", "required": true, "immutable": false},
            "deletedAt": {"type": "datetime", "required": false, "immutable": false},
            "updatedAt": {"type": "datetime", "required": true, "immutable": false}
        }
    },
    "enums": {},
    "accountData": {
        "didIndex": {"type": "set", "name": "DIDIndex"},
        "didIndexList": {"type": "connection", "name": "DIDIndex"},
        "embeddingList": {"type": "connection", "name": "Embedding"},
        "indexItemList": {"type": "connection", "name": "IndexItem"},
        "indexList": {"type": "connection", "name": "Index"},
        "profile": {"type": "node", "name": "Profile"},
        "webPageList": {"type": "connection", "name": "WebPage"}
    }
}
