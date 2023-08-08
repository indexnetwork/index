"use client";

import * as React from "react";

import { useAtBottom } from "hooks/useAtBottom";
import Button, { type ButtonProps } from "components/base/Button";
import { IconArrowDown } from "components/ai/ui/icons";

export function ButtonScrollToBottom({ className, ...props }: ButtonProps) {
	const isAtBottom = useAtBottom();

	return (
		<Button
			variant="outline"
			size="icon"
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
