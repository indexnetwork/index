export const profileFragment = `
  ... on Profile {
    bio
    name
    avatar
    createdAt
    updatedAt
    deletedAt
    controllerDID {
      id
    }
  }
`;

export const appBundleFragment = `
  id
  __typename
  ... on Index {
    Index_id: id
    Index_title: title
    Index_createdAt: createdAt
    Index_updatedAt: updatedAt
    Index_deletedAt: deletedAt
  }
  ... on Article {
    Article_id: id
    Article_title: title
    Article_url: url
    Article_createdAt: createdAt
  }
  ... on WebPage {
    WebPage_title: title
    WebPage_favicon: favicon
    WebPage_url: url
    WebPage_content: content
    WebPage_createdAt: createdAt
    WebPage_updatedAt: updatedAt
    WebPage_deletedAt: deletedAt
  }
  ... on Cast {
    Cast_thread_hash: thread_hash
    Cast_author: author {
      username
    }
    Cast_text: text
    Cast_timestamp: timestamp
  }
`;

export const indexItemFragment = `
  ... on IndexItem {
    id
    indexId
    itemId
    controllerDID {
      id
    }
    modelId
    createdAt
    updatedAt
    deletedAt
    item {
      id
      __typename
      ${appBundleFragment}
    }
    index {
      id
      title
      signerPublicKey
      signerFunction
      controllerDID {
        id
      }
      createdAt
      updatedAt
      deletedAt
    }
  }
`;
