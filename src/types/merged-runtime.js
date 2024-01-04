export const definition = {
    "models": {
        "Index": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6cagi7g34abu6z5577q72fydc9rkvb42x6qazazynllq8g8g5l4l",
            "accountRelation": {"type": "list"}
        },
        "IndexItem": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6cbcg7dk1bsmnmdubsk3yj15ht07zf7wbn3ps4peto28nt2n5hy1",
            "accountRelation": {"type": "list"}
        },
        "Embedding": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c7g0ue98mvzvfh3sfzvzqr7zby0wil22x34u464q1vhzrlrcdco",
            "accountRelation": {"type": "list"}
        },
        "WebPage": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6calh2ht019q87xfuoi7xecn3otnxi7l3pm6t4mfyhznqml2ipg2",
            "accountRelation": {"type": "list"}
        },
        "DIDIndex": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c7actchexmj9clt1tga2kt5qhatdljfr0kfb30f1kkljnvjklll",
            "accountRelation": {"type": "list"}
        },
        "Profile": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6c5zkvtgtv9m3a51v9pd4eg6or18y5qigjhn60grulgy9fulfruf",
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
                    "model": "kjzl6hvfrbw6cbcg7dk1bsmnmdubsk3yj15ht07zf7wbn3ps4peto28nt2n5hy1",
                    "property": "indexId"
                }
            },
            "did": {
                "type": "view",
                "viewType": "relation",
                "relation": {
                    "source": "queryConnection",
                    "model": "kjzl6hvfrbw6c7actchexmj9clt1tga2kt5qhatdljfr0kfb30f1kkljnvjklll",
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
                    "model": "kjzl6hvfrbw6cagi7g34abu6z5577q72fydc9rkvb42x6qazazynllq8g8g5l4l",
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
                    "model": "kjzl6hvfrbw6cagi7g34abu6z5577q72fydc9rkvb42x6qazazynllq8g8g5l4l",
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
                    "model": "kjzl6hvfrbw6cagi7g34abu6z5577q72fydc9rkvb42x6qazazynllq8g8g5l4l",
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
