import React, {
	ReactNode,
	useCallback, useEffect, useRef, useState,
} from "react";
import cc from "classcat";
import useBackdropClick from "hooks/useBackdropClick";
import { useTranslation } from "next-i18next";
import debounce from "lodash.debounce";
import { InputSizeType } from "types";
import IconClose from "../Icon/IconClose";
import IconSearch from "../Icon/IconSearch";
import Input from "../Input";
import Spin from "../Spin";

export interface SearchDropdownProps {
	children: ReactNode;
	value?: string;
	size?: InputSizeType,
	fullWidth?: boolean;
	disabled?: boolean;
	placeholder?: string;
	debounceTime?: number;
	minChars?: number;
	showClear?: boolean;
	loading?: boolean;
	closeMenuWhenEmpty?: boolean;
	closeMenuOnTextChange?: boolean;
	clearOnClose?: boolean;
	open?: boolean;
	defaultValue?: string;
	addOnAfter?: ReactNode;
	inputClass?: string;
	/**
	 * Custom Search Event Triggers with debounce
	 * @param value input value
	 */
	onSearch?(value?: string | null): void;
	onMenuStateChanged?(open: boolean): void;
}

const SearchDropdown = (
	{
		children,
		addOnAfter,
		inputClass,
		size = "md",
		fullWidth = true,
		disabled = false,
		showClear = true,
		placeholder,
		debounceTime = 1000,
		loading = false,
		closeMenuWhenEmpty = true,
		clearOnClose = true,
		closeMenuOnTextChange = false,
		open = false,
		defaultValue = "",
		onMenuStateChanged,
		onSearch,
	}: SearchDropdownProps,
) => {
	const { t } = useTranslation(["components"]);

	const [loaded, setLoaded] = useState(false);
	const [query, setQuery] = useState(defaultValue);
	const [menuOpen, setMenuOpen] = useState(() => !disabled && open);

	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (loaded && !disabled && (closeMenuOnTextChange || (!query && closeMenuWhenEmpty))) {
			setMenuOpen(false);
		}

		if (disabled) {
			setMenuOpen(false);
		}
	}, [disabled, query, menuOpen, loaded, closeMenuOnTextChange, closeMenuWhenEmpty, clearOnClose]);

	useEffect(() => {
		if (loaded && !menuOpen && clearOnClose) {
			setQuery("");
		}

		onMenuStateChanged && onMenuStateChanged(menuOpen);
	}, [menuOpen]);

	useEffect(() => {
		setMenuOpen(!disabled && open);
	}, [open, disabled]);

	useEffect(() => {
		setLoaded(true);
	}, []);

	const handleOnSearch = (val: string | null) => {
		onSearch && onSearch(val);
	};

	const debouncedSearch = useCallback(debounce(handleOnSearch, debounceTime), [onSearch, debounceTime]);

	const handleChange = (e: any) => {
		if (e && e.target) {
			setQuery(e.target.value);
			debouncedSearch(e.target.value);
		}
	};

	const handleBackdropClick = () => {
		setMenuOpen(false);
	};

	useBackdropClick(containerRef, handleBackdropClick, menuOpen);

	const handleClear = (e: any) => {
		e && e.stopPropagation();
		setQuery("");
	};

	return (
		<div
			ref={containerRef}
			className={cc([
				"search",
				menuOpen ? "search-open" : "",
				disabled ? "search-disabled" : "",
				fullWidth ? "w-100" : "",
				`search-${size}`,
			])}
		>
			<Input
				className={inputClass}
				addOnBefore={loading ? <Spin active wrapsChildren={false} thickness="light" theme="secondary" /> : <IconSearch />}
				addOnAfter={addOnAfter || (!disabled && showClear && <IconClose onClick={handleClear} style={{ cursor: "pointer" }} />)}
				placeholder={placeholder}
				onChange={handleChange}
				value={query}
				inputSize={size}
				disabled={disabled}
			/>
			<div className="search-menu">
				<div className="search-menu-list">
					{children}
				</div>
			</div>
		</div>
	);
};

export default SearchDropdown;
