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
	if (section === "creators") {
		text = `This section will soon allow you to curate together, through NFTs.`;
	} else if (section === "audience") {
		text = `This section will soon allow you to monetize your index through NFT-based access rules.`;
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
