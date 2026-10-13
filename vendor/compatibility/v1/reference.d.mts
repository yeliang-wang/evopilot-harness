import type { JSONValue, Reference, Visibility } from '../../../src/types.js';
export const CONTRACT_REVISION: '1.0.0';
export const SOURCE_STATUSES: readonly string[];
export const ENVELOPE_FIELDS: readonly string[];
export function assertJSON(value: unknown, ancestors?: Set<object>): asserts value is JSONValue;
export function stableSerialize(value: unknown): string;
export function sha256(value: unknown): string;
export function frozenClone<T>(value: T): T;
export function exactFields(value: unknown, required: readonly string[], optional?: readonly string[]): asserts value is Record<string, unknown>;
export function textField(value: unknown): asserts value is string;
export function validateEnvelope(asset: unknown): { extensions: { namespace: string; version: string; status: string }[]; authority: false };
export interface ReferenceOptions { product?: 'harness' | 'ontology'; visibility?: Visibility }
export function validateReference(value: unknown, options?: ReferenceOptions): Readonly<Reference>;
export function inspectReference(ref: unknown, observed: unknown, options?: ReferenceOptions): Readonly<{ reference: Readonly<Reference>; exactMatch: true; authority: false }>;
