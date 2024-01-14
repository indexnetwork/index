/* eslint-disable no-unused-vars */
const Service = require('./Service');

/**
* Create a new Embedding
* Endpoint to create a new Embedding entity.
*
* embedding Embedding 
* no response value expected for this operation
* */
const createEmbedding = ({ embedding }) => new Promise(
  async (resolve, reject) => {
    try {
      resolve(Service.successResponse({
        embedding,
      }));
    } catch (e) {
      reject(Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      ));
    }
  },
);
/**
* Create a new Index
* Endpoint to create a new Index entity.
*
* index Index 
* no response value expected for this operation
* */
const createIndex = ({ index }) => new Promise(
  async (resolve, reject) => {
    try {
      resolve(Service.successResponse({
        index,
      }));
    } catch (e) {
      reject(Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      ));
    }
  },
);
/**
* Create a new IndexItem
* Endpoint to create a new IndexItem entity.
*
* indexItem IndexItem 
* no response value expected for this operation
* */
const createIndexItem = ({ indexItem }) => new Promise(
  async (resolve, reject) => {
    try {
      resolve(Service.successResponse({
        indexItem,
      }));
    } catch (e) {
      reject(Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      ));
    }
  },
);
/**
* Get an Embedding by ID
* Retrieve an Embedding entity by its unique identifier.
*
* embeddingId String 
* returns Embedding
* */
const getEmbedding = ({ embeddingId }) => new Promise(
  async (resolve, reject) => {
    try {
      resolve(Service.successResponse({
        embeddingId,
      }));
    } catch (e) {
      reject(Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      ));
    }
  },
);
/**
* Get an Index by ID
* Retrieve an Index entity by its unique identifier.
*
* indexId String 
* returns Index
* */
const getIndex = ({ indexId }) => new Promise(
  async (resolve, reject) => {
    try {
      resolve(Service.successResponse({
        indexId,
      }));
    } catch (e) {
      reject(Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      ));
    }
  },
);
/**
* Get an IndexItem by ID
* Retrieve an IndexItem entity by its unique identifier.
*
* itemId String 
* returns IndexItem
* */
const getIndexItem = ({ itemId }) => new Promise(
  async (resolve, reject) => {
    try {
      resolve(Service.successResponse({
        itemId,
      }));
    } catch (e) {
      reject(Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      ));
    }
  },
);
/**
* List all Embeddings
* Retrieves a list of all Embedding entities.
*
* returns List
* */
const listEmbeddings = () => new Promise(
  async (resolve, reject) => {
    try {
      resolve(Service.successResponse({
      }));
    } catch (e) {
      reject(Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      ));
    }
  },
);
/**
* List all IndexItems
* Retrieves a list of all IndexItem entities.
*
* returns List
* */
const listIndexItems = () => new Promise(
  async (resolve, reject) => {
    try {
      resolve(Service.successResponse({
      }));
    } catch (e) {
      reject(Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      ));
    }
  },
);
/**
* List all Indexes
* Retrieves a list of all Index entities.
*
* returns List
* */
const listIndexes = () => new Promise(
  async (resolve, reject) => {
    try {
      resolve(Service.successResponse({
      }));
    } catch (e) {
      reject(Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      ));
    }
  },
);
/**
* Query
* This endpoint allows for a complex query against indexes, items, and embeddings, filtered by specific identifiers and categories. It supports querying based on Decentralized Identifiers (DIDs), item and index identifiers, and specific types of embeddings. 
*
* query Query 
* no response value expected for this operation
* */
const query = ({ query }) => new Promise(
  async (resolve, reject) => {
    try {
      resolve(Service.successResponse({
        query,
      }));
    } catch (e) {
      reject(Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      ));
    }
  },
);
/**
* Update an Embedding by ID
* Update an existing Embedding entity by its ID.
*
* embeddingId String 
* embedding Embedding 
* no response value expected for this operation
* */
const updateEmbedding = ({ embeddingId, embedding }) => new Promise(
  async (resolve, reject) => {
    try {
      resolve(Service.successResponse({
        embeddingId,
        embedding,
      }));
    } catch (e) {
      reject(Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      ));
    }
  },
);
/**
* Update an Index by ID
* Update an existing Index entity by its ID.
*
* indexId String 
* index Index 
* no response value expected for this operation
* */
const updateIndex = ({ indexId, index }) => new Promise(
  async (resolve, reject) => {
    try {
      resolve(Service.successResponse({
        indexId,
        index,
      }));
    } catch (e) {
      reject(Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      ));
    }
  },
);
/**
* Update an IndexItem by ID
* Update an existing IndexItem entity by its ID.
*
* itemId String 
* indexItem IndexItem 
* no response value expected for this operation
* */
const updateIndexItem = ({ itemId, indexItem }) => new Promise(
  async (resolve, reject) => {
    try {
      resolve(Service.successResponse({
        itemId,
        indexItem,
      }));
    } catch (e) {
      reject(Service.rejectResponse(
        e.message || 'Invalid input',
        e.status || 405,
      ));
    }
  },
);

module.exports = {
  createEmbedding,
  createIndex,
  createIndexItem,
  getEmbedding,
  getIndex,
  getIndexItem,
  listEmbeddings,
  listIndexItems,
  listIndexes,
  query,
  updateEmbedding,
  updateIndex,
  updateIndexItem,
};
