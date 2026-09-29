/**
 * Decodes an Android Bluetooth HCI snoop log (btsnoop format) and prints the Spark messages in it.
 *
 *   npx tsx tools/snoop/decode-btsnoop.ts <btsnoop_hci.log> [--all] [--json out.json]
 *
 * Keeps only ATT writes (app → amp) and notifications (amp → app) whose bytes form Spark frames
 * (F0 01 … F7), reassembled per handle with the app's own MessageAssembler, and decodes them with
 * the protocol module. Frames with a bad checksum are shown and flagged, not dropped.
 * `--all` also lists every command/sub pair with counts at the end.
 *
 * btsnoop format (public spec, RFC 1761-style): 16-byte file header ("btsnoop\0", version,
 * datalink 1002 = HCI UART/H4), then records of: original length, included length, flags
 * (bit 0: 0 = sent by host, 1 = received), drops, 64-bit timestamp in µs since 0000-01-01.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { MessageAssembler, type SparkMessage, decodeValues } from '../../src/spark/protocol.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: npx tsx tools/snoop/decode-btsnoop.ts <btsnoop_hci.log> [--all] [--json out.json]');
  process.exit(1);
}
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : null;

const buf = readFileSync(file);
if (buf.subarray(0, 8).toString('latin1') !== 'btsnoop\0') throw new Error('Not a btsnoop file');
const datalink = buf.readUInt32BE(12);
if (datalink !== 1002) console.warn(`warning: datalink ${datalink}, expected 1002 (H4)`);

// µs between 0000-01-01 and 1970-01-01, as used by btsnoop.
const EPOCH_DELTA_US = 0x00dcddb30f2f8000n;

interface Out {
  t: string;
  dir: 'app→amp' | 'amp→app';
  handle: number;
  message: SparkMessage;
}
const out: Out[] = [];

// ACL reassembly per connection handle and direction.
const acl = new Map<string, { expected: number; data: number[] }>();
// Spark frame reassembly per ATT handle and direction.
const assemblers = new Map<string, MessageAssembler>();
let current: { t: string; dir: Out['dir']; handle: number } | null = null;

function assemblerFor(dir: Out['dir'], handle: number): MessageAssembler {
  const key = `${dir}:${handle}`;
  let a = assemblers.get(key);
  if (!a) {
    a = new MessageAssembler((message) => {
      if (current) out.push({ ...current, message });
    });
    assemblers.set(key, a);
  }
  return a;
}

function onL2cap(pdu: number[], dir: Out['dir'], t: string): void {
  const cid = pdu[2] | (pdu[3] << 8);
  if (cid !== 0x0004) return; // ATT only
  const att = pdu.slice(4);
  const opcode = att[0];
  // 0x52 Write Command, 0x12 Write Request, 0x1b Handle Value Notification, 0x1d Indication
  if (![0x52, 0x12, 0x1b, 0x1d].includes(opcode)) return;
  const handle = att[1] | (att[2] << 8);
  const value = att.slice(3);
  current = { t, dir, handle };
  assemblerFor(dir, handle).feed(value);
}

let off = 16;
let records = 0;
while (off + 24 <= buf.length) {
  const incl = buf.readUInt32BE(off + 4);
  const flags = buf.readUInt32BE(off + 8);
  const ts = buf.readBigUInt64BE(off + 16);
  const pkt = buf.subarray(off + 24, off + 24 + incl);
  off += 24 + incl;
  records++;
  if (pkt.length < 5 || pkt[0] !== 0x02) continue; // H4 ACL data only
  const received = (flags & 1) === 1;
  const dir: Out['dir'] = received ? 'amp→app' : 'app→amp';
  const t = new Date(Number((ts - EPOCH_DELTA_US) / 1000n)).toISOString();
  const hdr = pkt[1] | (pkt[2] << 8);
  const conn = hdr & 0x0fff;
  const pb = (hdr >> 12) & 0x3;
  const data = Array.from(pkt.subarray(5));
  const key = `${dir}:${conn}`;
  if (pb === 0x1) {
    // continuation fragment
    const st = acl.get(key);
    if (!st) continue;
    st.data.push(...data);
    if (st.data.length >= st.expected) {
      acl.delete(key);
      onL2cap(st.data, dir, t);
    }
  } else {
    const l2len = data[0] | (data[1] << 8);
    if (data.length - 4 >= l2len) onL2cap(data, dir, t);
    else acl.set(key, { expected: l2len + 4, data });
  }
}

const hex = (a: readonly number[]) => a.map((b) => b.toString(16).padStart(2, '0')).join(' ');
for (const o of out) {
  const m = o.message;
  const code = `0x${hex([m.cmd, m.sub]).replace(' ', '')}`;
  let decoded = '';
  try {
    decoded = JSON.stringify(decodeValues(m.data));
  } catch {
    decoded = '(not decodable)';
  }
  console.log(
    `${o.t.slice(11, 23)} ${o.dir} h=0x${o.handle.toString(16)} ${code} seq=${hex([m.seq])}${m.checksumOk ? '' : ' BADCS'}  ${hex(m.data)}  ${decoded.slice(0, 160)}`,
  );
}

console.error(`\n${records} records, ${out.length} Spark messages`);
if (args.includes('--all')) {
  const counts = new Map<string, number>();
  for (const o of out) {
    const k = `${o.dir} 0x${hex([o.message.cmd, o.message.sub]).replace(' ', '')}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...counts].sort()) console.error(`${k}  ×${n}`);
}
if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify(
      out.map((o) => ({ t: o.t, dir: o.dir, handle: o.handle, cmd: o.message.cmd, sub: o.message.sub, seq: o.message.seq, checksumOk: o.message.checksumOk, raw: hex(o.message.raw), data: hex(o.message.data) })),
      null,
      2,
    ),
  );
  console.error(`wrote ${jsonOut}`);
}
