import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, lstatSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import { nativeSha256, nativeBytesDigest, nativeExact, nativeDigest, nativeStableSerialize, nativeFrozenClone, referenceForPackage } from '../vendor/compatibility/v1/native.mjs';
import type { NativePackage, NativeToolchain, NativeValidationContext, NativeJSON, NativeReference } from '../vendor/compatibility/v1/native.mjs';
import type { HarnessCommand, HarnessObservation, NativeHarnessReport, HarnessRule } from './native-types.js';
import { inspectHarnessPackage, validateObservation, entry, entries, equalSet } from './native-package.js';
import { HARNESS_SPEC_ROOT } from './native-standard.js';
function checkTools(lock: NativeToolchain) { if (lock.schema !== 'evopilot-native-toolchain/v1' || lock.platform !== process.platform || lock.arch !== process.arch || !Number.isSafeInteger(lock.timeoutMs) || lock.timeoutMs < 1 || lock.timeoutMs > 120000 || !Number.isSafeInteger(lock.maxInputBytes) || lock.maxInputBytes < 1 || !Number.isSafeInteger(lock.maxPackageBytes) || lock.maxPackageBytes < 1)
    throw new TypeError('Invalid installed toolchain'); nativeDigest(lock.lockDigest); nativeDigest(lock.dependencyLockDigest); for (const [id, version] of [['conftest', '0.71.1'], ['opa', '1.21.2']]) {
    const t = lock.tools[id];
    if (!t || t.version !== version || !isAbsolute(t.executable) || !lstatSync(t.executable).isFile() || lstatSync(t.executable).isSymbolicLink() || nativeBytesDigest(readFileSync(t.executable)).slice(7) !== t.sha256.replace(/^sha256:/, ''))
        throw new TypeError('Toolchain binary identity mismatch: ' + id);
} }
export async function runHarnessCommand(lock: NativeToolchain, id: string, tool: 'conftest' | 'opa', argv: string[], cwd: string): Promise<HarnessCommand> {
    checkTools(lock);
    const started = performance.now();
    const maxBytes = Math.min(lock.maxInputBytes * 8, 2 * 1024 * 1024);
    return await new Promise((resolve, reject) => { const child = spawn(lock.tools[tool].executable, argv, { cwd, env: { PATH: '/usr/bin:/bin', HOME: cwd, LANG: 'C.UTF-8' }, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }); const out: Buffer[] = [], err: Buffer[] = []; let bytes = 0, timedOut = false, outputLimit = false; const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, lock.timeoutMs); const collect = (list: Buffer[], chunk: Buffer) => { const available = Math.max(0, maxBytes - bytes); if (available > 0) list.push(chunk.subarray(0, available)); bytes += chunk.length; if (bytes > maxBytes) {
        outputLimit = true;
        child.kill('SIGKILL');
    } }; child.stdout.on('data', (b: Buffer) => collect(out, b)); child.stderr.on('data', (b: Buffer) => collect(err, b)); child.once('error', e => { clearTimeout(timer); reject(e); }); child.once('close', (exitCode, signal) => { clearTimeout(timer); resolve({ id, tool, argv, exitCode, signal, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), timedOut, outputLimit, durationMs: Math.round(performance.now() - started) }); }); });
}
function parse(command: HarnessCommand): unknown { if (command.timedOut || command.outputLimit || command.signal || command.exitCode === null)
    throw new TypeError('Native command incomplete: ' + command.id); try {
    return JSON.parse(command.stdout);
}
catch {
    throw new TypeError('Invalid native JSON: ' + command.id);
} }
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new TypeError('Native report object required'); return v as Record<string, unknown>; }
function rows(v: unknown): unknown[] { if (!Array.isArray(v))
    throw new TypeError('Native report list required'); return v; }
function conftestRow(value: unknown): Record<string, unknown> {
    nativeExact(value, ['filename', 'namespace', 'successes'], ['failures', 'warnings', 'skipped', 'exceptions']);
    if (typeof value.filename !== 'string' || !value.filename || typeof value.namespace !== 'string')
        throw new TypeError('Invalid Conftest result identity');
    return value;
}
function astDeclarations(ast: unknown) { const root = object(ast), pkg = object(root.package), namespace = rows(pkg.path).map(x => object(x).value).join('.'); const names = rows(root.rules ?? []).map(r => { const head = object(object(r).head); if (typeof head.name !== 'string')
    throw new TypeError('Unsupported dynamic/native rule head'); return head.name; }); return { namespace, names }; }
