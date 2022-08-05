import { useBreakpoint } from "hooks/useBreakpoint";
import React, { useCallback, useEffect, useRef } from "react";
import { BREAKPOINTS } from "utils/constants";
import styled from "styled-components";
import { useMergedState } from "hooks/useMergedState";
import { isSSR } from "utils/helper";

interface DynamicDivProps {
	maxHeight?: number;
	height?: number;
	transition?: string;
}

const DynamicDiv = styled.div<DynamicDivProps>`
	height: ${(props) => `${Math.floor(props.height || 0)}px !important`};
	max-height: ${(props) => `${Math.floor(props.maxHeight! || 0)}px !important`};
	transition: ${(props) => props.transition || "unset"}
`;

export interface BottomMenuDivProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement> {
	heightResizable?: boolean;
	transition?: string;
	closeAnimationDelay?: number,
	menuOpen?: boolean;
	collapseThresholdForSingleTouch?: number;
	collapseThresholdForMinSize?: number;
	maxVh?: number;
	onCollapse?(): void;
	onMenuStateChanged?(menuActive: boolean): void;
}

export interface ButtomMenuDivState {
	height?: number,
	maxHeight?: number,
	transition?: string,
	originalHeight?: number,
	firstLoad?: boolean,
	collapsed?: boolean;
}

const BottomMenuDiv: React.FC<BottomMenuDivProps> = ({
	children,
	style,
	menuOpen,
	transition = "unset", // "max-height .2s cubic-bezier(0.0, .60, .75, 1.0)",
	collapseThresholdForSingleTouch = 0.1,
	collapseThresholdForMinSize = 0.6,
	maxVh = 70,
	closeAnimationDelay = 200,
	onCollapse,
	onMenuStateChanged,
	...divProps
}) => {
	const breakpoint = useBreakpoint(BREAKPOINTS);
	const [state, setState] = useMergedState<ButtomMenuDivState>({ height: 0, maxHeight: 0, firstLoad: true });

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
					transition: "none !important",
				};
			});
		} else {
			const newSize = window.innerHeight - e.clientY;

			setState((currentState) => ({
				maxHeight: newSize < currentState.originalHeight! ? newSize : currentState.originalHeight,
				transition: "none !important",
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
		document.removeEventListener!("mousemove", handleMouseMove);
		if (buttonRef.current) {
			buttonRef.current!.removeEventListener!("touchmove", handleMouseUp);
			buttonRef.current!.removeEventListener!("touchmove", handleMouseMove);
		}
	}, [handleMouseMove]);

	const handleMouseDown = useCallback((e: any) => {
		if (e.type === "touchstart") e.preventDefault();

		document.addEventListener!("mouseup", handleMouseUp);
		document!.addEventListener!("mousemove", handleMouseMove);
		if (buttonRef.current) {
			buttonRef.current!.addEventListener!("touchend", handleMouseUp);
			buttonRef.current!.addEventListener!("touchmove", handleMouseMove);
		}
	}, [handleMouseUp, handleMouseMove]);

	const resetHeight = () => {
		if (!isSSR() && menuOpen) {
			setState({
				height: window.innerHeight! * (maxVh / 100),
				maxHeight: window.innerHeight! * (maxVh / 100),
			});
		} else {
			setState({
				maxHeight: 0,
			});
		}
	};

	useEffect(() => {
		if (ref.current!) {
			if (state.firstLoad) {
				const initHeight = window.innerHeight! * (maxVh / 100);
				setState({
					height: initHeight,
					maxHeight: initHeight,
					originalHeight: initHeight,
					firstLoad: false,
				});
			}

			if (buttonRef.current) {
				buttonRef.current!.addEventListener("touchstart", handleMouseDown, {
					capture: true,
					passive: false,
				});
				buttonRef.current!.removeEventListener!("mousedown", handleMouseDown);
			}
		}
		return () => {
			document.removeEventListener!("mouseup", handleMouseUp);
			document.removeEventListener!("mousemove", handleMouseMove);
			if (buttonRef.current) {
				buttonRef.current!.removeEventListener!("mousemove", handleMouseMove);
				buttonRef.current!.addEventListener("touchstart", handleMouseDown, {
					capture: true,
					passive: false,
				});
				buttonRef.current!.removeEventListener!("touchmove", handleMouseUp);
				buttonRef.current!.removeEventListener!("touchmove", handleMouseMove);
			}
		};
	}, [ref, breakpoint]);

	useEffect(() => {
		if (state.collapsed) {
			setTimeout(() => {
				onCollapse && onCollapse();
			}, closeAnimationDelay);
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

	useEffect(() => {
		resetHeight();
	}, [menuOpen]);

	useEffect(() => () => {
		document.removeEventListener!("mouseup", handleMouseUp);
		document.removeEventListener!("mousemove", handleMouseMove);
		if (buttonRef.current) {
			buttonRef.current!.removeEventListener!("touchmove", handleMouseUp);
			buttonRef.current!.removeEventListener!("touchmove", handleMouseMove);
		}
	}, []);

	return (
		<>
			{
				breakpoint === "xs" ? <DynamicDiv
					style={style}
					height={state.height}
					maxHeight={state.firstLoad ? 0 : state.maxHeight}
					transition={state.transition}
					{...divProps}
					ref={ref}
				>
					<div
						ref={buttonRef}
						onMouseDown={handleMouseDown}
						className="modal-mobile-swiper"
					>
						<div
							className="modal-mobile-swiper-button"></div>
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
