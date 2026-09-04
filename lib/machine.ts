// Deliberately bounded x86-32 laboratory. No uploaded or native code is executed.
export const BASE = 0x401000;
export const hex = (n: number, width = 8) =>
  (n >>> 0).toString(16).toUpperCase().padStart(width, '0');
export const bytesText = (b: number[]) => b.map((n) => hex(n, 2)).join(' ');
type Source = {
  asm: string;
  note?: string;
  label?: string;
  functionName?: string;
  stringAddress?: number;
};
export type Row = {
  address: number;
  bytes: number[];
  asm: string;
  note: string;
  functionName?: string;
  stringAddress?: number;
};
export type StringEntry = {
  address: number;
  text: string;
  references: number[];
};
export type Level = {
  id: string;
  name: string;
  file: string;
  year: string;
  kind: string;
  difficulty: string;
  goal: string;
  hints: string[];
  rows: Row[];
  strings: string[];
  stringTable?: StringEntry[];
  gateFunction?: string;
  success: string;
  explanation: string;
};
const api: Record<number, string> = {
  0x402000: 'CheckSerial',
  0x402010: 'FindGameDisc',
  0x402020: 'TrialDaysRemaining',
  0x402100: 'ShowLocked',
  0x402110: 'ShowUnlocked',
};
const imports = [
  'GetModuleHandleA',
  'LoadStringA',
  'GetPrivateProfileStringA',
  'OutputDebugStringA',
  'CreateFileA',
  'LoadLibraryA',
  'GetProcAddress',
  'RegisterWindowMessageA',
];
imports.forEach((name, i) => {
  api[0x408000 + i * 16] = name;
});
const u32 = (n: number) => [
  n & 255,
  (n >>> 8) & 255,
  (n >>> 16) & 255,
  (n >>> 24) & 255,
];
const read32 = (b: number[], i: number) =>
  (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
export function assemble(text: string, address: number): number[] {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',');
  const fixed: Record<string, number[]> = {
    'push ebp': [0x55],
    'mov ebp,esp': [0x8b, 0xec],
    'pop ebp': [0x5d],
    ret: [0xc3],
    nop: [0x90],
    'xor eax,eax': [0x31, 0xc0],
    'cmp eax,eax': [0x39, 0xc0],
    'test eax,eax': [0x85, 0xc0],
    'test al,al': [0x84, 0xc0],
  };
  if (fixed[s]) return [...fixed[s]];
  if (s === 'push eax') return [0x50];
  if (s === 'pop eax') return [0x58];
  if (s === 'pop ecx') return [0x59];
  const adjust = s.match(/^(sub|add) esp,(?:0x)?([0-9a-f]+)$/);
  if (adjust) {
    const n = parseInt(adjust[2], 16);
    if (n > 124 || n % 4)
      throw Error('Stack adjustment must be a multiple of 4, at most 7C.');
    return [0x83, adjust[1] === 'sub' ? 0xec : 0xc4, n];
  }
  const local = s.match(/^(mov|lea) eax,\[ebp-(?:0x)?([0-9a-f]+)\]$/);
  const write = s.match(/^mov \[ebp-(?:0x)?([0-9a-f]+)\],eax$/);
  if (local || write) {
    const offset = parseInt(local ? local[2] : write![1], 16);
    if (offset < 4 || offset > 124 || offset % 4)
      throw Error('Local offset must be aligned, from 04 to 7C.');
    return [
      write ? 0x89 : local![1] === 'lea' ? 0x8d : 0x8b,
      0x45,
      -offset & 255,
    ];
  }
  const push = s.match(/^push (?:0x)?([0-9a-f]+)$/);
  if (push) {
    const value = parseInt(push[1], 16);
    if (value > 0xffffffff) throw Error('Immediate is too large.');
    return [0x68, ...u32(value)];
  }
  const match = s.match(/^(mov|cmp) (eax|al),(?:0x)?([0-9a-f]+)$/);
  if (match) {
    const n = parseInt(match[3], 16);
    if (n > (match[2] === 'al' ? 255 : 0xffffffff))
      throw Error('Immediate is too large for this register.');
    if (match[1] === 'mov')
      return match[2] === 'al' ? [0xb0, n] : [0xb8, ...u32(n)];
    if (match[2] === 'eax') return [0x3d, ...u32(n)];
  }
  const branch = s.match(/^(jnz|jne|jz|je|jmp|call) (?:0x)?([0-9a-f]+)$/);
  if (branch) {
    const dest = parseInt(branch[2], 16);
    if (branch[1] === 'call') return [0xe8, ...u32(dest - address - 5)];
    const delta = dest - address - 2;
    if (delta < -128 || delta > 127)
      throw Error('Short branch target must be within -128 to +127 bytes.');
    return [
      { jnz: 0x75, jne: 0x75, jz: 0x74, je: 0x74, jmp: 0xeb }[branch[1]]!,
      delta & 255,
    ];
  }
  throw Error(
    'Unsupported instruction. Open the instruction guide for supported syntax. Numbers are hexadecimal.',
  );
}
export function decode(
  b: number[],
  i: number,
): { asm: string; size: number; op: string; value?: number } {
  const a = BASE + i,
    byte = b[i];
  if ([0x74, 0x75, 0xeb].includes(byte)) {
    const op = byte === 0x74 ? 'jz' : byte === 0x75 ? 'jnz' : 'jmp';
    const value = a + 2 + (b[i + 1] > 127 ? b[i + 1] - 256 : b[i + 1]);
    return { asm: `${op} ${hex(value)}`, size: 2, op, value };
  }
  if (byte === 0xe8) {
    const value = (a + 5 + read32(b, i + 1)) >>> 0;
    return { asm: `call ${hex(value)}`, size: 5, op: 'call', value };
  }
  if (byte === 0xb8 || byte === 0x3d) {
    const value = read32(b, i + 1),
      op = byte === 0xb8 ? 'mov' : 'cmp';
    return { asm: `${op} eax, ${hex(value)}`, size: 5, op, value };
  }
  if (byte === 0xb0)
    return {
      asm: `mov al, ${hex(b[i + 1], 2)}`,
      size: 2,
      op: 'mov-al',
      value: b[i + 1],
    };
  if (byte === 0x83 && [0xec, 0xc4].includes(b[i + 1])) {
    const op = b[i + 1] === 0xec ? 'sub-esp' : 'add-esp';
    return {
      asm: `${op === 'sub-esp' ? 'sub' : 'add'} esp, ${hex(b[i + 2], 2)}`,
      size: 3,
      op,
      value: b[i + 2],
    };
  }
  if ([0x8b, 0x89, 0x8d].includes(byte) && b[i + 1] === 0x45) {
    const value = 256 - b[i + 2],
      operand = `[ebp-${hex(value, 2)}]`;
    return {
      asm:
        byte === 0x89
          ? `mov ${operand}, eax`
          : `${byte === 0x8d ? 'lea' : 'mov'} eax, ${operand}`,
      size: 3,
      op: byte === 0x89 ? 'store' : byte === 0x8d ? 'lea' : 'load',
      value,
    };
  }
  if (byte === 0x50) return { asm: 'push eax', size: 1, op: 'push-eax' };
  if (byte === 0x58) return { asm: 'pop eax', size: 1, op: 'pop-eax' };
  if (byte === 0x68)
    return {
      asm: `push ${hex(read32(b, i + 1))}`,
      size: 5,
      op: 'push-data',
      value: read32(b, i + 1),
    };
  if (byte === 0x59) return { asm: 'pop ecx', size: 1, op: 'pop-ecx' };
  const fixed: Record<number, [string, number, string, number?]> = {
    0x55: ['push ebp', 1, 'push'],
    0x5d: ['pop ebp', 1, 'pop'],
    0xc3: ['ret', 1, 'ret'],
    0x90: ['nop', 1, 'nop'],
    0x8b: ['mov ebp, esp', 2, 'frame', 0xec],
    0x31: ['xor eax, eax', 2, 'xor', 0xc0],
    0x39: ['cmp eax, eax', 2, 'cmp-self', 0xc0],
    0x85: ['test eax, eax', 2, 'test', 0xc0],
    0x84: ['test al, al', 2, 'test-al', 0xc0],
  };
  const f = fixed[byte];
  if (!f || (f[3] !== undefined && b[i + 1] !== f[3]) || i + f[1] > b.length)
    throw Error(`Invalid instruction at ${hex(a)}.`);
  return { asm: f[0], size: f[1], op: f[2] };
}
function compile(source: Source[]): Row[] {
  let cursor = BASE;
  const labels: Record<string, number> = {};
  for (const s of source) {
    if (s.label) labels[s.label] = cursor;
    cursor += assemble(s.asm.replace(/@\w+/, hex(cursor + 2)), cursor).length;
  }
  cursor = BASE;
  let functionName = '';
  return source.map((s) => {
    if (s.functionName) functionName = s.functionName;
    const asm = s.asm.replace(/@(\w+)/, (_, name) => {
      if (labels[name] === undefined) throw Error(`Unknown label ${name}`);
      return hex(labels[name]);
    });
    const bytes = assemble(asm, cursor);
    const row = {
      address: cursor,
      bytes,
      asm,
      note: s.note || '',
      functionName,
      stringAddress: s.stringAddress,
    };
    cursor += bytes.length;
    return row;
  });
}
const prologue: Source[] = [
  { asm: 'push ebp', note: 'entry point' },
  { asm: 'mov ebp, esp' },
  { asm: 'xor eax, eax', note: 'initialize return value' },
  ...Array.from({ length: 8 }, () => ({ asm: 'nop', note: '' })),
];
const tail: Source[] = [
  { asm: 'call 00402100', label: 'locked', note: '"Unregistered copy"' },
  { asm: 'jmp @exit' },
  { asm: 'call 00402110', label: 'unlocked', note: 'start application' },
  { asm: 'pop ebp', label: 'exit' },
  { asm: 'ret' },
];
export const levels: Level[] = [
  {
    id: 'serial',
    name: 'PixelPaint Pro',
    file: 'PIXELPNT.EXE',
    year: '1997',
    kind: 'SERIAL CHECK',
    difficulty: '01 / BEGINNER',
    goal: 'Make PixelPaint open without a valid registration key. Follow the return value from CheckSerial to the branch that opens the application.',
    hints: [
      'CheckSerial returns EAX = 0 for the supplied invalid key. TEST sets the zero flag when EAX is zero.',
      'JNZ only jumps when ZF = 0. Look at the branch immediately after TEST.',
      'Replace that JNZ with JMP and keep its destination. The short opcode changes from 75 to EB.',
    ],
    rows: compile([
      ...prologue,
      { asm: 'call 00402000', note: 'CheckSerial(user_key)' },
      { asm: 'test eax, eax', note: 'is the key valid?' },
      { asm: 'jnz @unlocked' },
      ...tail,
    ]),
    strings: [
      'Enter your registration key',
      'Unregistered copy',
      'Thanks for registering!',
    ],
    success: 'Registered to: the underground',
    explanation:
      'CheckSerial returned zero, so TEST set ZF to 1. The original JNZ fell through to the registration dialog. JMP always reaches the application, regardless of ZF.',
  },
  {
    id: 'disc',
    name: 'Orbit Racer 2000',
    file: 'ORBIT.EXE',
    year: '2000',
    kind: 'CD-ROM CHECK',
    difficulty: '02 / INTERMEDIATE',
    goal: 'Convince Orbit Racer that its game disc is present. Change the disc check result, or find another working route to the game.',
    hints: [
      'FindGameDisc returns EAX = 0 because the drive is empty. The next instructions inspect AL, the low byte of EAX.',
      'CMP EAX, EAX changes flags but leaves EAX untouched. TEST AL, AL overwrites those flags afterwards.',
      'Replace CMP EAX, EAX with MOV AL, 01. Both occupy two bytes, and TEST will now find a nonzero AL.',
    ],
    rows: compile([
      ...prologue,
      { asm: 'call 00402010', note: 'FindGameDisc("D:\\")' },
      { asm: 'cmp eax, eax', note: 'compare return register' },
      { asm: 'test al, al', note: 'disc found?' },
      { asm: 'jnz @unlocked' },
      ...tail,
    ]),
    strings: [
      'Please insert the Orbit Racer CD-ROM',
      'D:\\ORBIT.DAT',
      'Start your engines',
    ],
    success: 'Disc verified. Start your engines.',
    explanation:
      'MOV AL, 01 sets the low byte of EAX to 1 without changing flags. The following TEST AL, AL clears ZF, allowing JNZ to enter the game. CMP EAX, EAX by itself only sets flags; it never sets EAX.',
  },
  {
    id: 'trial',
    name: 'WaveStudio 2.4',
    file: 'WAVESTUD.EXE',
    year: '2003',
    kind: 'TRIAL + SERIAL',
    difficulty: '03 / ADVANCED',
    goal: 'Open the full studio after the trial has expired. There are two checks: getting past the first one is only half the job.',
    hints: [
      'Trace the program. The trial result is zero and the first JZ leads to the locked dialog.',
      'Both the expiration check and the serial check must be passed. NOP can remove an instruction without shifting addresses.',
      'NOP the JZ after TrialDaysRemaining, then replace the JNZ after CheckSerial with JMP. Shorter patches are automatically padded with NOP.',
    ],
    rows: compile([
      ...prologue,
      { asm: 'call 00402020', note: 'TrialDaysRemaining()' },
      { asm: 'test eax, eax' },
      { asm: 'jz @locked', note: 'trial expired' },
      { asm: 'call 00402000', note: 'CheckSerial(user_key)' },
      { asm: 'test eax, eax' },
      { asm: 'jnz @unlocked' },
      ...tail,
    ]),
    strings: [
      'Your 30-day trial has expired',
      'Please register WaveStudio',
      'Full studio unlocked',
    ],
    success: 'Full studio unlocked. Make some noise.',
    explanation:
      'The trial and serial checks are independent. Removing the first conditional branch allows execution to reach the serial check; changing the second branch to JMP reaches the full studio. Other valid control-flow patches also count.',
  },
];
// Surround the teaching gate with linked, executable routines. Addresses and
// string xrefs are derived from the same source that produces the opcode bytes.
function expandProgram(level: Level) {
  const resources =
    level.id === 'serial'
      ? [
          'PIXELPNT.INI',
          'Software\\PixelSoft\\PixelPaint',
          '*.BMP;*.PCX;*.TGA',
          'Untitled.bmp',
          'PALETTE.DAT',
          'BrushSize',
          'Recent Files',
          'Unable to load palette',
          'TOOLBAR.BMP',
          'Save changes before closing?',
        ]
      : level.id === 'disc'
        ? [
            'ORBIT.INI',
            'Software\\Orbital\\OrbitRacer',
            'TRACK01.DAT',
            'D:\\ORBIT.DAT',
            'DINPUT.DLL',
            'Renderer',
            'Choose a race track',
            'Unable to initialize audio',
            'CAR01.TEX',
            'Quit current race?',
          ]
        : [
            'WAVESTUD.INI',
            'Software\\Waveform\\WaveStudio',
            '*.WAV;*.AIFF',
            'Untitled.wav',
            'WINMM.DLL',
            'SampleRate',
            'Audio device settings',
            'Unable to open audio device',
            'MIXER.DAT',
            'Save session before closing?',
          ];
  const extra = [
    'AppPath',
    'WindowPosition',
    'Language',
    'Default',
    'About',
    'Help contents',
    'README.TXT',
    'Out of memory',
    'Invalid file header',
    'Open recent document',
    'Initializing application',
    'Loading preferences',
    'Creating main window',
    'Releasing resources',
    'Operation completed',
    'Operation cancelled',
    'File not found',
    'Access denied',
    'Unexpected end of file',
    'Please select a file',
  ];
  const strings = Array.from(
    new Set([...level.strings, ...resources, ...extra]),
  );
  let dataAddress = 0x405000;
  const table: StringEntry[] = strings.map((text) => {
    const entry = { address: dataAddress, text, references: [] };
    dataAddress += Math.ceil((text.length + 1) / 4) * 4;
    return entry;
  });
  const ref = (entry: StringEntry): Source => ({
    asm: `push ${hex(entry.address)}`,
    note: `ASCII "${entry.text}"`,
    stringAddress: entry.address,
  });
  const routineNames = [
    'LoadPreferences',
    'OpenResourceArchive',
    'ResolveRenderer',
    'InitializeWindowClass',
    'LoadToolbar',
    'ReadRecentFiles',
    'InitializeDocument',
    'LoadPalette',
    'ConfigureAudio',
    'SaveWindowPlacement',
    'LoadLanguagePack',
    'InitializeStatusBar',
    'OpenHelpFile',
    'ShowAboutDialog',
    'ValidateFileHeader',
    'OpenRecentDocument',
    'TraceStartup',
    'TracePreferences',
    'TraceWindowCreation',
    'ReleaseResources',
    'ReportCompletion',
    'ReportCancellation',
    'ReportFileNotFound',
    'ReportAccessDenied',
    'ReportReadFailure',
    'ShowFilePicker',
    'ResolveApplicationPath',
    'RestoreWindowPosition',
    'ReadLocale',
    'LoadDefaults',
  ];
  const routine = (name: string, i: number): Source[] => {
    const item = table[3 + (i % (table.length - 3))],
      other = table[3 + ((i + 7) % (table.length - 3))],
      prefix = `f${i}`;
    const wrapper = 0x408000 + (i % imports.length) * 16;
    const body: Source[] = [
      {
        asm: 'push ebp',
        label: prefix,
        functionName: name,
        note: `${name} proc near`,
      },
      { asm: 'mov ebp, esp' },
      { asm: 'sub esp, 10' },
      { asm: 'xor eax, eax' },
      { asm: 'mov [ebp-04], eax' },
      ref(item),
      {
        asm: `call ${hex(wrapper)}`,
        note: `shim_${imports[i % imports.length]}`,
      },
      { asm: 'pop ecx', note: 'release wrapper argument' },
      { asm: 'mov [ebp-08], eax' },
      { asm: 'test eax, eax' },
      { asm: `jz @${prefix}_fail` },
    ];
    if (i % 3 === 0)
      body.push(
        { asm: 'mov eax, [ebp-08]' },
        { asm: 'cmp eax, 00000001' },
        { asm: `jnz @${prefix}_fail` },
        ref(other),
        { asm: 'call 00408010', note: 'shim_LoadStringA' },
        { asm: 'pop ecx' },
        { asm: 'mov [ebp-0C], eax' },
        { asm: 'mov eax, [ebp-0C]' },
      );
    else if (i % 3 === 1)
      body.push(
        { asm: 'lea eax, [ebp-10]', note: 'address of local buffer' },
        { asm: 'mov [ebp-0C], eax' },
        ref(other),
        { asm: 'call 00408030', note: 'shim_OutputDebugStringA' },
        { asm: 'pop ecx' },
        { asm: 'mov eax, [ebp-08]' },
      );
    else
      body.push(
        { asm: `mov eax, ${hex(0x100 + i)}`, note: 'resource identifier' },
        { asm: 'mov [ebp-0C], eax' },
        { asm: 'mov eax, [ebp-0C]' },
        { asm: `cmp eax, ${hex(0x100 + i)}` },
        { asm: `jnz @${prefix}_fail` },
        { asm: 'mov eax, 00000001' },
      );
    body.push(
      { asm: `jmp @${prefix}_done` },
      { asm: 'xor eax, eax', label: `${prefix}_fail` },
      { asm: 'mov [ebp-04], eax', label: `${prefix}_done` },
      { asm: 'mov eax, [ebp-04]' },
      { asm: 'add esp, 10' },
      { asm: 'pop ebp' },
      { asm: 'ret', note: `${name} endp` },
    );
    return body;
  };
  const gateName =
    level.id === 'serial'
      ? 'RegistrationDlgProc'
      : level.id === 'disc'
        ? 'DiscCheckDlgProc'
        : 'TrialDlgProc';
  const gate: Source[] = [];
  for (const [i, row] of level.rows.entries()) {
    if (row.asm === 'nop') continue; // Replace artificial NOP padding with surrounding routines.
    const label = `gate_${hex(row.address)}`;
    let entry: StringEntry | undefined;
    if (row.asm === 'call 00402100') entry = table[0];
    if (row.asm === 'call 00402110') entry = table[2];
    if (
      row.asm === 'call 00402000' ||
      row.asm === 'call 00402010' ||
      row.asm === 'call 00402020'
    )
      entry = table[1];
    if (entry)
      gate.push({
        ...ref(entry),
        label,
        functionName: i === 0 ? gateName : undefined,
      });
    gate.push({
      asm: row.asm.replace(
        /^(j\w+) ([0-9A-F]+)$/i,
        (_, op, address) => `${op} @gate_${address}`,
      ),
      note: row.note,
      label: entry ? undefined : label,
      functionName: i === 0 ? gateName : undefined,
    });
    if (entry) gate.push({ asm: 'pop ecx', note: 'release dialog argument' });
  }
  const source: Source[] = [
    {
      asm: 'push ebp',
      label: 'entry',
      functionName: 'WinMain',
      note: 'program entry point',
    },
    { asm: 'mov ebp, esp' },
    ...['f0', 'f1', 'f2', 'f3'].map((label) => ({ asm: `call @${label}` })),
    { asm: `call @gate_${hex(BASE)}`, note: gateName },
    { asm: 'pop ebp' },
    { asm: 'ret', note: 'WinMain endp' },
    ...routineNames.slice(0, 12).flatMap((name, i) => routine(name, i)),
    ...gate,
    ...routineNames.slice(12).flatMap((name, i) => routine(name, i + 12)),
  ];
  level.rows = compile(source);
  if (level.rows.at(-1)!.address >= 0x402000)
    throw Error('Code overlaps API address space.');
  for (const row of level.rows) {
    if (row.stringAddress)
      table
        .find((s) => s.address === row.stringAddress)!
        .references.push(row.address);
    if (row.asm.startsWith('call ')) {
      const target = level.rows.find(
        (r) => r.address === parseInt(row.asm.slice(5), 16),
      );
      if (target) row.note = target.functionName || '';
    }
  }
  level.strings = strings;
  level.stringTable = table;
  level.gateFunction = gateName;
}
levels.forEach(expandProgram);

