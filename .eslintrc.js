module.exports = {
  env: {
    es6: true,
    node: true
  },
  extends: [
    'standard'
  ],
  globals: {
    Atomics: 'readonly',
    SharedArrayBuffer: 'readonly'
  },
  parserOptions: {
    ecmaVersion: 2022
  },

  rules: {
    'no-async-promise-executor': 'off',
    'space-before-function-paren': ['error', {
      anonymous: 'ignore',
      named: 'ignore',
      asyncArrow: 'ignore'
    }],
    'no-unsafe-optional-chaining': 0
  }

}
