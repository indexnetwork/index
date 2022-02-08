import React, { ReactElement } from "react";
import Row from "layout/base/Grid/Row";
import Col from "layout/base/Grid/Col";
import Header from "components/base/Header";
import Text from "components/base/Text";
import CopyInput from "components/base/CopyInput";
import Tooltip from "components/base/Tooltip";
import ButtonGroup from "components/base/ButtonGroup";
import Button from "components/base/Button";
import IconAdd from "components/base/Icon/IconAdd";
import Flex from "layout/base/Grid/Flex";
import Input from "components/base/Input";
import { NextPageWithLayout } from "types";
import LandingLayout from "layout/site/LandingLayout";
// import Text from "components/base/Text";
// import Button from "components/base/Button";
// import Header from "components/base/Header";
// import Input from "components/base/Input";
// import IconSearch from "components/base/Icon/IconSearch";

const Home: NextPageWithLayout = () => (
	<>
		<Row noGutters>
			<Col lg={"2"} md={"3"} sm={"6"} xs={"12"}><Header level={6}>asdasdasd</Header></Col>
			<Col lg={"2"} md={"3"} sm={"6"} xs={"12"}>
				<Text theme="secondary" fontWeight={700}>Bu bir texttir</Text>
			</Col>
			<Col lg={"6"} md={"3"} sm={"6"} xs={"12"}><Button>Button 2</Button>
				<Button addOnBefore><Flex alignItems="center" style={{ height: "100%" }}><IconAdd stroke="var(--gray-4)" />asdasasdas</Flex></Button>
			</Col>
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
			<Col lg={"12"} md={"3"} sm={"6"} xs={"12"}>
				<Flex>
					<Input />
					<ButtonGroup
						theme="clear"
						style={{
							marginLeft: 20,
						}}
					>
						<Button addOnBefore><IconAdd stroke="var(--gray-4)" /><span>asdasasdasd</span></Button>
						<Button addOnAfter>Button 2 <IconAdd stroke="var(--gray-4)" /></Button>
						<Button>Button 2</Button>
					</ButtonGroup>
				</Flex>
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
	</>
);

Home.getLayout = function getLayout(page: ReactElement) {
	return (
		<LandingLayout>
			{page}
		</LandingLayout>
	);
};

export default Home;
