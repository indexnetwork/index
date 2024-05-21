import { ComposeClient } from "@composedb/client";

/*
fragment, name */
export class ComposeDBService {
  constructor(definition, modelFragment) {
    this.modelFragment = modelFragment;
    this.client = new ComposeClient({
      ceramic: process.env.CERAMIC_HOST,
      definition,
    });
    this.did = null;
  }

  setSession(session) {
    if (session && session.did.authenticated) {
      this.did = session.did;
    }
    return this;
  }

  async createNode(content) {
    if (!this.did) {
      throw new Error("DID not set. Use setDID() to set the did.");
    }

    try {
      this.client.setDID(this.did);
      const { data, errors } = await this.client.executeQuery(
        `
                mutation CreateNode($input: Create${this.modelFragment.name}Input!) {
                    create${this.modelFragment.name}(input: $input) {
                        document {
                            ${this.modelFragment.fragment}
                        }
                    }
                }`,
        { input: { content } },
      );

      // Handle GraphQL errors
      if (errors) {
        throw new Error(
          `Error creating ${this.modelFragment.name}: ${JSON.stringify(errors)}`,
        );
      }

      // Validate the data response
      if (
        !data ||
        !data[`create${this.modelFragment.name}`] ||
        !data[`create${this.modelFragment.name}`].document
      ) {
        throw new Error("Invalid response data");
      }

      // Return the created webpage document
      return data[`create${this.modelFragment.name}`].document;
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in createWebPage:", error);
      throw error;
    }
  }

  async updateNode(id, content) {
    if (!this.did) {
      throw new Error("DID not set. Use setDID() to set the did.");
    }

    try {
      this.client.setDID(this.did);
      const { data, errors } = await this.client.executeQuery(
        `
                mutation Update${this.modelFragment.name}($input: Update${this.modelFragment.name}Input!) {
                    update${this.modelFragment.name}(input: $input) {
                        document {
                            ${this.modelFragment.fragment}
                        }
                    }
                }`,
        { input: { id, content } },
      );

      // Handle GraphQL errors
      if (errors) {
        throw new Error(
          `Error updating ${this.modelFragment.name}: ${JSON.stringify(errors)}`,
        );
      }

      // Validate the data response
      if (
        !data ||
        !data[`update${this.modelFragment.name}`] ||
        !data[`update${this.modelFragment.name}`].document
      ) {
        throw new Error("Invalid response data");
      }

      // Return the updated node document
      return data[`update${this.modelFragment.name}`].document;
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error(
        `Exception occurred in update${modelFragment.name}:`,
        error,
      );
      throw error;
    }
  }

  async getNodeById(id) {
    try {
      const { data, errors } = await this.client.executeQuery(`
            {
              node(id: "${id}") {
                ... on ${this.modelFragment.name} {
                  ${this.modelFragment.fragment}
                }
              }
            }`);

      // Handle GraphQL errors
      if (errors) {
        throw new Error(
          `Error getting ${this.modelFragment.name}: ${JSON.stringify(errors)}`,
        );
      }
      // Validate the data response
      if (!data || !data.node) {
        throw new Error("Invalid response data");
      }

      return data.node;
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error(`Exception occurred in getNodeById:`, error);
      throw error;
    }
  }
}
