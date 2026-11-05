import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import stylistic from '@stylistic/eslint-plugin'
import { globalIgnores } from 'eslint/config'

export default tseslint.config([
  globalIgnores(['dist', 'node_modules', 'build', 'coverage', '**/*.min.js']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended, // Список рекомендованных правил отмечен ✅ https://eslint.org/docs/latest/rules/
      tseslint.configs.recommended, // Список рекомендованных правил https://github.com/typescript-eslint/typescript-eslint/blob/main/packages/eslint-plugin/src/configs/eslintrc/recommended.ts
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      react: react,
      '@stylistic': stylistic,
      'simple-import-sort': simpleImportSort,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      // Style rules

      // Отступы
      '@stylistic/indent': ["error", 2],
      // Максимальная длина строки. 
      'max-len': [
        'error',
        {
          'code': 140,
          'ignorePattern': "import \\{?\\s?.*\\s?\\}? from '.*';",
          'ignoreStrings': true,
          'ignoreTemplateLiterals': true,
        },
      ],
      // Разрешенное количество пустых строк
      '@stylistic/no-multiple-empty-lines': [
        'error',
        {
          'max': 2,
          'maxBOF': 0,
          'maxEOF': 0,
        }
      ],
      // Одинарные кавычки
      '@stylistic/quotes': [
        'error',
        'single' // double если нужны двойные
      ],

      // ";" всегда
      '@stylistic/semi': [
        'error',
        'always'
      ],

      // Новая строка в конце файла
      '@stylistic/eol-last': [
        'error',
        'always'
      ],

      // Никаких пустых пробелов в конце строки
      '@stylistic/no-trailing-spaces': [
        'error'
      ],

      // Предотвращение бесполезных вычислений
      'no-constant-binary-expression': "error",

      // пробелы у фигурных скобок
      'object-curly-spacing': ['error', 'always'],

      // Порядок импортов (с полноценным auto-fix через blank lines)
      'simple-import-sort/imports': ['error', {
        groups: [
          // React первым
          ['^react$', '^react-dom$', '^react[/-]'],
          // Внешние пакеты
          ['^@?\\w'],
          // Внутренние @/ алиасы
          ['^@/'],
          // Родительские ../
          ['^\\.\\./'],
          // Соседние ./ (без CSS-модулей)
          ['^\\./(?!.*\\.module\\.css$).*'],
          // CSS-модули последними
          ['\\.module\\.css$'],
        ],
      }],
      'simple-import-sort/exports': 'error',

      // Висящие запятые в импортах
      '@stylistic/comma-dangle': [
        'error',
        {
          arrays: 'always-multiline',
          objects: 'always-multiline',
          imports: 'always-multiline',
          exports: 'always-multiline',
          enums: 'always-multiline',
          tuples: 'always-multiline',
          generics: 'never',
          functions: 'never',
        },
      ],

      // Yoda
      // https://eslint.org/docs/latest/rules/yoda
      'yoda': ["error", "always", { "onlyEquality": true }],

      // React Rules

      // Validate JSX has key prop when in array or iterator
      // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/jsx-key.md
      'react/jsx-key': 'warn',

      // Предупреждение, что плохо использовать индексы в качестве ключей
      'react/no-array-index-key': 'warn',

      // Разрешаем спредить спросы
      'react/jsx-props-no-spreading': 'off',

      // Двойные кавычки для пропсов у компонентов
      'jsx-quotes': ['error', 'prefer-double'],

      // True пропсы передаются в короткой форме; example: var Hello = <Hello personal />;
      // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/jsx-boolean-value.md
      'react/jsx-boolean-value': ['error', 'never', { always: [] }],

      // Validate closing bracket location in JSX
      // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/jsx-closing-bracket-location.md
      'react/jsx-closing-bracket-location': ['error', 'line-aligned'],

      // Validate closing tag location in JSX
      // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/jsx-closing-tag-location.md
      'react/jsx-closing-tag-location': 'error',

      // Enforce or disallow spaces inside of curly braces in JSX attributes
      // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/jsx-curly-spacing.md
      'react/jsx-curly-spacing': ['error', 'never', { allowMultiline: true }],

      // Validate props indentation in JSX
      // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/jsx-indent-props.md
      'react/jsx-indent-props': ['error', 2],

      // Limit maximum of props on a single line in JSX
      // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/jsx-max-props-per-line.md
      'react/jsx-max-props-per-line': ['error', { maximum: 1, when: 'multiline' }],

      // Prevent usage of .bind() in JSX props
      // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/jsx-no-bind.md
      'react/jsx-no-bind': ['error', {
        ignoreRefs: true,
        allowArrowFunctions: true,
        allowFunctions: false,
        allowBind: false,
        ignoreDOMComponents: true,
      }],

      // Prevent duplicate props in JSX
      // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/jsx-no-duplicate-props.md
      'react/jsx-no-duplicate-props': ['error', { ignoreCase: true }],

      // Prevent usage of unwrapped JSX strings
      // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/jsx-no-literals.md
      'react/jsx-no-literals': ['off', { noStrings: true }],

      // Disallow undeclared variables in JSX
      // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/jsx-no-undef.md
      'react/jsx-no-undef': 'error',

      // Enforce PascalCase for user-defined JSX components
      // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/jsx-pascal-case.md
      'react/jsx-pascal-case': ['error', {
        allowAllCaps: true,
        ignore: [],
      }],

      // Enforce propTypes declarations alphabetical sorting
      // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/sort-prop-types.md
      'react/sort-prop-types': ['warn', {
        ignoreCase: true,
        callbacksLast: false,
        requiredFirst: false,
        sortShapeProp: true,
      }],

      // Enforce props alphabetical sorting
      // https://github.com/jsx-eslint/eslint-plugin-react/blob/master/docs/rules/jsx-sort-props.md
      'react/jsx-sort-props': ['off', {
        ignoreCase: true,
        callbacksLast: false,
        shorthandFirst: false,
        shorthandLast: false,
        noSortAlphabetically: false,
        reservedFirst: true,
      }],

      'react-refresh/only-export-components': 'off',

      'react-hooks/exhaustive-deps': 'off',
    },
  },
])