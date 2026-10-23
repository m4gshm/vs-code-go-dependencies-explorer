import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/test/**/*.test.ts'],
        coverage: {
            include: ['src/**'],
            exclude: ['src/test/**', 'src/test-vscode/**'],
        },
    },
});
