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
	onMenuStateChanged?(menuActive: boolean): void;
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
	onMenuStateChanged,
	...divProps
}) => {
	const breakpoint = useBreakpoint(BREAKPOINTS);
	const [state, setState] = useMergedState<ButtomMenuDivState>({ height: "auto", maxHeight: 0, firstLoad: true });

	const ref = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLDivElement>(null);

	const handleMouseMove = useCallback((e: any) => {
		if (e.type === "touchmove") {
			const touch = e.touches[0] || e.changedTouches[0];
			const newSize = window.innerHeight - touch.clientY;
			setState((currentState) => {
				const delta = currentState.maxHeight! - newSize;
				if (delta > currentState.originalHeight! * collapseThresholdForSingleTouch) {
					handleMouseUp(false);
					return {
						maxHeight: 0,
						transition,
					};
				}

				return {
					maxHeight: newSize < currentState.originalHeight! ? newSize : currentState.originalHeight,
					transition: "none",
				};
			});
		} else {
			const newSize = window.innerHeight - e.clientY;

			setState((currentState) => ({
				maxHeight: newSize < currentState.originalHeight! ? newSize : currentState.originalHeight,
				transition: "none",
			}));
		}
	}, [
		state,
		transition,
		collapseThresholdForSingleTouch,
	]);

	const handleMouseUp = useCallback((e: any) => {
		if (typeof e !== "boolean" && e) {
			setState((currentState) => {
				const collapsed = currentState.maxHeight! <
					currentState.originalHeight! * collapseThresholdForMinSize;
				return {
					maxHeight: collapsed ? 0 : currentState.originalHeight!,
					transition,
					collapsed,
				};
			});
		}
		document.removeEventListener!("mouseup", handleMouseUp);
		buttonRef.current!.removeEventListener!("touchmove", handleMouseUp);
		document.removeEventListener!("mousemove", handleMouseMove);
		buttonRef.current!.removeEventListener!("touchmove", handleMouseMove);
	}, [handleMouseMove]);

	const handleMouseDown = useCallback((e: any) => {
		if (e.type === "touchstart") e.preventDefault();

		document.addEventListener!("mouseup", handleMouseUp);
		buttonRef.current!.addEventListener!("touchend", handleMouseUp);
		document!.addEventListener!("mousemove", handleMouseMove);
		buttonRef.current!.addEventListener!("touchmove", handleMouseMove);
	}, [handleMouseUp, handleMouseMove]);

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
	}, [ref]);

	useEffect(() => {
		if (state.collapsed) {
			onCollapse && onCollapse();
			setState({
				collapsed: false,
			});
		}
	}, [state]);

	useEffect(() => {
		if (breakpoint) {
			onMenuStateChanged && onMenuStateChanged(breakpoint === "xs");
		}
	}, [breakpoint]);

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
