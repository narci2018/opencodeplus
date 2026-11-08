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
exports.cleanupLegacyChronicleSkill = cleanupLegacyChronicleSkill;
exports.runLegacyChronicleSkillCleanup = runLegacyChronicleSkillCleanup;
const vscode = __importStar(require("vscode"));
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const logger_js_1 = require("../logger.js");
const builtin_skill_materializer_js_1 = require("../core/builtin-skill-materializer.js");
const GET_PRODUCT_DATA_FOLDER_PATH_COMMAND = 'icube.common.commands.getProductDataFolderPath';
const RELOAD_SKILL_REGISTRY_COMMAND = 'icube.common.commands.recordReplay.reloadSkillRegistry';
const LEGACY_SKILL_DIRECTORY_SEGMENTS = ['builtin', 'global', 'skills', 'chronicle'];
// Backup lives outside the `builtin/` tree, so no skill scanner (global or
// agent/model directories) can discover a moved copy again.
const LEGACY_SKILL_BACKUP_DIRECTORY_NAME = 'skill-migration-backup';
// Byte-level SHA256 fingerprints of every officially released legacy
// `builtin/global/skills/chronicle/SKILL.md` content. The git history of both
// removed repository copies contains exactly one content version.
const OFFICIAL_LEGACY_SKILL_MD_SHA256 = [
    'a0f0ee79952af1a237402691720f4c8ee0ffe49aa61d1efb68a0c620bd768da8',
];
let cleanupPromise;
/**
 * One-shot cleanup of the legacy extension-materialized Chronicle skill copy.
 * Runs at extension activation, independent of Chronicle enablement and of the
 * MCP registration lifecycle; failures never block MCP behavior.
 */
function cleanupLegacyChronicleSkill() {
    if (!cleanupPromise) {
        cleanupPromise = runLegacyChronicleSkillCleanup();
    }
    return cleanupPromise;
}
async function fileSha256(filePath) {
    const digest = crypto.createHash('sha256');
    digest.update(await fs.readFile(filePath));
    return digest.digest('hex');
}
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * Raised when a directory in the legacy or backup path chain is a symbolic
 * link or not a directory. Such layouts escape the product data boundary and
 * must be preserved untouched for manual review.
 */
class LegacySkillPathBoundaryError extends Error {
}
/**
 * lstat-based boundary check for one directory in the chain. Unlike stat or
 * realpath, lstat never resolves links, so a symlink is always reported
 * instead of being transparently followed.
 */
async function inspectRealDirectory(directoryPath) {
    let stat;
    try {
        stat = await fs.lstat(directoryPath);
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return 'missing';
        }
        throw error;
    }
    if (stat.isSymbolicLink()) {
        throw new LegacySkillPathBoundaryError(`${directoryPath} is a symbolic link`);
    }
    if (!stat.isDirectory()) {
        throw new LegacySkillPathBoundaryError(`${directoryPath} is not a directory`);
    }
    return 'directory';
}
async function pathExists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Single invocation of the legacy copy inspection and migration. Tests drive
 * this directly; activation uses the one-shot {@link cleanupLegacyChronicleSkill}.
 */
