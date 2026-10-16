'use client';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Code2,
  Disc3,
  FileCode2,
  FolderOpen,
  HardDrive,
  Play,
  RotateCcw,
  Save,
  Search,
  SkipForward,
  Terminal,
  X,
} from 'lucide-react';
import {
  assemble,
  bytesText,
  execute,
  getRows,
  hex,
  levels,
  searchCode,
  type Result,
} from '../lib/machine';

export default function Home() {
  const [index, setIndex] = useState(0),
    [patches, setPatches] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<number | null>(null),
    [draft, setDraft] = useState(''),
    [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null),
    [step, setStep] = useState(-1),
    [hint, setHint] = useState(-1);
  const [guide, setGuide] = useState(false),
    [tab, setTab] = useState('disassembly'),
    [search, setSearch] = useState('');
  const [solved, setSolved] = useState<string[]>([]),
    [log, setLog] = useState(
      'Process loaded. Inspect the code, select an instruction, and assemble a patch.',
    );
  const [nativeCapture, setNativeCapture] = useState(false);
  const [stringSearch, setStringSearch] = useState('');
  const codePane = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const runAction = useRef<() => Result>(() => execute(levels[0]));
  const level = levels[index],
    rows = getRows(level, patches),
    original = level.rows.find((r) => r.address === selected);
  const frame = result && step >= 0 ? result.frames[step] : null;
  const finished = !!result && step === result.frames.length - 1,
    won = finished && result.success;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('cracklab-solved') || '[]');
      if (Array.isArray(saved))
        setSolved(saved.filter((s) => levels.some((l) => l.id === s)));
    } catch {}
  }, []);
  const stringMatches =
    level.stringTable?.filter((s) =>
      `${s.text} ${hex(s.address)}`
        .toLowerCase()
        .includes(stringSearch.trim().toLowerCase()),
    ) || [];
  const matches = searchCode(level, rows, search);
  const matchIndex = selected === null ? -1 : matches.indexOf(selected);
  const functions = rows.filter(
    (r, i) => i === 0 || r.functionName !== rows[i - 1].functionName,
  );
  function jumpTo(address: number) {
    const row = rows.find((r) => r.address === address);
    if (!row) return;
    setTab('disassembly');
    setSelected(address);
    setDraft(patches[address] || row.asm);
    setError('');
  }
  function nextMatch(direction = 1) {
    if (!matches.length) return;
    const n =
      matchIndex < 0
        ? direction > 0
          ? 0
          : matches.length - 1
        : (matchIndex + direction + matches.length) % matches.length;
    jumpTo(matches[n]);
  }
  function jumpToReference(address: number, text: string) {
    setSearch('');
    jumpTo(address);
    setLog(
      `String reference: "${text}" at ${hex(address)}. Surrounding code is preserved.`,
    );
  }
  function followTarget(asm: string) {
    const target = asm.match(/^(?:j\w+|call) ([0-9a-f]+)/i);
    if (target) {
      const address = parseInt(target[1], 16);
      if (rows.some((r) => r.address === address)) {
        setSearch('');
        jumpTo(address);
      } else setLog('This call targets a simulated external API wrapper.');
    }
  }
  useEffect(() => {
    if (tab !== 'disassembly' || selected === null) return;
    const pane = codePane.current,
      node = pane?.querySelector<HTMLElement>(`[data-address="${selected}"]`);
    if (pane && node)
      pane.scrollTop +=
        node.getBoundingClientRect().top -
        pane.getBoundingClientRect().top -
        pane.clientHeight / 2 +
        node.clientHeight / 2;
  }, [selected, tab, index]);
  useEffect(() => {
    if (tab === 'disassembly' && search.trim()) {
      const found = searchCode(level, rows, search);
      if (found.length) jumpTo(found[0]);
    }
  }, [search, index]);
  function changeLevel(i: number) {
    setIndex(i);
    setPatches({});
    setDraft('');
    setSelected(null);
    setResult(null);
    setStep(-1);
    setHint(-1);
    setError('');
    setSearch('');
    setStringSearch('');
    setTab('disassembly');
    setLog(`Loaded ${levels[i].file}. Original bytes restored.`);
  }
  function resetProgress(all = false) {
    const next = all ? [] : solved.filter((id) => id !== level.id);
    setSolved(next);
    try {
      localStorage.setItem('cracklab-solved', JSON.stringify(next));
    } catch {}
    changeLevel(all ? 0 : index);
    if (codePane.current) codePane.current.scrollTop = 0;
    setLog(all ? 'New game started. All progress and patches cleared.' : 'Case reset. Completion and patches cleared.');
  }
  function run(single = false) {
    const r = execute(level, patches);
    const n = single
      ? result
        ? Math.min(step + 1, r.frames.length - 1)
        : 0
      : r.frames.length - 1;
    setResult(r);
    setStep(n);
    setLog(
      r.error
        ? `FAULT: ${r.error}`
        : single && n < r.frames.length - 1
          ? `Stepped ${hex(r.frames[n].address)}. ${r.frames[n].event || r.frames[n].asm}`
          : r.success
            ? 'SUCCESS: The patched application reached its unlocked state.'
            : `Program exited. ${index === 1 ? 'The disc is still missing.' : 'The application is still locked.'}`,
    );
    if (n === r.frames.length - 1 && r.success) {
      const next = Array.from(new Set([...solved, level.id]));
      setSolved(next);
      try {
        localStorage.setItem('cracklab-solved', JSON.stringify(next));
      } catch {}
    }
  }
  runAction.current = () => {
    const r = execute(level, patches);
    flushSync(() => run());
    return r;
  };
  useEffect(() => {
    type Context = {
      registerTool: (
        tool: {
          name: string;
          description: string;
          inputSchema: object;
          annotations: object;
          execute: (input: unknown) => unknown;
        },
        options: { signal: AbortSignal },
      ) => void | Promise<void>;
    };
    const context = (document as Document & { modelContext?: Context })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      Promise.resolve(
        context.registerTool(
          {
            name: 'run_crackme',
            description:
              'Run the current crackme with its staged patches and update the visible debugger and application outcome.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: false },
            execute: (args: unknown) => {
              if (
                !args ||
                typeof args !== 'object' ||
                Array.isArray(args) ||
                Object.keys(args).length
              )
                throw Error('Expected an empty object.');
              const r = runAction.current();
              return {
                success: r.success,
                outcome: r.outcome,
                error: r.error,
                instructions: r.frames.length,
              };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => lifecycle.abort();
  }, []);
  function apply() {
    if (selected === null || !original) return;
    try {
      const b = assemble(draft, selected);
      if (b.length > original.bytes.length)
        throw Error(
          `This instruction needs ${b.length} bytes. The selected slot holds ${original.bytes.length}.`,
        );
      const p = { ...patches, [selected]: draft };
      getRows(level, p);
      setPatches(p);
      setResult(null);
      setStep(-1);
      setError('');
      setLog(
        `Patched ${hex(selected)}: ${bytesText(original.bytes)} → ${bytesText(b)}${b.length < original.bytes.length ? ' + NOP padding' : ''}`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function revert() {
    if (selected === null) return;
    const p = { ...patches };
    delete p[selected];
    setPatches(p);
    setResult(null);
    setStep(-1);
    setDraft(original?.asm || '');
    setError('');
    setLog('Selected instruction restored.');
  }
  function download() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            format: 'cracklab-patch-v1',
            target: level.file,
            patches: Object.entries(patches).map(([a, asm]) => ({
              address: hex(+a),
              original: bytesText(
                level.rows.find((r) => r.address === +a)!.bytes,
              ),
              replacement: bytesText(rows.find((r) => r.address === +a)!.bytes),
              assembly: asm,
            })),
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${level.id}.patch.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setLog(
      'Patch manifest exported. This manifest targets the browser fixture.',
    );
  }
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Cracklab home">
          <span className="brand-icon">
            <Terminal size={23} />
          </span>
          CRACK<span>LAB</span>
          <small>’97</small>
        </a>
        <div className="top-note">THE REVERSE ENGINEERING PLAYGROUND</div>
        <button className="quiet" onClick={() => setGuide(true)}>
          <BookOpen size={16} /> Field manual
        </button>
        <span className="local">
          <i /> LOCAL SESSION
        </span>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="side-heading">
            YOUR CASE FILES <span>03</span>
          </div>
          <h1>
            A few bytes.
            <br />A different ending.
          </h1>
          <p className="intro">
            Find the check. Change the code.
            <br />
            See what happens.
          </p>
          <div className="case-list">
            {levels.map((l, i) => (
              <button
                key={l.id}
                onClick={() => changeLevel(i)}
                className={`case ${i === index ? 'active' : ''}`}
              >
                <div className="case-top">
                  <span className="case-number">0{i + 1}</span>
                  <span>{l.year}</span>
                  {solved.includes(l.id) ? (
                    <Check size={15} className="mint" />
                  ) : (
                    <FileCode2 size={15} />
                  )}
                </div>
                <strong>{l.name}</strong>
                <span className="case-file">{l.file}</span>
                <div className="case-bottom">
                  <span>{l.kind}</span>
                  <ChevronRight size={14} />
                </div>
              </button>
            ))}
          </div>
          <div className="progress">
            <div>
              <span>LAB PROGRESS</span>
              <strong>{solved.length} / 3</strong>
            </div>
            <div className="progress-track">
              <span style={{ width: `${(solved.length / 3) * 100}%` }} />
            </div>
            <p>
              {solved.length === 3
                ? 'All cases closed. Nicely patched.'
                : 'Every check has a story.'}
            </p>
          </div>
          <div className="sidebar-foot">
            <HardDrive size={16} />
            <span>
              Fictional software. Real opcodes.
              <br />
              <small>x86-32 · simulated environment</small>
            </span>
          </div>
        </aside>
        <main>
          <div className="breadcrumb">
            <FolderOpen size={14} /> crackmes <ChevronRight size={12} />
            <span>{level.file.toLowerCase()}</span>
          </div>
          <section className="case-header">
            <div>
              <div className="eyebrow">
                CASE 0{index + 1} <span>/</span>{' '}
                {level.difficulty.split(' / ')[1]}
              </div>
              <h2>
                {level.name}
                <span className="year">{level.year}</span>
              </h2>
            </div>
            <span className={`status ${won || solved.includes(level.id) ? 'unlocked' : ''}`}>
              <i />
              {won ? 'UNLOCKED' : solved.includes(level.id) ? 'SOLVED' : 'AWAITING PATCH'}
            </span>
          </section>
          <section className="mission">
            <span className="mission-icon">↳</span>
            <div>
              <strong>THE OBJECTIVE</strong>
              <p>{level.goal}</p>
            </div>
            <button onClick={() => setHint(Math.min(hint + 1, 2))}>
              Need a hint? <span>{hint < 0 ? '↗' : `${hint + 1}/3`}</span>
            </button>
          </section>
          {hint >= 0 && (
            <div className="hint">
              <BookOpen size={17} />
              <span>
                <b>Hint {hint + 1}.</b> {level.hints[hint]}
              </span>
              <button aria-label="Close hint" onClick={() => setHint(-1)}>
                <X size={15} />
              </button>
            </div>
          )}
          <div className="lab-grid">
            <section className="debugger panel">
              <div className="panel-heading">
                <span>
                  <Code2 size={16} /> DISASSEMBLER
                </span>
                <span className="dim">x86 · 32-bit</span>
              </div>
              <div className="debug-tabs">
                <button
                  className={tab === 'disassembly' ? 'chosen' : ''}
                  onClick={() => setTab('disassembly')}
                >
                  .text
                </button>
                <button
                  className={tab === 'strings' ? 'chosen' : ''}
                  onClick={() => setTab('strings')}
                >
                  Strings <span>{level.strings.length}</span>
                </button>
                <button
                  className={tab === 'trace' ? 'chosen' : ''}
                  onClick={() => setTab('trace')}
                >
                  Execution trace
                </button>
                <span className="tab-right">{rows.length} instructions</span>
              </div>
              <div className="search">
                <Search size={14} />
                <input
                  aria-label={
                    tab === 'strings' ? 'Search strings' : 'Find in disassembly'
                  }
                  placeholder={
                    tab === 'strings'
                      ? 'Search ASCII strings…'
                      : 'Find string, instruction, address…'
                  }
                  value={tab === 'strings' ? stringSearch : search}
                  onChange={(e) =>
                    tab === 'strings'
                      ? setStringSearch(e.target.value)
                      : setSearch(e.target.value)
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (tab === 'strings') {
                        const first = stringMatches[0];
                        if (first?.references.length)
                          jumpToReference(first.references[0], first.text);
                      } else nextMatch(e.shiftKey ? -1 : 1);
                    }
                    if (e.key === 'Escape') {
                      setSearch('');
                      setStringSearch('');
                    }
                  }}
                />
                {tab !== 'strings' && search.trim() && (
                  <>
                    <span role="status">
                      {matches.length
                        ? `${matchIndex + 1} / ${matches.length}`
                        : 'No matches'}
                    </span>
                    <button
                      onClick={() => nextMatch(-1)}
                      disabled={!matches.length}
                      aria-label="Previous match"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => nextMatch(1)}
                      disabled={!matches.length}
                      aria-label="Next match"
                    >
                      ↓
                    </button>
                  </>
                )}
                <span>{tab === 'strings' ? '.rdata' : 'FIND'}</span>
              </div>
              {tab === 'disassembly' ? (
                <>
                  <div className="function-nav">
                    <label htmlFor="function">FUNCTION</label>
                    <select
                      id="function"
                      value={original?.functionName || ''}
                      onChange={(e) => {
                        const row = functions.find(
                          (r) => r.functionName === e.target.value,
                        );
                        if (row) {
                          setSearch('');
                          jumpTo(row.address);
                        }
                      }}
                    >
                      <option value="" disabled>
                        Browse {functions.length} functions…
                      </option>
                      {functions.map((r) => (
                        <option key={r.address} value={r.functionName}>
                          {hex(r.address)} · {r.functionName}
                        </option>
                      ))}
                    </select>
                    <span>Double-click a branch to follow</span>
                  </div>
                  <div className="code-scroll" ref={codePane}>
                    <div className="code-labels">
                      <span>ADDRESS</span>
                      <span>OPCODES</span>
                      <span>INSTRUCTION</span>
                      <span>COMMENT / REFERENCE</span>
                    </div>
                    {rows.map((r, i) => (
                      <div key={r.address}>
                        {(i === 0 ||
                          r.functionName !== rows[i - 1].functionName) && (
                          <div className="function-label">
                            {r.functionName}{' '}
                            <span>────────────────────────</span>
                          </div>
                        )}
                        <button
                          data-address={r.address}
                          aria-label={`Patch ${hex(r.address)} ${r.asm}`}
                          className={`code-row ${selected === r.address ? 'selected' : ''} ${patches[r.address] ? 'patched' : ''} ${frame?.address === r.address ? 'executing' : ''} ${matches.includes(r.address) ? 'search-match' : ''}`}
                          onClick={() => jumpTo(r.address)}
                          onDoubleClick={() => followTarget(r.asm)}
                        >
                          <span className="address">
                            {frame?.address === r.address
                              ? '▸'
                              : patches[r.address]
                                ? '•'
                                : ' '}
                            {hex(r.address)}
                          </span>
                          <span className="bytes">{bytesText(r.bytes)}</span>
                          <span
                            className={`instruction ${r.asm.startsWith('j') ? 'branch' : r.asm.startsWith('call') ? 'call' : ''}`}
                          >
                            <b>{r.asm.split(' ')[0]}</b>{' '}
                            {r.asm.includes(' ')
                              ? r.asm.substring(r.asm.indexOf(' ') + 1)
                              : ''}
                          </span>
                          <span
                            className={`comment ${r.stringAddress ? 'string-ref' : ''}`}
                          >
                            {r.note && `; ${r.note}`}
                          </span>
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              ) : tab === 'strings' ? (
                <div className="alternate-view string-list">
                  <div className="string-table-heading">
                    .rdata · ASCII strings and code cross-references
                  </div>
                  {stringMatches.map((s) => (
                    <div className="string-entry" key={s.address}>
                      <button
                        className="string-link"
                        onClick={() => jumpToReference(s.references[0], s.text)}
                        disabled={!s.references.length}
                      >
                        <span>{hex(s.address)}</span>
                        <b>"{s.text}"</b>
                        <ArrowRight size={14} />
                      </button>
                      <div className="xref-list">
                        <span>
                          {s.references.length} XREF
                          {s.references.length === 1 ? '' : 'S'}
                        </span>
                        {s.references.map((address) => (
                          <button
                            key={address}
                            title={
                              rows.find((r) => r.address === address)
                                ?.functionName
                            }
                            onClick={() => jumpToReference(address, s.text)}
                          >
                            {hex(address)}{' '}
                            <small>
                              {
                                rows.find((r) => r.address === address)
                                  ?.functionName
                              }
                            </small>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {!stringMatches.length && (
                    <p className="dim">No strings match “{stringSearch}”.</p>
                  )}
                </div>
              ) : (
                <div className="alternate-view trace">
                  {!result ? (
                    <p>
                      Run or step the program to inspect its execution path.
                    </p>
                  ) : (
                    result.frames.slice(0, step + 1).map((f, i) => (
                      <div key={i}>
                        <button
                          className="trace-address"
                          onClick={() => {
                            setSearch('');
                            jumpTo(f.address);
                          }}
                        >
                          {hex(f.address)}
                        </button>
                        <b>{f.asm}</b>
                        <small>
                          EAX {hex(f.eax)} · ZF {+f.zf}
                        </small>
                        {f.event && <em>{f.event}</em>}
                      </div>
                    ))
                  )}
                </div>
              )}
              <div className="debug-footer">
                <span>
                  <i className="legend-dot" /> Select to patch · double-click to
                  follow
                </span>
                <span>{Object.keys(patches).length} modified</span>
              </div>
            </section>
            <div className="right-column">
              <section className="preview panel">
                <div className="panel-heading">
                  <span>
                    <span className="live-dot" /> APPLICATION PREVIEW
                  </span>
                  <span className="dim">{won ? 'RUNNING' : 'PAUSED'}</span>
                </div>
                <div className={`desktop desktop-${level.id}`}>
                  <div className="desktop-label">
                    {index === 0
                      ? 'PIXELPAINT PROFESSIONAL'
                      : index === 1
                        ? 'ORBIT RACER 2000'
                        : 'WAVESTUDIO AUDIO WORKSTATION'}
                  </div>
                  <div className="win" hidden={nativeCapture && !won}>
                    <div className="win-title">
                      <span>
                        {index === 1 ? '◉' : '▧'} {level.name}
                      </span>
                      <span className="win-controls" aria-hidden="true">
                        _ ▢ ×
                      </span>
                    </div>
                    <div className="win-menu">File　 Edit　 View　 Help</div>
                    {won ? (
                      <div className="win-content win-success">
                        <div className="success-icon">✓</div>
                        <b>
                          {index === 0
                            ? 'Thank you for registering!'
                            : index === 1
                              ? 'CD-ROM detected'
                              : 'Welcome to the full version!'}
                        </b>
                        <p>{level.success}</p>
                        <div className="win-button">
                          {index === 1
                            ? 'Race ready'
                            : 'All features available'}
                        </div>
                      </div>
                    ) : (
                      <div className="win-content">
                        <div className="dialog-heading">
                          <span className="dialog-icon">
                            {index === 1 ? (
                              <Disc3 size={34} />
                            ) : index === 2 ? (
                              '⌛'
                            ) : (
                              '🔑'
                            )}
                          </span>
                          <strong>
                            {index === 0
                              ? 'Unregistered version'
                              : index === 1
                                ? 'Please insert the CD-ROM'
                                : 'Your trial has expired'}
                          </strong>
                        </div>
                        <p>
                          {index === 0
                            ? 'This copy of PixelPaint Pro is not registered. Please enter your registration key to continue.'
                            : index === 1
                              ? 'Insert the original Orbit Racer 2000 game disc into drive D: and try again.'
                              : 'Your 30-day evaluation period has ended. Register now to keep using WaveStudio.'}
                        </p>
                        {index === 0 && (
                          <>
                            <label htmlFor="serial">Registration key:</label>
                            <input
                              id="serial"
                              className="serial"
                              value="0000-0000-0000-0000"
                              readOnly
                            />
                          </>
                        )}
                        <div className="win-actions">
                          <button onClick={() => run()}>
                            {index === 1 ? 'Retry' : 'Register'}
                          </button>
                          <button
                            onClick={() =>
                              setLog(
                                'The application remains paused at its protection dialog. Patch the code, then run it again.',
                              )
                            }
                          >
                            Cancel
                          </button>
                        </div>
                        <div className="win-copyright">
                          © {level.year}{' '}
                          {index === 0
                            ? 'PixelSoft'
                            : index === 1
                              ? 'Orbital Interactive'
                              : 'Waveform Software'}
                        </div>
                      </div>
                    )}
                  </div>
                  {nativeCapture && !won && (
                    <img
                      className="native-capture"
                      src={`/captures/case${index}.png`}
                      alt={`Screenshot of the actual Visual Studio compiled ${level.name} protection dialog`}
                      width={405}
                      height={280}
                    />
                  )}
                  <div className="desktop-taskbar">
                    <b>▦ Start</b>
                    <span>{level.name}</span>
                    <time>23:47</time>
                  </div>
                </div>
                <div className="preview-caption">
                  <span className="live-dot" />{' '}
                  {nativeCapture && !won
                    ? 'Native Win32 screenshot · MSVC /Od'
                    : 'Live reconstruction'}
                  <button onClick={() => setNativeCapture(!nativeCapture)}>
                    {nativeCapture ? 'Live preview' : 'Native capture'}
                  </button>
                </div>
              </section>
              <section className="registers panel">
                <div className="panel-heading">
                  <span>CPU STATE</span>
                  <span className="dim">
                    {frame ? 'AFTER INSTRUCTION' : 'READY'}
                  </span>
                </div>
                <div className="register-values">
                  <div>
                    <span>EAX</span>
                    <b>{hex(frame?.eax || 0)}</b>
                  </div>
                  <div>
                    <span>EIP</span>
                    <b>{hex(frame?.next || 0x401000)}</b>
                  </div>
                  <div>
                    <span>ZF</span>
                    <b className="mint">{frame ? +frame.zf : '—'}</b>
                  </div>
                </div>
              </section>
            </div>
          </div>
          <section className="patch-panel panel">
            <div className="patch-title">
              <span className="patch-symbol">⌁</span>
              <div>
                <h3>Patch instruction</h3>
                <span>
                  {selected !== null
                    ? `${hex(selected)} · ${original?.bytes.length} byte slot`
                    : 'Select a line in the disassembler'}
                </span>
              </div>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                apply();
              }}
            >
              <label className="sr-only" htmlFor="patch">
                Replacement assembly
              </label>
              <input
                id="patch"
                ref={input}
                disabled={!original}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="e.g. jmp 00401023"
                spellCheck={false}
                autoComplete="off"
              />
              <button className="assemble" disabled={!original}>
                Assemble <span>↵</span>
              </button>
            </form>
            <button
              className="icon-btn"
              title="Restore selected instruction"
              aria-label="Restore selected instruction"
              disabled={selected === null || !patches[selected]}
              onClick={revert}
            >
              <RotateCcw size={17} />
            </button>
            {error && (
              <p className="patch-error" role="alert">
                {error}
              </p>
            )}
          </section>
          <div className="actions">
            <div>
              <button className="run" onClick={() => run()}>
                <Play size={16} fill="currentColor" /> Run patched program
              </button>
              <button className="secondary" onClick={() => run(true)}>
                <SkipForward size={16} /> Step
              </button>
              <button className="quiet" onClick={() => resetProgress()}>
                <RotateCcw size={15} /> Reset case
              </button>
              <button className="quiet" onClick={() => resetProgress(true)}>
                <RotateCcw size={15} /> Reset all progress
              </button>
            </div>
            <button
              className="quiet"
              disabled={!Object.keys(patches).length}
              onClick={download}
            >
              <Save size={15} /> Export patch
            </button>
          </div>
          <div
            className={`console ${won ? 'success-console' : ''}`}
            role="status"
          >
            <span>{won ? '✓' : '>'}</span>
            <p>{log}</p>
            <span className="console-label">OUTPUT</span>
          </div>
          {won && (
            <section className="debrief">
              <div>
                <div className="eyebrow">CASE CLOSED</div>
                <h3>Small patch. Full access.</h3>
                <p>
                  <b>One solution:</b> {level.explanation}
                </p>
              </div>
              {index < 2 ? (
                <button className="run" onClick={() => changeLevel(index + 1)}>
                  Next case <ArrowRight size={16} />
                </button>
              ) : (
                <span className="mint">
                  {solved.length === 3
                    ? 'All three cases solved.'
                    : 'Final case solved.'}
                </span>
              )}
            </section>
          )}
          <footer>
            <span>CRACKLAB / OFFLINE UNDERGROUND</span>
            <span>No downloads. No targets. Just you and the jump.</span>
            <span>EST. 1997 / REBUILT TODAY</span>
          </footer>
        </main>
      </div>
      {guide && (
        <div className="modal-backdrop" onClick={() => setGuide(false)}>
          <section
            className="manual"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setGuide(false);
              if (e.key === 'Tab') {
                const buttons = e.currentTarget.querySelectorAll('button');
                const first = buttons[0],
                  last = buttons[buttons.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first.focus();
                }
              }
            }}
          >
            <button
              autoFocus
              className="close-manual"
              aria-label="Close field manual"
              onClick={() => setGuide(false)}
            >
              <X />
            </button>
            <div className="eyebrow">THE FIELD MANUAL</div>
            <h2 id="manual-title">Follow the flags.</h2>
            <p>
              Select an instruction, edit its assembly, then press Assemble. Run
              the program to test your patch, or Step to inspect registers after
              each instruction. Find searches the complete listing without
              hiding code; Enter/Shift+Enter cycles matches. In Strings, select
              a string or one of its XREF addresses to jump to its use.
              Double-click a branch or local call to follow its destination.
            </p>
            <dl>
              <dt>JNZ address / JNE address</dt>
              <dd>
                Jump if ZF is 0. Often follows a TEST of a boolean result.
              </dd>
              <dt>JZ address / JE address</dt>
              <dd>Jump if ZF is 1.</dd>
              <dt>JMP address</dt>
              <dd>Always jump. Uses a signed 8-bit relative displacement.</dd>
              <dt>TEST EAX, EAX / TEST AL, AL</dt>
              <dd>
                Set ZF if the register is zero; leave the register unchanged.
              </dd>
              <dt>CMP EAX, EAX</dt>
              <dd>Set ZF to 1. Does not write to EAX.</dd>
              <dt>MOV AL, 01 / MOV EAX, 00000001</dt>
              <dd>
                Write a value without changing flags. AL is the low 8 bits of
                EAX.
              </dd>
              <dt>NOP</dt>
              <dd>
                Do nothing. Short patches are padded to the original slot size.
              </dd>
            </dl>
            <p>
              Also supported: CMP EAX, immediate; XOR EAX, EAX; PUSH EBP; MOV
              EBP, ESP; POP EBP; RET; PUSH immediate; PUSH/POP EAX; POP ECX;
              SUB/ADD ESP; EBP-relative MOV/LEA; CALL to local functions or
              simulated import wrappers. All numeric literals are hexadecimal.
            </p>
            <div className="manual-note">
              This is a small x86-32 interpreter, not a full PC emulator.
              Programs contain linked startup, resource, configuration, and
              dialog routines. Import wrappers have simplified, deterministic
              behavior rather than full Windows API semantics. Browser fixtures
              are hand-assembled; previews are interactive reconstructions.
              Native Visual Studio crackme source and build instructions are
              included separately in the project.
            </div>
            <button className="run" onClick={() => setGuide(false)}>
              Back to the debugger <ArrowRight size={16} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
