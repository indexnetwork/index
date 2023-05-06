import Header from "components/base/Header";
import Text from "components/base/Text";
import React, { useContext, useEffect } from "react";
import cc from "classcat";
import Button from "components/base/Button";
import { useAuth } from "hooks/useAuth";
import { useRouter } from "next/router";
import { AuthHandlerContext } from "components/site/context/AuthHandlerProvider";

import { selectConnection } from "store/slices/connectionSlice";
import { useAppSelector } from "hooks/store";
import cm from "./style.module.scss";
import LandingSection from "../LandingSection";

const LandingSection1 = () => {
	const router = useRouter();

	const authenticated = useAuth();
	const { did } = useAppSelector(selectConnection);

	const { connect } = useContext(AuthHandlerContext);

	useEffect(() => {
		if (authenticated && router.route === "/") {
			router.push(`/${did}`);
		}
	}, [authenticated]);

	const handleConnect = async () => {
		try {
			await connect();
		} catch (err) {
			console.log(err);
		}
	};

	return <LandingSection dark hasBgImage={false}>
		<div
			className={cc(["lnd-card lnd-first", cm.container])}
		>
			<div className="lnd-desc">
				<Header className="lnd-blue-ttl">The human bridge between context and content.</Header>
				<Text size="xl" className={cc([cm.descLine, "mb-6", "mb-sm-7"])}>
					index.as helps you to curate all-forms of content, create searchable indexes, and monetize them independently.</Text>
				<Button onClick={handleConnect}><Text className="px-8" theme="white">Get Started</Text></Button>
			</div>
			<div
				className={"lnd-img lnd-img-reverse lnd-lottie lnd-lottie-fade"}
			>
				<video
					autoPlay
					loop
					muted
					playsInline
					className={cm.video}
					style={{
						height: "100%",
						width: "100%",
					}}
				>
					<source src="video/MainaniNew.mp4" type="video/mp4" />
				</video>
			</div>
		</div>
	</LandingSection>;
};

export default LandingSection1;
