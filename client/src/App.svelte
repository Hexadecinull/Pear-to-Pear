<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from './lib/stores';
  import { startSession, regenerateCode, bondWithCode, leaveBond } from './lib/session';
  import {
    validateSelection,
    sendFiles,
    acceptIncoming,
    declineIncoming,
    cancelActiveTransfer,
    returnToIdle,
  } from './lib/transfer';
  import { formatBytes, formatSpeed, formatDuration, formatCode } from './lib/format';

  let peerCodeInput = $state('');
  let selectedFiles = $state<File[]>([]);
  let dragActive = $state(false);
  let pickerNotice = $state<string | null>(null);
  let copyFeedback = $state(false);
  let speedBps = $state(0);
  let etaSeconds = $state(0);

  onMount(() => {
    void startSession();
  });

  // Samples transfer progress on a fixed interval rather than reacting to
  // every single chunk (which would fire hundreds of times a second) -
  // this effect intentionally reads no reactive state synchronously, so
  // it mounts once and never re-runs.
  $effect(() => {
    let lastBytes = 0;
    let lastTime = performance.now();
    const interval = setInterval(() => {
      const now = performance.now();
      const bytes = $appState.transfer.bytesDone;
      const dt = (now - lastTime) / 1000;
      if ($appState.transfer.phase === 'transferring' && dt > 0) {
        const rate = (bytes - lastBytes) / dt;
        speedBps = rate;
        const remaining = $appState.transfer.totalBytes - bytes;
        etaSeconds = rate > 0 ? remaining / rate : Infinity;
      } else {
        speedBps = 0;
        etaSeconds = 0;
      }
      lastBytes = bytes;
      lastTime = now;
    }, 500);
    return () => clearInterval(interval);
  });

  let connectionLabel = $derived(
    $appState.connection === 'connecting'
      ? 'Connecting\u2026'
      : $appState.connection === 'connected'
        ? 'Connected'
        : 'Disconnected',
  );
  let selectedTotalBytes = $derived(selectedFiles.reduce((sum, f) => sum + f.size, 0));
  let overallPct = $derived(
    $appState.transfer.totalBytes > 0
      ? Math.min(100, ($appState.transfer.bytesDone / $appState.transfer.totalBytes) * 100)
      : 0,
  );
  let sendDisabled = $derived(
    selectedFiles.length === 0 ||
      selectedFiles.length > $appState.limits.maxFiles ||
      selectedTotalBytes > $appState.limits.maxTotalBytes,
  );

  async function copyCode() {
    try {
      await navigator.clipboard.writeText($appState.myCode);
      copyFeedback = true;
      setTimeout(() => (copyFeedback = false), 1500);
    } catch {
      // Clipboard API can be unavailable; the code is still selectable by hand.
    }
  }

  function submitPeerCode() {
    if (!peerCodeInput.trim()) return;
    bondWithCode(peerCodeInput);
  }

  function handleDisconnect() {
    leaveBond();
  }

  function addFiles(newFiles: File[]) {
    const combined = [...selectedFiles, ...newFiles];
    const { maxFiles, maxTotalBytes } = $appState.limits;
    if (combined.length > maxFiles) {
      pickerNotice = `You can select up to ${maxFiles} files at once \u2014 kept the first ${maxFiles}.`;
      selectedFiles = combined.slice(0, maxFiles);
    } else {
      selectedFiles = combined;
    }
    const total = selectedFiles.reduce((sum, f) => sum + f.size, 0);
    if (total > maxTotalBytes) {
      pickerNotice = `That's ${formatBytes(total)} total \u2014 the limit is ${formatBytes(maxTotalBytes)}. Remove some files.`;
    } else if (combined.length <= maxFiles) {
      pickerNotice = null;
    }
  }

  function onFilesChosen(list: FileList | null) {
    if (!list) return;
    addFiles(Array.from(list));
  }

  function onDragOver(event: DragEvent) {
    event.preventDefault();
    dragActive = true;
  }

  function onDragLeave(event: DragEvent) {
    event.preventDefault();
    dragActive = false;
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragActive = false;
    const items = event.dataTransfer?.items;
    const incoming: File[] = [];
    let sawFolder = false;

    if (items && items.length > 0) {
      for (const item of Array.from(items)) {
        const entry = (
          item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory: boolean } | null }
        ).webkitGetAsEntry?.();
        if (entry && entry.isDirectory) {
          sawFolder = true;
          continue;
        }
        const file = item.getAsFile();
        if (file) incoming.push(file);
      }
    } else if (event.dataTransfer?.files) {
      incoming.push(...Array.from(event.dataTransfer.files));
    }

    if (sawFolder) {
      pickerNotice = 'Folders aren\u2019t supported \u2014 drop individual files instead.';
    }
    addFiles(incoming);
  }

  function removeFile(index: number) {
    selectedFiles = selectedFiles.filter((_, i) => i !== index);
    pickerNotice = null;
  }

  function clearFiles() {
    selectedFiles = [];
    pickerNotice = null;
  }

  function handleSend() {
    const validation = validateSelection(selectedFiles);
    if (!validation.ok) {
      pickerNotice = validation.error;
      return;
    }
    void sendFiles(selectedFiles);
    selectedFiles = [];
  }

  function handleReceive() {
    void acceptIncoming();
  }

  function handleDecline() {
    declineIncoming();
  }

  function handleCancel() {
    cancelActiveTransfer('Cancelled by user.');
  }

  function handleDone() {
    returnToIdle();
  }
