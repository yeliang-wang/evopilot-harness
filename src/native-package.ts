import { validateSourceContent, validateSourceFragment, pointerValue } from './native-sources.js';
import { nativeExact, nativeText, nativeDigest, nativeSha256, nativeStableSerialize, validateNativePackage, nativeAssertJSON } from '../vendor/compatibility/v1/native.mjs';
import type { NativePackage, NativeJSON } from '../vendor/compatibility/v1/native.mjs';
import type { HarnessCoverage, HarnessRule, HarnessObservation } from './native-types.js';
import { inspectHarnessStandard, CANONICAL_CONFTEST } from './native-standard.js';
function exact(value: unknown, fields: string[], optional: string[] = []): asserts value is Record<string, unknown> { nativeExact(value, fields, optional); }
export function jsonFile(pkg: NativePackage, path: string): unknown { if (typeof pkg.files[path] !== 'string')
    throw new TypeError('Missing manifested JSON: ' + path); return JSON.parse(pkg.files[path]); }
export function entry(pkg: NativePackage, key: string): string { const v = pkg.manifest.entrypoints[key]; if (typeof v !== 'string')
    throw new TypeError('Expected single ' + key + ' entrypoint'); return v; }
export function entries(pkg: NativePackage, key: string): string[] { const v = pkg.manifest.entrypoints[key]; if (!Array.isArray(v) || !v.length)
    throw new TypeError('Expected nonempty ' + key + ' entrypoints'); return v; }
export function strings(value: unknown, label: string, empty = false): asserts value is string[] { if (!Array.isArray(value) || (!empty && !value.length) || value.some(x => typeof x !== 'string' || !x) || new Set(value).size !== value.length)
    throw new TypeError('Invalid ' + label); for (const item of value) nativeText(item); }
export function equalSet(a: string[], b: string[], label: string) { if (nativeStableSerialize([...a].sort()) !== nativeStableSerialize([...b].sort()))
    throw new TypeError(label + ' set differs'); }
