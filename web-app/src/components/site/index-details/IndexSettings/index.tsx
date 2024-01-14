import React, { useEffect, useState } from "react";
import Header from "components/base/Header";
import Text from "components/base/Text";
import Col from "components/layout/base/Grid/Col";
import FlexRow from "components/layout/base/Grid/FlexRow";
import { useIndex } from "hooks/useIndex";
import Flex from "components/layout/base/Grid/Flex";
import CopyInput from "components/base/CopyInput";
import LitService from "../../../../services/lit-service";

export interface IndexSettingsProps {

}

const IndexSettings: React.VFC<IndexSettingsProps> = () => {
	const { index } = useIndex();
	const [key, setKey] = useState<string>();
	const getIntegrationKey = async () => {
		if (!index) return;
		const indexSession = await LitService.getPKPSession(index.pkpPublicKey!, index.collabAction!);
		const personalSession = localStorage.getItem("did");
		if (!indexSession.session || !personalSession) return;
		setKey(btoa(JSON.stringify({
			session: {
				index: indexSession.session.serialize(),
				personal: personalSession,
			},
			indexId: index.id!,
		})));
	};
	useEffect(() => {
		index && getIntegrationKey();
	}, [index]);
	return (
		<>
			<FlexRow className={"mt-6"}>
				<Col xs={12}>
					<Header className="mb-4">Integrations</Header>
				</Col>
				<Col className="mt-6" xs={8}>
					<Flex flexDirection="column">
						<Text className={"mb-4"} theme={"primary"} size="md">Integration Key</Text>
						<CopyInput value={key || "Loading..."} />
					</Flex>
				</Col>
			</FlexRow>
		</>

	);
};

export default IndexSettings;
