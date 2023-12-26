/**
 * The DefaultController file is a very simple one, which does not need to be changed manually,
 * unless there's a case where business logic routes the request to an entity which is not
 * the service.
 * The heavy lifting of the Controller item is done in Request.js - that is where request
 * parameters are extracted and sent to the service, and where response is handled.
 */

const Controller = require('./Controller');
const service = require('../services/DefaultService');
const createEmbedding = async (request, response) => {
  await Controller.handleRequest(request, response, service.createEmbedding);
};

const createIndex = async (request, response) => {
  await Controller.handleRequest(request, response, service.createIndex);
};

const createIndexItem = async (request, response) => {
  await Controller.handleRequest(request, response, service.createIndexItem);
};

const getEmbedding = async (request, response) => {
  await Controller.handleRequest(request, response, service.getEmbedding);
};

const getIndex = async (request, response) => {
  await Controller.handleRequest(request, response, service.getIndex);
};

const getIndexItem = async (request, response) => {
  await Controller.handleRequest(request, response, service.getIndexItem);
};

const listEmbeddings = async (request, response) => {
  await Controller.handleRequest(request, response, service.listEmbeddings);
};

const listIndexItems = async (request, response) => {
  await Controller.handleRequest(request, response, service.listIndexItems);
};

const listIndexes = async (request, response) => {
  await Controller.handleRequest(request, response, service.listIndexes);
};

const query = async (request, response) => {
  await Controller.handleRequest(request, response, service.query);
};

const updateEmbedding = async (request, response) => {
  await Controller.handleRequest(request, response, service.updateEmbedding);
};

const updateIndex = async (request, response) => {
  await Controller.handleRequest(request, response, service.updateIndex);
};

const updateIndexItem = async (request, response) => {
  await Controller.handleRequest(request, response, service.updateIndexItem);
};


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
