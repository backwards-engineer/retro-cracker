import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE,
  assemble,
  decode,
  execute,
  getRows,
  hex,
  levels,
  searchCode,
} from '../lib/machine.ts';
const find = (l, prefix) =>
  l.rows.find(
    (r) => r.functionName === l.gateFunction && r.asm.startsWith(prefix),
  );
for (const l of levels)
  test(`${l.id}: original program is locked and returns cleanly`, () => {
    const r = execute(l);
    assert.equal(r.success, false);
    assert.equal(r.outcome, 'locked');
    assert.equal(r.error, '');
  });
test('serial: JNZ -> JMP changes 75 to EB and unlocks', () => {
  const l = levels[0],
    r = find(l, 'jnz');
  const patch = r.asm.replace('jnz', 'jmp');
  assert.equal(assemble(patch, r.address)[0], 0xeb);
  assert.equal(execute(l, { [r.address]: patch }).success, true);
});
test('disc: CMP EAX,EAX -> MOV AL,01 sets the boolean and unlocks', () => {
  const l = levels[1],
    r = find(l, 'cmp');
  const result = execute(l, { [r.address]: 'mov al, 01' });
  assert.equal(result.success, true);
  const mov = result.frames.find((f) => f.address === r.address);
  assert.equal(mov.eax, 1);
  assert.equal(mov.zf, true);
  assert.equal(result.frames.find((f) => f.asm === 'test al, al').zf, false);
});
test('trial: each intended patch alone fails, both succeed', () => {
  const l = levels[2],
    first = find(l, 'jz'),
    second = find(l, 'jnz');
  const a = { [first.address]: 'nop' },
    b = { [second.address]: second.asm.replace('jnz', 'jmp') };
  assert.equal(execute(l, a).success, false);
  assert.equal(execute(l, b).success, false);
  assert.equal(execute(l, { ...a, ...b }).success, true);
  assert.deepEqual(
    getRows(l, a).find((r) => r.address === first.address).bytes,
    [0x90, 0x90],
  );
});
test('alternate legitimate control flow solution is accepted', () => {
  const l = levels[2],
    r = find(l, 'jz'),
    target = l.rows.find((r) => r.address === l.stringTable[2].references[0]);
  assert.equal(
    execute(l, { [r.address]: `jmp ${hex(target.address)}` }).success,
    true,
  );
});
test('oversized patches rejected without changing source', () => {
  const l = levels[0],
    r = find(l, 'jnz');
  assert.throws(() => getRows(l, { [r.address]: 'mov eax, 01' }), /only 2/);
  assert.equal(r.bytes[0], 0x75);
});
test('bad destinations, unknown APIs, loops and stack faults do not win', () => {
  const l = levels[0],
    r = find(l, 'jnz');
  for (const asm of [
    `jmp ${hex(BASE + 2)}`,
    `jmp ${hex(BASE - 1)}`,
    `jmp ${hex(r.address)}`,
  ]) {
    const result = execute(l, { [r.address]: asm });
    assert.equal(result.success, false);
    assert.notEqual(result.error, '');
  }
  assert.match(
    execute(l, { [find(l, 'call').address]: 'call 00403000' }).error,
    /API/,
  );
  assert.match(execute(l, { [BASE]: 'pop ebp' }).error, /underflow/);
});
test('MOV AL preserves high EAX bits and flags', () => {
  const l = levels[1],
    call = find(l, 'call'),
    cmp = find(l, 'cmp');
  const result = execute(l, {
    [call.address]: 'mov eax, 12345600',
    [cmp.address]: 'mov al, 01',
  });
  assert.equal(
    result.frames.find((f) => f.address === cmp.address).eax,
    0x12345601,
  );
  assert.equal(result.success, true);
});
test('short branches and instruction syntax validated', () => {
  assert.throws(() => assemble('jmp 00402000', BASE), /Short branch/);
  assert.throws(() => assemble('mov al, 100', BASE), /too large/);
  assert.throws(() => assemble('rm -rf /', BASE), /Unsupported/);
  assert.deepEqual(assemble('  MOV  AL , 0x01 ', BASE), [0xb0, 1]);
  assert.equal(decode([0x75, 0xfe], 0).value, BASE);
});

for (const l of levels) {
  test(`${l.id}: expanded code decodes contiguously with meaningful functions`, () => {
    assert.ok(l.rows.length >= 700);
    assert.equal(new Set(l.rows.map((r) => r.functionName)).size, 32);
    assert.equal(l.rows.filter((r) => r.asm === 'nop').length, 0);
    const bytes = l.rows.flatMap((r) => r.bytes);
    for (const row of l.rows) {
      assert.equal(decode(bytes, row.address - BASE).size, row.bytes.length);
      assert.ok(row.functionName);
    }
    const result = execute(l);
    assert.ok(result.frames.some((f) => f.event === 'LoadPreferences'));
    assert.ok(result.frames.some((f) => f.asm === 'mov eax, [ebp-08]'));
  });
  test(`${l.id}: every string resolves to actual PUSH operands and search destinations`, () => {
    for (const string of l.stringTable) {
      assert.ok(string.references.length > 0, string.text);
      const matches = searchCode(l, l.rows, string.text);
      for (const address of string.references) {
        const row = l.rows.find((r) => r.address === address);
        assert.equal(row.stringAddress, string.address);
        assert.equal(row.asm, `push ${hex(string.address)}`);
        assert.equal(
          decode(
            l.rows.flatMap((r) => r.bytes),
            address - BASE,
          ).value,
          string.address,
        );
        assert.ok(matches.includes(address));
      }
    }
  });
}
test('filtered string result keeps its own xrefs regardless of result index', () => {
  const l = levels[0],
    entry = l.stringTable.find((s) => s.text === 'Thanks for registering!');
  const filtered = l.stringTable.filter((s) => s.text.includes('Thanks'));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].address, entry.address);
  assert.deepEqual(
    searchCode(l, l.rows, 'Thanks for registering!'),
    entry.references,
  );
  const at = l.rows.findIndex((r) => r.address === entry.references[0]);
  assert.equal(l.rows[at + 1].asm, 'call 00402110');
});
test('search includes all string xrefs, data addresses and unknown-query empty result', () => {
  const l = levels[2],
    entry = l.stringTable[1];
  assert.equal(entry.references.length, 2);
  for (const address of entry.references)
    assert.ok(searchCode(l, l.rows, hex(entry.address)).includes(address));
  assert.deepEqual(searchCode(l, l.rows, 'nothing-like-this-string'), []);
  assert.deepEqual(searchCode(l, l.rows, '   '), []);
  assert.equal(l.rows.length, 771);
});
test('nested call stack faults and out-of-frame loads fail cleanly', () => {
  const l = levels[0],
    firstCall = l.rows.find((r) => r.asm.startsWith('call'));
  assert.match(
    execute(l, { [firstCall.address]: `call ${hex(BASE)}` }).error,
    /Call depth/,
  );
  const load = l.rows.find((r) => r.asm === 'mov eax, [ebp-08]');
  assert.match(
    execute(l, { [load.address]: 'mov eax, [ebp-7C]' }).error,
    /outside/,
  );
});
