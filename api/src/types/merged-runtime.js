// This is an auto-generated file, do not edit manually
export const definition = {
    "models": {
        "DIDIndex": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c8zxu9h8wq0ycmvknf3rg3v5gm0z1dwlrquruyxnapzye0wuus2",
            "accountRelation": {"type": "set", "fields": ["indexId", "type"]}
        },
        "Embedding": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c5wj20x3gw3nevmdpwtrkwsmz94ewbakc99qmn29piwe9cs1fo1",
            "accountRelation": {"type": "list"}
        },
        "Index": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6cbcdnrwl793l4o1jkd6gg9gfoe97t32px4tphikbgr3d2s64kcd",
            "accountRelation": {"type": "list"}
        },
        "IndexItem": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c8y5uncb93eiyo3immfr80tedl8yv58qkwm5lz0y8tuu00a2u79",
            "accountRelation": {"type": "list"}
        },
        "Profile": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c52ta9l6qqcvjfdqcf3vys0gvbnq4zwn4k7z2m9bbykz1dic8a6",
            "accountRelation": {"type": "single"}
        },
        "WebPage": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c6y1s4ov3k7pu6id3c568snr5mgvo0h4ptohqypsl5paqftl431",
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
                    "model": "kjzl6hvfrbw6cbcdnrwl793l4o1jkd6gg9gfoe97t32px4tphikbgr3d2s64kcd",
                    "property": "indexId"
                }
            },
            "controllerDID": {"type": "view", "viewType": "documentAccount"}
        },
        "Embedding": {
            "itemId": {"type": "streamid", "required": true, "immutable": false, "indexed": true},
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
                    "model": "kjzl6hvfrbw6cbcdnrwl793l4o1jkd6gg9gfoe97t32px4tphikbgr3d2s64kcd",
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
                    "model": "kjzl6hvfrbw6c8y5uncb93eiyo3immfr80tedl8yv58qkwm5lz0y8tuu00a2u79",
                    "property": "indexId"
                }
            },
            "did": {
                "type": "view",
                "viewType": "relation",
                "relation": {
                    "source": "queryConnection",
                    "model": "kjzl6hvfrbw6c8zxu9h8wq0ycmvknf3rg3v5gm0z1dwlrquruyxnapzye0wuus2",
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
                    "model": "kjzl6hvfrbw6cbcdnrwl793l4o1jkd6gg9gfoe97t32px4tphikbgr3d2s64kcd",
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
            "url": {"type": "uri", "required": true, "immutable": false},
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
