import IndexClient from "@indexnetwork/sdk";

// add your key here
const privateKey = "";

async function main() {
  try {
    // const session = "";
    const indexClient = new IndexClient({
      domain: "index.network",
      network: "ethereum",
      privateKey, // or session
    });

    await indexClient.authenticate();

    const sampleTeamNode = {
      teamId: "cldvnxydg01n5u21kcdgywqa8",
      name: "$STYLE Protocol",
      logo: "https://files.plnetwork.io",
      website: "https://www.protocol.style",
      twitter: "@StyleProtocol",
      shortDescription:
        "An open protocol to license NFTs and virtual assets to players in any metaverse.",
      longDescription:
        "<div>STYLE Protocol is a decentralized infrastructure to enable licensing and interoperability of assets and NFTs across any virtual environment.</div>",
      technologies: [],
      fundingStage: "Pre-seed",
      industryTags: [
        {
          uid: "cldsydhtp001vyh0xmpxqx2i7",
          title: "NFT",
          definition:
            "An NFT (or non-fungible token) is a digital asset that represents real-world objects like art, music, in-game items and videos.",
          airtableRecId: "recQL48A3uH7QTwA2",
          createdAt: "2023-02-06T15:13:25.883Z",
          updatedAt: "2023-02-08T15:39:37.265Z",
          industryCategoryUid: "cldsydhsa0004yh0x5tn33ixq",
        },
        {
          uid: "clo3svcx9000002wrgipq19y4",
          title: "Blockchain Infrastructure",
          definition: "",
          airtableRecId: "",
          createdAt: "2023-10-24T04:01:52.942Z",
          updatedAt: "2024-03-20T05:36:26.385Z",
          industryCategoryUid: "cldsydhsa000ayh0xxfvj0r20",
        },
        {
          uid: "cldsydhto0013yh0xiwceoys0",
          title: "Social Networking",
          definition:
            "Social companies enable individuals to stay connected with friends, family, colleagues, customers, or clients.",
          airtableRecId: "rec8UM4hfsJLPWcmW",
          createdAt: "2023-02-06T15:13:25.883Z",
          updatedAt: "2023-10-24T03:51:56.587Z",
          industryCategoryUid: "cldsydhsa0004yh0x5tn33ixq",
        },
        {
          uid: "cldsydhtp001zyh0x8u1wtj5n",
          title: "Gaming/Metaverse",
          definition:
            "Gaming refers to creating a competitive (or achievement-focused) experience.",
          airtableRecId: "recR5RrW3ouaGNNvA",
          createdAt: "2023-02-06T15:13:25.883Z",
          updatedAt: "2023-10-24T03:58:52.642Z",
          industryCategoryUid: "cldsydhsa0004yh0x5tn33ixq",
        },
      ],
      membershipSources: [
        {
          uid: "cldsydjjl0042yh0x61vug819",
          title: "Faber",
          createdAt: "2023-02-06T15:13:28.113Z",
          updatedAt: "2023-02-06T15:13:28.113Z",
        },
        {
          uid: "cldsydjjk003myh0xfbhnsqyh",
          title: "Venture Investment",
          createdAt: "2023-02-06T15:13:28.113Z",
          updatedAt: "2023-10-25T16:30:58.736Z",
        },
      ],
      members: [
        {
          memberId: "cldvo6j0q04idu21k4960p0uk",
          name: "Leo Hilse",
          image: "https://files.plnetwork.io//620427d13c17a2d7.webp",
          githubHandle: "",
          discordHandle: "",
          telegramHandle: "",
          twitter: "",
          officeHours: "",
          skills: [
            {
              title: "Management",
            },
            {
              title: "Strategy",
            },
            {
              title: "Marketing & Creative",
            },
          ],
          teamLead: true,
          projectContributions: [],
          teams: [
            {
              uid: "cldvnxydg01n5u21kcdgywqa8",
              name: "$STYLE Protocol",
              role: "Founder",
              teamLead: true,
              mainTeam: true,
            },
          ],
          mainTeam: {
            uid: "cldvnxydg01n5u21kcdgywqa8",
            name: "$STYLE Protocol",
            role: "Founder",
            teamLead: true,
            mainTeam: true,
          },
          openToWork: false,
          linkedinHandle: "http://a.com",
          repositories: [],
          preferences: "",
        },
        {
          memberId: "cldvo53jt042tu21kc8zl1r7p",
          name: "René Petrevski",
          image: "https://files.plnetwork.io//6e2a116678c563cc.webp",
          githubHandle: "",
          discordHandle: "",
          telegramHandle: "",
          twitter: "",
          officeHours: "",
          skills: [
            {
              title: "Product",
            },
            {
              title: "Operations",
            },
            {
              title: "Marketing & Creative",
            },
            {
              title: "People",
            },
          ],
          teamLead: false,
          projectContributions: [],
          teams: [
            {
              uid: "cldvnxydg01n5u21kcdgywqa8",
              name: "$STYLE Protocol",
              role: "Bus. Dev. Manager",
              teamLead: false,
              mainTeam: true,
            },
          ],
          mainTeam: {
            uid: "cldvnxydg01n5u21kcdgywqa8",
            name: "$STYLE Protocol",
            role: "Bus. Dev. Manager",
            teamLead: false,
            mainTeam: true,
          },
          openToWork: false,
          linkedinHandle: "http://a.com",
          repositories: [],
          preferences: "",
        },
      ],
      contactMethod: "https://protocol.com",
      linkedinHandle: "http://a.com",
    };

    const createdNode = await indexClient.createNode(
      "kjzl6hvfrbw6cb9d3i74xp3iuooxhw04k3pumj6zyzxlvkvzyd6qaus3jihej7h",
      sampleTeamNode,
    );

    console.log("Created Node:", createdNode.id, createdNode.name);

    const node = await indexClient.getNodeById(
      "kjzl6hvfrbw6cb9d3i74xp3iuooxhw04k3pumj6zyzxlvkvzyd6qaus3jihej7h",
      createdNode.id,
    );

    console.log("Get Node:", node.id, node.name);

    // const did = "";
    // const indexes = await indexClient.getAllIndexes(did);
    // console.log(indexes);

    // const profile = await indexClient.getProfile(did);
    // console.log("Profile:", profile);

    const title = "Team index";
    const newIndex = await indexClient.createIndex(title);
    console.log("New Index:", newIndex);

    // const item = await indexClient.crawlLink(
    //   "https://www.paulgraham.com/articles.html",
    // );
    // console.log("Crawled Item:", item);

    const addedItem = await indexClient.addItemToIndex(
      newIndex.id,
      createdNode.id,
    );
    console.log("Added Item to Index:", addedItem);

    // const fetchedIndex = await indexClient.getIndex(newIndex.id);
    // console.log("Fetched Index:", fetchedIndex);
  } catch (err) {
    console.error(err);
  }
}

main();
