"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.RECONCILE_CHRONICLE_MCP_CONFIG_COMMAND = void 0;
exports.isChronicleSupportedPlatform = isChronicleSupportedPlatform;
exports.registerChronicle = registerChronicle;
exports.disposeChronicle = disposeChronicle;
const vscode = __importStar(require("vscode"));
const logger_js_1 = require("../logger.js");
const server_js_1 = require("./server.js");
const types_js_1 = require("./types.js");
let registration;
let configurationListener;
let featureConfigListener;
let userInfoListener;
let activeContext;
let reconcilePromise = Promise.resolve();
let reconcileGeneration = 0;
let latestReconcileToken;
const SOLO_CHRONICLE_SETTINGS_KEY = 'AI.soloLite.chronicle.enable';
const IDE_CHRONICLE_SETTINGS_KEY = 'AI.ide.chronicle.enable';
const CHRONICLE_FEATURE_CONFIG_KEY = 'chronicle';
const GET_DYNAMIC_CONFIG_COMMAND = 'icube.common.getDynamicConfig';
const GET_AB_CONFIG_COMMAND = 'icube.event.getABTestConfigByKey';
exports.RECONCILE_CHRONICLE_MCP_CONFIG_COMMAND = 'icube.common.commands.chronicle.reconcileMcpConfig';
const DEFAULT_CHRONICLE_VISIBLE = true;
const DEFAULT_CHRONICLE_ENABLED = false;
const FEATURE_CONFIG_TIMEOUT_MS = 10_000;
function isChronicleSupportedPlatform(platform = process.platform) {
    return platform === 'darwin';
}
function isSoloLiteHost() {
    const uriScheme = vscode.env.uriScheme?.toLowerCase() ?? '';
    return uriScheme.startsWith('solo');
}
function getChronicleSettingsKeyForCurrentHost() {
    return isSoloLiteHost() ? SOLO_CHRONICLE_SETTINGS_KEY : IDE_CHRONICLE_SETTINGS_KEY;
}
function getConfiguredChronicleValue(settingsKey) {
    const configuration = vscode.workspace.getConfiguration();
    const inspected = configuration.inspect(settingsKey);
    if (!inspected) {
        return undefined;
    }
    const explicitlyConfigured = [
        inspected.applicationValue,
        inspected.userValue,
        inspected.userLocalValue,
        inspected.userRemoteValue,
        inspected.globalValue,
        inspected.workspaceValue,
        inspected.workspaceFolderValue,
        inspected.globalLanguageValue,
        inspected.workspaceLanguageValue,
        inspected.workspaceFolderLanguageValue,
        inspected.memoryValue,
        inspected.policyValue,
    ].some(value => value !== undefined);
    const value = configuration.get(settingsKey);
    return explicitlyConfigured && typeof value === 'boolean' ? value : undefined;
}
async function getChronicleFeatureConfig() {
    if (isSoloLiteHost()) {
        const dynamicConfig = await vscode.commands.executeCommand(GET_DYNAMIC_CONFIG_COMMAND);
        return dynamicConfig?.iCubeApp?.chronicle;
    }
    return vscode.commands.executeCommand(GET_AB_CONFIG_COMMAND, {
        key: CHRONICLE_FEATURE_CONFIG_KEY,
        defaultValue: {
            enable: DEFAULT_CHRONICLE_VISIBLE,
            fallbackValue: DEFAULT_CHRONICLE_ENABLED,
        },
    });
}
async function isChronicleEnabled() {
    let featureConfig;
    try {
        featureConfig = await withTimeout(getChronicleFeatureConfig(), FEATURE_CONFIG_TIMEOUT_MS, () => {
            (0, logger_js_1.log)(`[Chronicle] feature config read timed out after ${FEATURE_CONFIG_TIMEOUT_MS}ms`);
        });
    }
    catch (error) {
        (0, logger_js_1.log)(`[Chronicle] failed to read feature config: ${error instanceof Error ? error.message : String(error)}`);
    }
    const visible = typeof featureConfig?.enable === 'boolean'
        ? featureConfig.enable
        : DEFAULT_CHRONICLE_VISIBLE;
    const fallbackEnabled = typeof featureConfig?.fallbackValue === 'boolean'
        ? featureConfig.fallbackValue
        : DEFAULT_CHRONICLE_ENABLED;
    const configuredEnabled = getConfiguredChronicleValue(getChronicleSettingsKeyForCurrentHost());
    return isChronicleSupportedPlatform() && visible && (configuredEnabled ?? fallbackEnabled);
}
async function withTimeout(promise, timeoutMs, onTimeout) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise(resolve => {
                timer = setTimeout(() => {
                    onTimeout();
                    resolve(undefined);
                }, timeoutMs);
            }),
        ]);
    }
    finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}
