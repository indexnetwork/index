const IndexConfig = {
  defaultCID: "Qmayic4Fyp6gUFnrEfzhuHnAEe7BUBAsUe1AaVJdCn21a4",
  litNetwork: "habanero" as
    | "cayenne"
    | "custom"
    | "localhost"
    | "manzano"
    | "habanero",
  apiURL: "https://dev.index.network/api",
  litProtocolRPCProviderURL: "https://chain-rpc.litprotocol.com/http",
  indexChromaURL: "http://chroma-chromadb.env-dev:8000", // TODO: Update this
};

export default IndexConfig;
