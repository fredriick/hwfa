const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration — monorepo aware.
 *
 * The app lives in `apps/mobile` but consumes workspace packages (`@hwfa/client`,
 * `@hwfa/models`) whose source is under `packages/*` at the repo root. Metro must
 * (1) watch the repo root so changes in those packages trigger reloads, and
 * (2) resolve modules from both the app's and the root's node_modules (npm
 * hoists most deps to the root in a workspace).
 *
 * https://reactnative.dev/docs/metro
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    // Workspace packages expose TypeScript source directly (main: ./src/index.ts),
    // so Metro must accept .ts/.tsx as source extensions (it already does) and
    // must not follow a single hoisted copy of react — dedupe to the app's.
    disableHierarchicalLookup: false,
    // The workspace TS packages use NodeNext-style ".js" import specifiers that
    // actually point at ".ts" sources (e.g. `from "./discovery.js"` in a .ts
    // file). Node/tsc resolve that; Metro does not. Try normal resolution first,
    // then fall back to the ".ts"/".tsx" sibling for a relative ".js" import.
    resolveRequest: (context, moduleName, platform) => {
      try {
        return context.resolveRequest(context, moduleName, platform);
      } catch (err) {
        if (
          (moduleName.startsWith('./') || moduleName.startsWith('../')) &&
          moduleName.endsWith('.js')
        ) {
          const base = moduleName.slice(0, -'.js'.length);
          for (const ext of ['.ts', '.tsx']) {
            try {
              return context.resolveRequest(context, base + ext, platform);
            } catch (_) {
              /* try next */
            }
          }
        }
        throw err;
      }
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
