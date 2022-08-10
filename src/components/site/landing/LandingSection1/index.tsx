import Header from "components/base/Header";
import Text from "components/base/Text";
import React from "react";
import cc from "classcat";
import Button from "components/base/Button";
import cm from "./style.module.scss";
import LandingSection from "../LandingSection";

const LandingSection1: React.VFC = () => (
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
				className={"idx-lnd-img idx-lnd-img-reverse idx-lnd-lottie idx-lnd-lottie-fade"}
			>
				<video
					autoPlay
					loop
					muted
					playsInline
					style={{
						height: "100%",
						width: "100%",
					}}
				>
					<source src="video/anim1.webm" type='video/webm; codecs=vp9' />
				</video>
			</div>
		</div>
	</LandingSection>
);

export default LandingSection1;
