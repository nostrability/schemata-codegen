/**
 * Data model for kind schema extraction (v0.2+).
 *
 * Kind schemas define event-level constraints: which tags are required,
 * conditional tag validation, and content constraints.
 */

import type { PositionType } from './patterns.js';

/** A "contains" constraint: tags array must include a tag matching this shape */
export interface TagRequirement {
  tagName: string;
  positions: PositionType[];
  minItems: number;
  maxItems?: number;
  additionalItems: boolean;
  errorMessage?: string;
}

/** An "if/then" constraint on individual tag items */
export interface PerItemConditional {
  conditionTagName: string;
  requirement: TagRequirement;
  errorMessage?: string;
}

/** An "if/then" constraint at the array level: if tags contain X, then must also contain Y */
export interface ArrayLevelConditional {
  conditionTagName: string;
  requirement: TagRequirement;
  errorMessage?: string;
}

/** Category of a kind schema based on its tag constraints */
export type KindCategory =
  | 'bare'
  | 'simple-contains'
  | 'multi-contains'
  | 'conditional'
  | 'failed';

/** Extracted shape of a kind schema */
export interface KindShape {
  kindNumber: number;
  nip: string;
  title?: string;
  description?: string;
  requiredTags: TagRequirement[];
  perItemConditionals: PerItemConditional[];
  arrayLevelConditionals: ArrayLevelConditional[];
  tagsMinItems?: number;
  contentConstraints?: {
    minLength?: number;
    pattern?: string;
    description?: string;
    enumValues?: string[];
  };
  category: KindCategory;
}
