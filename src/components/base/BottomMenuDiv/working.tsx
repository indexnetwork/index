import { useBreakpoint } from "hooks/useBreakpoint";
import React, { useCallback, useEffect, useRef } from "react";
import { BREAKPOINTS } from "utils/constants";
import styled from "styled-components";
import { useMergedState } from "hooks/useMergedState";

interface DynamicDivProps {
	maxHeight?: number | string;
	transition?: string;
}

const DynamicDiv = styled.div<DynamicDivProps>`
	height: auto;
	max-height: ${(props) => `${props.maxHeight}px`};
	transition: ${(props) => props.transition || "none"}
`;

export interface ResizableDivProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	heightResizable?: boolean;
	maxSize?: number;
	transition?: string;
	collapseThresholdForSingleTouch?: number;
	collapseThresholdForMinSize?: number;
	onCollapse?(): void;
}

export interface ButtomMenuDivState {
	height?: string,
	maxHeight?: number,
	transition?: string,
	originalHeight?: number,
	firstLoad?: boolean,
	collapsed?: boolean;
}

const BottomMenuDiv: React.FC<ResizableDivProps> = ({
	children,
	style,
	transition = "max-height .2s cubic-bezier(0.0, .60, .75, 1.0)",
	collapseThresholdForSingleTouch = 0.1,
	collapseThresholdForMinSize = 0.6,
	onCollapse,
	...divProps
}) => {
	const breakpoint = useBreakpoint(BREAKPOINTS);
	const [state, setState] = useMergedState<ButtomMenuDivState>({ height: "auto", maxHeight: 0, firstLoad: true });

	const ref = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLDivElement>(null);

	function handleMouseDown(e: any) {
		if (e.type === "touchstart") e.preventDefault();

		document.addEventListener!("mouseup", mouseUp);
		buttonRef.current!.addEventListener!("touchend", mouseUp);
		document!.addEventListener!("mousemove", handleMouseMove);
		buttonRef.current!.addEventListener!("touchmove", handleMouseMove);
	}

	function mouseUp(e: any) {
		if (typeof e !== "boolean" && e) {
			setState((currentSize) => {
				const collapsed = currentSize.maxHeight! <
					currentSize.originalHeight! * collapseThresholdForMinSize;
				return {
					maxHeight: collapsed ? 0 : currentSize.originalHeight!,
					transition,
					collapsed,
				};
			});
		}
		document.removeEventListener!("mouseup", mouseUp);
		buttonRef.current!.removeEventListener!("touchmove", mouseUp);
		document.removeEventListener!("mousemove", handleMouseMove);
		buttonRef.current!.removeEventListener!("touchmove", handleMouseMove);
	}

	const handleMouseMove = useCallback((e: any) => {
		if (e.type === "touchmove") {
			const touch = e.touches[0] || e.changedTouches[0];
			const newSize = window.innerHeight - touch.clientY;
			setState((currentSize) => {
				const delta = currentSize.maxHeight! - newSize;
				if (delta > currentSize.originalHeight! * collapseThresholdForSingleTouch) {
					mouseUp(false);
					return {
						maxHeight: 0,
						transition,
					};
				}

				return {
					maxHeight: newSize < currentSize.originalHeight! ? newSize : currentSize.originalHeight,
					transition: "none",
				};
			});
		} else {
			const newSize = window.innerHeight - e.clientY;

			setState((currentSize) => ({
				maxHeight: newSize < currentSize.originalHeight! ? newSize : currentSize.originalHeight,
				transition: "none",
			}));
		}
	}, [state]);

	useEffect(() => {
		if (ref.current!) {
			if (state.firstLoad) {
				setState({
					firstLoad: false,
					maxHeight: ref.current!.clientHeight,
					originalHeight: ref.current!.clientHeight,
				});
			}

			buttonRef.current!.addEventListener("touchstart", handleMouseDown, {
				capture: true,
				passive: false,
			});
			buttonRef.current!.removeEventListener!("mousedown", handleMouseDown);
		}
		return () => {
			if (buttonRef.current) {
				buttonRef.current!.removeEventListener!("mousemove", handleMouseMove);
				buttonRef.current!.addEventListener("touchstart", handleMouseDown, {
					capture: true,
					passive: false,
				});
			}
		};
	}, [ref, breakpoint]);

	useEffect(() => {
		if (state.collapsed) {
			onCollapse && onCollapse();
			setState({
				collapsed: false,
			});
		}
	}, [state]);

	return (
		<>
			{
				breakpoint === "xs" ? <DynamicDiv
					style={style}
					maxHeight={state.firstLoad ? "none" : state.maxHeight}
					transition={state.transition}
					{...divProps}
					ref={ref}
				>
					<div
						ref={buttonRef}
						onMouseDown={handleMouseDown}
						style={{
							width: "100%",
							height: 20,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
						}}>
						<div style={{
							width: 32,
							height: 4,
							borderRadius: 2,
							backgroundColor: "#E3E5EA",
						}}></div>
					</div>
					{children}
				</DynamicDiv> :
					<div
						{...divProps}
					>
						{children}
					</div>
			}
		</>
	);
};

export default BottomMenuDiv;
