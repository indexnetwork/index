import React, {
	useCallback, useEffect, useRef, useState,
} from "react";
import cc from "classcat";
import useBackdropClick from "hooks/useBackdropClick";
import { useTranslation } from "next-i18next";
import debounce from "lodash.debounce";
import IconClose from "../Icon/IconClose";
import IconSearch from "../Icon/IconSearch";
import Input from "../Input";
import Spin from "../Spin";

export interface SearchProps<T> {
	value?: string | string[];
	size?: "sm" | "md" | "lg",
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
	/**
	 * Custom Search Event Triggers with debounce
	 * @param value input value
	 */
	onSearch?(value?: string | null): void;
	onMenuStateChanged?(open: boolean): void;
}

const Search: React.FC<SearchProps<any>> = ({
	children,
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
}) => {
	const { t } = useTranslation(["components"]);

	const [query, setQuery] = useState(defaultValue);
	const [menuOpen, setMenuOpen] = useState(!disabled && open);

	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (closeMenuOnTextChange || (!query && closeMenuWhenEmpty)) {
			setMenuOpen(false);
		}
	}, [query]);

	useEffect(() => {
		if (!menuOpen && clearOnClose) {
			setQuery("");
		}

		onMenuStateChanged && onMenuStateChanged(menuOpen);
	}, [menuOpen]);

	useEffect(() => {
		setMenuOpen(!disabled && open);
	}, [open]);

	useEffect(() => {
		setMenuOpen(false);
	}, [disabled]);

	const handleOnSearch = (val: string | null) => {
		onSearch && onSearch(val);
	};

	const debouncedSearch = useCallback(debounce(handleOnSearch, debounceTime), []);

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
				"idx-search",
				menuOpen ? "idx-search-open" : "",
				disabled ? "idx-search-disabled" : "",
				fullWidth ? "idx-w-100" : "",
				`idx-search-${size}`,
			])}
		>
			<Input
				addOnBefore={loading ? <Spin active wrapsChildren={false} thickness="light" theme="secondary" /> : <IconSearch />}
				addOnAfter={!disabled && showClear && <IconClose onClick={handleClear} style={{ cursor: "pointer" }} />}
				placeholder={placeholder}
				onChange={handleChange}
				value={query}
				inputSize={size}
				disabled={disabled}
			/>
			<div className="idx-search-menu">
				<div className="idx-search-menu-list">
					{children}
				</div>
			</div>
		</div>
	);
};

export default Search;