export function searchCode(level: Level, rows: Row[], query: string): number[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const stringRefs = new Set(
    level.stringTable
      ?.filter(
        (s) =>
          s.text.toLowerCase().includes(q) ||
          hex(s.address).toLowerCase().includes(q),
      )
      .flatMap((s) => s.references),
  );
  return rows
    .filter(
      (r) =>
        stringRefs.has(r.address) ||
        `${hex(r.address)} ${bytesText(r.bytes)} ${r.asm} ${r.note} ${r.functionName || ''}`
          .toLowerCase()
          .includes(q),
    )
    .map((r) => r.address);
}

export function getRows(level: Level, patches: Record<number, string>): Row[] {
  return level.rows.flatMap((r) => {
    if (!patches[r.address]) return [r];
    const replacement = assemble(patches[r.address], r.address);
    if (replacement.length > r.bytes.length)
      throw Error(
        `Patch needs ${replacement.length} bytes; only ${r.bytes.length} available.`,
      );
    const bytes = [
      ...replacement,
      ...Array(r.bytes.length - replacement.length).fill(0x90),
    ];
    return [
      {
        ...r,
        bytes,
        asm:
          decode(
            [...Array(r.address - BASE).fill(0), ...bytes],
            r.address - BASE,
          ).asm + (replacement.length < bytes.length ? ' ; NOP padding' : ''),
      },
    ];
  });
}
export type Frame = {
  address: number;
  asm: string;
  eax: number;
  zf: boolean;
  next: number;
  event: string;
};
export type Result = {
  frames: Frame[];
  success: boolean;
  error: string;
  outcome: string;
};
export function execute(
  level: Level,
  patches: Record<number, string> = {},
): Result {
  const frames: Frame[] = [];
  let eax = 0,
    zf = false,
    pc = 0,
    outcome = 'none',
    ebp = 0;
  const stack: number[] = [],
    calls: { pc: number; depth: number }[] = [];
  const top = 0x12ff00;
  const pop = () => {
    if (!stack.length)
      throw Error('Stack underflow: POP has no matching PUSH.');
    return stack.pop()!;
  };
  const localIndex = (offset: number) => {
    const address = ebp - offset,
      index = (top - address) / 4 - 1;
    if (!Number.isInteger(index) || index < 0 || index >= stack.length)
      throw Error('Local memory access is outside the allocated stack frame.');
    return index;
  };
  try {
    const bytes = getRows(level, patches).flatMap((r) => r.bytes);
    const boundaries = new Set<number>();
    for (let i = 0; i < bytes.length;) {
      boundaries.add(i);
      i += decode(bytes, i).size;
    }
    for (let count = 0; count < 4096; count++) {
      if (!boundaries.has(pc))
        throw Error(
          'Execution jumped outside the program or into the middle of an instruction.',
        );
      const d = decode(bytes, pc);
      let next = pc + d.size,
        event = '',
        complete = false;
      switch (d.op) {
        case 'mov':
          eax = d.value!;
          break;
        case 'mov-al':
          eax = ((eax & 0xffffff00) | d.value!) >>> 0;
          break;
        case 'xor':
          eax = 0;
          zf = true;
          break;
        case 'cmp':
          zf = eax === d.value;
          break;
        case 'cmp-self':
          zf = true;
          break;
        case 'test':
          zf = eax === 0;
          break;
        case 'test-al':
          zf = (eax & 255) === 0;
          break;
        case 'jmp':
          next = d.value! - BASE;
          break;
        case 'jz':
          if (zf) next = d.value! - BASE;
          break;
        case 'jnz':
          if (!zf) next = d.value! - BASE;
          break;
        case 'push':
          stack.push(ebp);
          break;
        case 'push-eax':
          stack.push(eax);
          break;
        case 'push-data':
          stack.push(d.value!);
          break;
        case 'pop':
          ebp = pop();
          break;
        case 'pop-ecx':
          pop();
          break;
        case 'pop-eax':
          eax = pop();
          break;
        case 'frame':
          ebp = top - stack.length * 4;
          break;
        case 'sub-esp':
          stack.push(...Array(d.value! / 4).fill(0));
          zf = top - stack.length * 4 === 0;
          break;
        case 'add-esp':
          if (d.value! / 4 > stack.length)
            throw Error('Stack underflow during ADD ESP.');
          stack.length -= d.value! / 4;
          zf = top - stack.length * 4 === 0;
          break;
        case 'store':
          stack[localIndex(d.value!)] = eax;
          break;
        case 'load':
          eax = stack[localIndex(d.value!)];
          break;
        case 'lea':
          localIndex(d.value!);
          eax = (ebp - d.value!) >>> 0;
          break;
        case 'call': {
          if (boundaries.has(d.value! - BASE)) {
            if (calls.length >= 64)
              throw Error('Call depth exceeded: possible recursive loop.');
            calls.push({ pc: next, depth: stack.length });
            stack.push(BASE + next);
            next = d.value! - BASE;
            event =
              level.rows.find((r) => r.address === d.value)?.functionName ||
              'local function';
            break;
          }
          event = api[d.value!] || '';
          if (!event)
            throw Error(
              'Only local functions and documented simulated API calls are supported.',
            );
          if (d.value! >= 0x408000) {
            eax = 1;
            event = 'shim_' + event + ' → EAX = 1';
          } else if (d.value! < 0x402100) {
            eax = 0;
            event += ' → EAX = 0';
          } else {
            outcome = d.value === 0x402110 ? 'unlocked' : 'locked';
            event += ' → ' + outcome;
          }
          break;
        }
        case 'ret': {
          const caller = calls.pop();
          if (caller) {
            if (stack.length !== caller.depth + 1 || pop() !== BASE + caller.pc)
              throw Error('Unbalanced stack at RET.');
            next = caller.pc;
          } else {
            if (stack.length !== 0) throw Error('Unbalanced stack at RET.');
            complete = true;
          }
          break;
        }
      }
      frames.push({
        address: BASE + pc,
        asm: d.asm,
        eax,
        zf,
        next: BASE + next,
        event,
      });
      if (complete)
        return { frames, success: outcome === 'unlocked', error: '', outcome };
      pc = next;
    }
    throw Error(
      'Execution stopped after 4096 instructions: possible infinite loop.',
    );
  } catch (e) {
    return { frames, success: false, error: (e as Error).message, outcome };
  }
}
