import { NextPage } from "next/types";
import React, {
	ReactElement, ReactNode,
} from "react";

/**
 * Common Types
 */

export type NextPageWithLayout<P = {}, IP = P> = NextPage<P, IP> & {
	getLayout?: (page: ReactElement) => ReactNode
	requireAuth?: boolean;
};

export type GridFractionType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export type SpacingBaseType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type HeaderSizeType = 1 | 2 | 3 | 4 | 5 | 6;

export type ComponentThemeType = "primary" | "secondary" | "success" | "error" | "warning" | "disabled" | "blue";

export type SizeType = "xs" | "sm" | "md" | "lg" | "xl";

export type PropType<TObj, TProp extends keyof TObj> = TObj[TProp];

export type CSSFlexPropsNamesType =
  "flex" |
  "flexBasis" |
  "flexDirection" |
  "flexFlow" |
  "flexGrow" |
  "flexShrink" |
  "flexWrap" |
  "order" |
  "alignContent" |
  "alignSelf" |
  "alignItems" |
  "justifyContent" |
  "justifySelf" |
  "justifyItems" |
  "gap";

export type FlexPropsType = Pick<React.CSSProperties, CSSFlexPropsNamesType>;

/**
 * Text Types
 */
export type TextThemeType = ComponentThemeType | "gray5" | "white" | "gray9";

export type TextElementType = "span" | "strong" | "div" | "p" | "label";

/**
 * Button Types
 */
export type ButtonThemeType = ComponentThemeType | "primary-outlined" | "secondary-outlined" | "success-outlined" | "error-outlined" | "warning-outlined" | "ghost" | "link" | "clear" | "blue" | "blue-outlined" | "tag";

/**
 * Input Types
 */
export type InputSizeType = SizeType;

/**
 * Size Types
 */
export type TextSizeType = SizeType;

/**
 * Shape Types
 */
export type ShapeType = "square" | "circle";

/**
 * Select Types
 */
export type SelectValueType = string | string[] | undefined;
export interface SelectSelectionType {
	[key: string]: {
		title: string;
		selected: boolean;
	}
}
/**
 * Flex Types
 */
export type FlexAlignType = "start" | "end" | "center";
export type FlexJustifyType = FlexAlignType | "between" | "around" | "evenly";

export type UserRightType = "view" | "edit" | "off";

export interface IndexesRouteParams {
	did?: string;
}

export interface IndexDetailsRouteParams extends IndexesRouteParams {
  streamId?: string;
}
