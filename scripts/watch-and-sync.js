#!/usr/bin/env node

const { execSync } = require('child_process');

console.log('🔄 Starting auto-sync (every 10 seconds)...\n');

setInterval(() => {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] Running sync...`);

  try {
    execSync('node scripts/fetch-apim-openapi.js', { stdio: 'pipe' });
    console.log(`[${time}] ✅ Sync complete\n`);
  } catch (error) {
    console.log(`[${time}] ⚠️  Sync skipped\n`);
  }
}, 10000); // 10 seconds

// Keep running
setInterval(() => {}, 1000);
