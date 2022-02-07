import React from "react";
import type { NextPage } from "next";
import SiteHeader from "layout/site/SiteHeader";
import Container from "layout/base/Grid/Container";
import Row from "layout/base/Grid/Row";
import Col from "layout/base/Grid/Col";
import Header from "components/base/Header";
import Text from "components/base/Text";
import CopyInput from "components/base/CopyInput";
import Tooltip from "components/base/Tooltip";
// import Text from "components/base/Text";
// import Button from "components/base/Button";
// import Header from "components/base/Header";
// import Input from "components/base/Input";
// import IconSearch from "components/base/Icon/IconSearch";

const Home: NextPage = () => (
	<>
		<SiteHeader headerType="public" />
		<Container fluid>
			<Row noGutters>
				<Col lg="4" style={{
					height: 120,
					background: "red",
				}} />
				<Col lg={"2"} md={"3"} sm={"6"} xs={"12"}><Header level={6}>asdasdasd</Header></Col>
				<Col lg={"2"} md={"3"} sm={"6"} xs={"12"}>
					<Text theme="secondary" fontWeight={700}>Bu bir texttir</Text>
				</Col>
				<Col lg={"2"} md={"3"} sm={"6"} xs={"12"}>Deneme</Col>
				<Col lg={"2"} md={"3"} sm={"6"} xs={"12"}>
					<Tooltip
						content={"Deneme"}
					>
						Try Tooltip
					</Tooltip>
				</Col>
				<Col>
					<CopyInput
						value="https://asdaasdasdasdsasd.com" />
				</Col>
				{/* <Col lg="3" sm="6" xs="12"><Header level={1}>Deneme 1</Header></Col>
				<Col lg="3" sm="6" xs="12">
					<Input
						addOnBefore={<IconSearch />}
						type="password"
						placeholder="deneme" />
				</Col>
				<Col lg="3" sm="6" xs="12"><Input placeholder="deneme" disabled 						addOnBefore={<IconSearch />}
				/></Col>
				<Col lg="3" sm="6" xs="12"><Text theme="secondary">Deneme Text</Text></Col>
				<Col lg="3" sm="6" xs="12"><Button theme="ghost">Deneme</Button></Col> */}
			</Row>
		</Container>
	</>
);

export default Home;
