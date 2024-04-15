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
        "Team": {
            "interface": false,
            "implements": [],
            "id": "kjzl6hvfrbw6cb9d3i74xp3iuooxhw04k3pumj6zyzxlvkvzyd6qaus3jihej7h",
            "accountRelation": {"type": "list"}
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
        "Team": {
            "logo": {"type": "uri", "required": true, "immutable": false},
            "name": {"type": "string", "required": true, "immutable": false},
            "teamId": {"type": "string", "required": true, "immutable": false},
            "members": {
                "type": "list",
                "required": false,
                "immutable": false,
                "item": {
                    "type": "reference",
                    "refType": "object",
                    "refName": "TeamMember",
                    "required": false,
                    "immutable": false
                }
            },
            "twitter": {"type": "string", "required": false, "immutable": false},
            "website": {"type": "uri", "required": true, "immutable": false},
            "fundingStage": {"type": "string", "required": false, "immutable": false},
            "industryTags": {
                "type": "list",
                "required": false,
                "immutable": false,
                "item": {
                    "type": "reference",
                    "refType": "object",
                    "refName": "TeamIndustryTag",
                    "required": false,
                    "immutable": false
                }
            },
            "technologies": {
                "type": "list",
                "required": false,
                "immutable": false,
                "item": {
                    "type": "reference",
                    "refType": "object",
                    "refName": "TeamTechnology",
                    "required": false,
                    "immutable": false
                }
            },
            "contactMethod": {"type": "uri", "required": true, "immutable": false},
            "linkedinHandle": {"type": "uri", "required": true, "immutable": false},
            "longDescription": {"type": "string", "required": false, "immutable": false},
            "shortDescription": {"type": "string", "required": false, "immutable": false},
            "membershipSources": {
                "type": "list",
                "required": false,
                "immutable": false,
                "item": {
                    "type": "reference",
                    "refType": "object",
                    "refName": "TeamMembershipSource",
                    "required": false,
                    "immutable": false
                }
            }
        },
        "TeamIndustryTag": {
            "uid": {"type": "string", "required": true, "immutable": false},
            "title": {"type": "string", "required": true, "immutable": false},
            "createdAt": {"type": "datetime", "required": true, "immutable": false},
            "updatedAt": {"type": "datetime", "required": true, "immutable": false},
            "definition": {"type": "string", "required": false, "immutable": false},
            "airtableRecId": {"type": "string", "required": false, "immutable": false},
            "industryCategoryUid": {"type": "string", "required": false, "immutable": false}
        },
        "TeamMember": {
            "name": {"type": "string", "required": true, "immutable": false},
            "image": {"type": "uri", "required": true, "immutable": false},
            "teams": {
                "type": "list",
                "required": false,
                "immutable": false,
                "item": {
                    "type": "reference",
                    "refType": "object",
                    "refName": "TeamRole",
                    "required": false,
                    "immutable": false
                }
            },
            "skills": {
                "type": "list",
                "required": false,
                "immutable": false,
                "item": {
                    "type": "reference",
                    "refType": "object",
                    "refName": "TeamSkill",
                    "required": false,
                    "immutable": false
                }
            },
            "twitter": {"type": "string", "required": false, "immutable": false},
            "location": {"type": "string", "required": false, "immutable": false},
            "mainTeam": {
                "type": "reference",
                "refType": "object",
                "refName": "TeamRole",
                "required": true,
                "immutable": false
            },
            "memberId": {"type": "string", "required": true, "immutable": false},
            "teamLead": {"type": "boolean", "required": true, "immutable": false},
            "openToWork": {"type": "boolean", "required": true, "immutable": false},
            "officeHours": {"type": "string", "required": false, "immutable": false},
            "preferences": {"type": "string", "required": false, "immutable": false},
            "githubHandle": {"type": "string", "required": false, "immutable": false},
            "repositories": {
                "type": "list",
                "required": false,
                "immutable": false,
                "item": {"type": "string", "required": false, "immutable": false}
            },
            "discordHandle": {"type": "string", "required": false, "immutable": false},
            "linkedinHandle": {"type": "uri", "required": true, "immutable": false},
            "telegramHandle": {"type": "string", "required": false, "immutable": false},
            "projectContributions": {
                "type": "list",
                "required": true,
                "immutable": false,
                "item": {
                    "type": "reference",
                    "refType": "object",
                    "refName": "TeamProjectContribution",
                    "required": true,
                    "immutable": false
                }
            }
        },
        "TeamMembershipSource": {
            "uid": {"type": "string", "required": true, "immutable": false},
            "title": {"type": "string", "required": true, "immutable": false},
            "createdAt": {"type": "datetime", "required": true, "immutable": false},
            "updatedAt": {"type": "datetime", "required": true, "immutable": false}
        },
        "TeamProjectContribution": {
            "uid": {"type": "string", "required": true, "immutable": false},
            "role": {"type": "string", "required": true, "immutable": false},
            "endDate": {"type": "datetime", "required": false, "immutable": false},
            "memberUid": {"type": "string", "required": true, "immutable": false},
            "startDate": {"type": "datetime", "required": false, "immutable": false},
            "projectUid": {"type": "string", "required": true, "immutable": false},
            "description": {"type": "string", "required": false, "immutable": false},
            "currentProject": {"type": "boolean", "required": true, "immutable": false}
        },
        "TeamRole": {
            "uid": {"type": "string", "required": true, "immutable": false},
            "name": {"type": "string", "required": true, "immutable": false},
            "role": {"type": "string", "required": false, "immutable": false},
            "mainTeam": {"type": "boolean", "required": true, "immutable": false},
            "teamLead": {"type": "boolean", "required": true, "immutable": false}
        },
        "TeamSkill": {"title": {"type": "string", "required": true, "immutable": false}},
        "TeamTechnology": {
            "uid": {"type": "string", "required": true, "immutable": false},
            "title": {"type": "string", "required": true, "immutable": false},
            "createdAt": {"type": "datetime", "required": true, "immutable": false},
            "updatedAt": {"type": "datetime", "required": true, "immutable": false}
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
        "teamList": {"type": "connection", "name": "Team"},
        "webPageList": {"type": "connection", "name": "WebPage"}
    }
}
