export const profileFragment = `
  ... on Profile {
    id
    name
    controllerDID {
      id
    }
    bio
    avatar
    createdAt
    updatedAt
  }
`;

export const indexFragment = `
  ... on Index {
    id
    title
    collabAction
    pkpPublicKey
    createdAt
    updatedAt
    deletedAt
    controllerDID {
      id
    }
    links(last: 1) {
      edges {
        node {
          updatedAt
        }
      }
    }
  }
`;

// ... (other fragments)


export const indexLinkFragment = `
  ... on IndexLink {
      id
      indexId
      linkId
      createdAt
      updatedAt
      deletedAt
      indexerDID {
        id
      }
      controllerDID {
        id
      }
      index {
        id
        controllerDID {
          id
        }        
        title
        collabAction
        pkpPublicKey
        createdAt
        updatedAt
        deletedAt
      }
      link {
        id
        controllerDID {
          id
        }
        title
        url
        favicon
        tags
        content
        createdAt
        updatedAt
        deletedAt
      }
  }
`;

export const userIndexFragment = `
  ... on UserIndex {
    id
    indexId
    controllerDID {
      id
    }
    type
    createdAt
    updatedAt
    deletedAt
  }
`;

export const linkFragment = `
  ... on Link {
    id
    controllerDID {
      id
    }
    title
    url
    favicon
    tags
    content
    createdAt
    updatedAt
    deletedAt
  }
`;
