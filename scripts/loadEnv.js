const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (process.env.__JIT_ENV_LOADED) return; // idempotent
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  } else {
    console.warn('⚠️  .env file not found at', envPath);
  }
  process.env.__JIT_ENV_LOADED = 'true';
}

module.exports = { loadEnv };