async function disposeProvider() {
    const current = registration;
    registration = undefined;
    await current?.dispose();
}
async function disposeCandidate(provider, server) {
    provider?.dispose();
    if (server && typeof server.close === 'function') {
        await server.close().catch(() => { });
    }
}
function createReconcileToken(generation) {
    let cancelled = false;
    let resolveCancelled;
    const cancelledPromise = new Promise(resolve => { resolveCancelled = resolve; });
    return {
        generation,
        cancelled: cancelledPromise,
        isCancelled: () => cancelled,
        cancel() {
            if (!cancelled) {
                cancelled = true;
                resolveCancelled();
            }
        },
    };
}
function isCurrentReconcile(token, context) {
    return !token.isCancelled() && reconcileGeneration === token.generation && activeContext === context;
}
async function isCurrentAndEnabled(token, context) {
    if (!isCurrentReconcile(token, context)) {
        return false;
    }
    const enabled = await isChronicleEnabled();
    return enabled && isCurrentReconcile(token, context);
}
async function reconcileChronicle(token) {
    const context = activeContext;
    if (!context) {
        return;
    }
    if (!await isCurrentAndEnabled(token, context)) {
        if (isCurrentReconcile(token, context)) {
            await disposeProvider();
        }
        return;
    }
    if (!isCurrentReconcile(token, context)) {
        return;
    }
    if (registration) {
        return;
    }
    const server = await (0, server_js_1.createChronicleServer)();
    let provider;
    try {
        if (!await isCurrentAndEnabled(token, context)) {
            await disposeCandidate(undefined, server);
            return;
        }
        provider = await vscode.trae.registerMcpTransportServer(types_js_1.CHRONICLE_PROVIDER_ID, types_js_1.CHRONICLE_PROVIDER_LABEL, server, { featureFlags: [types_js_1.CHRONICLE_FEATURE_FLAG] });
        if (!await isCurrentAndEnabled(token, context)) {
            await disposeCandidate(provider, server);
            return;
        }
        const readyResult = await Promise.race([
            provider.whenReady().then(() => 'ready'),
            token.cancelled.then(() => 'cancelled'),
        ]);
        if (readyResult === 'cancelled' || !await isCurrentAndEnabled(token, context)) {
            await disposeCandidate(provider, server);
            return;
        }
    }
    catch (error) {
        await disposeCandidate(provider, server);
        throw error;
    }
    let disposed = false;
    registration = {
        provider,
        async dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            provider.dispose();
            if (typeof server.close === 'function') {
                await server.close().catch(() => { });
            }
        },
    };
    (0, logger_js_1.log)('[Chronicle] registered Skill-orchestrated explicit MCP tools');
}
function queueReconcile() {
    const generation = ++reconcileGeneration;
    latestReconcileToken?.cancel();
    const token = createReconcileToken(generation);
    latestReconcileToken = token;
    const task = reconcilePromise.then(() => reconcileChronicle(token)).finally(() => {
        if (latestReconcileToken === token) {
            latestReconcileToken = undefined;
        }
    });
    reconcilePromise = task.catch(() => { });
    return task;
}
async function registerChronicle(context) {
    if (!isChronicleSupportedPlatform()) {
        return;
    }
    await disposeChronicle();
    activeContext = context;
    configurationListener = vscode.workspace.onDidChangeConfiguration(event => {
        if (!event.affectsConfiguration(getChronicleSettingsKeyForCurrentHost())) {
            return;
        }
        void queueReconcile().catch(error => {
            (0, logger_js_1.log)(`[Chronicle] failed to reconcile MCP registration: ${error instanceof Error ? error.message : String(error)}`);
        });
    });
    featureConfigListener = vscode.commands.registerCommand(exports.RECONCILE_CHRONICLE_MCP_CONFIG_COMMAND, () => queueReconcile());
    userInfoListener = vscode.icube.onDidChangeUserInfo(() => {
        void queueReconcile().catch(error => {
            (0, logger_js_1.log)(`[Chronicle] failed to reconcile MCP registration after account change: ${error instanceof Error ? error.message : String(error)}`);
        });
    });
    context.subscriptions.push({ dispose: () => void disposeChronicle() });
    await queueReconcile();
}
async function disposeChronicle() {
    reconcileGeneration += 1;
    latestReconcileToken?.cancel();
    latestReconcileToken = undefined;
    activeContext = undefined;
    configurationListener?.dispose();
    configurationListener = undefined;
    featureConfigListener?.dispose();
    featureConfigListener = undefined;
    userInfoListener?.dispose();
    userInfoListener = undefined;
    await reconcilePromise;
    await disposeProvider();
}
//# sourceMappingURL=registration.js.map