#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env file
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const [key, value] = line.split('=');
    if (key && value && !process.env[key]) {
      process.env[key] = value.trim();
    }
  });
}


// Store Credentials in Variables

const clientId = process.env.AZURE_CLIENT_ID;
const tenantId = process.env.AZURE_TENANT_ID;
const clientSecret = process.env.AZURE_CLIENT_SECRET;
const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID;
const resourceGroup = 'POCAPIM';
const apimInstance = process.env.AZURE_APIM_INSTANCE || 'APIMPOC23';

// HTTPS Request Function

function httpsRequest(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        } else {
          try {
            resolve({ body, statusCode: res.statusCode, headers: res.headers });
          } catch (e) {
            resolve({ body, statusCode: res.statusCode, headers: res.headers });
          }
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// AUTHENTICATE 
async function getAccessToken() {
  console.log('🔐 Getting access token...');
  const data = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    resource: 'https://management.azure.com/',
  }).toString();

  const options = {
    hostname: 'login.microsoftonline.com',
    port: 443,
    path: `/${tenantId}/oauth2/token`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': data.length,
    },
  };

  const res = await httpsRequest(options, data);
  const token = JSON.parse(res.body).access_token;
  console.log('✓ Access token obtained');
  return token;
}

// List All APIs

async function listAPIs(token) {
  console.log('📡 Fetching APIs from APIM...');
  const apiPath = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.ApiManagement/service/${apimInstance}/apis?api-version=2021-08-01`;

  const options = {
    hostname: 'management.azure.com',
    port: 443,
    path: apiPath,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };

  const res = await httpsRequest(options);
  const apis = JSON.parse(res.body).value || [];
  console.log(`✓ Found ${apis.length} API(s)`);
  return apis;
}

async function getAPIOpenAPISpec(token, apiId) {
  // Skip fetching OpenAPI spec to speed up sync (takes 2-3 sec per API)
  // Return null to use generated spec instead
  return null;
}



function generateCatalogEntity(api, openApiSpec) {
  const apiId = api.name.split('/').pop();
  const displayName = api.properties.displayName || apiId;
  const description =
    api.properties.description || 'API from Azure API Management';

  let definition =
    openApiSpec ||
    `openapi: 3.0.0
info:
  title: ${displayName}
  version: "1.0.0"
  description: ${description}
servers:
  - url: https://${apimInstance}.azure-api.net`;

  return `apiVersion: backstage.io/v1alpha1
kind: API
metadata:
  name: ${apiId}
  namespace: apim
  title: ${displayName}
  description: ${description}
  labels:
    source: apim
    environment: poc
  annotations:
    apim/gateway-url: https://${apimInstance}.azure-api.net
    apim/instance: ${apimInstance}
    apim/resource-id: ${api.id}
spec:
  type: openapi
  owner: api-team
  lifecycle: experimental
  definition: |
${definition
  .split('\n')
  .map(line => '    ' + line)
  .join('\n')}
`;
}

async function main() {
  try {
    const token = await getAccessToken();
    const apis = await listAPIs(token);

    if (apis.length === 0) {
      console.log('⚠ No APIs found in APIM');
      return;
    }

    const outputDir = path.join(__dirname, '../examples/apim-apis');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Clear existing files
    fs.readdirSync(outputDir).forEach(file => {
      if (file !== '.gitkeep') {
        fs.unlinkSync(path.join(outputDir, file));
      }
    });

    for (const api of apis) {
      const apiId = api.name.split('/').pop();
      console.log(`\n📦 Processing API: ${apiId}`);

      const openApiSpec = await getAPIOpenAPISpec(token, apiId);
      const entity = generateCatalogEntity(api, openApiSpec);
      const filePath = path.join(outputDir, `${apiId}.yaml`);

      fs.writeFileSync(filePath, entity);
      console.log(`✓ Created catalog entity: ${filePath}`);
    }

    console.log('\n✅ Success! Your APIM APIs are now in the catalog.');
    console.log('📍 Go to: http://localhost:3001/catalog?kind=api\n');

    // Trigger Backstage catalog refresh
    await triggerCatalogRefresh();
  } catch (error) {
    console.error(' Error:', error.message);
    process.exit(1);
  }
}

async function triggerCatalogRefresh() {
  try {
    console.log('🔄 Triggering Backstage catalog refresh...');

    // Call Backstage API to refresh the catalog
    const options = {
      hostname: 'localhost',
      port: 7007,
      path: '/api/catalog/refresh',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    await httpsRequest(options, JSON.stringify({})).catch(() => {
      // HTTP (not HTTPS) fallback
      return new Promise(resolve => {
        const http = require('http');
        const req = http.request({ ...options, port: 7007 }, res => {
          let body = '';
          res.on('data', chunk => (body += chunk));
          res.on('end', () => resolve({ body }));
        });
        req.on('error', () => resolve({ body: '' }));
        req.write(JSON.stringify({}));
        req.end();
      });
    });

    console.log('✅ Catalog refresh triggered!\n');
  } catch (error) {
    console.log('Could not trigger refresh (auto-refresh in 30 seconds)\n');
  }
}

main();
