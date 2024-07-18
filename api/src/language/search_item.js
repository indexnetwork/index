import pgvector from "pgvector/knex";
import pkg from "knex";
const { knex } = pkg;

const cli = knex({
  client: "pg",
  connection: process.env.POSTGRES_CONNECTION_STRING,
});

export const searchItems = async (params) => {
  const { indexIds, vector, page = 1, categories, modelNames } = params;
  const itemsPerPage = 10;

  if (page < 1) throw new Error("Page number must be greater than 0");

  const offset = (page - 1) * itemsPerPage;

  let query = cli("index_embeddings")
    .select(`*`)
    .whereIn("index_id", indexIds)
    .limit(itemsPerPage)
    .offset(offset);

  if (vector) {
    query = query.orderByRaw("?? <=> ?", ["vector", pgvector.toSql(vector)]);
  }

  const documents = await query;
  return documents;
};
