import pgvector from "pgvector/knex";
import pkg from "knex";
const { knex } = pkg;

const cli = knex({
  client: "pg",
  connection: process.env.POSTGRES_CONNECTION_STRING,
});

export const searchItems = async (params) => {
  const { indexIds, vector } = params;
  let query = cli("index_embeddings").select(`*`).whereIn("index_id", indexIds);

  if (vector) {
    query = query.orderByRaw("?? <=> ?", ["vector", pgvector.toSql(vector)]);
  }

  const documents = await query.limit(30);
  return documents;
};
