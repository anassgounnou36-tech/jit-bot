module.exports = {
  require: ['ts-node/register'],
  extensions: ['ts'],
  spec: 'test/unit/**/*.test.ts',
  timeout: 10000,
  recursive: true
};