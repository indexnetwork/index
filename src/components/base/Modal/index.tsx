import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { isSSR } from "utils/helper";
import cc from "classcat";
import { createGlobalStyle } from "styled-components";
import { InputSizeType } from "types";
import BottomMenuDiv from "../BottomMenuDiv";

export interface ModalProps {
	mountNode?: HTMLElement;
	body: React.ReactNode;
	footer?: React.ReactNode;
	header?: React.ReactNode;
	visible?: boolean;
	destroyOnClose?: boolean;
	mobileMaxVh?: number;
	size?: "fit" | InputSizeType;
	mobileBackdropClose?: boolean;
	onClose?(): void;
}

interface GlobalStyleProps {
	overflow?: string;
}

const GlobalStyle = createGlobalStyle<GlobalStyleProps>`
  body {
    overflow: hidden;
  }
`;

const PORTAL_ID = "idxModalPortal";

const Modal: React.FC<ModalProps> = ({
	body,
	footer,
	header,
	visible = false,
	destroyOnClose = false,
	mobileBackdropClose = false,
	size = "fit",
	mobileMaxVh = 70,
	onClose,
}) => {
	const [portal, setPortal] = useState<HTMLDivElement | null>(null);

	const [isMobile, setIsMobile] = useState(false);
	const [open, setOpen] = useState(visible);

	const getPortal = () => {
		if (!isSSR()) {
			const elem = document.getElementById(PORTAL_ID) as HTMLDivElement;
			return elem;
		}
		return null;
	};

	const createPortalIfNotExists = useCallback(() => {
		if (!isSSR()) {
			const existingPortal = getPortal();
			if (existingPortal) {
				setPortal(existingPortal);
				return;
			}
			const el = document.createElement("div");
			el.id = PORTAL_ID;
			el.className = "idx-modal-portal";
			document.body!.appendChild(el);
			setPortal(el);
		}
	}, []);

	useEffect(() => {
		createPortalIfNotExists();

		return () => {
			const portalElement = portal || document.getElementById(PORTAL_ID);
			portalElement!.remove();
		};
	}, []);

	useEffect(() => {
		setOpen(visible);
	}, [visible]);

	if (isSSR()) {
		return null;
	}

	if (!portal) return null;

	const handleMobileChange = (menuMobile: boolean) => {
		setIsMobile(menuMobile);
	};

	const handleClose = () => {
		setOpen(false);
		onClose && onClose();
	};

	const handleDesktopClose = () => {
		if (isMobile && !mobileBackdropClose) {
			return;
		}
		handleClose();
	};

	const handleMobileClose = () => {
		handleClose();
	};

	const handleBackdropClick = (e: any) => {
		e && e.stopPropagation();
	};

	const renderModal = () => (
		<div
			className={cc([
				"idx-modal",
				!open ? "idx-modal-invisible" : "",
				isMobile ? "idx-modal-mobile" : "",
				"idx-modal-container-outer",
				`idx-modal-size-${size}`,
			])}
			onClick={handleDesktopClose}
		>
			<div
				className={
					"idx-modal-container-inner"
				}
			>
				{open && <GlobalStyle />}
				<BottomMenuDiv
					onCollapse={handleMobileClose}
					onMenuStateChanged={handleMobileChange}
					menuOpen={open}
					className="idx-modal-wrapper"
					maxVh={mobileMaxVh}
					onClick={handleBackdropClick}
				>
					<div className="idx-modal-header">
						{header}
					</div>
					<div className="idx-modal-body">
						{body}
					</div>
					<div className="idx-modal-footer">
						{footer}
					</div>
				</BottomMenuDiv>
			</div>
		</div>
	);

	const renderFunction = () => {
		if (destroyOnClose) {
			return open ? renderModal() : null;
		}
		return renderModal();
	};

	return createPortal(renderFunction(), portal!);
};

export default Modal;
