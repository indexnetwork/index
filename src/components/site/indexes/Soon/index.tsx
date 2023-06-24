import Header from "components/base/Header";
import Col from "components/layout/base/Grid/Col";
import Row from "components/layout/base/Grid/Row";
import Image from "next/image";
import React from "react";

export interface SoonProps {
	section?: string;
}
let text: String;

const Soon: React.VFC<SoonProps> = ({
	section,
}) => {
	if (section === "audience") {
		text = `This section will allow you to monetize your index through access rules based on NFTs.`;
	} else if (section === "ask") {
		text = `This section will soon allow you to interact with your index through the LLM algorithms you choose.`;
	}
	return (
		<>
			<Row rowSpacing={5}>
				<Col className="mb-7" xs={12} centerBlock style={{
					height: 150,
				}}>
					<Image src="/images/tabsoon.webp" alt="tabsoon" layout="fill" objectFit='contain'/>
				</Col>
				<Col className="text-center" centerBlock>
					<Header level={4} style={{
						maxWidth: 525,
					}}>{text}</Header>
				</Col>
			</Row>
		</>
	);
};

export default Soon;
