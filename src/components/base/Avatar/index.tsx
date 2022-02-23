import React, { useEffect, useState } from "react";
import cc from "classcat";
import { generateRandomColor, isSSR } from "utils/helper";
import { ShapeType } from "types";

export interface AvatarProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	size?: number;
	shape?: ShapeType;
	hoverable?: boolean;
	contentRatio?: number;
	randomColor?: boolean;
	bgColor?: string;
	maxLetters?: number;
}

const Avatar: React.FC<AvatarProps> = ({
	size = 40,
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
}) => {
	const [color, setColor] = useState<string>(bgColor || "var(--main)");

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
					"idx-avatar",
					`idx-avatar-${shape}`,
					hoverable ? "idx-avatar-hoverable" : "",
					className || "",
				],
			)}
			style={{
				...style,
				width: size,
				height: size,
				lineHeight: `${size}px`,
				fontSize: contentRatio > 1 ? size : contentRatio * size,
				backgroundColor: color,
			}}
		>
			{typeof children === "string" ? children.substring(0, maxLetters) : children}
		</div>
	);
};

export default Avatar;
