import React from "react";
import type { NextPage } from "next";
import SiteHeader from "layout/site/SiteHeader";
import Container from "layout/base/Container";
import Row from "layout/base/Row";
import Col from "layout/base/Col";
import Text from "components/base/Text";
import Button from "components/base/Button";

const Home: NextPage = () => (
	<>
		<SiteHeader headerType="public"/>
		<Container>
			<Row noGutters>
				<Col lg="3" sm="6" xs="12"><h1>Deneme 1</h1></Col>
				<Col lg="3" sm="6" xs="12"><Text theme="secondary">Deneme Text</Text></Col>
				<Col lg="3" sm="6" xs="12"><Button theme="ghost">Deneme</Button></Col>
			</Row>
		</Container>
	</>
);

export default Home;
