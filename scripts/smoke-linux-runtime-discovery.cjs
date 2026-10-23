const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { collectLinuxRuntimeData } = require('../electron/linux-runtime-collector.cjs');
const { normalizeRuntimeScan } = require('../src/runtime-discovery.cjs');

async function main() {
  if (process.platform !== 'linux') {
    console.log('Skipped: the Linux collector smoke check runs on Linux.');
    return;
  }

  const worktreePath = process.cwd();
  const probeSource = `require('node:net').createServer().listen(0, '127.0.0.1', function () { console.log(this.address().port); }); // ${worktreePath}`;
  const probe = spawn(process.execPath, ['-e', probeSource], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  await once(probe, 'spawn');
  try {
    const [output] = await once(probe.stdout, 'data');
    const probePort = Number(String(output).trim());
    const collected = await collectLinuxRuntimeData();
    if (!collected.processes.length)
      throw new Error('The Linux collector returned no process records.');
    if (!Array.isArray(collected.listeners))
      throw new Error('The Linux collector returned invalid listener data.');

    const scan = normalizeRuntimeScan({
      ...collected,
      worktrees: [{ id: 'smoke-check', path: worktreePath }],
      platform: 'linux',
    });
    const probeRuntime = scan.runtimes.find(
      ({ process: runtimeProcess }) => runtimeProcess.pid === probe.pid,
    );
    if (!probeRuntime)
      throw new Error('The real scan did not match the probe process to its worktree.');
    if (!probeRuntime.listeners.some(({ port }) => port === probePort))
      throw new Error('The real scan did not observe the probe process listening on its port.');
    if (JSON.stringify(scan).includes('commandLine'))
      throw new Error('The normalized scan contains raw command lines.');

    console.log(
      `Linux collector smoke check passed: ${collected.processes.length} processes, ${collected.listeners.length} listeners, ${scan.runtimes.length} matched runtime(s).`,
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
