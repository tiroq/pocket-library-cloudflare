import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Apps Script example manifest contains read-only OAuth scopes and Tasks service', () => {
  const manifest = JSON.parse(readFileSync(
    new URL('../scripts/appsscript.example.json', import.meta.url), 'utf8'));
  assert.equal(manifest.timeZone, 'Asia/Bangkok');
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.deepEqual(new Set(manifest.oauthScopes), new Set([
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/tasks.readonly',
    'https://www.googleapis.com/auth/script.external_request'
  ]));
  assert.ok(manifest.dependencies.enabledAdvancedServices.some(service =>
    service.userSymbol === 'Tasks' && service.serviceId === 'tasks' &&
    service.version === 'v1'));
});
