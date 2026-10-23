const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { collectWindowsRuntimeData } = require('../electron/windows-runtime-collector.cjs');
const { normalizeRuntimeScan } = require('../src/runtime-discovery.cjs');

async function main() {
  if (process.platform !== 'win32') {
    console.log('Skipped: the Windows collector smoke check runs on Windows.');
    return;
  }

  const worktreePath = process.cwd();
  const probe = spawn(process.execPath, ['-e', `setInterval(() => {}, 1000); // ${worktreePath}`], {
    windowsHide: true,
    stdio: 'ignore',
  });
  await once(probe, 'spawn');
  try {
    const collected = await collectWindowsRuntimeData();
    if (!collected.processes.length)
      throw new Error('The Windows collector returned no process records.');
    if (!Array.isArray(collected.listeners))
      throw new Error('The Windows collector returned invalid listener data.');

    const scan = normalizeRuntimeScan({
      ...collected,
      worktrees: [{ id: 'smoke-check', path: worktreePath }],
      platform: 'win32',
    });
    const probeRuntime = scan.runtimes.find(
      ({ process: runtimeProcess }) => runtimeProcess.pid === probe.pid,
    );
    if (!probeRuntime)
      throw new Error('The real scan did not match the probe process to its worktree.');
    if (JSON.stringify(scan).includes('commandLine'))
      throw new Error('The normalized scan contains raw command lines.');

    console.log(
      `Windows collector smoke check passed: ${collected.processes.length} processes, ${collected.listeners.length} listeners, ${scan.runtimes.length} matched runtime(s).`,
    );
    if (scan.limitations.length)
      console.log(`Partial scan limitations: ${scan.limitations.join(' ')}`);
  } finally {
    probe.kill();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
