// import List from "components/base/List";
// import { Tabs } from "components/base/Tabs";
// import TabPane from "components/base/Tabs/TabPane";
// import Text from "components/base/Text";
// import Col from "components/layout/base/Grid/Col";
// import FlexRow from "components/layout/base/Grid/FlexRow";
// import IndexItem from "components/site/indexes/IndexItem";
import { useRouteParams } from "hooks/useRouteParams";
// import { useRouter, useSearchParams } from "next/navigation";
// import { FC, memo, useCallback, useEffect, useRef, useMemo } from "react";
// import { Indexes } from "types/entity";
import { useApp } from "@/context/AppContext";
// import Link from "next/link";
import { useRouter } from "next/navigation";
import { FC, memo, useEffect, useMemo, useCallback } from "react";

const TAB_QUERY = "tab";

const IndexListSection: FC = () => {
  const { id, isDID, isIndex } = useRouteParams();
  const router = useRouter();
  // const query = useSearchParams();
  const { fetchIndex } = useApp();
  useEffect(() => {
    console.log("indexlist rendered");
  }, []);

  // const {
  //   indexes,
  //   leftSectionIndexes,
  //   setLeftTabKey,
  //   leftTabKey,
  //   viewedProfile,
  // } = useApp();

  // const prevProfileID = useRef(viewedProfile?.id);

  // const handleTabChange = useCallback(
  //   (tabKey: IndexListTabKey) => {
  //     if (!viewedProfile) return;

  //     setLeftTabKey(tabKey);
  //     if (tabKey !== IndexListTabKey.ALL) {
  //       router.push(`/${viewedProfile?.id}?${TAB_QUERY}=${tabKey}`);
  //     } else {
  //       router.push(`/${viewedProfile?.id}`);
  //     }
  //   },
  //   [setLeftTabKey, router, viewedProfile],
  // );

  // useEffect(() => {
  //   const tab = query.get(TAB_QUERY) as IndexListTabKey;
  //   console.log("in indexlist", tab);
  //   if (tab && isDID) {
  //     setLeftTabKey(tab);
  //   } else if (viewedProfile?.id !== prevProfileID.current) {
  //     setLeftTabKey(IndexListTabKey.ALL);
  //   }
  // }, [query, setLeftTabKey, isDID, viewedProfile]);
  const tmp = useMemo(() => {
    return [
      {
        did: {
          owned: false,
          starred: true,
        },
        id: "did:pkh:eip155:1:0xA9271CAD3d22d67A11e126E4DCbc0410563c0beA",
        title: "yenibitane",
        signerPublicKey:
          "0x04538d6f1f03a4a221b94059410dace631c56e5612c8b4d97713124d29d20317d795232f91e19d8c83bf10c993ef80879b0f87e84b5e1aa3cf080d9db576467b36",
        signerFunction:
          "bafybeigs5ai3wwt6dec23hftzyzhnqgxudstzz52gfasclej47llerxqwq",
        createdAt: "2024-05-07T13:24:44.761Z",
        updatedAt: "2024-05-07T13:24:44.761Z",
        deletedAt: null,
        ownerDID: {
          bio: null,
          name: "Seref",
          avatar: "bafybeig43kbqtmr4zmvkdf7khfbqrai7xnsr6ke52hjnnukon6pr4qc3xa",
          createdAt: "2024-05-03T04:49:34.423Z",
          updatedAt: "2024-05-03T04:49:34.423Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0xA9271CAD3d22d67A11e126E4DCbc0410563c0beA",
        },
      },
      {
        did: {
          owned: true,
          starred: true,
        },
        id: "kjzl6kcym7w8y5rsdbcinirg4yn8z8tb80pugkify79ver0yngsu0cydqs9jseg",
        title: "Startup Articles",
        signerPublicKey:
          "0x0433a165ad4e907d3eb8955187f63d0afaff0b49ae7417bba8c4922a2e52936d5b4f8881428df95ea91a2ae0ed0691950292673001fe048e65e777cc85798a1ad9",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T17:47:12.093Z",
        updatedAt: "2024-04-25T17:47:12.093Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: false,
          starred: true,
        },
        id: "kjzl6kcym7w8y7aqx2q0d3sr96h9qgrarfk4x9hw0tw17ykac2yltl5xvn00nhl",
        title: "heymo",
        signerPublicKey:
          "0x0439742e0431595294bf76392aec5f59947452c401fb8d224ddbe3930ab3a744834a8e7619b00926bc8541c59cc6463d375beaf6102e9b0990152dee3c812ec40b",
        signerFunction:
          "bafybeibpxagaqn6dupa4wnz4mnttdnfwwcshopsxeig7cf5zhz4v2jpbei",
        createdAt: "2024-05-01T14:34:25.338Z",
        updatedAt: "2024-05-01T14:49:14.330Z",
        deletedAt: null,
        ownerDID: {
          bio: null,
          name: "hey",
          avatar: null,
          createdAt: "2024-04-13T05:27:30.968Z",
          updatedAt: "2024-04-13T05:27:30.969Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x1b9Aceb609a62bae0c0a9682A9268138Faff4F5f",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y8sft1n8ysm1tmaps62renp8eqk92kuqps40wcrv0dp9h8unkab",
        title: "lol2",
        signerPublicKey:
          "0x049d43dd4c42c39918faed6b8bc2273c76dc9fc65e2c3ff7d36f2d21cb25df2ef101e3546787eb8fbef2d9a81c168ccc30360236e7b7aca42557a1b85b279c5896",
        signerFunction:
          "bafybeidgnu3fwsf3zggi7evgo4klz5wb2o7khg75ntwlsiuulbnniqkyja",
        createdAt: "2024-05-02T14:59:37.341Z",
        updatedAt: "2024-05-07T14:03:28.896Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y5lw479lm1olbq1pftn7efkz2k6l95wzep0k3yvnekvwxter0of",
        title: "tarko",
        signerPublicKey:
          "0x046ebc0b8306f695b500bdfb2c74e233003af4816ecec37a0e8123bca6a436f7863eb00d52399e42c8ee85fd79c466dffb51530fc8167ea19b0500232b93b3eb7b",
        signerFunction:
          "bafybeigs5ai3wwt6dec23hftzyzhnqgxudstzz52gfasclej47llerxqwq",
        createdAt: "2024-05-01T12:09:31.412Z",
        updatedAt: "2024-05-01T12:09:31.412Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y790dbwckam1xvieombqeup6ogmko0sxi2ki7cx9tkzakqp2f7e",
        title: "My First Index",
        signerPublicKey:
          "0x04f392929295484862eaddb7352a75fd31a34520e6b65462662470650c7cbb0710dca7c72534c6967c5dbaf82635d5195e984b801cbdecdcc758270c4d8acdbace",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-29T15:58:34.492Z",
        updatedAt: "2024-04-29T15:58:34.492Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y7q2yob3nm75piqr7tax29y4l7r0e0192zfxjnavzk3wc7gtof2",
        title: "Startup Articles",
        signerPublicKey:
          "0x048e92b42ccad2cd2af8603690e08a4cc26d3e3ee2005cc29fbafead5c1f35aab5e49b0bca4a5400621e7d0ca43b416ef2894e66a5f07f49f03191b406dbbfffb4",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T17:55:42.880Z",
        updatedAt: "2024-04-25T17:55:42.880Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y731v5i4sw9y8a50c0ux30kouz0a5dk998x1a6r7saqpa405iqp",
        title: "Team index",
        signerPublicKey:
          "0x042e7ccb81437e6f3a50dfaeb0773df32dfb6e373699f72db681be5887247b9b0e848ec15138da1c4d63de0942d24cd1c300f9eefc431c9c3b512af72d2f7cf23d",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T17:50:39.464Z",
        updatedAt: "2024-04-25T17:50:39.464Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y5lbbi9ryh3rsh06t2ko8hcrxgq6dk2n7afalsjokxgmyiei2gn",
        title: "Startup Articles",
        signerPublicKey:
          "0x0416f5f1cda4c989145f17ecd593d9bfee516b000f15effdca977a1b8798faa3670868a8533321d466b89ec32ba61281748b0524d2a76554588f24ab0616bd83e2",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T17:48:15.312Z",
        updatedAt: "2024-04-25T17:48:15.312Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8ya66cffebgu1tdb58yio1826wp3e69ugvonyg9blk5xozmpedw7",
        title: "My First Index",
        signerPublicKey:
          "0x04785571f18724dbaf0687cbf84d84eb14a865eb9b2bc951d6a012467602b7786a7d7f31ef920580edca7eaa8b02121d5172c9f5ad523bab54eb92596873384c55",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T17:42:06.893Z",
        updatedAt: "2024-04-25T17:42:06.893Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y52o1pd6wb9vaae9wlkppoqx730ycfar9tnnhnyq7wj5c2ostqq",
        title: "My First Index",
        signerPublicKey:
          "0x04075a67b2593e2f333e4068dced371c85bfd7cd60e1e076c546d8601567b4c5a860097fc82c0d7ebf3387dd125aa9eedf0b8608cff0b4a69ea4bf018f7d566358",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T17:40:38.322Z",
        updatedAt: "2024-04-25T17:40:38.322Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y7zcdwnt2zns0a7cv0ua8u4semhpjybqmy0m5ng2jhetz7espyr",
        title: "My First Index",
        signerPublicKey:
          "0x045355f5f3ab34f3ec5c35a80c75a94cd8869a6cdb85794d5262d5c7c8b33863ae2abf90c2ae491d58e14be4ca179782dfe793b674889d9551cb6c3a83cc603a73",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T17:39:37.286Z",
        updatedAt: "2024-04-25T17:39:37.286Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y9xglphvdtmop8viv0grveoxacr4upa9pjrdmkvsid1neppafy2",
        title: "My First Index",
        signerPublicKey:
          "0x047348dbe6b4ab6de65dc8e5f3e6c0fa679f89a1093346c09872533bd8d10b452bb1e6747e537cf8e4ea5de0b468cc27b763ccfca8eaa826cb76975c9228f11b52",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T17:37:25.590Z",
        updatedAt: "2024-04-25T17:37:25.590Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y96hljyntnh32zy0yoro0m4pcn8cqch2hkznmb1n9995wom4fux",
        title: "My First Index",
        signerPublicKey:
          "0x04c15f2d00077350bba6b1f06f9ef94701a3da9cbb5292147829c80b8c12579ee2f8e5a1151eeb67cf9da78f25b18b98b8c660c51b0580b0ac78dc27b93f1dcdbd",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T17:36:21.724Z",
        updatedAt: "2024-04-25T17:36:21.724Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y5mmqkcg2meqq13kbt4qa4kj922gdtwn424ucstpzmpesb36q1t",
        title: "My First Index",
        signerPublicKey:
          "0x044b2c8f7ac0a1958297cb6c70ddaf03302e9adce90d254d653abff4a0cacb1d67dd8b8fcc35c5df8d57c0ba28e894e4f026b72a194738e754f40294e8eb21e2c9",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T17:35:50.625Z",
        updatedAt: "2024-04-25T17:35:50.625Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8yb7xychbs62hvcmia6965dfq4v3ziz0byq3vaidc2a39cvjoyat",
        title: "My First Index",
        signerPublicKey:
          "0x040a4f907940cf62a142c685ed5c54a0acb3e88c88cf776543b96247db1d5d0958baaf7b6247eac818631bbcf05ceeefce4e57386fb1f8b46d0483d0729323d241",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T17:35:18.103Z",
        updatedAt: "2024-04-25T17:35:18.103Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y6wxasz1f0wp62o1p5xhkppalbdtyeslhv2qhqymzmhv0uzt4ip",
        title: "My First Index",
        signerPublicKey:
          "0x04bfd575fda3232afca34ee856d00e679c897db8e315ff33c0f13881b0f981749027aa73a4c806998a82e25044bd1c16b8534fd7fc5c2f2e9bfec8076d11479d45",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T17:34:21.606Z",
        updatedAt: "2024-04-25T17:34:21.606Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y9tq53zmadspwvkw44tw1plgfk53jv01k1yzgccj45ersf8akq6",
        title: "My First Index",
        signerPublicKey:
          "0x0425776dc14c47d02dba0c450acfde9bdbdb2ffd01afe24a5bf2e8649b06d5b41bed335c6be8a2e31702792e034a7c70b8dad9b5a8b254f9a6562a76078ee6d76c",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T17:33:16.920Z",
        updatedAt: "2024-04-25T17:33:16.920Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y747qex5lbw8vc5pgjgkm6axqyhp21ec9v5cb3gfd2bxvim92c8",
        title: "My First Index",
        signerPublicKey:
          "0x049d9ddabbb546835fcf63ee9718f273427535a9d9ae9f6ea4ce8f2afe6de3352c51042bd72c6c1195ac1e06dd73fef7e9a57811271aee01f0dda4645f4aed3ee0",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T17:31:25.268Z",
        updatedAt: "2024-04-25T17:31:25.268Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y55nh3aqe4crh36lc4mjvct7dkoh507zl7ch6yixh8cirdw6w3p",
        title: "My First Index",
        signerPublicKey:
          "0x045f45095965ae7e1e14e82362ec7849536ceeba5462aa0af42704a52cf92de307064cfa0c9b82348b9fd8b19f61e2818795526f9bd6db092a0448beead7659b17",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T17:29:57.932Z",
        updatedAt: "2024-04-25T17:29:57.932Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y5b4c2059yyjp48deud5pumf2h6wuhgk76fr0zbkq2mun5iqwfd",
        title: "My First Index",
        signerPublicKey:
          "0x0469a24982a35c29ffe724a3228e7301f725b38822a5b880d99b9ed1b431758cf63871927766cc4d582e94ab2225642515a16c933a109547fed0289c0767ebfd85",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T17:29:31.087Z",
        updatedAt: "2024-04-25T17:29:31.087Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y5p2h23r927nxcw8f2fnwzgwkek16w9jsmwvzxskqj2nbcxrrs1",
        title: "My First Index",
        signerPublicKey:
          "0x04dee1058982ef7807972f6170a370a3dcf8f854d560d5c47cf96d13e0b062431bc47e594ac3524b18110fd8c4bd08085f95f79ac1b0f831fcf38951d6062acfc3",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T17:27:54.842Z",
        updatedAt: "2024-04-25T17:27:54.842Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y8keeoi45b1273z0j0apicl5e34lf0yp1oasjz7ikdzluwiepu1",
        title: "My First Index",
        signerPublicKey:
          "0x04c3c4b232657a5977ab28023c4df33fcbc36b97c85c5287d636db7d0886c85978eb6a1243814288b2a4688c0b061b3e5a5aa64004150dfaf9ffbb1fbc8a3185e0",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T13:51:23.198Z",
        updatedAt: "2024-04-25T13:51:23.198Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8ya5w5wq8u1f3tczznmtpk412ujtfkdglwwsj1rxpf3pq8yg3mt1",
        title: "My First Index",
        signerPublicKey:
          "0x046cf80425d59eb8b6736f33d7c7d735f63dc7c7afa8cf0b7be2d960ac12bee92b2602416ae7de479dee77c14627ac1212a74721e810783a099ccfa4935b7278e2",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T13:45:05.573Z",
        updatedAt: "2024-04-25T13:45:05.573Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y7papfzr9i6c0bcd651cj8fkr1dkiyrme05fe8f7k9mcwu1knag",
        title: "Startup Articles",
        signerPublicKey:
          "0x04780ec012fae7619b8d9f3853e39af6030ad4a227f4de3e20d72a70cccf4aff96c51e0881ae14586411f8ee58bff6481beb97a7f130603e87612ff0c8b5798183",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T13:38:57.808Z",
        updatedAt: "2024-04-25T13:38:57.808Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y4ypf0r18wwtibxtmt2kvhjg7srgoz9cq3ojrjgit9e7sucl9rl",
        title: "My First Index",
        signerPublicKey:
          "0x040594f67b8fd128f7a36ee22737495d8d81453c931bb041957a34d4774ab10cb492b32487bcfd01925a96b24c54760ed7e214d41931ee191a122f154c005111b4",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T12:59:30.998Z",
        updatedAt: "2024-04-25T12:59:30.998Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y9muikicyyzvkg5us2u31rbyid8sta4ck09sxyk4szivglfgu1x",
        title: "Startup Articles",
        signerPublicKey:
          "0x04c980f0826b6906f018cbec9c35772e65c13eb9ab558c41a7a0bd6c2e0888090d83d0403b1830b602f0ec75ac798fbce8c04f905f6a2f2cd6283dedf19446d305",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-25T12:53:53.487Z",
        updatedAt: "2024-04-25T12:53:53.487Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y6b2guwuvf0jyd63w2dfl468lhzl0mtjt976espu8atqoq1znwv",
        title: "Startup Articles",
        signerPublicKey:
          "0x04948c43fb00f141c7b182784aecf0b8dc0f1ed75fe7a255fa756dbe97d29252f507e9ad2476e27220d05a8885a74de3cee9f13eac8b0aa34b69e3d4eb858717f1",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-24T21:49:33.262Z",
        updatedAt: "2024-04-24T21:49:33.262Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y61hi0d9q1qfn6113x5mqkiy3yeflcmk7ttlzs1wpjcj6329wmk",
        title: "My First Index",
        signerPublicKey:
          "0x04b4a86b61bd9c65ff053d355b74c04f32b168869875ed265feeea0f2e2f306702a221cbfe4d05e927e9e7793257fe893a8537281cb0e539b3b47f69432ff385fa",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-24T20:56:22.955Z",
        updatedAt: "2024-04-24T20:56:22.955Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8yajcfkz5qxylinih8kauszunn2zebvkbova85s4z16hyh6lyli4",
        title: "My First Index",
        signerPublicKey:
          "0x04be1f52ab66db47a5a01505212d4d172314dce816320ec42f5aee8dcf632ae4f86d9aab28bf6db0626eaa50aacd06b1963087c91e7bbafb799f5d7c57009d07b1",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-24T20:55:38.827Z",
        updatedAt: "2024-04-24T20:55:38.827Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y948af96yz2mb20chld9kyqis71016j2belsn0wgy2178emvx0w",
        title: "My First Index",
        signerPublicKey:
          "0x04e722d653920cbd1681ca82798ce8dee7231716bfc5b0849b0110e4c0d0706d961dedb6132310fcae53f741eaf41880900a98bf24decec667bdb4bca2cc517da8",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-24T20:55:19.088Z",
        updatedAt: "2024-04-24T20:55:19.088Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8yap0kwbi1paf8wc1uj347eht6r1ddexvl677wmst2lzrgc2oiby",
        title: "Startup Articles",
        signerPublicKey:
          "0x0429eb981399542027dfabebaa90f9e85adab244c1f52260556736b471f7c82bd05341afe2cfac270d69452c057a74013442f40b8840425475e5eb22a5ad672f50",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-24T20:48:26.178Z",
        updatedAt: "2024-04-24T20:48:26.178Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y7gaqv0zzuwyeb0x1qpunuiajss0csjrybzafgh4xm1ui01y1w3",
        title: "Startup Articles",
        signerPublicKey:
          "0x048b5210442bbf91caac96daeb96c103aa2db90300be6dba78469ee1bd18856b8656a04fcdf26c8260c1b15cb4c59d0239937bbb85c72ab022205d7e3acd1faf73",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-24T20:46:29.927Z",
        updatedAt: "2024-04-24T20:46:29.927Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y7iwnntdnorijho0fmgqkasimkhpu3shso2auz7ah9wx5odxw9w",
        title: "Startup Articles",
        signerPublicKey:
          "0x04562f8238b72e97e5ddf0ba9b93652e98cb135387fd07afb59c3f79c25db773f7931f973c1f93a0e3e3fb55272699e6953216a108791cf1e2d745bdd2b664980f",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-24T20:21:57.653Z",
        updatedAt: "2024-04-24T20:21:57.654Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8yahiofx7v5x8snb43wpu4r7ixf35iiepls9555silaim38sq6lm",
        title: "lmao",
        signerPublicKey:
          "0x048fd798256019f461370d77ffa26324a4115bb610fc546e0e27420049c7d905dc74d21c6dafc9ac8d7bbc88c2f6f3427a02c98266a2e0ed4b61b9de60dfccc15c",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-24T20:20:26.044Z",
        updatedAt: "2024-04-24T20:20:26.044Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y8c58hbdyqijnrg9e3x32wndzcvehfq0uuteiad3j8d2du5oule",
        title: "Startup Articles",
        signerPublicKey:
          "0x0468709e37837b3b6c89a880f34289e5ab72cf56e427ca7a414be3741140d6ca95678bb76a1671232937561beed6ea29aceb96938f0fdd2d6fd1609723441ebe97",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-24T16:17:46.581Z",
        updatedAt: "2024-04-24T16:17:46.581Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y92bcg0jxkww42q16gdy741f8bsep7494luc562yb0wgybmeglz",
        title: "My First Index",
        signerPublicKey:
          "0x04a1e07ead2dec703c7765b3e8f659efc926b15cd8be1f2bdc756a948cfbd3f321fda1f719b07e09b4a3bb8ec31d5c6f1f5919c4acc46fc3746411b70447dd8323",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-24T16:15:53.736Z",
        updatedAt: "2024-04-24T16:15:53.736Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y8bdiyolkkz3wg2mhao6giuui8zv48whiblapzz8dqlo9l6w65p",
        title: "My First Index",
        signerPublicKey:
          "0x044a4d528ebbee13045e7115d21c5bc72f3e492625001207b0a2c5c5cedcecdffbede294b7a87ee7f489d680cfeb08ef7a608caadc0391842d9e74c509f0cb16a0",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-24T16:09:17.795Z",
        updatedAt: "2024-04-24T16:09:17.796Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y66xgpl9yknbjzj9gdzskmisxa9q6znhtmlf67hxayhidkrr3j8",
        title: "Startup Articles",
        signerPublicKey:
          "0x041a9123d1d3c19a59e24d7e2693ab58bc8e0017c622a1d67c726a34becbfb5cfeceef0db0727fa681163fabc39e234fcb40aa2a4b2e062fa7c1ee8b557b096361",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-24T16:09:12.192Z",
        updatedAt: "2024-04-24T16:09:12.193Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y9dhky7gf3z8248o30ks8v24grc9cxbcr4kbr0040q3nrg54cqe",
        title: "Startup Articles",
        signerPublicKey:
          "0x04a769a137178cdc3ad8fdeabe6dfe4797d69069c6bbfca8ab2969511a72d8799c1e047886803369bf0dc5e89017130bdc77a8d817eddc8563d6bfcc417bc33a9f",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-24T16:04:20.976Z",
        updatedAt: "2024-04-24T16:04:20.976Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y530gt3mojkjgzc2ff69p0dd4tht4agg0e6b1xbzpii3cb1aliy",
        title: "Startup Articles",
        signerPublicKey:
          "0x04c144811517942589a8b89211b31c3e2952b0f3591db6a7dd29d6f4d254ab8e3914476b7b70499952cda5fe0e49b9f5e435088ea2a2974ff87839cebe566010a3",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-24T16:02:27.570Z",
        updatedAt: "2024-04-24T16:02:27.570Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8yb29677m0wzxw7cbrex4wekgygnz9wwmst9nuw6061qanc41te8",
        title: "My First Index",
        signerPublicKey:
          "0x04162e26ce29ecf013dec5e3ce76b1b20b1fd6e75bd574301c79563144627d69a04a4e9d692d87662fa1479d34e584938e2a1d4c3c522846123220bebf8bfa6a32",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-24T15:49:21.705Z",
        updatedAt: "2024-04-24T15:49:21.706Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8yac0qeim4895fd8snk49cngsui0l8jrau4mu3raary0ppz0aa0d",
        title: "My First Index",
        signerPublicKey:
          "0x04ec6067063514218e218bf702a49226294dd870fea8f6460483e2e943c191777c950a41d6cb190a0ed25646178f518528a7c0914461ca6001431287e8229ae0b1",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-24T15:41:47.062Z",
        updatedAt: "2024-04-24T15:41:47.062Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y9oa6mv42vz0qaxgrl9vkszgmx8z8aid62kq0n364matheha8nk",
        title: "Startup Articles",
        signerPublicKey:
          "0x040dc63ab4f28e109bb8ec380460e8e2d04c61f7c8e8018f110ef0f5301d8c192343b4d7fe6d60f64d09a4befc13a4bafaed0d5fd2783f7e5d656bfaa5935090b8",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-24T15:41:26.510Z",
        updatedAt: "2024-04-24T15:41:26.510Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y8vs57ev8v9jafx5nrh9oo36u3trzc0nrbhzrurp0lmzijuq1pf",
        title: "Startup Articles",
        signerPublicKey:
          "0x040479bbcb4a61b117e9a854796fc1194632d90f19050788c43e45eb709db84f4202c734777fe3a4359f2317f56b43371718264f0443833696bb33dfa3f9bd6284",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-24T13:20:10.158Z",
        updatedAt: "2024-04-24T13:20:10.158Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y77an1wbgub7w6yduk0cm9v3egrp2u9xmlspntx5i9thqd4cqwv",
        title: "Startup Articles",
        signerPublicKey:
          "0x04cff3158fbc138229965782da61529764ea567b3af39559cfefdd6eb6df6ec5b37a1717742fe12bf4b2f5dc4ca51529ccb1011cd7f70fcc1095be2c12f6f30592",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-24T13:19:48.834Z",
        updatedAt: "2024-04-24T13:19:48.834Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y7yrthgx1v2jliohzimnv3yamb53v1fzwobdt26vqegehpxhkvf",
        title: "Startup Articles",
        signerPublicKey:
          "0x04df2fdaf8db22f748fcd688d64e8a57916f2f12f76fcbb85d79e17c51f9d54153af2bdb1a59d95763f1211feceea2c9180f40bf78badb0841b755e7513ccea025",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-23T17:09:49.669Z",
        updatedAt: "2024-04-23T17:09:49.669Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y5g9zord8aby3rtjtpqlsqyefqj9hnz8o1u4vgvxlolzubgf0o6",
        title: "Startup Articles",
        signerPublicKey:
          "0x04259c145f58c401aff0111c5f171f9234d9c3c4eb276bec1dc06d658ffa3c3141b392ab7d4d6cda1bc706fcb5813b1e78db75e322fcaad91fcf50fb18983dc105",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-23T17:06:04.936Z",
        updatedAt: "2024-04-23T17:06:04.936Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y9411vchfx1bdcikbajhdadss9rd76btn6rf5u2tmt5980t4l7g",
        title: "Startup Articles",
        signerPublicKey:
          "0x04cf04eec866754471dc87845c70986c9e65941706ac650fd99797e66b9fcb193d4bd9bfe240ca8069f8b1b8ddc76961ff7d2f3a3b01b902d0ffd244796cd91762",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-23T16:57:49.126Z",
        updatedAt: "2024-04-23T16:57:49.126Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y5y1tvp00ntje725luo2bn1g764z7ojlwrt57aayo25bz3zikrp",
        title: "Startup Articles",
        signerPublicKey:
          "0x04660ac69d195f876b7fa6446094e5306c35803aa349162d5067998823033090e3091cd1e6d4aa06b153b1584280ef4317d557b9a2645b06e67296719ebd2214df",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-23T16:56:48.249Z",
        updatedAt: "2024-04-23T16:56:48.249Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y881hmhlf9lmr5do0x3ku59fc3ydflat6vc0zo5k8j5we45u0ft",
        title: "Startup Articles",
        signerPublicKey:
          "0x04b51d794f6e48fd93ac4e12d26f08a6e11c10e8a4434a272ae12ba662d4d2d825d70e638e6b6e35d19f6639e0930cb561bb4d1ae16903b126652fba7ad692c7ce",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-23T16:56:11.733Z",
        updatedAt: "2024-04-23T16:56:11.733Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y954yqra0yqswlu6irq8lb8notgllre84n4p0ilazjdi5l0efrz",
        title: "Startup Articles",
        signerPublicKey:
          "0x046f22a4e22c89af11af8fdc64b1f9d96fe00453ef1275ecd2de3f9ae8ad6ab49031b14ee59e89381b5545354ece064344d0d63fec649bf979a4122fa05bf43e99",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-23T16:54:56.695Z",
        updatedAt: "2024-04-23T16:54:56.696Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y5iqlgv8oa9ra9qqtko4ndj1t691l336r7lgm4k4phejguxaaba",
        title: "Startup Articles",
        signerPublicKey:
          "0x04e1710da8193d9acf34ed170eda1a02c3818621e4604b5684261b60d4a57b70ef7f28a33ba4a3b71fd735e62c3668e862521083546a32cf1fd8a68f0f90f11a3d",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-23T16:34:23.853Z",
        updatedAt: "2024-04-23T16:34:23.853Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y66nlo7nn5ehq7dx8r1vtpg4b4q4h06f5rm2p4ldn1zqksxsx4k",
        title: "My First Index",
        signerPublicKey:
          "0x0477f42ef950f36efc8a0cf5ccccc04799331222417d406605f7df8df35478c4be01ea25b4b255abdc741efca4300df91dc11270ff67f5ec154131c20a26f53942",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-22T19:45:58.573Z",
        updatedAt: "2024-04-22T19:45:58.573Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y60qlnmolmpa5nmbip7pkq2mv00v2ycsbsm6j2jvil5gtf2kdm3",
        title: "Startup Articles",
        signerPublicKey:
          "0x04d45c2696bb259b7a116addfcbfbc1a33255d31095290819ae1604984de2d5d8e3a6c49dad2e777c6027264151289100ec90ce446c7df4d6399bb9536caaa5843",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-22T18:33:09.520Z",
        updatedAt: "2024-04-22T18:33:09.521Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y6fsg2ub2ky7d2wgis9kb0qg5t14ptzc5opibl1hh3qcsk9nu5w",
        title: "Team index",
        signerPublicKey:
          "0x04ba12a92163d994c3a6166c021810064666b42f00d5173bfa6b1afaac7600102cc48c55a2598c477aa3e69f15e38923c3b99280f2ea4432fea2ae518bc253a20e",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-18T15:41:44.669Z",
        updatedAt: "2024-04-18T15:41:44.669Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8yaap0m3wq8noh15fl73ymbpta3ghs0j67hufeb63knbenxn03sx",
        title: "Startup Articles",
        signerPublicKey:
          "0x042e9082b7310b0c08d5658a177af9501f8a8f38470c97660220e068042abe36a7cea2c681bcab666c39b5aff06c4eeea992a729e1d021ed771b5bb6076d38e83b",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-18T15:39:46.720Z",
        updatedAt: "2024-04-18T15:39:46.720Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y9z94l4qs53461sbf55pp1wiemqia6l0prwqqxa10bezwgqez5d",
        title: "Team index",
        signerPublicKey:
          "0x04c221467b6692af74a96cd7571285f6f8ce1002dfa1a00c82fcf7c63d53e794b9084dd767f35842def16ca784e924b38659a956136e509824fd98c965ee9251f3",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-18T15:36:28.703Z",
        updatedAt: "2024-04-18T15:36:28.704Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y9sr5qn9o2zg771h0rgv0phmy9hg5lti7w8neoj4ujxdok7skhk",
        title: "Team index",
        signerPublicKey:
          "0x04dda45dab9ade37ab710c0e01c6f588ee2c8cca36b3d0eed7b48448902becfffc46778a89e1914cfee6368747445540f7f224a63363e7d592e7d60202c1e4993a",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-18T12:39:13.573Z",
        updatedAt: "2024-04-18T12:39:13.573Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8yb6497s8ubiglv34sut0d9c1lpsn770mhb38s5niiqap40pajj2",
        title: "Team index",
        signerPublicKey:
          "0x04f69fe93e74f583fec0301f269f01cc106eb139b5cbf73ad91472af65bf56a64cd53d0e22c3d34c42826d0505bf52783798419a01a1d7c4bd5438b76ea2b8bfad",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-18T12:34:36.275Z",
        updatedAt: "2024-04-18T12:34:36.275Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y5dgssux2a471beiag0tanv59c7fwv50vxd48dd7w4fduyj5n8h",
        title: "Startup Articles",
        signerPublicKey:
          "0x04d88cbca907dadaa4a93d91ba89babe62a7e209a7cf6d47ae2055a0c62087a6214b39109385e725c06d5ce72c150bb42e81e6a5c1271dfa6af8f40c1ba3844ddc",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-18T12:34:18.364Z",
        updatedAt: "2024-04-18T12:34:18.364Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8yaxs3b1pp1c4f6b1rnqmzbivk1d3fm15gwkwy1ng5a0u8egp4s8",
        title: "Team index",
        signerPublicKey:
          "0x04a118468c55ed7238b298245c1ff6535c5b56413ee1c3f3041d17614f44a119ec4cd382ee6a73814d76113f96686b73b67f972d26e600580ceaf0f03666594373",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-18T12:30:44.180Z",
        updatedAt: "2024-04-18T12:30:44.180Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y8n9jqp2lkisnupcu22zo39kfidjvjv7ajw1jpivgypvxcxwp4r",
        title: "Team index",
        signerPublicKey:
          "0x047a8243f0393d8c448313b96530c7b8b10a175b9ef5d7bdaa61d3fcd5b763759f7abe2104c8f6b42c58ccd32a2c35813d2062b492b57495f30b7b5317faa614e4",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-18T11:02:53.992Z",
        updatedAt: "2024-04-18T11:02:53.993Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y981zivcyqx9j8itm1gvfpstz1vzpx8h4ik6a6j9gqne2r2ufkd",
        title: "Team index",
        signerPublicKey:
          "0x04f415ee6aa4015d3b36160db32feb4533cd0a26403d92c8e4145e8e30e4a7f648325abd8b420d45ba2222b04d8851840fa94d60017f3870cd619465a592256211",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-18T10:56:42.665Z",
        updatedAt: "2024-04-18T10:56:42.665Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y5xfidttkc7td09ow6zkrgr1kpqi7ofpesm9b40ra2gu392oo8s",
        title: "Team index",
        signerPublicKey:
          "0x0468325173872fc336ef3f8862c041514ea09bfa706bb6f84e4dc178d0f130bcceaf3b170c5d98a5be0740fa14b743a30f83dde82d26a18e4635a10fbb2335b48d",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-17T19:59:30.030Z",
        updatedAt: "2024-04-17T19:59:30.031Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y76zq6uyeoscnt9ze0g9emybo01d36xrvo8zg8yn5ohfgbbk1go",
        title: "Team index",
        signerPublicKey:
          "0x04cf011afaa29561be15ba081024c0e2a240bb7fd41bc063566718ed8972d567a81bf7ece9f0451c95e16d4b7796f318df3632eaf03b7ca978f0ba2d343a29fd13",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-17T19:19:45.745Z",
        updatedAt: "2024-04-17T19:19:45.746Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y7qsnn8vnor5d2vcv9u3a9rtdiga7rohjk329mi91fw0jgwsp2e",
        title: "new",
        signerPublicKey:
          "0x045b5ba85790712eb9a924568f13167d7a5656f7e7c1341093c550f7d7c005a4ca9315ed9550dd2f4014b6c75e5e48f03edb983e3e2a7cd12a85606d19efa88773",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-17T11:55:59.324Z",
        updatedAt: "2024-04-17T11:55:59.324Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y7lzm8fk87cnowt63h23t21tzuq4zfw5chzp469pgsh04u2dp9v",
        title: "more2",
        signerPublicKey:
          "0x0402eafce017ecd9e72c21943561219e91a56aa86feba9ef25dc29bf661356cce35da2f312ee6af40e30ad3d6c22097702e7ab2ed08c9d9a995d37d60ad13481fc",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-17T11:52:49.060Z",
        updatedAt: "2024-04-17T11:52:49.060Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y6g0iyt8gpfty6nwhrdrxbsj3u1jh28h0dxdtj7d4c5f444c678",
        title: "more",
        signerPublicKey:
          "0x0474f00f02109f7f0d692007e1eaecf548f10ac9c184dce4076401cf4107787f72c0906be0cbb06fc49882f2987963f4da91aa6f1d683b2ac87a2e43ff7a10dce6",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-17T11:52:38.975Z",
        updatedAt: "2024-04-17T11:52:38.975Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y886kg2u0c7iib4m6kmmp0d3gojovtqxencbz2a7n6xt0x5a5te",
        title: "more",
        signerPublicKey:
          "0x0423b04219aba2c03b92411b71e8c2035b64ce1363f52a3e00fb19c745a0445ea8c2a313963d3ed832e9f9308cba99a84bdd189c9dc9ba38b39b61ba58c52946e4",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-17T11:51:50.279Z",
        updatedAt: "2024-04-17T11:51:50.279Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y9izh0ait9q9bsj75hww20vy8q8lwkajlg3cuwy7g0aa3z12s0e",
        title: "more",
        signerPublicKey:
          "0x04369dc3f0f61abf440ca3eb73e2833641bb5913e67bd99d02c4f7bc6f479218b3b0d3793aace57d245bc6bbde398ab5582432f5a00e7fa138b826dd3074467674",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-17T11:51:35.727Z",
        updatedAt: "2024-04-17T11:51:35.727Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y55pdqkov593tlxbtigmpioxbph84v48di8qun7vm9r5lofco9g",
        title: "more2",
        signerPublicKey:
          "0x04d9b82bf6337f7b0af46757ffdf69a975aa095d1254292ba08c544e04bdc20c74212947ea0eb09fb33b4207ab92ba2d1b22645de03b29df6b9cfb55f8b0b2596a",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-17T11:51:07.624Z",
        updatedAt: "2024-04-17T11:51:07.624Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y9ma04joi4g24d8oz9rr9wrcweb68o0xqywc9asrwgktzjytm9o",
        title: "more2",
        signerPublicKey:
          "0x041799df1e9f1b2d82ab2c15b957654edde8f82d2a22c0c28429ae7d9a72d71236415153f1fad311b6bd04416d251a52a5673fa7879cd7fd7e3e0dbaedb08fc3d4",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-17T11:51:01.061Z",
        updatedAt: "2024-04-17T11:51:01.061Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y5y1v53sadl9mueici8os0izfoez8c8z4ueidmllloha3oc2k6z",
        title: "more",
        signerPublicKey:
          "0x04f318d91aa9e560ac3d478ab3bb35a8298eff14fe4ac3a2ea8eda6d85e8b88f9d2f060e74a81bdc0dbe2408b53bb8ead38cdfabeafd844bbd3870d089544a63af",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-17T11:48:27.028Z",
        updatedAt: "2024-04-17T11:48:27.028Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8y6g1j07g93608t83zzgkurwp1opih5uysais3ept4ha6zznlbyd",
        title: "brand new",
        signerPublicKey:
          "0x04c92f050b0d676298439d173142fc1dc062892dab2d3d14bef693846f7f3fb0561e7d05be292fc6a228e3261ecdd30cb17528e98ae7d9f64b62b1522cb30016b9",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-17T11:45:04.039Z",
        updatedAt: "2024-04-17T11:45:04.040Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
      {
        did: {
          owned: true,
          starred: false,
        },
        id: "kjzl6kcym7w8yaz7ryyivut07w5q58p7ysa8rgxzwo1dnhul3quznbb9ugi99bl",
        title: "new3sdfsdf",
        signerPublicKey:
          "0x047fe9e3cddd1f1090a8d876339b8f6fee1799721252fe8fa405033c7b6ebc5853ed302f4fac207212e72579c3d2e62b226662497cabe0a1804a7c8a39d42a1728",
        signerFunction:
          "bafybeif3zmru6vdhlyhom5evxryjuyhcvxfwwt6gxjwxdrafe7rtk25y2u",
        createdAt: "2024-04-15T10:59:19.264Z",
        updatedAt: "2024-04-15T11:11:19.124Z",
        deletedAt: null,
        ownerDID: {
          bio: "mrb",
          name: "srht",
          avatar: "bafybeibw44ldvnqs54owenp2cpbloh2kfzhfnj5msirnxsta22uyhz4b4q",
          createdAt: "2024-05-07T12:10:56.375Z",
          updatedAt: "2024-05-07T12:10:56.375Z",
          deletedAt: null,
          id: "did:pkh:eip155:1:0x0D73c72676D7250eeAe1a3a35cfB2f361FC0CcF7",
        },
      },
    ];
  }, []);

  const handleClick = useCallback(
    (id: any) => {
      // fetchIndex(id);
      // router.replace(`/${id}`, { scroll: false });
      router.push(`/${id}`, { scroll: false });
      console.log("clicked", isDID, isIndex);
    },
    [isDID, isIndex, router],
  );

  // return (
  //   <div>
  //     {tmp.map((itm: any) => (
  //       // <IndexItem index={itm} selected={itm.id === id} />
  //       <button
  //         onClick={() =>
  //           handleClick(
  //             "did:pkh:eip155:1:0xaf771BB037Ed40765EE7115aEF383145590ede8d",
  //           )
  //         }
  //         key={itm.id}
  //       >
  //         <div>
  //           <h1>{itm.id} --</h1>
  //         </div>
  //       </button>
  //     ))}
  //   </div>
  // );

  return (
    <div>
      {/* <Link href="/kjzl6kcym7w8y61hi0d9q1qfn6113x5mqkiy3yeflcmk7ttlzs1wpjcj6329wmk">
        <div>
          <h1>Index</h1>
        </div>
      </Link> */}
      {tmp.map((itm) => (
        <button key={itm.id} onClick={() => handleClick(itm.id)}>
          <h1
            style={{
              padding: "32px",
            }}
          >
            {itm.id}
          </h1>
        </button>
      ))}
    </div>
  );

  return (
    <div>
      {tmp.map((itm: any) => (
        // <IndexItem index={itm} selected={itm.id === id} />
        <button onClick={() => handleClick(itm.id)} key={itm.id}>
          <div>
            <h1>{itm.id} --</h1>
          </div>
        </button>
      ))}
    </div>
    // <>
    //   <FlexRow className={"mr-6 pb-4"}>
    //     <Col className="idxflex-grow-1">
    //       <Tabs
    //         destroyInactiveTabPane={false}
    //         theme={"rounded"}
    //         activeKey={leftTabKey}
    //         // onTabChange={handleTabChange}
    //       >
    //         <TabPane
    //           enabled={true}
    //           tabKey={IndexListTabKey.ALL}
    //           title={`All Indexes`}
    //         />
    //         <TabPane
    //           enabled={true}
    //           tabKey={IndexListTabKey.OWNED}
    //           total={indexes ? indexes.filter((i) => i.did.owned).length : 0}
    //           title={`Owned`}
    //         />
    //         <TabPane
    //           enabled={true}
    //           tabKey={IndexListTabKey.STARRED}
    //           total={indexes ? indexes.filter((i) => i.did.starred).length : 0}
    //           title={`Starred`}
    //         />
    //       </Tabs>
    //     </Col>
    //   </FlexRow>
    //   <FlexRow className={"scrollable-area index-list idxflex-grow-1 pr-6"}>
    //     {leftSectionIndexes && leftSectionIndexes.length > 0 ? (
    //       <div className={"idxflex-grow-1"}>
    //         <List
    //           data={leftSectionIndexes}
    //           render={(itm: Indexes) => (
    //             <>
    //               <IndexItem index={itm} selected={itm.id === id} />
    //             </>
    //           )}
    //           divided={false}
    //         />
    //       </div>
    //     ) : (
    //       <Text
    //         fontWeight={500}
    //         style={{
    //           color: "var(--gray-4)",
    //           textAlign: "center",
    //           padding: "4rem 0",
    //           margin: "auto",
    //         }}
    //       >
    //         There are no indexes yet
    //       </Text>
    //     )}
    //   </FlexRow>
    // </>
  );
};

export default memo(IndexListSection);
