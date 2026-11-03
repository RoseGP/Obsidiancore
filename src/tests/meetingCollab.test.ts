/**
 * Meeting room logic: summaries and action items, real-time event envelopes,
 * poll tallies and connection-quality rating.
 */
import { extractActionItems, summarizeMeeting } from '../lib/meetingSummary';
import { MAX_EVENT_BYTES, isMeetingEnvelope, tallyPoll } from '../lib/meetingRealtime';
import { rateConnection } from '../components/greet/meeting/useMeetingUi';

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail?: string) {
  if (condition) { console.log(`  ✅ [PASS] ${name}`); passed++; }
  else { console.error(`  ❌ [FAIL] ${name}${detail ? `: ${detail}` : ''}`); failed++; }
}

console.log('📝 Summary & action items');
{
  const lines = [
    { speaker: 'Ana', text: 'Thanks for joining. The beta launch is the main topic today.' },
    { speaker: 'Li', text: 'I’ll send the revised deck by Friday. We agreed to keep the launch on Nov 18.' },
    { speaker: 'Ana', text: 'Sam, can you book the venue? Let’s review pricing next week.' },
    { speaker: 'Notes', text: '[ ] Update the onboarding checklist' },
  ];
  const items = extractActionItems(lines);
  const texts = items.map((i) => i.text);
  assert(texts.some((t) => /send the revised deck/i.test(t)), 'Finds “I’ll …” commitments (curly apostrophe)', texts.join(' | '));
  assert(items.find((i) => /revised deck/i.test(i.text))?.owner === 'Li', 'Owner is the speaker for first-person commitments');
  assert(items.find((i) => /revised deck/i.test(i.text))?.due === 'Friday', 'Picks up the due date');
  assert(texts.some((t) => /book the venue/i.test(t)), 'Finds requests (“can you …”)');
  assert(texts.some((t) => /review pricing/i.test(t)), 'Finds “let’s …” proposals');
  assert(texts.some((t) => /onboarding checklist/i.test(t)), 'Finds unchecked note checkboxes');

  const s = summarizeMeeting(lines, { title: 'Beta sync' });
  assert(s.source === 'on-device' && s.keyPoints.length > 0 && s.keyPoints.length <= 5, 'Produces up to 5 key points');
  assert(s.decisions.some((d) => /agreed/i.test(d)), 'Captures decisions');
  assert(!s.keyPoints.some((k) => k.startsWith('[')), 'Key points drop checkbox markers');
  assert(s.speakers[0].name === 'Ana' && s.speakers[0].lines === 2, 'Counts lines per speaker');
  assert(JSON.stringify(summarizeMeeting(lines)) === JSON.stringify(summarizeMeeting(lines)), 'Deterministic for the same input');
  assert(/nothing to summarize/i.test(summarizeMeeting([]).overview), 'Empty meeting says there is nothing to summarize');
}

console.log('\n📡 Real-time envelopes');
{
  assert(isMeetingEnvelope({ id: 'a', senderId: 'b', type: 'hand', raised: true, name: 'Ana' }), 'Accepts a known event');
  assert(!isMeetingEnvelope({ id: 'a', senderId: 'b', type: 'exec', cmd: 'rm' }), 'Rejects unknown event types');
  assert(!isMeetingEnvelope({ type: 'hand' }), 'Rejects events without id/sender');
  assert(!isMeetingEnvelope(null) && !isMeetingEnvelope('hand'), 'Rejects non-objects');
  assert(MAX_EVENT_BYTES === 16000, 'Event size cap matches the server relay (16 KB)');
}

console.log('\n📊 Polls');
{
  const poll = { id: 'p', question: 'Date?', options: ['Nov 18', 'Nov 25', 'Dec 2'], createdBy: 'Ana', createdAt: 0 };
  const t = tallyPoll(poll, { u1: 0, u2: 0, u3: 2, u4: 7, u5: -1 });
  assert(t.counts.join() === '2,0,1' && t.total === 3, 'Counts valid votes and ignores out-of-range ones', t.counts.join());
  const changed = tallyPoll(poll, { u1: 1 });
  assert(changed.counts.join() === '0,1,0', 'One vote per voter (re-voting replaces)');
}

console.log('\n📶 Connection quality');
{
  assert(rateConnection({ effectiveType: '4g', rtt: 80, downlink: 20 }, true) === 'good', '4G, low RTT → good');
  assert(rateConnection({ effectiveType: '4g', rtt: 320, downlink: 5 }, true) === 'fair', 'High RTT → fair');
  assert(rateConnection({ effectiveType: '3g', rtt: 200, downlink: 3 }, true) === 'fair', '3G → fair');
  assert(rateConnection({ effectiveType: '2g', rtt: 900, downlink: 0.2 }, true) === 'poor', '2G → poor');
  assert(rateConnection(undefined, true) === 'good', 'No Network Information API → assume good');
  assert(rateConnection({ effectiveType: '4g' }, false) === 'offline', 'Offline wins');
}

console.log(`\nResults: ${passed} Passed, ${failed} Failed\n`);
if (failed > 0) process.exit(1);
