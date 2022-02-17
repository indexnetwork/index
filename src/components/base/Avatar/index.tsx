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
	maxLetters?: number;
}

const Avatar: React.FC<AvatarProps> = ({
	size = 40,
	children,
	className,
	style,
	contentRatio = 0.5,
	shape = "circle",
	hoverable = false,
	maxLetters = 1,
	randomColor = false,
	...divProps
}) => {
	const [color, setColor] = useState<string>();

	useEffect(() => {
		if (!isSSR()) {
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
				fontSize: contentRatio > 1 ? size : contentRatio * size,
				backgroundColor: randomColor ? color : "#2a2a2a",
			}}
		>
			{typeof children === "string" ? children.substring(0, maxLetters) : children}
		</div>
	);
};

export default Avatar;
