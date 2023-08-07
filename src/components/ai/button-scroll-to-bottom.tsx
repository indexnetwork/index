"use client";

import * as React from "react";

import cc from "classcat";
import { useAtBottom } from "hooks/useAtBottom";
import Button, { type ButtonProps } from "components/base/Button";
import { IconArrowDown } from "components/ai/ui/icons";

export function ButtonScrollToBottom({ className, ...props }: ButtonProps) {
	const isAtBottom = useAtBottom();

	return (
		<Button
			variant="outline"
			size="icon"
			className={cc(
				"absolute right-4 top-1 z-10 bg-background transition-opacity duration-300 sm:right-8 md:top-2",
				isAtBottom ? "opacity-0" : "opacity-100",
				className,
			)}
			onClick={() => window.scrollTo({
				top: document.body.offsetHeight,
				behavior: "smooth",
			})
			}
			{...props}
		>
			<IconArrowDown />
			<span className="sr-only">Scroll to bottom</span>
		</Button>
	);
}
