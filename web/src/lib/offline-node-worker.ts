/**
 * The offline world's node, in a Worker. See `./offline-node.ts` for why, and
 * `./offline-node-host.ts` for what this exposes.
 */
import {exposeOfflineNode} from './offline-node-host.js';

exposeOfflineNode();
