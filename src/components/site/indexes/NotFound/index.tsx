import Header from "components/base/Header";
import Col from "components/layout/base/Grid/Col";
import Row from "components/layout/base/Grid/Row";
import Image from "next/image";
import React from "react";

export interface NotFoundProps {
	active?: boolean;
	hasIndex?: boolean;
	search?: string;
}

const NotFound: React.VFC<NotFoundProps> = ({
	active,
}) => (
	<>
		{
			active && (
				<Row rowSpacing={5} >
					<Col xs={12} centerBlock style={{
						height: 166,
					}}>
						<Image src="/images/notfound.png" alt="Not found" layout="fill" objectFit='contain' />
					</Col>
					<Col className="idx-text-center" centerBlock>
						<Header level={4} style={{
							maxWidth: 350,
						}}>{`Page not found.`}</Header>
					</Col>
				</Row>
			)
		}
	</>
);

export default NotFound;
