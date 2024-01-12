import Header from "components/base/Header";
import Col from "components/layout/base/Grid/Col";
import Row from "components/layout/base/Grid/Row";
import React from "react";

export interface SoonProps {
	section?: string;
}
let text: String;

const Soon: React.VFC<SoonProps> = ({
	section,
}) => {
	if (section === "access_control") {
		text = `This section will allow you to control access to your index using access rules based on NFTs.`;
	} else if (section === "ask") {
		text = `This section will soon allow you to interact with your index through the LLM algorithms you choose.`;
	} else if (section === "chat_history") {
		text = `Your chat history will be here soon, with complete privacy.`;
	}
	return (
		<>
			<Row rowSpacing={0}>
				<Col className="mb-7" xs={12} centerBlock style={{
					height: 150,
					display: "grid",
					placeItems: "center",
				}}>
					{
						section === "ask" ? <img src="/images/landing-5.webp" width={175} height={175} alt="tabsoon"/> : <img src="/images/tabsoon.webp" width={185} height={128} alt="tabsoon" />
					}

				</Col>
				<Col className="text-center" centerBlock>
					<Header level={4} theme="gray6" style={{
						maxWidth: 525,
					}}>{text}</Header>
				</Col>
			</Row>
		</>
	);
};

export default Soon;