</script>

<div class="shell">
  <header class="topbar">
    <div class="brand">
      <img src="/favicon.svg" alt="" class="brand-mark" />
      <span class="brand-name">Pear-to-Pear</span>
    </div>
    <div class="conn">
      <span
        class="dot"
        class:connected={$appState.connection === 'connected'}
        class:disconnected={$appState.connection === 'disconnected'}
      ></span>
      {connectionLabel}
    </div>
  </header>

  <main class="stage">
    {#if $appState.bond !== 'bonded' || $appState.channel !== 'ready'}
      <section class="bond-card">
        <div class="node-pair">
          <div class="node">
            <h2>You</h2>
            <code class="peer-code">{formatCode($appState.myCode) || '\u2026'}</code>
            <div class="node-actions">
              <button onclick={copyCode}>{copyFeedback ? 'Copied' : 'Copy code'}</button>
              <button onclick={regenerateCode} disabled={$appState.bond !== 'idle'}>Regenerate</button>
            </div>
          </div>

          <div class="link-line" class:active={$appState.bond !== 'idle'} aria-hidden="true"></div>

          <div class="node">
            <h2>Peer</h2>
            {#if $appState.bond === 'bonded'}
              <p class="hint">Securing connection\u2026</p>
            {:else}
              <input
                class="code-input"
                placeholder="paste your peer's code"
                bind:value={peerCodeInput}
                maxlength={64}
                spellcheck="false"
                autocomplete="off"
                onkeydown={(e) => e.key === 'Enter' && submitPeerCode()}
              />
              <div class="node-actions">
                <button class="primary" onclick={submitPeerCode} disabled={$appState.bond === 'bonding'}>
                  {$appState.bond === 'bonding' ? 'Connecting\u2026' : 'Connect'}
                </button>
              </div>
            {/if}
          </div>
        </div>
        {#if $appState.bondError}
          <p class="error-text">{$appState.bondError}</p>
        {/if}
      </section>

      <ul class="trust-chips">
        <li>No accounts</li>
        <li>End-to-end encrypted</li>
        <li>Nothing stored</li>
        <li>Open source \u00b7 GPL-3.0</li>
      </ul>
    {:else}
      <section class="connected-bar">
        <div class="connected-info">
          <span class="badge" class:direct={$appState.channelIsDirect}>
            {$appState.channelIsDirect ? 'Direct P2P' : 'Relayed \u00b7 encrypted'}
          </span>
          {#if $appState.verificationCode}
            <details class="verify">
              <summary>Security code: {$appState.verificationCode}</summary>
              <p>
                Read this number to your peer over another channel (voice, chat) to rule out a
                tampered connection. It's derived from both sides' one-time keys, so it only
                matches if you're really talking to each other.
              </p>
            </details>
          {/if}
        </div>
        {#if $appState.transfer.phase === 'idle'}
          <button class="ghost" onclick={handleDisconnect}>Disconnect</button>
        {/if}
      </section>

      {#if $appState.transfer.phase === 'idle'}
        <section class="picker">
          <label
            class="dropzone"
            class:active={dragActive}
            ondragover={onDragOver}
            ondragleave={onDragLeave}
            ondrop={onDrop}
          >
            <input
              type="file"
              multiple
              class="visually-hidden"
              onchange={(e) => onFilesChosen((e.target as HTMLInputElement).files)}
            />
            <span class="dropzone-title">Drop files here</span>
            <span class="dropzone-sub">
              or click to browse \u2014 up to {$appState.limits.maxFiles} files, {formatBytes(
                $appState.limits.maxTotalBytes,
              )} total. No folders.
            </span>
          </label>

          {#if pickerNotice}
            <p class="warn-text">{pickerNotice}</p>
          {/if}

          {#if selectedFiles.length > 0}
            <ul class="file-list">
              {#each selectedFiles as file, i (file.name + i)}
                <li>
                  <span class="file-name">{file.name}</span>
                  <span class="file-size">{formatBytes(file.size)}</span>
                  <button class="icon-btn" onclick={() => removeFile(i)} aria-label="Remove {file.name}"
                    >\u00d7</button
                  >
                </li>
              {/each}
            </ul>
            <div class="picker-summary">
              <span
                >{selectedFiles.length} / {$appState.limits.maxFiles} files \u00b7 {formatBytes(
                  selectedTotalBytes,
                )} / {formatBytes($appState.limits.maxTotalBytes)}</span
              >
              <div class="picker-actions">
                <button class="ghost" onclick={clearFiles}>Clear</button>
                <button class="primary" onclick={handleSend} disabled={sendDisabled}>
                  Send {selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          {/if}
        </section>
      {:else if $appState.transfer.phase === 'awaiting-peer' && $appState.transfer.role === 'receiver'}
        <section class="incoming">
          <h2>Incoming transfer</h2>
          <p class="hint">
            {$appState.transfer.files.length} file{$appState.transfer.files.length === 1 ? '' : 's'} \u00b7 {formatBytes(
              $appState.transfer.totalBytes,
            )}
          </p>
          <ul class="file-list">
            {#each $appState.transfer.files as f, i (i)}
              <li>
                <span class="file-name">{f.name}</span>
                <span class="file-size">{formatBytes(f.size)}</span>
              </li>
            {/each}
          </ul>
          <div class="picker-actions">
            <button class="ghost" onclick={handleDecline}>Decline</button>
            <button class="primary" onclick={handleReceive}>Receive</button>
          </div>
        </section>
      {:else if $appState.transfer.phase === 'awaiting-peer' && $appState.transfer.role === 'sender'}
        <section class="waiting">
          <div class="spinner" aria-hidden="true"></div>
          <p>Waiting for your peer to accept\u2026</p>
          <button class="ghost" onclick={handleCancel}>Cancel</button>
        </section>
      {:else if $appState.transfer.phase === 'transferring'}
        <section class="transferring">
          <div class="overall">
            <div class="overall-bar"><div class="overall-fill" style="width: {overallPct}%"></div></div>
            <div class="overall-meta">
              <span>{formatBytes($appState.transfer.bytesDone)} / {formatBytes($appState.transfer.totalBytes)}</span>
              <span>{formatSpeed(speedBps)}</span>
              <span>ETA {formatDuration(etaSeconds)}</span>
            </div>
          </div>
          <ul class="file-list">
            {#each $appState.transfer.files as f, i (i)}
              <li class:active={i === $appState.transfer.activeFileIndex} class:done={f.bytesDone >= f.size}>
                <span class="file-name">{f.name}</span>
                <span class="file-size">{formatBytes(f.bytesDone)} / {formatBytes(f.size)}</span>
              </li>
            {/each}
          </ul>
          <button class="ghost" onclick={handleCancel}>Cancel transfer</button>
        </section>
      {:else if $appState.transfer.phase === 'done'}
        <section class="done">
          <p class="done-check">\u2713 Transfer complete</p>
          <p class="hint">
            {$appState.transfer.files.length} file{$appState.transfer.files.length === 1 ? '' : 's'} \u00b7 {formatBytes(
              $appState.transfer.totalBytes,
            )}
          </p>
          <button class="primary" onclick={handleDone}>Done</button>
        </section>
      {:else if $appState.transfer.phase === 'cancelled' || $appState.transfer.phase === 'error'}
        <section class="done">
          <p class="error-text">
            {$appState.transfer.phase === 'error' ? 'Something went wrong' : 'Transfer cancelled'}
          </p>
          {#if $appState.transfer.error}
            <p class="hint">{$appState.transfer.error}</p>
          {/if}
          <button class="primary" onclick={handleDone}>Back</button>
        </section>
      {/if}
    {/if}
  </main>

  <footer class="foot">
    <span>Free \u00b7 open source \u00b7 GPL-3.0</span>
    <a href="https://github.com/Hexadecinull/Pear-to-Pear" target="_blank" rel="noreferrer">Source</a>
  </footer>
</div>

<style>
  .shell {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    max-width: 720px;
    margin: 0 auto;
    padding: 20px 20px 32px;
  }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 4px 28px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .brand-mark {
    width: 26px;
    height: 26px;
  }

  .brand-name {
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 1.05rem;
    letter-spacing: 0.01em;
  }

  .conn {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-dim);
  }
  .dot.connected {
    background: var(--success);
    box-shadow: 0 0 8px var(--success);
  }
  .dot.disconnected {
    background: var(--danger);
    box-shadow: 0 0 8px var(--danger);
  }

  .stage {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .bond-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 28px 24px;
  }

  .node-pair {
    display: flex;
    align-items: center;
    gap: 18px;
  }

  .node {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .node h2 {
    margin: 0;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    font-weight: 600;
  }

  .peer-code {
    font-family: var(--font-mono);
    font-size: 0.92rem;
    line-height: 1.5;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 12px;
    word-break: break-all;
    display: block;
  }

  .hint {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin: 0;
  }

  .code-input {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 12px;
    outline: none;
    width: 100%;
  }
  .code-input:focus {
    border-color: var(--accent-dim);
  }

  .node-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .link-line {
    flex: 0 0 48px;
    height: 2px;
    align-self: center;
    background-image: repeating-linear-gradient(
      90deg,
      var(--border-strong) 0 6px,
      transparent 6px 12px
    );
  }
  .link-line.active {
    height: 3px;
    background-image: linear-gradient(90deg, var(--accent-dim), var(--accent), var(--accent-dim));
    background-size: 200% 100%;
    animation: sweep 1.6s linear infinite;
    box-shadow: 0 0 10px rgba(199, 230, 57, 0.4);
  }

  @keyframes sweep {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: 0 0;
    }
  }

  button {
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 10px 14px;
    cursor: pointer;
    font-size: 0.88rem;
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  button:hover:not(:disabled) {
    border-color: var(--border-strong);
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  button.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-ink);
    font-weight: 600;
  }
  button.primary:hover:not(:disabled) {
    background: var(--accent-dim);
    border-color: var(--accent-dim);
  }
  button.ghost {
    background: transparent;
  }
  button.icon-btn {
    background: transparent;
    border: none;
    padding: 2px 8px;
    color: var(--text-muted);
    font-size: 1rem;
  }
  button.icon-btn:hover {
    color: var(--danger);
  }

  .error-text {
    color: var(--danger);
    font-size: 0.88rem;
    margin: 14px 0 0;
  }
  .warn-text {
    color: var(--accent);
    font-size: 0.85rem;
    margin: 0;
  }

  .trust-chips {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0;
    margin: 0;
    justify-content: center;
  }
  .trust-chips li {
    font-size: 0.78rem;
    color: var(--text-muted);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 6px 12px;
  }

  .connected-bar {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px 18px;
  }
  .connected-info {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .badge {
    display: inline-block;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    padding: 4px 10px;
    border-radius: 999px;
    background: var(--surface-raised);
    border: 1px solid var(--border-strong);
    color: var(--text-muted);
    width: fit-content;
  }
  .badge.direct {
    color: var(--accent);
    border-color: var(--accent-dim);
  }

  .verify {
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .verify summary {
    cursor: pointer;
    font-family: var(--font-mono);
  }
  .verify p {
    margin: 8px 0 0;
    max-width: 46ch;
    line-height: 1.5;
  }

  section.picker,
  section.incoming,
  section.waiting,
  section.transferring,
  section.done {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 22px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    text-align: center;
    border: 1.5px dashed var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 36px 16px;
    cursor: pointer;
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  .dropzone:hover,
  .dropzone.active {
    border-color: var(--accent);
    background: rgba(199, 230, 57, 0.05);
  }
  .dropzone-title {
    font-weight: 600;
  }
  .dropzone-sub {
    font-size: 0.82rem;
    color: var(--text-muted);
  }

  .file-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 260px;
    overflow-y: auto;
  }
  .file-list li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
  }
  .file-list li:hover {
    background: var(--surface-raised);
  }
  .file-list li.active {
    background: var(--surface-raised);
    border: 1px solid var(--accent-dim);
  }
  .file-list li.done .file-name::before {
    content: '\2713 ';
    color: var(--success);
  }
  .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-size {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.78rem;
    flex-shrink: 0;
  }

  .picker-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    font-size: 0.82rem;
    color: var(--text-muted);
  }
  .picker-actions {
    display: flex;
    gap: 8px;
  }

  .waiting {
    align-items: center;
    text-align: center;
    padding: 40px 22px;
  }
  .spinner {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 3px solid var(--border-strong);
    border-top-color: var(--accent);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .overall-bar {
    height: 8px;
    border-radius: 999px;
    background: var(--surface-raised);
    overflow: hidden;
  }
  .overall-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-dim), var(--accent));
    transition: width 0.2s ease;
  }
  .overall-meta {
    display: flex;
    justify-content: space-between;
    font-size: 0.78rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
    margin-top: 6px;
  }

  .done {
    align-items: center;
    text-align: center;
    padding: 36px 22px;
  }
  .done-check {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--success);
    margin: 0;
  }

  .foot {
    display: flex;
    justify-content: space-between;
    padding: 22px 4px 0;
    font-size: 0.78rem;
    color: var(--text-dim);
  }
  .foot a {
    color: var(--text-muted);
  }

  @media (max-width: 620px) {
    .node-pair {
      flex-direction: column;
    }
    .link-line {
      width: 2px;
      height: 28px;
      flex: none;
    }
    .link-line.active {
      width: 3px;
      height: 28px;
      background-image: linear-gradient(180deg, var(--accent-dim), var(--accent), var(--accent-dim));
      animation: sweep-v 1.6s linear infinite;
    }
    @keyframes sweep-v {
      from {
        background-position: 0 200%;
      }
      to {
        background-position: 0 0%;
      }
    }
  }
</style>
