import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import {
  assertJavaScriptChunkWithinBudget,
  MAX_JAVASCRIPT_CHUNK_BYTES,
  validateProductionConfig,
} from './scripts/deployment-config';

export default defineConfig(({ command, mode }) => {
  const environment = loadEnv(mode, '.', 'SECURE_BOARD_');
  const productionConfig = command === 'build'
    ? validateProductionConfig({ homeserverUrl: environment.SECURE_BOARD_HOMESERVER_URL })
    : null;
  const runtimeConfigPlugin: Plugin | null = productionConfig ? {
    name: 'secure-board-runtime-config',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk') {
          assertJavaScriptChunkWithinBudget(output.fileName, new TextEncoder().encode(output.code).byteLength);
        }
      }
      this.emitFile({
        type: 'asset',
        fileName: 'config.json',
        source: `${JSON.stringify(productionConfig, null, 2)}\n`,
      });
    },
  } : null;

  return {
    plugins: [react(), ...(runtimeConfigPlugin ? [runtimeConfigPlugin] : [])],
    build: {
      chunkSizeWarningLimit: MAX_JAVASCRIPT_CHUNK_BYTES / 1_000,
    },
    test: {
      environment: 'jsdom',
      environmentOptions: {
        jsdom: { url: 'https://secure-board.test/' },
      },
      setupFiles: './tests/setup.ts',
      restoreMocks: true,
    },
  };
});
