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
exports.ChronicleRepository = void 0;
const vscode = __importStar(require("vscode"));
const types_js_1 = require("./types.js");
// Real Chronicle payloads approach the repository response guard above 12
// observations. Keep the public tool inside that guard before it crosses the
// command and MCP serialization boundaries.
const MAX_RECENT_LIMIT = 12;
const MAX_SEARCH_LIMIT = 20;
const MAX_QUERY_LENGTH = 512;
const MAX_RESULT_CHARACTERS = 64 * 1024;
class ChronicleRepository {
    async status() {
        return this.call(types_js_1.CHRONICLE_STATUS_COMMAND);
    }
    async recent(input) {
        const range = normalizedRange(input);
        return this.call(types_js_1.CHRONICLE_RECENT_COMMAND, {
            ...range,
            limit: boundedLimit(input.limit, MAX_RECENT_LIMIT),
        });
    }
    async search(input) {
        const query = typeof input.query === 'string' ? input.query.trim() : '';
        if (!query || query.length > MAX_QUERY_LENGTH) {
            throw new Error(`query must contain between 1 and ${MAX_QUERY_LENGTH} characters`);
        }
        const range = normalizedRange(input);
        return this.call(types_js_1.CHRONICLE_SEARCH_COMMAND, {
            query,
            ...range,
            limit: boundedLimit(input.limit, MAX_SEARCH_LIMIT),
        });
    }
    async getMemory(input) {
        const memoryId = typeof input.memoryId === 'string' ? input.memoryId : '';
        if (!/^[a-zA-Z0-9_-]{1,160}$/.test(memoryId)) {
            throw new Error('memoryId must be an opaque Chronicle identifier');
        }
        return this.call(types_js_1.CHRONICLE_GET_MEMORY_COMMAND, memoryId);
    }
    async call(command, argument) {
        const result = argument === undefined
            ? await vscode.commands.executeCommand(command)
            : await vscode.commands.executeCommand(command, argument);
        const serialized = JSON.stringify(result ?? null);
        if (serialized.length > MAX_RESULT_CHARACTERS) {
            throw new Error('Chronicle result exceeded the safe MCP response limit');
        }
        return result ?? null;
    }
}
exports.ChronicleRepository = ChronicleRepository;
function boundedLimit(value, max) {
    return typeof value === 'number' && Number.isSafeInteger(value)
        ? Math.max(1, Math.min(max, value))
        : 10;
}
function optionalIsoTime(value) {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
        throw new Error('time range values must be ISO-8601 timestamps');
    }
    return new Date(value).toISOString();
}
function normalizedRange(input) {
    const since = optionalIsoTime(input.since);
    const until = optionalIsoTime(input.until);
    if (since && until && since > until) {
        throw new Error('since must not be later than until');
    }
    return { since, until };
}
//# sourceMappingURL=repository.js.map