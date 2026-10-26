#!/usr/bin/env node
'use strict';
// scripts/verify-log.js: verify an exported QuackTrack log from the command line.
//   node scripts/verify-log.js quacktrack-log.json
//   node scripts/verify-log.js --selftest
// Imports only src/canon.js and src/log.js, never the running server.

const fs = require('fs');
const path = require('path');
const { buildEntry, verifyChain } = require(path.join(__dirname, '..', 'src', 'log.js'));

function report(result) {
  if (result.ok) {
    console.log(`Chain OK: ${result.count} entries. Head ${result.head}.`);
  } else {
    console.log(`Chain BROKEN at entry ${result.brokenAt}.`);
  }
  return result.ok;
}

// SDS.md section 8 step 5: build a 5 entry chain in memory, verify it,
// change entry 2, verify again. Exits 0 only when the first check passes
// and the second one catches the change at entry 2.
function selftest() {
  const ts = (n) => `2026-10-25T12:00:0${n}.000Z`;
  const org = { kind: 'organizer', id: 'organizer' };
  const entries = [];
  const add = (actor, action, data) => {
    const e = buildEntry(entries[entries.length - 1] || null, actor, action, data, ts(entries.length));
    entries.push(e);
  };
  add({ kind: 'system', id: null }, 'event.created', {});
  add(org, 'team.created', { teamId: 'tm_0000000000000001', teamName: 'Team Mallard', mode: 'key' });
  add(org, 'roster.added', { teamId: 'tm_0000000000000001', handle: 'jasonepage', role: 'Captain' });
  add(org, 'prompt.created', { promptId: 'pr_0000000000000001', deadline: '2026-10-25T14:00:00.000Z' });
  add(org, 'prompt.assigned', { teamId: 'tm_0000000000000001', promptId: 'pr_0000000000000001' });

  const first = verifyChain(entries);
  report(first);
  const tampered = JSON.parse(JSON.stringify(entries));
  tampered[2].data.handle = 'octocat';
  const second = verifyChain(tampered);
  report(second);
  return first.ok && first.count === 5 && !second.ok && second.brokenAt === 2;
}

function main(argv) {
  const arg = argv[2];
  if (!arg) {
    console.log('Usage: node scripts/verify-log.js quacktrack-log.json');
    console.log('       node scripts/verify-log.js --selftest');
    return 1;
  }
  if (arg === '--selftest') return selftest() ? 0 : 1;

  let entries = null;
  try {
    entries = JSON.parse(fs.readFileSync(arg, 'utf8'));
  } catch (_) {
    entries = null; // unreadable or not JSON: reported as broken at entry 0
  }
  const ok = report(verifyChain(entries));
  // SDS.md section 8 step 6: every override stands out in a printed check.
  if (Array.isArray(entries)) {
    for (const e of entries) {
      if (e && e.action === 'team.override' && e.data) console.log(`OVERRIDE at entry ${e.seq}: ${e.data.teamName}.`);
    }
  }
  return ok ? 0 : 1;
}

process.exitCode = main(process.argv);
