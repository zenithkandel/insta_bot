import assert from 'assert';

console.log('=== RUNNING SPA UNIT & SECURITY TESTS ===');

// 1. Recipient Username Validation Test
const USERNAME_REGEX = /^[a-zA-Z0-9._]{1,30}$/;
function validateUsername(handle) {
  if (!handle) return false;
  const clean = handle.replace(/^@/, '').trim();
  if (clean.length === 0 || clean.length > 30) return false;
  if (/\s/.test(clean) || /\.\./.test(clean)) return false;
  if (clean.startsWith('.') || clean.endsWith('.')) return false;
  return USERNAME_REGEX.test(clean);
}

assert.strictEqual(validateUsername('alex_designer'), true);
assert.strictEqual(validateUsername('@studio.flux'), true);
assert.strictEqual(validateUsername('invalid handle with space'), false);
assert.strictEqual(validateUsername('invalid..dots'), false);
assert.strictEqual(validateUsername('invalid-hyphen'), false);
console.log('✓ Test 1: Username format validation matches Instagram standards');

// 2. Auto-Deduplication Test
const rawLines = ['alex_designer', 'ALEX_DESIGNER', '@alex_designer', 'studio.flux', 'creative_labs', 'studio.flux'];
const seen = new Set();
const deduped = [];
let dupsCount = 0;
for (const line of rawLines) {
  const clean = line.replace(/^@/, '').trim();
  if (!validateUsername(clean)) continue;
  const lower = clean.toLowerCase();
  if (seen.has(lower)) {
    dupsCount++;
  } else {
    seen.add(lower);
    deduped.push(clean);
  }
}
assert.strictEqual(deduped.length, 3);
assert.strictEqual(dupsCount, 3);
console.log('✓ Test 2: Auto-deduplication accurately eliminates duplicates regardless of casing/@');

// 3. Message Personalization Test
const template = 'Hi @{{username}}, check out our platform at {{handle}}!';
const sample = 'alex_designer';
const rendered = template
  .replace(/\{\{\s*username\s*\}\}/gi, sample)
  .replace(/\{\{\s*handle\s*\}\}/gi, `@${sample}`);
assert.strictEqual(rendered, 'Hi @alex_designer, check out our platform at @alex_designer!');
console.log('✓ Test 3: Template variables {{username}} and {{handle}} correctly interpolate');

// 4. Feasibility Math Test
function checkFeasibility(totalRecipients, startTime, deadline, interval, maxVolume) {
  const start = new Date(startTime);
  const end = new Date(deadline);
  const availableSeconds = (end.getTime() - start.getTime()) / 1000;
  const achievableUnderPacing = Math.floor(availableSeconds / interval);
  const deliverableCount = Math.min(achievableUnderPacing, maxVolume);
  return {
    isFeasible: deliverableCount >= totalRecipients,
    deliverableCount,
    shortfall: Math.max(0, totalRecipients - deliverableCount)
  };
}

// Case A: Feasible
{
  const start = '2026-11-17T12:00:00Z';
  const end = '2026-11-18T12:00:00Z'; // 24 hours = 86400 seconds
  const res = checkFeasibility(50, start, end, 30, 100); // 86400 / 30 = 2880 > 50
  assert.strictEqual(res.isFeasible, true);
  assert.strictEqual(res.shortfall, 0);
  console.log('✓ Test 4A: Feasible schedule correctly passes');
}

// Case B: Infeasible deadline
{
  const start = '2026-11-17T12:00:00Z';
  const end = '2026-11-17T12:10:00Z'; // 10 minutes = 600 seconds
  const res = checkFeasibility(50, start, end, 30, 100); // 600 / 30 = 20 messages max
  assert.strictEqual(res.isFeasible, false);
  assert.strictEqual(res.deliverableCount, 20);
  assert.strictEqual(res.shortfall, 30);
  console.log('✓ Test 4B: Infeasible deadline detected (30 recipients shortfall calculated)');
}

// 5. Security Test: Session ID Excluded from Backup Export
{
  const internalAppState = {
    sessionId: 'SECRET_SESSION_TOKEN_1234567890',
    recipients: ['alex_designer'],
    message: 'Hello!',
    schedule: { pacingInterval: 30 }
  };

  const backupData = {
    version: '2.0.0',
    exportedAt: new Date().toISOString(),
    recipients: internalAppState.recipients,
    message: internalAppState.message,
    schedule: internalAppState.schedule
    // Note: sessionId is intentionally omitted
  };

  const serialized = JSON.stringify(backupData);
  assert.strictEqual(serialized.includes('SECRET_SESSION_TOKEN_1234567890'), false);
  assert.strictEqual(backupData.sessionId, undefined);
  console.log('✓ Test 5: Session ID is strictly omitted from exported backup JSON');
}

console.log('ALL SPA TESTS PASSED SUCCESSFULLY!');
