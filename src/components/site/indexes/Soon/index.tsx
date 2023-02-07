import Header from "components/base/Header";
import Col from "components/layout/base/Grid/Col";
import Row from "components/layout/base/Grid/Row";
import Image from "next/image";
import React from "react";

const Soon = () => (
	<>
		{

			<Row rowSpacing={5} >
				<Col className="mb-7" xs={12} centerBlock style={{
					height: 150,
				}}>
					<Image src="/images/tabsoon.webp" alt="tabsoon" layout="fill" objectFit='contain' />
				</Col>
				<Col className="text-center" centerBlock>
					<Header level={4} style={{
						maxWidth: 525,
					}}>{`This section will soon offer options to monetize your content through membership and subscription options.`}</Header>
				</Col>
			</Row>

		}
	</>
);

export default Soon;