function conftestResults(raw: unknown, catalog: HarnessRule[]) { const failures: string[] = [], warnings: string[] = []; let successes = 0; for (const rawRow of rows(raw)) {
    const r = conftestRow(rawRow);
    if (typeof r.successes !== 'number' || !Number.isSafeInteger(r.successes) || r.successes < 0 || r.skipped || r.exceptions)
        throw new TypeError('Unexpected Conftest result');
    successes += r.successes;
    for (const [key, out] of [['failures', failures], ['warnings', warnings]] as const) {
        for (const rawIssue of rows(r[key] ?? [])) {
            const issue = object(rawIssue), metadata = object(issue.metadata);
            if (typeof issue.msg !== 'string' || typeof metadata.ruleId !== 'string' || typeof metadata.query !== 'string')
                throw new TypeError('Rule report lacks exact identity');
            if (metadata.ruleId === 'EVOPILOT_BASE') {
                if (metadata.query !== 'data.evopilot.base.deny_EVOPILOT_BASE')
                    throw new TypeError('Base query spoof');
            }
            else if (!catalog.some(x => x.ruleId === metadata.ruleId && x.query === metadata.query))
                throw new TypeError('Unknown rule result');
            out.push(metadata.ruleId);
        }
    }
} if (!successes && !failures.length && !warnings.length)
    throw new TypeError('No rule evaluated'); return { failures: failures.sort(), warnings: warnings.sort() }; }
