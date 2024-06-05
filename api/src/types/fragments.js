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
  ... on WebPage {
    WebPage_title: title
    WebPage_favicon: favicon
    WebPage_url: url
    WebPage_content: content
    WebPage_createdAt: createdAt
    WebPage_updatedAt: updatedAt
    WebPage_deletedAt: deletedAt
  }
`;

export const indexItemFragment = `
  ... on IndexItem {
    id
    indexId
    itemId
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
      createdAt
      updatedAt
      deletedAt
    }
  }
`;
