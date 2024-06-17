import { readFile } from "fs/promises";

import { createHandler } from "@composedb/server";
import { Composite } from "@composedb/devtools";
import { createContext, createGraphQLSchema } from "@composedb/runtime";

import { createServer } from "node:http";

import { CeramicClient } from "@ceramicnetwork/http-client";

import { DID } from "dids";
import { Ed25519Provider } from "key-did-provider-ed25519";
import { getResolver } from "key-did-resolver";
import { fromString } from "uint8arrays/from-string";

const ceramic = new CeramicClient(process.env.CERAMIC_HOST);

let server;

const authenticateAdmin = async () => {
  const ceramicAdminPrivateKey = process.env.CERAMIC_ADMIN_PRIVATE_KEY;
  if (!ceramicAdminPrivateKey) {
    return false;
  }
  const key = fromString(ceramicAdminPrivateKey, "base16");
  const did = new DID({
    resolver: getResolver(),
    provider: new Ed25519Provider(key),
  });
  await did.authenticate();
  if (!did.authenticated) {
    return false;
  }
  ceramic.did = did;
};

let defaultRuntime = {
  models: {
    Conversation: {
      interface: false,
      implements: [],
      id: "Model_Conversation_ID",
      accountRelation: { type: "list" },
    },
    EncryptedMessage: {
      interface: false,
      implements: [],
      id: "Model_EncryptedMessage_ID",
      accountRelation: { type: "list" },
    },
    DIDIndex: {
      interface: false,
      implements: [],
      id: "Model_DIDIndex_ID",
      accountRelation: { type: "set", fields: ["indexId", "type"] },
    },
    Embedding: {
      interface: false,
      implements: [],
      id: "Model_Embedding_ID",
      accountRelation: { type: "list" },
    },
    Index: {
      interface: false,
      implements: [],
      id: "Model_Index_ID",
      accountRelation: { type: "list" },
    },
    IndexItem: {
      interface: false,
      implements: [],
      id: "Model_IndexItem_ID",
      accountRelation: { type: "list" },
    },
    Profile: {
      interface: false,
      implements: [],
      id: "Model_Profile_ID",
      accountRelation: { type: "single" },
    },
  },
  objects: {
    Conversation: {
      members: {
        type: "list",
        required: false,
        immutable: false,
        item: { type: "did", required: false, immutable: false },
      },
      payload: { type: "string", required: false, immutable: false },
      createdAt: {
        type: "datetime",
        required: true,
        immutable: false,
        indexed: true,
      },
      deletedAt: {
        type: "datetime",
        required: false,
        immutable: false,
        indexed: true,
      },
      updatedAt: {
        type: "datetime",
        required: true,
        immutable: false,
        indexed: true,
      },
      controllerDID: { type: "view", viewType: "documentAccount" },
      messages: {
        type: "view",
        viewType: "relation",
        relation: {
          source: "queryConnection",
          model: "Model_EncryptedMessage_ID",
          property: "conversationId",
        },
      },
    },
    EncryptedMessage: {
      payload: { type: "string", required: false, immutable: false },
      createdAt: {
        type: "datetime",
        required: true,
        immutable: false,
        indexed: true,
      },
      deletedAt: {
        type: "datetime",
        required: false,
        immutable: false,
        indexed: true,
      },
      updatedAt: {
        type: "datetime",
        required: true,
        immutable: false,
        indexed: true,
      },
      conversationId: {
        type: "streamid",
        required: true,
        immutable: false,
        indexed: true,
      },
      conversation: {
        type: "view",
        viewType: "relation",
        relation: {
          source: "document",
          model: "Model_Conversation_ID",
          property: "conversationId",
        },
      },
      controllerDID: { type: "view", viewType: "documentAccount" },
    },
    DIDIndex: {
      type: { type: "string", required: true, immutable: true, indexed: true },
      indexId: {
        type: "streamid",
        required: true,
        immutable: true,
        indexed: true,
      },
      createdAt: {
        type: "datetime",
        required: true,
        immutable: false,
        indexed: true,
      },
      deletedAt: {
        type: "datetime",
        required: false,
        immutable: false,
        indexed: true,
      },
      updatedAt: {
        type: "datetime",
        required: true,
        immutable: false,
        indexed: true,
      },
      index: {
        type: "view",
        viewType: "relation",
        relation: {
          source: "document",
          model: "Model_Index_ID",
          property: "indexId",
        },
      },
      controllerDID: { type: "view", viewType: "documentAccount" },
    },
    Embedding: {
      itemId: {
        type: "streamid",
        required: true,
        immutable: false,
        indexed: true,
      },
      vector: {
        type: "list",
        required: true,
        immutable: false,
        item: { type: "float", required: true, immutable: false },
      },
      context: { type: "string", required: false, immutable: false },
      indexId: {
        type: "streamid",
        required: true,
        immutable: false,
        indexed: true,
      },
      category: {
        type: "string",
        required: true,
        immutable: false,
        indexed: true,
      },
      createdAt: {
        type: "datetime",
        required: true,
        immutable: false,
        indexed: true,
      },
      deletedAt: {
        type: "datetime",
        required: false,
        immutable: false,
        indexed: true,
      },
      modelName: {
        type: "string",
        required: true,
        immutable: false,
        indexed: true,
      },
      updatedAt: {
        type: "datetime",
        required: true,
        immutable: false,
        indexed: true,
      },
      description: { type: "string", required: true, immutable: false },
      item: {
        type: "view",
        viewType: "relation",
        relation: { source: "document", model: null, property: "itemId" },
      },
      index: {
        type: "view",
        viewType: "relation",
        relation: {
          source: "document",
          model: "Model_Index_ID",
          property: "indexId",
        },
      },
      controllerDID: { type: "view", viewType: "documentAccount" },
    },
    Index: {
      title: { type: "string", required: true, immutable: false },
      createdAt: {
        type: "datetime",
        required: true,
        immutable: false,
        indexed: true,
      },
      deletedAt: {
        type: "datetime",
        required: false,
        immutable: false,
        indexed: true,
      },
      updatedAt: {
        type: "datetime",
        required: true,
        immutable: false,
        indexed: true,
      },
      signerFunction: { type: "cid", required: false, immutable: false },
      signerPublicKey: {
        type: "string",
        required: false,
        immutable: false,
        indexed: true,
      },
      controllerDID: { type: "view", viewType: "documentAccount" },
      items: {
        type: "view",
        viewType: "relation",
        relation: {
          source: "queryConnection",
          model: "Model_IndexItem_ID",
          property: "indexId",
        },
      },
      did: {
        type: "view",
        viewType: "relation",
        relation: {
          source: "queryConnection",
          model: "Model_DIDIndex_ID",
          property: "indexId",
        },
      },
      embeddings: {
        type: "view",
        viewType: "relation",
        relation: {
          source: "queryConnection",
          model: "Model_Embedding_ID",
          property: "indexId",
        },
      },
    },
    IndexItem: {
      itemId: {
        type: "streamid",
        required: true,
        immutable: false,
        indexed: true,
      },
      indexId: {
        type: "streamid",
        required: true,
        immutable: false,
        indexed: true,
      },
      modelId: {
        type: "streamid",
        required: true,
        immutable: false,
        indexed: true,
      },
      createdAt: {
        type: "datetime",
        required: true,
        immutable: false,
        indexed: true,
      },
      deletedAt: {
        type: "datetime",
        required: false,
        immutable: false,
        indexed: true,
      },
      updatedAt: {
        type: "datetime",
        required: true,
        immutable: false,
        indexed: true,
      },
      item: {
        type: "view",
        viewType: "relation",
        relation: { source: "document", model: null, property: "itemId" },
      },
      index: {
        type: "view",
        viewType: "relation",
        relation: {
          source: "document",
          model: "Model_Index_ID",
          property: "indexId",
        },
      },
      controllerDID: { type: "view", viewType: "documentAccount" },
      embeddings: {
        type: "view",
        viewType: "relation",
        relation: {
          source: "queryConnection",
          model: "Model_Embedding_ID",
          property: "itemId",
        },
      },
    },
    Profile: {
      bio: { type: "string", required: false, immutable: false },
      name: { type: "string", required: false, immutable: false },
      avatar: { type: "cid", required: false, immutable: false },
      createdAt: { type: "datetime", required: true, immutable: false },
      deletedAt: { type: "datetime", required: false, immutable: false },
      updatedAt: { type: "datetime", required: true, immutable: false },
      controllerDID: { type: "view", viewType: "documentAccount" },
    },
  },
  enums: {},
  accountData: {
    didIndex: { type: "set", name: "DIDIndex" },
    didIndexList: { type: "connection", name: "DIDIndex" },
    embeddingList: { type: "connection", name: "Embedding" },
    indexItemList: { type: "connection", name: "IndexItem" },
    conversationList: { type: "connection", name: "Conversation" },
    encryptedMessageList: { type: "connection", name: "EncryptedMessage" },
    indexList: { type: "connection", name: "Index" },
    profile: { type: "node", name: "Profile" },
  },
};

