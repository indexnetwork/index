import Header from "components/base/Header";
import Text from "components/base/Text";
import React from "react";
import cc from "classcat";
import Button from "components/base/Button";
import cm from "./style.module.scss";
import LandingSection from "../LandingSection";

const LandingSection1: React.VFC = () => (
	<LandingSection dark hasBgImage={false}>
		<div
			className={cc(["lnd-card lnd-first", cm.container])}
		>
			<div className="lnd-desc">
				<Header className={cm.blueTitle}>The human bridge between context and content.</Header>
				<Text className={cc([cm.descLine, cm.mbMd])}>
					index.as helps you to curate all-forms of content, create searchable indexes, and monetize them independently.</Text>
				<Button><Text className="px-8" theme="white">Get Started</Text></Button>
			</div>
			<div
				className={"lnd-img lnd-img-reverse lnd-lottie lnd-lottie-fade"}
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
					<source src="video/MainaniNew.mp4" type="video/mp4" />
				</video>
			</div>
		</div>
	</LandingSection>
);

export default LandingSection1;