export function inspectHarnessPackage(value: unknown) {
    const standard = inspectHarnessStandard();
    const pkg = validateNativePackage(value, { owner: 'harness', standardPins: standard, contractDigest: standard.contractDigest }) as NativePackage;
    if (pkg.manifest.files.some(f => f.path.startsWith('_standard/') || f.path.startsWith('_effective/')))
        throw new TypeError('Reserved native execution directory');
    if (nativeStableSerialize(pkg.manifest.files.map(f => f.path)) !== nativeStableSerialize(pkg.manifest.files.map(f => f.path).sort((a, b) => a.localeCompare(b, 'en'))))
        throw new TypeError('Manifest file list must be sorted');
    const ep = pkg.manifest.entrypoints;
    for (const [key, path] of Object.entries({ ruleCatalog: 'rule-catalog.json', coverage: 'coverage.json', parameterSchema: 'parameter-schema.json', observation: 'observations/current.json' }))
        if (entry(pkg, key) !== path)
            throw new TypeError('Fixed native entrypoint differs: ' + key);
    if (pkg.manifest.sourceBindingRef !== 'source-bindings.json')
        throw new TypeError('Fixed source binding path required');
    exact(ep, ['policy', 'tests', 'data', 'config', 'ruleCatalog', 'coverage', 'parameterSchema', 'observation']);
    if (entry(pkg, 'config') !== 'conftest.toml' || pkg.files['conftest.toml'] !== CANONICAL_CONFTEST)
        throw new TypeError('Fixed Conftest configuration required');
    const policy = entries(pkg, 'policy'), tests = entries(pkg, 'tests'), data = entries(pkg, 'data');
    if (policy.some(p => !/^policy\/.+\.rego$/.test(p) || p.endsWith('_test.rego')) || tests.some(p => !/^policy\/.+_test\.rego$/.test(p)) || data.some(p => !/^data\/.+\.json$/.test(p)))
        throw new TypeError('Native policy/test/data layout differs');
    equalSet(Object.keys(pkg.files).filter(p => p.startsWith('policy/') && p.endsWith('.rego')), [...policy, ...tests], 'Rego file closure');
    const rawCatalog = jsonFile(pkg, entry(pkg, 'ruleCatalog'));
    exact(rawCatalog, ['schema', 'rules']);
    if (rawCatalog.schema !== 'evopilot-rule-catalog/v1' || !Array.isArray(rawCatalog.rules) || !rawCatalog.rules.length)
        throw new TypeError('Nonempty native catalog required');
    const catalog: HarnessRule[] = [];
    for (const row of rawCatalog.rules) {
        exact(row, ['ruleId', 'query', 'namespace', 'required', 'qualityDomain', 'sourceIds', 'targets', 'inputRefs', 'parameterRefs', 'testIds', 'caseIds']);
        nativeText(row.ruleId);
        nativeText(row.query);
        nativeText(row.namespace);
        nativeText(row.qualityDomain);
        for (const k of ['sourceIds', 'targets', 'inputRefs', 'parameterRefs', 'testIds', 'caseIds'] as const)
            strings(row[k], k, k === 'parameterRefs');
        if (typeof row.required !== 'boolean' || !/^data\.[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+\.(?:deny|violation|warn)(?:_[A-Za-z0-9_]+)?$/.test(row.query) || row.query.slice(5, row.query.lastIndexOf('.')) !== row.namespace || row.namespace === 'evopilot' || row.namespace.startsWith('evopilot.'))
            throw new TypeError('Invalid or reserved catalog query');
        catalog.push(row as unknown as HarnessRule);
    }
    strings(catalog.map(r => r.ruleId), 'unique rule IDs');
    strings(catalog.map(r => r.query), 'unique rule queries');
    const coverage = jsonFile(pkg, entry(pkg, 'coverage'));
    exact(coverage, ['schema', 'requiredRuleIds', 'requiredTestIds', 'requiredCaseIds', 'requirements', 'cases']);
    if (coverage.schema !== 'evopilot-harness-coverage/v1' || !Array.isArray(coverage.requirements) || !coverage.requirements.length || !Array.isArray(coverage.cases))
        throw new TypeError('Independent nonempty coverage required');
    strings(coverage.requiredRuleIds, 'requiredRuleIds');
    strings(coverage.requiredTestIds, 'requiredTestIds');
    strings(coverage.requiredCaseIds, 'requiredCaseIds');
    equalSet(coverage.requiredRuleIds, catalog.filter(r => r.required).map(r => r.ruleId), 'Mandatory rules');
    equalSet(coverage.requiredTestIds, [...new Set(catalog.flatMap(r => r.testIds))], 'Required test IDs');
    equalSet(coverage.requiredCaseIds, [...new Set(catalog.flatMap(r => r.caseIds))], 'Required case IDs');
    for (const c of coverage.cases) {
        exact(c, ['id', 'input', 'expected', 'expectedRuleIds'], ['missingInputRefs']);
        if (Object.hasOwn(c, 'missingInputRefs')) {
            strings(c.missingInputRefs, 'missing input references');
            const fixture = jsonFile(pkg, c.input as string);
            for (const pointer of c.missingInputRefs)
                if (pointerValue(fixture, pointer).exists)
                    throw new TypeError('Missing-input fixture still contains value');
        }
        nativeText(c.id);
        nativeText(c.input);
        strings(c.expectedRuleIds, 'expected rules', true);
        if (!['PASS', 'FAIL', 'WARN'].includes(c.expected as string) || !/^tests\/fixtures\/.+\.json$/.test(c.input) || !Object.hasOwn(pkg.files, c.input) || (c.expected === 'PASS') !== (c.expectedRuleIds.length === 0) || c.expectedRuleIds.some(id => !catalog.some(r => r.ruleId === id)))
            throw new TypeError('Invalid fixed case');
    }
    equalSet(coverage.requiredCaseIds, coverage.cases.map(c => (c as {
        id: string;
    }).id), 'All required case IDs');
    strings(coverage.cases.map(c => (c as {
        id: string;
    }).id), 'unique case IDs');
    strings(coverage.requirements.map(c => (c as {
        id: string;
    }).id), 'unique requirement IDs');
    const typedCoverage = coverage as unknown as HarnessCoverage;
    for (const r of catalog) {
        const cases = typedCoverage.cases.filter(c => r.caseIds.includes(c.id));
        if (!cases.some(c => c.expected === 'PASS') || !cases.some(c => c.expected !== 'PASS' && c.expectedRuleIds.includes(r.ruleId)) || r.testIds.length < 2 || r.inputRefs.some(pointer => !cases.some(c => c.expected !== 'PASS' && c.expectedRuleIds.includes(r.ruleId) && c.missingInputRefs?.includes(pointer))))
            throw new TypeError('Each rule requires fixed positive/negative tests and cases');
    }
    for (const q of coverage.requirements) {
        exact(q, ['id', 'required', 'ruleIds', 'caseIds']);
        nativeText(q.id);
        if (typeof q.required !== 'boolean')
            throw new TypeError('Required flag missing');
        strings(q.ruleIds, 'requirement rules');
        strings(q.caseIds, 'requirement cases');
        if (q.ruleIds.some(id => !catalog.some(r => r.ruleId === id)) || q.caseIds.some(id => !(coverage.requiredCaseIds as string[]).includes(id)))
            throw new TypeError('Uncovered requirement');
    }
    const bindings = jsonFile(pkg, pkg.manifest.sourceBindingRef);
    exact(bindings, ['schema', 'direction', 'sources', 'mappings', 'requirements']);
    if (bindings.schema !== 'evopilot-source-bindings/v1' || !['forward', 'reverse'].includes(bindings.direction as string) || !Array.isArray(bindings.sources) || !bindings.sources.length || !Array.isArray(bindings.mappings) || !Array.isArray(bindings.requirements))
        throw new TypeError('Invalid native source bindings');
    const sourceIds: string[] = [];
    for (const s of bindings.sources) {
        exact(s, ['id', 'locator', 'revision', 'digest', 'status', 'visibility', 'contentPath']);
        validateSourceContent(pkg, s);
        nativeText(s.id);
        nativeText(s.locator);
        nativeText(s.revision);
        nativeDigest(s.digest);
        if (!['observed', 'inferred'].includes(s.status as string) || !['public', 'private'].includes(s.visibility as string) || pkg.manifest.visibility === 'public' && s.visibility === 'private')
            throw new TypeError('Source provenance/scope mismatch');
        sourceIds.push(s.id);
    }
    strings(sourceIds, 'source IDs');
    for (const m of bindings.mappings) {
        exact(m, ['requirementId', 'targetId', 'sourceId', 'status', 'revision', 'fileDigest', 'selector', 'fragmentDigest'], ['rationale']);
        nativeText(m.requirementId);
        nativeText(m.targetId);
        nativeText(m.sourceId);
        nativeText(m.status);
        if (Object.hasOwn(m,'rationale')) nativeText(m.rationale);
        if (!sourceIds.includes(m.sourceId) || !catalog.some(r => r.ruleId === m.targetId) || !typedCoverage.requirements.some(r => r.id === m.requirementId) || !['observed', 'inferred'].includes(m.status) || (m.status === 'inferred' && (typeof m.rationale !== 'string' || !m.rationale)))
            throw new TypeError('Missing source/mapping or inference rationale');
        if (bindings.sources.some(s => (s as Record<string, unknown>).id === m.sourceId && (s as Record<string, unknown>).status === 'inferred') && m.status === 'observed')
            throw new TypeError('Inferred source cannot become an observed mapping');
        validateSourceFragment(pkg, bindings.sources.find(s => (s as {
            id: string;
        }).id === m.sourceId) as Record<string, unknown>, m);
    }
    strings(bindings.mappings.map(m => nativeStableSerialize(m)), 'unique source mappings');
    for (const r of catalog)
        if (r.sourceIds.some(id => !sourceIds.includes(id)) || !bindings.mappings.some(m => (m as {
            targetId: string;
        }).targetId === r.ruleId))
            throw new TypeError('Missing rule source mapping');
    for (const q of bindings.requirements) {
        exact(q, ['id', 'required', 'disposition'], ['reason']);
        if(Object.hasOwn(q,'reason')) nativeText(q.reason);
        if (typeof q.id !== 'string' || typeof q.required !== 'boolean' || !['covered', 'unresolved', 'not-applicable'].includes(q.disposition as string) || q.required && q.disposition !== 'covered')
            throw new TypeError('Unresolved mandatory source requirement');
    }
    for (const q of bindings.requirements as {
        id: string;
        required: boolean;
        disposition: string;
        reason?: string;
    }[]) {
        const coverageRequirement = typedCoverage.requirements.find(r => r.id === q.id);
        if (!coverageRequirement || coverageRequirement.required !== q.required || q.disposition !== 'covered' && !q.reason)
            throw new TypeError('Source requirement disposition differs');
        for (const ruleId of coverageRequirement.ruleIds)
            if (!bindings.mappings.some(m => (m as {
                requirementId: string;
                targetId: string;
            }).requirementId === q.id && (m as {
                targetId: string;
            }).targetId === ruleId))
                throw new TypeError('Missing requirement to rule source mapping');
    }
    strings(bindings.requirements.map(q => (q as {
        id: string;
    }).id), 'unique source requirements');
    equalSet(bindings.requirements.map(q => (q as {
        id: string;
    }).id), typedCoverage.requirements.map(q => q.id), 'Independent source requirement coverage');
    const params: Record<string, NativeJSON> = Object.create(null) as Record<string, NativeJSON>;
    for (const p of data) {
        const d = jsonFile(pkg, p);
        exact(d, ['params']);
        nativeAssertJSON(d.params);
        if (!d.params || typeof d.params !== 'object' || Array.isArray(d.params))
            throw new TypeError('Expected parameters object');
        for (const [k, v] of Object.entries(d.params)) {
            if (Object.hasOwn(params, k))
                throw new TypeError('Duplicate parameter');
            params[k] = v;
        }
    }
    const parameterSchema = jsonFile(pkg, entry(pkg, 'parameterSchema'));
    validateParameters(params, parameterSchema);
    for (const r of catalog)
        if (r.parameterRefs.some(k => !Object.hasOwn(params, k)))
            throw new TypeError('Dangling parameter ref');
    const observation = validateObservation(jsonFile(pkg, entry(pkg, 'observation')));
    for (const r of catalog)
        for (const pointer of r.inputRefs)
            pointerValue(observation, pointer);
    return { pkg, catalog, coverage: typedCoverage, bindings, parameters: params, observation, standard, effectiveConfigDigest: nativeSha256({ params }) };
}
export function validateParameters(params: Record<string, NativeJSON>, schema: unknown) { exact(schema, ['schema', 'properties', 'required']); if (schema.schema !== 'evopilot-parameters/v1' || !schema.properties || typeof schema.properties !== 'object' || Array.isArray(schema.properties))
    throw new TypeError('Unknown parameter schema'); strings(schema.required, 'required parameters', true); const properties = schema.properties as Record<string, unknown>; if (Object.keys(params).some(k => !Object.hasOwn(properties, k)) || schema.required.some(k => !Object.hasOwn(params, k)))
    throw new TypeError('Missing or extra parameter'); for (const [key, definition] of Object.entries(properties)) {
    exact(definition, ['type'], ['minimum', 'maximum', 'enum', 'default']);
    if (!['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(definition.type as string))
        throw new TypeError('Unsupported parameter type');
    for (const limit of ['minimum','maximum'] as const) if(Object.hasOwn(definition,limit) && (typeof definition[limit] !== 'number' || !Number.isFinite(definition[limit]))) throw new TypeError('Invalid parameter bound');
        if(Object.hasOwn(definition,'enum') && (!Array.isArray(definition.enum) || !definition.enum.length)) throw new TypeError('Invalid parameter enum');
        if (!Object.hasOwn(params, key)) {
        if (Object.hasOwn(definition, 'default'))
            throw new TypeError('Defaults must already appear in the unique parameter data file');
        continue;
    }
    const v = params[key];
    const type = definition.type;
    if (type === 'integer' ? !Number.isSafeInteger(v) : type === 'array' ? !Array.isArray(v) : type === 'object' ? !v || typeof v !== 'object' || Array.isArray(v) : typeof v !== type)
        throw new TypeError('Parameter type mismatch');
    for (const bound of ['minimum', 'maximum'] as const)
        if (Object.hasOwn(definition, bound)) {
            if (typeof definition[bound] !== 'number' || typeof v !== 'number' || (bound === 'minimum' ? v < definition[bound] : v > definition[bound]))
                throw new TypeError('Parameter bound violated');
        }
    if (Object.hasOwn(definition, 'enum') && (!Array.isArray(definition.enum) || !definition.enum.some((x: unknown) => nativeStableSerialize(x) === nativeStableSerialize(v))))
        throw new TypeError('Parameter enum mismatch');
    if (Object.hasOwn(definition, 'default') && nativeStableSerialize(definition.default) !== nativeStableSerialize(v))
        throw new TypeError('Default differs from frozen effective parameter');
} }
export function validateObservation(value: unknown): HarnessObservation { nativeAssertJSON(value); exact(value, ['schema', 'origin', 'source', 'values'], ['collectionReceiptRef', 'sourceScopeDigest']); if (value.schema !== 'evopilot-observation/v1' || !['execution-result', 'synthetic', 'source-declaration', 'design-declaration', 'runtime-observation', 'imported'].includes(value.origin as string))
    throw new TypeError('Unknown observation identity/origin'); exact(value.source, ['revision', 'digest']); nativeText(value.source.revision); nativeDigest(value.source.digest); if (!value.values || typeof value.values !== 'object' || Array.isArray(value.values))
    throw new TypeError('Observation values object required'); if (Object.hasOwn(value, 'collectionReceiptRef')) {
    exact(value.collectionReceiptRef, ['id', 'digest', 'claimId']);
    nativeText(value.collectionReceiptRef.id);
    nativeText(value.collectionReceiptRef.claimId);
    nativeDigest(value.collectionReceiptRef.digest);
} if (Object.hasOwn(value, 'sourceScopeDigest'))
    nativeDigest(value.sourceScopeDigest); if (value.origin === 'execution-result') {
    exact(value.collectionReceiptRef, ['id', 'digest', 'claimId']);
    nativeText(value.collectionReceiptRef.id);
    nativeText(value.collectionReceiptRef.claimId);
    nativeDigest(value.collectionReceiptRef.digest);
    nativeDigest(value.sourceScopeDigest);
} return value as unknown as HarnessObservation; }
