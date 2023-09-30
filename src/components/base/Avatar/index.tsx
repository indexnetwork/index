import React, { useEffect, useState } from "react";
import cc from "classcat";
import { generateRandomColor, isSSR } from "utils/helper";
import { ShapeType } from "types";
import { Users } from "types/entity";
import { appConfig } from "config";

export interface AvatarProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	size?: number;
	user?: Users;
	creatorRule?: any;
	shape?: ShapeType;
	hoverable?: boolean;
	contentRatio?: number;
	randomColor?: boolean;
	bgColor?: string;
	maxLetters?: number;
}

const Avatar = (
	{
		size = 40,
		user,
		creatorRule,
		children,
		className,
		style,
		bgColor,
		contentRatio = 0.5,
		shape = "circle",
		hoverable = false,
		maxLetters = 1,
		randomColor = false,
		...divProps
	}: AvatarProps,
) => {
	const [color, setColor] = useState<string>(bgColor || "var(--main)");
	const getFontSize = () => {
		console.log("seref", user);
		if (user && !user.avatar && !user.name) {
			return 15;
		}
		if (creatorRule && creatorRule.symbol) {
			return 12;
		}
		return contentRatio > 1 ? size : contentRatio * size;
	};
	useEffect(() => {
		if (!isSSR() && randomColor) {
			setColor(generateRandomColor());
		}
	}, []);

	return (
		<div
			{...divProps}
			className={cc(
				[
					"avatar",
					`avatar-${shape}`,
					hoverable ? "avatar-hoverable" : "",
					className || "",
				],
			)}
			style={{
				...style,
				width: size,
				height: size,
				lineHeight: `${size}px`,
				fontSize: getFontSize(),

				backgroundColor: color,
			}}
		>
			{
				user ? (
					user.avatar ? (
						<img src={`${appConfig.ipfsProxy}/${user.avatar}`} alt="profile_img"/>
					) : (
						user.name ? user.name!.substring(0, 1).toUpperCase() : (user.id ? user.id.toString().slice(-4).toUpperCase() : "Y")
					)
				) : creatorRule ? (
					creatorRule.image ? (
						<img src={`${appConfig.ipfsProxy}/${creatorRule.image}`} alt="profile_img"/>
					) : (
						(creatorRule.symbol || creatorRule.ensName).substring(0, 4).toUpperCase()
					)
				) : (
					typeof children !== "string" ? children : null
				)
			}
		</div>
	);
};

export default Avatar;
