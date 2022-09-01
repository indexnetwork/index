import Header from "components/base/Header";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import Row from "components/layout/base/Grid/Row";
import React from "react";
import cc from "classcat";
import Text from "components/base/Text";
import LandingSection from "../LandingSection";
import cm from "./style.module.scss";

const LandingSection6: React.VFC = () => (
	<LandingSection noContainer>
		<Flex
			flexDirection="column"
			gap={"32px"}
			className={cc(["lnd-card", "lnd-steps"])}
		>
			<Header className={cm.title}>The Road Ahead</Header>
			<Row
			>
				<Col xs={3}>
					<Header level={4}>Q1 2022</Header>

				</Col>
				<Col xs={3}>
					<Header level={4}>Q1 2022</Header>

				</Col>
				<Col xs={3}>
					<Header level={4}>Q1 2022</Header>
				</Col>
				<Col xs={3}>
					<Header level={4}>Q1 2022</Header>

				</Col>
				<Col xs={12}>
					<img className={cm.img} alt="steps-png" src="/images/steps2.png" />
				</Col>
				<Col xs={12} className="mt-lg-8">
					<Row>
						<Col xs={3}>
							<Flex
								flexDirection="column">
								<Header level={2}>Validation</Header>
								<ul className={cm.list}>
									<li>
										<Text theme="secondary">MVP on Web2</Text>
									</li>
									<li>
										<Text theme="secondary">Test and validate use case with 1K users</Text>
									</li>
								</ul>
							</Flex>
						</Col>
						<Col xs={3}>
							<Flex
								flexDirection="column">
								<Header level={2}>Alpha</Header>
								<ul className={cm.list}>
									<li>
										<Text theme="secondary">Indexing web links using Ceramic Network and IPFS</Text>
									</li>
									<li>
										<Text theme="secondary">Enabling search within indexes</Text>
									</li>
								</ul>
							</Flex>
						</Col>
						<Col xs={3}>
							<Flex
								flexDirection="column">
								<Header level={2}>Beta</Header>
								<ul className={cm.list}>
									<li>
										<Text theme="secondary">Enabling monetization and collaboration with Lit Protocol</Text>
									</li>
									<li>
										<Text theme="secondary">Featuring multi-use ownership with Gnosis safe</Text>
									</li>
									<li>
										<Text theme="secondary">Collaboration with DAOs, companies and individual curators</Text>
									</li>
								</ul>
							</Flex>
						</Col>
						<Col xs={3}>
							<Flex
								flexDirection="column">
								<Header level={2}>V1</Header>
								<ul className={cm.list}>
									<li>
										<Text theme="secondary">Social graph integration with Lens Protocol</Text>
									</li>
									<li>
										<Text theme="secondary">Enabling browser extension and highlighted content</Text>
									</li>
									<li>
										<Text theme="secondary">Featuring custom view options and filters</Text>
									</li>
									<li>
										<Text theme="secondary">Launching subscription based monetization</Text>
									</li>
								</ul>
							</Flex>
						</Col>
					</Row>
				</Col>

			</Row>
		</Flex>
	</LandingSection>
);

export default LandingSection6;
