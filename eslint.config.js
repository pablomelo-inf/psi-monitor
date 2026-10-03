import js from '@eslint/js';
import globals from 'globals';

export default [
    { ignores: ['node_modules/', 'dist/'] },
    js.configs.recommended,
    {
        languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
        rules: {
            eqeqeq: ['error', 'always'],
            'no-var': 'error',
            'prefer-const': 'error',
            'no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
            ],
        },
    },
    {
        // Runs inside GNOME Shell (GJS): these globals exist there.
        files: ['extension.js', 'lib/**/*.js'],
        languageOptions: {
            globals: {
                TextDecoder: 'readonly',
                console: 'readonly',
                print: 'readonly',
                log: 'readonly',
                logError: 'readonly',
            },
        },
    },
    {
        // Runs on Node: unit tests and this config.
        files: ['test/**/*.js', 'eslint.config.js'],
        languageOptions: { globals: globals.node },
    },
];
