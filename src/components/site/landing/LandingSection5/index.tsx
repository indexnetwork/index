import Header from "components/base/Header";
import Col from "components/layout/base/Grid/Col";
import Flex from "components/layout/base/Grid/Flex";
import FlexRow from "components/layout/base/Grid/FlexRow";
import React from "react";
import Link from "next/link";
import LandingSection from "../LandingSection";

const LandingSection5: React.VFC = () => (
	<>
		<LandingSection>
			<Flex
				gap={"32px"}
				flexWrap={"wrap"}
			>

				<FlexRow fullWidth>
					<Header className="lnd-5-title">Built with open protocols</Header>
				</FlexRow>
				<FlexRow
					wrap={true}
					fullWidth
					className={"lnd-5-logos-container"}
				>
					<Col className={"lnd-5-logos"}>
						<Link href={"https://ceramic.network"} target={"_blank"}>
							<img className="lnd-5-img" alt="ceramic-img" src="/images/ceramic.png" />
						</Link>
					</Col>
					<Col className={"lnd-5-logos"}>
						<Link href={"https://ceramic.network"} target={"_blank"}>
							<img className="lnd-5-img" alt="lit-img" src="/images/lit.png" />
						</Link>
					</Col>
					<Col className={"lnd-5-logos"}>
						<Link href={"https://ceramic.network"} target={"_blank"}>
							<img className="lnd-5-img" alt="ipfs-img" src="/images/ipfs.png" />
						</Link>
					</Col>
				</FlexRow>
			</Flex>

			{false && <Flex
				className={"mt-11"}
				gap={"16px"}
				flexWrap={"wrap"}
			>

				<FlexRow fullWidth>
					<Header className="lnd-5-title">Backed by</Header>
				</FlexRow>
				<FlexRow
					wrap={true}
					fullWidth
					className={"lnd-5-logos-container"}
				>
					<Col className={"lnd-5-logos"}>
						<Link href={"https://mesh.xyz"} target={"_blank"}>
							<img style={{ height: "100px" }} className="lnd-5-img" alt="ceramic-img" src="/images/mesh.png" />
						</Link>
					</Col>
				</FlexRow>
			</Flex> }
		</LandingSection>
	</>
);

export default LandingSection5;
