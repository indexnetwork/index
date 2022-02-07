import React from "react";
import type { NextPage } from "next";
import SiteHeader from "layout/site/SiteHeader";
import Container from "layout/base/Container";
import Row from "layout/base/Row";
import Col from "layout/base/Col";
import Text from "components/base/Text";
import Button from "components/base/Button";
import Header from "components/base/Header";
import Input from "components/base/Input";
import IconSearch from "components/base/Icon/IconSearch";

const Home: NextPage = () => (
	<>
		<SiteHeader headerType="public" />
		<Container>
			<Row noGutters>
				<Col lg="3" sm="6" xs="12"><Header level={1}>Deneme 1</Header></Col>
				<Col lg="3" sm="6" xs="12">
					<Input
						addOnBefore={<IconSearch />}
						type="password"
						placeholder="deneme" />
				</Col>
				<Col lg="3" sm="6" xs="12"><Input placeholder="deneme" disabled 						addOnBefore={<IconSearch />}
				/></Col>
				<Col lg="3" sm="6" xs="12"><Text theme="secondary">Deneme Text</Text></Col>
				<Col lg="3" sm="6" xs="12"><Button theme="ghost">Deneme</Button></Col>
			</Row>
		</Container>
	</>
);

export default Home;