async function runLegacyChronicleSkillCleanup() {
    if (process.platform !== 'darwin') {
        // Legacy copies were only ever materialized on macOS hosts.
        return { status: 'skipped', reason: 'unsupported platform' };
    }
    let productDataDirectory;
    try {
        productDataDirectory = await vscode.commands.executeCommand(GET_PRODUCT_DATA_FOLDER_PATH_COMMAND);
    }
    catch (error) {
        (0, logger_js_1.log)(`[Chronicle] legacy skill cleanup cannot resolve the product data directory: ${describeError(error)}`);
        return { status: 'skipped', reason: 'product data directory unavailable' };
    }
    if (typeof productDataDirectory !== 'string' || !productDataDirectory.trim()) {
        return { status: 'skipped', reason: 'product data directory unavailable' };
    }
    const productDataRoot = (0, builtin_skill_materializer_js_1.normalizeBuiltinSkillProductDataDirectory)(productDataDirectory);
    const legacyPath = path.join(productDataRoot, ...LEGACY_SKILL_DIRECTORY_SEGMENTS);
    // Validate every directory from `builtin/` down to the legacy copy itself:
    // a symlink anywhere in the chain points outside the product data boundary
    // and must never be read through, moved, or recreated by the cleanup.
    try {
        let chainPath = productDataRoot;
        for (const segment of LEGACY_SKILL_DIRECTORY_SEGMENTS) {
            chainPath = path.join(chainPath, segment);
            if (await inspectRealDirectory(chainPath) === 'missing') {
                return { status: 'clean', legacyPath };
            }
        }
    }
    catch (error) {
        const reason = error instanceof LegacySkillPathBoundaryError
            ? describeError(error)
            : 'legacy directory chain inspection failed';
        (0, logger_js_1.log)(`[Chronicle] legacy skill directory chain is not safe to migrate (${reason}); left in place for manual review`);
        return { status: 'unknown-content', legacyPath, reason };
    }
    let entries;
    try {
        entries = await fs.readdir(legacyPath, { withFileTypes: true });
    }
    catch (error) {
        (0, logger_js_1.log)(`[Chronicle] legacy skill cleanup cannot inspect ${legacyPath}: ${describeError(error)}`);
        return { status: 'failed', legacyPath, reason: 'inspection failed' };
    }
    const unknownEntries = entries.filter(entry => entry.name !== 'SKILL.md' || !entry.isFile() || entry.isSymbolicLink() || entry.isDirectory());
    if (unknownEntries.length > 0 || entries.length !== 1) {
        const reason = `unexpected entries: ${unknownEntries.map(entry => entry.name).join(', ') || 'missing SKILL.md'}`;
        (0, logger_js_1.log)(`[Chronicle] legacy skill copy at ${legacyPath} does not match known official content (${reason}); left in place for manual review`);
        return { status: 'unknown-content', legacyPath, reason };
    }
    const installedHash = await fileSha256(path.join(legacyPath, 'SKILL.md'));
    if (!OFFICIAL_LEGACY_SKILL_MD_SHA256.includes(installedHash)) {
        (0, logger_js_1.log)(`[Chronicle] legacy skill copy at ${legacyPath} has unknown content hash ${installedHash}; left in place for manual review`);
        return { status: 'unknown-content', legacyPath, reason: `unknown content hash ${installedHash}` };
    }
    const backupRoot = path.join(productDataRoot, LEGACY_SKILL_BACKUP_DIRECTORY_NAME);
    try {
        // The backup must itself be a real directory: a link here could route
        // the moved copy back into a scanned skills directory.
        if (await inspectRealDirectory(backupRoot) === 'missing') {
            await fs.mkdir(backupRoot, { recursive: true });
        }
        if (await inspectRealDirectory(backupRoot) !== 'directory') {
            throw new LegacySkillPathBoundaryError(`${backupRoot} is missing or replaced after creation`);
        }
    }
    catch (error) {
        const reason = error instanceof LegacySkillPathBoundaryError
            ? describeError(error)
            : 'backup directory preparation failed';
        (0, logger_js_1.log)(`[Chronicle] legacy skill cleanup cannot prepare a safe backup directory (${reason}); legacy copy left in place`);
        return { status: 'failed', legacyPath, reason };
    }
    const backupStamp = `chronicle-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    let backupPath = path.join(backupRoot, `${backupStamp}-${crypto.randomUUID()}`);
    while (await pathExists(backupPath)) {
        backupPath = path.join(backupRoot, `${backupStamp}-${crypto.randomUUID()}`);
    }
    try {
        await fs.rename(legacyPath, backupPath);
    }
    catch (error) {
        (0, logger_js_1.log)(`[Chronicle] legacy skill cleanup failed to move ${legacyPath}: ${describeError(error)}`);
        return { status: 'failed', legacyPath, reason: 'move failed' };
    }
    (0, logger_js_1.log)(`[Chronicle] legacy skill copy migrated to ${backupPath}`);
    try {
        await vscode.commands.executeCommand(RELOAD_SKILL_REGISTRY_COMMAND);
    }
    catch (error) {
        (0, logger_js_1.log)(`[Chronicle] skill registry reload after legacy cleanup failed: ${describeError(error)}`);
    }
    return { status: 'migrated', legacyPath, backupPath };
}
//# sourceMappingURL=legacy-skill-cleanup.js.map