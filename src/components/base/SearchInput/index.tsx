import React, {
	useCallback, useEffect, useState,
} from "react";
import { useTranslation } from "next-i18next";
import debounce from "lodash.debounce";
import IconSearch from "../Icon/IconSearch";
import Input, { InputProps } from "../Input";
import IconClose from "../Icon/IconClose";
import Spin from "../Spin";

export interface SearchInputProps extends InputProps {
	debounceTime?: number;
	minChars?: number;
	loading?: boolean;
	defaultValue?: string;
	showClear?: boolean;
	/**
	 * Custom Search Event Triggers with debounce
	 * @param value input value
	 */
	onSearch?(value: string): void;
}

const SearchInput = (
	{
		addOnAfter,
		debounceTime = 1000,
		defaultValue = "",
		disabled,
		loading,
		showClear,
		onSearch,
		...inputProps
	}: SearchInputProps,
) => {
	const { t } = useTranslation(["pages"]);

	const [query, setQuery] = useState(defaultValue);
	const handleOnSearch = (val: string) => {
		onSearch && onSearch(val);
	};

	const debouncedSearch = useCallback(debounce(handleOnSearch, debounceTime), [onSearch, debounceTime]);

	const handleChange = (e: any) => {
		if (e && e.target) {
			setQuery(e.target.value);
			debouncedSearch(e.target.value);
		}
	};

	const handleClear = (e: any) => {
		e && e.stopPropagation();
		setQuery("");
		handleOnSearch("");
	};

	useEffect(() => {
		setQuery(defaultValue);
	}, [defaultValue]);

	return (
		<Input
			{...inputProps}
			inputSize={"lg"}
			addOnBefore={<IconSearch width={20} height={20} />}
			addOnAfter={loading ? (<Spin active={true} thickness="light" theme="secondary" />) :
				(!disabled && showClear && query && <IconClose onClick={handleClear} style={{ cursor: "pointer" }} />)
			}
			placeholder={t("pages:home.searchPh")}
			onChange={handleChange}
			value={query}
		/>
	);
};

export default SearchInput;
