import { ItemService } from "../services/item.js";
import { IndexService } from "../services/index.js";
import axios from "axios";
import { searchItems } from "../language/search_item.js";

export const listItems = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const { indexId } = req.params;
  const { query, cursor, limit, dateFilter } = req.query;
  try {
    let response = { endCursor: null, items: [] };
    if (query) {
      try {
        const searchResults = await searchItems({
          indexIds: [indexId],
          query,
          limit: parseInt(limit) || 500,
          offset: 0,
          dateFilter
        });

        if (searchResults.length > 0) {
          response.items = searchResults;
        }
      } catch (error) {
        return res.status(400).json({ error: error.message });
      }
    } else {
      const itemService = new ItemService(definition);
      response = await itemService.getIndexItems(indexId, cursor, limit);
    }

    return res.status(200).json(response);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

export const addItem = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const { indexId, itemId } = req.params;
  try {
    const itemService = new ItemService(definition).setSession(req.session);
    const item = await itemService.addItem(indexId, itemId);
    res.status(201).json(item);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
  //Queue embeddings.
};
export const removeItem = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const { indexId, itemId } = req.params;
  try {
    const itemService = new ItemService(definition).setSession(req.session);
    await itemService.removeItem(indexId, itemId);
    res.status(200).json({
      itemId,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
  //Queue embeddings
};

export const getIndexesByItemId = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const { itemId } = req.params;
  try {
    const itemService = new ItemService(definition);
    const items = await itemService.getIndexesByItemId(itemId, null, 24, false);

    return res.json(items);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
  //Queue embeddings
};