export const jsonSchemaToGraphQLFragment = (schema, prefix = false) => {
  function resolveRef(ref, defs) {
    const refPath = ref.replace(/^#\/\$defs\//, "");
    return defs[refPath];
  }
  const parentDefs = schema.schema.$defs;
  const prefixName = schema.name;

  if (schema.schema.$defs) {
    schema.schema.$defs.GraphQLDID = {
      type: "object",
      title: "GraphQLDID",
      required: ["id"],
      properties: {
        id: {
          type: "string",
          maxLength: 100,
        },
      },
      additionalProperties: false,
    };
  }

  schema.schema.properties.id = {
    type: "string",
  };

  function buildFragment(schema, parentDefs, indentLevel = 1) {
    const indent = "  ".repeat(indentLevel);
    const fields = Object.entries(schema.properties).map(([key, value]) => {
      key = prefix && indentLevel == 1 ? `${prefixName}_${key}: ${key}` : key;
      if (value.type === "array") {
        const foundRef = value.items.$ref || value.$ref;
        if (foundRef) {
          const resolved = resolveRef(foundRef, parentDefs);
          if (resolved) {
            const subFragment = buildFragment(
              resolved,
              parentDefs,
              indentLevel + 1,
            );
            return `${indent}${key} {\n${subFragment}\n${indent}}`;
          }
        } else {
          return `${indent}${key}`;
        }
      } else if (value.$ref) {
        const resolved = resolveRef(value.$ref, parentDefs);
        if (resolved) {
          if (resolved.type === `string`) {
            return `${indent}${key}`;
          } else if (resolved.type === `object` && resolved.properties) {
            const subFragment = buildFragment(
              resolved,
              parentDefs,
              indentLevel + 1,
            );
            return `${indent}${key} {\n${subFragment}\n${indent}}`;
          }
        }
      } else if (value.type) {
        return `${indent}${key}`;
      } else {
        console.log(key, value);
      }
    });

    return fields.join("\n");
  }

  const finalFragment = buildFragment(schema.schema, parentDefs);

  return `... on ${schema.name} {\n${finalFragment}\n}`;
};

export const indexNewModel = async (app, modelId, ceramicAdminPrivateKey) => {
  const indexerCeramic = new CeramicClient(process.env.CERAMIC_HOST);
  if (!ceramicAdminPrivateKey) {
    return false;
  }
  const key = fromString(ceramicAdminPrivateKey, "base16");
  const did = new DID({
    resolver: getResolver(),
    provider: new Ed25519Provider(key),
  });
  await did.authenticate();
  if (!did.authenticated) {
    return false;
  }
  indexerCeramic.did = did;

  await Composite.fromModels({
    ceramic: indexerCeramic,
    models: [modelId],
    index: true,
  });
  await setIndexedModelParams(app);

  return true;
};

export const stopIndexingModels = async (
  app,
  modelId,
  ceramicAdminPrivateKey,
) => {
  const indexerCeramic = new CeramicClient(process.env.CERAMIC_HOST);
  if (!ceramicAdminPrivateKey) {
    return false;
  }
  const key = fromString(ceramicAdminPrivateKey, "base16");
  const did = new DID({
    resolver: getResolver(),
    provider: new Ed25519Provider(key),
  });
  await did.authenticate();
  if (!did.authenticated) {
    return false;
  }
  indexerCeramic.did = did;

  const models = await indexerCeramic.admin.stopIndexingModels([modelId]);

  await setIndexedModelParams(app);

  return models;
};
export const setIndexedModelParams = async (app) => {
  await authenticateAdmin();
  const models = await ceramic.admin.getIndexedModels();
  const modelList = models.map((m) => m.streamID.toString());

  const modelFragments = await Promise.all(
    modelList.map(async (m) => {
      const stream = await ceramic.loadStream(m);
      const fragment = jsonSchemaToGraphQLFragment(stream.content);
      return {
        id: m,
        name: stream.content.name,
        fragment,
        prefixedFragment: jsonSchemaToGraphQLFragment(stream.content, true),
      };
    }),
  );

  const c = await Composite.fromModels({
    ceramic,
    models: modelList,
    index: true,
    commonEmbeds: `all`,
  });

  defaultRuntime = JSON.stringify(defaultRuntime);

  const runTime = c.toRuntime();
  Object.entries(runTime.models).forEach(([modelName, model]) => {
    defaultRuntime = defaultRuntime.replace(
      new RegExp(`Model_${modelName}_ID`, "g"),
      model.id,
    );
  });

  defaultRuntime = JSON.parse(defaultRuntime);

  Object.entries(runTime.models).forEach(([modelName, model]) => {
    if (!defaultRuntime.models[modelName]) {
      defaultRuntime.models[modelName] = model;
    }
  });

  Object.entries(runTime.objects).forEach(([modelName, object]) => {
    if (!defaultRuntime.objects[modelName]) {
      defaultRuntime.objects[modelName] = object;
    }
  });

  Object.entries(runTime.accountData).forEach(([modelName, accountData]) => {
    if (!defaultRuntime.accountData[modelName]) {
      defaultRuntime.accountData[modelName] = accountData;
    }
  });

  app.set("runtimeDefinition", defaultRuntime);
  app.set("modelFragments", modelFragments);

  const port = process.env.GRAPHQL_PORT || 5001;

  const handler = createHandler({
    ceramic,
    options: { context: createContext({ ceramic }), graphiql: true },
    port,
    cache: false,
    schema: createGraphQLSchema({
      definition: defaultRuntime,
      readonly: false,
    }),
  });

  if (server) {
    await server.close();
  }
  server = createServer(handler);

  server.listen(port, () => {
    console.log(`GraphiQL server intialized on port ${port}`);
  });
};
