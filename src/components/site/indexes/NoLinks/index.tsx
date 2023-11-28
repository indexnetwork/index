import Header from "components/base/Header";
import Col from "components/layout/base/Grid/Col";
import Row from "components/layout/base/Grid/Row";
import React from "react";

export interface NoLinksProps {
    search?: string;
}

const NoLinks: React.VFC<NoLinksProps> = ({
	search,
}) => (
	<>
		<Row rowSpacing={5} fullWidth>
			<Col xs={12} className="mb-7" centerBlock style={{
				height: 166,
				display: "grid",
				placeItems: "center",
			}}>
				<img src="/images/no_indexes.png" alt="No Indexes" />
			</Col>
			<Col className="text-center" centerBlock>
				{
					search ? (
						<Header level={4} style={{
							maxWidth: 350,
						}}>{`Your search "${search}" did not match any links.`}</Header>
					) : (
						<Header level={4} style={{
							maxWidth: 350,
						}}>{`No links yet.`}</Header>
					)
				}
			</Col>
		</Row>
	</>
);

export default NoLinks;