export async function validateNativeHarness(packageValue: NativePackage, toolchain: NativeToolchain, options: {
    observation?: HarnessObservation;
    context?: NativeValidationContext;
} = {}): Promise<NativeHarnessReport> {
    const deadline = performance.now() + toolchain.timeoutMs;
    const inspected = inspectHarnessPackage(packageValue), { pkg, catalog, coverage, parameters } = inspected;
    checkTools(toolchain);
    if (Buffer.byteLength(nativeStableSerialize(pkg)) > toolchain.maxPackageBytes)
        throw new TypeError('Native package toolchain size limit');
    const observation = validateObservation(options.observation ?? inspected.observation);
    if (Buffer.byteLength(nativeStableSerialize(observation)) > toolchain.maxInputBytes)
        throw new TypeError('Observation size limit');
    const context = options.context ?? null;
    if (context) {
        nativeExact(context.scope, ['visibility', 'projectId']);
        if (!['public', 'private'].includes(context.scope.visibility) || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(context.scope.projectId) || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(context.workspaceId))
            throw new TypeError('Invalid validation context scope');
        nativeExact(context, ['workspaceId', 'scope', 'projectCandidateDigest', 'claimId', 'inputDigest', 'effectiveConfigDigest', 'sourceScopeDigest', 'requirementSetDigest']);
        for (const k of ['projectCandidateDigest', 'inputDigest', 'effectiveConfigDigest', 'sourceScopeDigest', 'requirementSetDigest'] as const)
            nativeDigest(context[k]);
        if (context.effectiveConfigDigest !== inspected.effectiveConfigDigest)
            throw new TypeError('Effective configuration context mismatch');
        if (observation.origin === 'execution-result' && observation.sourceScopeDigest !== context.sourceScopeDigest)
            throw new TypeError('Collection observation/context mismatch');
    }
    const dir = mkdtempSync(join(tmpdir(), 'evopilot-harness-native-'));
    const commands: HarnessCommand[] = [], issues: string[] = [];
    let totalOutputBytes = 0;
    const criteria: NativeHarnessReport['criteria'] = [];
    let executionStatus: NativeHarnessReport['executionStatus'] = 'SUCCEEDED';
    const run = async (id: string, tool: 'conftest' | 'opa', args: string[]) => { const remaining = Math.floor(deadline - performance.now()); if (remaining < 1)
        throw new TypeError('Native validation time budget exhausted'); const r = await runHarnessCommand({ ...toolchain, timeoutMs: remaining }, id, tool, args, dir); commands.push(r); totalOutputBytes += Buffer.byteLength(r.stdout) + Buffer.byteLength(r.stderr); if (totalOutputBytes > Math.min(toolchain.maxPackageBytes / 8, 2 * 1024 * 1024)) throw new TypeError('Native cumulative output limit'); if (r.timedOut || r.outputLimit || r.signal || r.exitCode === null)
        throw new TypeError('Native command incomplete: ' + id); return r; };
    const write = (path: string, content: string) => { const f = join(dir, path); mkdirSync(dirname(f), { recursive: true, mode: 0o700 }); writeFileSync(f, content, { mode: 0o600, flag: 'wx' }); };
    try {
        for (const [path, content] of Object.entries(pkg.files))
            write(path, content);
        write('_standard/capabilities.json', readFileSync(join(HARNESS_SPEC_ROOT, 'capabilities.json'), 'utf8'));
        write('_standard/base.rego', readFileSync(join(HARNESS_SPEC_ROOT, 'policy/base.rego'), 'utf8'));
        write('_standard/base_test.rego', readFileSync(join(HARNESS_SPEC_ROOT, 'policy/base_test.rego'), 'utf8'));
        write('_effective/parameters.json', JSON.stringify({ params: parameters }));
        write('_effective/observation.json', JSON.stringify(observation));
        const policyPaths = [...entries(pkg, 'policy'), ...entries(pkg, 'tests'), '_standard/base.rego', '_standard/base_test.rego'], cap = '_standard/capabilities.json';
        const actualQueries: string[] = [], declaredTests: string[] = [];
        for (const path of policyPaths) {
            const cmd = await run('ast-' + path, 'opa', ['parse', '--format', 'json', path]);
            if (cmd.exitCode !== 0)
                throw new TypeError('Cannot parse native Rego');
            const a = astDeclarations(parse(cmd));
            const standardFile = path.startsWith('_standard/');
            if (!standardFile && (a.namespace === 'data.evopilot' || a.namespace.startsWith('data.evopilot.')))
                throw new TypeError('Project overrides standard namespace');
            for (const name of a.names) {
                if (name.startsWith('exception'))
                    throw new TypeError('Exceptions forbidden for mandatory rules');
                if (name.startsWith('todo_'))
                    throw new TypeError('Skipped native tests forbidden');
                if (name.startsWith('test_')) {
                    if (!path.endsWith('_test.rego'))
                        throw new TypeError('Tests require test file');
                    const id = a.namespace + '.' + name;
                    if (declaredTests.includes(id))
                        throw new TypeError('Duplicate declared test ID');
                    declaredTests.push(id);
                }
                else if (/^(deny|violation|warn)(?:_|$)/.test(name)) {
                    if (path.endsWith('_test.rego'))
                        throw new TypeError('Quality rules cannot reside in test modules');
                    actualQueries.push(a.namespace + '.' + name);
                }
            }
        }
        equalSet([...new Set(actualQueries)], catalog.map(r => r.query).concat('data.evopilot.base.deny_EVOPILOT_BASE'), 'AST rule catalog');
        const expectedTests = [...new Set(catalog.flatMap(r => r.testIds.map(id => 'data.' + r.namespace + '.' + id)))].concat('data.evopilot.base.test_EVOPILOT_BASE_positive', 'data.evopilot.base.test_EVOPILOT_BASE_negative');
        equalSet(declaredTests, [...new Set(expectedTests)], 'AST test IDs');
        let cmd = await run('strict', 'opa', ['check', '--strict', '--capabilities', cap, ...policyPaths]);
        if (cmd.exitCode !== 0)
            throw new TypeError('Strict native compile failed');
        const common = ['--config-file', 'conftest.toml', '--rego-version', 'v1', '--strict', '--show-builtin-errors', '--capabilities', cap, '--output', 'json', ...policyPaths.flatMap(p => ['--policy', p]), '--data', '_effective/parameters.json'];
        cmd = await run('verify', 'conftest', ['verify', ...common, ...[...new Set(catalog.map(r => r.namespace)), 'evopilot.base'].flatMap(n => ['--namespace', n])]);
        if (cmd.exitCode !== 0)
            throw new TypeError('Conftest verify failed');
        const verify = rows(parse(cmd));
        if (verify.length !== expectedTests.length || verify.some(x => { const r = conftestRow(x); return r.successes !== 1 || r.failures || r.warnings || r.skipped || r.exceptions; }))
            throw new TypeError('Conftest verify empty, skipped or incomplete');
        cmd = await run('test-ids', 'opa', ['test', '--format', 'json', '--fail-on-empty', '--capabilities', cap, ...policyPaths, '_effective/parameters.json']);
        if (cmd.exitCode !== 0)
            throw new TypeError('OPA tests failed/empty/skipped');
        const tests = rows(parse(cmd)).map(x => {
            nativeExact(x, ['package', 'name', 'location', 'duration'], ['fail', 'skip', 'error', 'output']);
            return object(x);
        });
        if (tests.some(t => t.fail || t.skip || t.error || typeof t.name !== 'string' || typeof t.package !== 'string'))
            throw new TypeError('OPA non-PASS test');
        equalSet(tests.map(t => String(t.package) + '.' + String(t.name)), expectedTests, 'Executed test IDs');
        const namespaces = [...new Set(catalog.map(r => r.namespace)), 'evopilot.base'];
        const evaluate = async (id: string, input: string) => { const c = await run(id + '-conftest', 'conftest', ['test', ...common, ...namespaces.flatMap(n => ['--namespace', n]), '--fail-on-warn', '--no-fail=false', '--all-namespaces=false', '--parser', 'json', input]); if (![0, 1, 2].includes(c.exitCode ?? -1))
            throw new TypeError('Unknown Conftest exit'); const result = conftestResults(parse(c), catalog); const expectedExit = result.failures.length ? 2 : result.warnings.length ? 1 : 0; if (c.exitCode !== expectedExit)
            throw new TypeError('Conftest exit/report mismatch'); const query = '[' + catalog.map(r => r.query).concat('data.evopilot.base.deny_EVOPILOT_BASE').join(',') + ']'; const o = await run(id + '-opa', 'opa', ['eval', '--strict', '--strict-builtin-errors', '--capabilities', cap, '--format', 'json', ...policyPaths.flatMap(p => ['--data', p]), '--data', '_effective/parameters.json', '--input', input, query]); if (o.exitCode !== 0)
            throw new TypeError('OPA eval error'); const root = object(parse(o)), r = object(rows(root.result)[0]), expr = object(rows(r.expressions)[0]), sets = rows(expr.value); if (sets.length !== catalog.length + 1)
            throw new TypeError('OPA missing query result'); const directFailures: string[] = [], directWarnings: string[] = []; sets.forEach((v, i) => rows(v).forEach(x => { const issue = object(x); if (typeof issue.ruleId !== 'string')
            throw new TypeError('OPA rule result lacks ID'); const rule = catalog[i]; if (rule && rule.ruleId !== issue.ruleId || !rule && issue.ruleId !== 'EVOPILOT_BASE')
            throw new TypeError('OPA rule mismatch'); (rule?.query.split('.').at(-1)?.startsWith('warn') ? directWarnings : directFailures).push(issue.ruleId); })); equalSet(directFailures, result.failures, 'Engine failure agreement'); equalSet(directWarnings, result.warnings, 'Engine warning agreement'); return result; };
        for (const c of coverage.cases) {
            validateObservation(JSON.parse(pkg.files[c.input]));
            const result = await evaluate('case-' + c.id, c.input);
            const status = result.failures.length ? 'FAIL' : result.warnings.length ? 'WARN' : 'PASS';
            const passed = status === c.expected && nativeStableSerialize([...result.failures, ...result.warnings].sort()) === nativeStableSerialize([...c.expectedRuleIds].sort());
            for (const requirement of coverage.requirements.filter(r => r.caseIds.includes(c.id)))
                criteria.push({ criterionId: requirement.id, variantId: c.id, status: passed ? 'PASS' : 'FAIL', evidenceDigest: nativeSha256(result) });
            if (!passed)
                issues.push('Fixed case differs: ' + c.id);
        }
        const actual = await evaluate('actual', '_effective/observation.json');
        for (const requirement of coverage.requirements)
            criteria.push({ criterionId: requirement.id, variantId: 'actual-observation', status: [...actual.failures, ...actual.warnings].some(id => requirement.ruleIds.includes(id)) ? 'FAIL' : 'PASS', evidenceDigest: nativeSha256(actual) });
        if (actual.failures.length || actual.warnings.length)
            issues.push('Mandatory observation quality failed');
    }
    catch (e) {
        executionStatus = 'ERROR';
        issues.push(e instanceof Error ? e.message : 'Native execution error');
        criteria.push({ criterionId: 'native-execution', variantId: 'error', status: 'ERROR', evidenceDigest: nativeSha256(issues) });
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
    const content = { schema: 'evopilot-native-validation/v1' as const, owner: 'harness' as const, reference: referenceForPackage(pkg) as NativeReference, context, toolchainLockDigest: toolchain.lockDigest, executionStatus, qualityStatus: executionStatus === 'ERROR' ? 'ERROR' as const : issues.length ? 'FAIL' as const : 'PASS' as const, observationDigest: nativeSha256(observation), effectiveConfigDigest: inspected.effectiveConfigDigest, effectiveConfiguration: { params: parameters }, engines: { conftest: '0.71.1' as const, embeddedOPA: '1.21.1' as const, opaCLI: '1.21.2' as const }, sourceBindingsDigest: nativeSha256(inspected.bindings), coverageDigest: nativeSha256(coverage), criteria, rawReports: commands.flatMap((c, i) => [{ path: `commands/${i}/stdout`, sha256: nativeBytesDigest(c.stdout).slice(7), mediaType: 'application/json' }, { path: `commands/${i}/stderr`, sha256: nativeBytesDigest(c.stderr).slice(7), mediaType: 'text/plain' }]), commands, issues, authority: false as const };
    return nativeFrozenClone({ ...content, reportDigest: nativeSha256(content) }) as NativeHarnessReport;
}
