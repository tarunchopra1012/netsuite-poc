import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/node_modules',
      '**/.nx',
      '**/coverage',
      // Legacy files with their own style — retired in Phase 8.
      'src/**',
      'suitescript-examples/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:ui',
                'type:util',
                'type:data-access',
              ],
            },
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: ['type:ui', 'type:util', 'type:data-access'],
            },
            { sourceTag: 'type:ui', onlyDependOnLibsWithTags: ['type:util'] },
            { sourceTag: 'type:data-access', onlyDependOnLibsWithTags: ['type:util'] },
            { sourceTag: 'type:util', onlyDependOnLibsWithTags: [] },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.spec.tsx', '**/*.test.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
];
