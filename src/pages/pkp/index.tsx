import React, { useEffect, useState } from "react";
import { NextPage } from "next/types";
import { ethers } from "ethers";

import { LitContracts } from "@lit-protocol/contracts-sdk";

const PKP: NextPage = () => {
	const [minting, setMinting] = useState(false);
	const [success, setSuccess] = useState("");
	const [error, setError] = useState(null);

	const mintPkp = async () => {
		setMinting(true);

		const litContracts = new LitContracts();
		await litContracts.connect();

		const mintCost = await litContracts.pkpNftContract.read.mintCost();
		const mint = await litContracts.pkpNftContract.write.mintNext(2, { value: mintCost });
		const wait = await mint.wait();
		const tokenIdFromEvent = wait.events[1].topics[3];
		const tokenIdNumber = ethers.BigNumber.from(tokenIdFromEvent).toString();
		const pkpPublicKey = await litContracts.pkpNftContract.read.getPubkey(tokenIdFromEvent);
		console.log(
			`PKP public key is ${pkpPublicKey} and Token ID is ${tokenIdFromEvent} and Token ID number is ${tokenIdNumber}`,
		);
		return;
		/*
		PKP public key is 0x04c00cfcacdd09cd14f858ec1a9771f88d170ad8ac46d5deb8cced8f24cce303ff9006ee68ff0eac11ac1e4a57dc0bc48075c6813fab164fb0b36ea2c021c51005
		and Token ID is 0x276c64f32ffe0f56396f60d1030d23d44b6ce50833856893ef0f311331f16d3f
		and Token ID number is 17831717308699365721260653288176043165957324409522683475746237039328728542527
		*/
		/*
		const tokenIdNumber = "17831717308699365721260653288176043165957324409522683475746237039328728542527"
		const signEverythingCID = "QmcZ2MuxkNrMbNKAVtK37tEmKJ8zwvFudin3rBEcHyhqJc";
		// const addPermissionTx = await litContracts.pkpPermissionsContractUtil.write.addPermittedAction(tokenIdNumber, signEverythingCID);
		const addPermissionTx = await litContracts.pkpPermissionsContractUtil.write.revokePermittedAction(tokenIdNumber, signEverythingCID);
		const aw = await addPermissionTx.wait();
		console.log(aw);

			*/
		setSuccess("PKP minted successfully! Go back to the main page to see it.");

		setMinting(false);
	};

	useEffect(() => {
		mintPkp();
	}, []);
	return (
		<>asd</>
	);
};

export default PKP;
