import pgvector from "pgvector/knex";
import pkg from "knex";
const { knex } = pkg;

const cli = knex({
  client: "pg",
  connection: process.env.POSTGRES_CONNECTION_STRING,
});

export const searchItems = async (params) => {
  const { indexIds, vector, page = 1, categories, modelNames } = params;
  const itemsPerPage = 500;

  if (page < 1) throw new Error("Page number must be greater than 0");
  if (!vector || vector.length !== 1536) throw new Error("Invalid embedding size");

  // Set HNSW search parameter
  await cli.raw('SET hnsw.ef_search = 1000');
  await cli.raw('SET hnsw.iterative_scan = strict_order');

  const query = cli('index_embeddings')
    .select([
      'index_id',
      'item_id', 
      'model_id',
      'stream_id',
      'category',
      'model_name',
      'description',
      'created_at',
      'updated_at',
      cli.raw('vector <=> ?::vector AS distance', [cli.raw(`'[${vector.join(',')}]'::vector(1536)`)])
    ])
    .whereIn('index_id', indexIds)
    .orderBy('distance')
    .limit(itemsPerPage);

  const results = await query;
  console.log("results", results.length)
  return results;



};

