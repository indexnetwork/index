export const didIndexFragment = `
  ... on DIDIndex {
    id
    type
    indexId
    createdAt
    updatedAt
    deletedAt
    controllerDID {
      id
    }
  }
`;

export const profileFragment = `
  ... on Profile {
    id
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

export const webPageFragment = `
  ... on WebPage {
    id
    title
    favicon
    url
    content
    createdAt
    updatedAt
    deletedAt
  }
`;

export const modelBundleFragment = `
  ... on WebPage {
    WebPage_title: title
    WebPage_favicon: favicon
    WebPage_url: url
    WebPage_content: content
    WebPage_createdAt: createdAt
    WebPage_updatedAt: updatedAt
    WebPage_deletedAt: deletedAt
  }
  ... on Team {
    Team_logo: logo
    Team_name: name
    Team_teamId: teamId
    Team_members: members {
        name
        image
        teams {
            uid
            name
            role
            mainTeam
            teamLead
        }
        skills {
            title
        }
        twitter
        location
        mainTeam {
            uid
            name
            role
            mainTeam
            teamLead
        }
        memberId
        teamLead
        openToWork
        officeHours
        preferences
        githubHandle
        repositories
        discordHandle
        linkedinHandle
        telegramHandle
        projectContributions {
            uid
            role
            endDate
            memberUid
            startDate
            projectUid
            description
            currentProject
        }
    }
    Team_twitter: twitter
    Team_website: website
    Team_fundingStage: fundingStage
    Team_industryTags: industryTags {
        uid
        title
        createdAt
        updatedAt
        definition
        airtableRecId
        industryCategoryUid
    }
    Team_technologies: technologies {
        uid
        title
        createdAt
        updatedAt
    }
    Team_contactMethod: contactMethod
    Team_linkedinHandle: linkedinHandle
    Team_longDescription: longDescription
    Team_shortDescription: shortDescription
    Team_membershipSources: membershipSources {
        uid
        title
        createdAt
        updatedAt
    }
  }
`;


export const indexItemFragment = `
  ... on IndexItem {
    id
    indexId
    itemId
    createdAt
    updatedAt
    deletedAt
    item {
      id
      __typename
      ${modelBundleFragment}
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
`
