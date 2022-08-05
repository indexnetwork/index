import Header from "components/base/Header";
import Text from "components/base/Text";
import React, { useState } from "react";
import Lottie from "react-lottie-player";
import cc from "classcat";
import Button from "components/base/Button";
import cm from "./style.module.scss";
import anim from "./anim.json";
import LandingSection from "../LandingSection";

const LandingSection1: React.VFC = () => {
	const [loaded, setLoaded] = useState(false);
	return (
		<LandingSection dark>
			<div
				className="idx-lnd-card idx-lnd-first"
			>
				<div className="idx-lnd-desc">
					<Header className={cm.blueTitle}>The human bridge between context and content.</Header>
					<Text className={cc([cm.descLine, cm.mbMd])}>Index.as helps you to curate content and<br />create searchable indexes.</Text>
					<Button>Create your first index</Button>
				</div>
				<div
					className={loaded ? "idx-lnd-img idx-lnd-img-reverse idx-lnd-lottie idx-lnd-lottie-fade" : "idx-lnd-img idx-lnd-img-reverse idx-lnd-lottie"}
				>
					<Lottie
						loop
						animationData={anim}
						play
						style={{
							height: "100%",
							width: "100%",
						}}
						onLoad={(e) => {
							setLoaded(true);
						}}
					/>
				</div>
			</div>
		</LandingSection>
	);
};
export default LandingSection1;
