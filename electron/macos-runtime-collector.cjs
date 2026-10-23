const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const execOptions = { timeout: 20000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' };

function parsePsLines(output, fieldCount) {
  const records = [];
  for (const line of output.split('\n')) {
    const pattern = fieldCount === 3 ? /^\s*(\d+)\s+(\d+)\s+(.*)$/ : /^\s*(\d+)\s+(.*)$/;
    const match = pattern.exec(line);
    if (!match) continue;
    records.push(
      fieldCount === 3
        ? { pid: Number(match[1]), parentPid: Number(match[2]), text: match[3].trim() }
        : { pid: Number(match[1]), text: match[2].trim() },
    );
  }
  return records;
}

function parseMacosProcesses(commandOutput, executableOutput) {
  const executables = new Map(
    parsePsLines(executableOutput, 2).map(({ pid, text }) => [pid, text]),
  );
  return parsePsLines(commandOutput, 3).map(({ pid, parentPid, text }) => {
    const executablePath = path.isAbsolute(executables.get(pid) ?? '')
      ? executables.get(pid)
      : null;
    return {
      pid,
      parentPid,
      name: executablePath ? path.basename(executablePath) : (executables.get(pid) ?? ''),
      executablePath,
      commandLine: text || null,
    };
  });
}

function parseLsofListeners(output) {
  const listeners = [];
  let pid = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) {
      pid = Number(line.slice(1));
    } else if (line.startsWith('n') && pid !== null) {
      const match = /^n(.*):(\d+)$/.exec(line);
      if (!match) continue;
      const address = match[1].replace(/^\[(.*)\]$/, '$1');
      listeners.push({
        pid,
        address: address === '*' ? '0.0.0.0' : address,
        port: Number(match[2]),
      });
    }
  }
  return listeners;
}

async function runTool(exec, file, args) {
  try {
    return (await exec(file, args, execOptions)).stdout;
  } catch (error) {
    // lsof exits 1 when it lists nothing or skipped inaccessible entries, but still prints results.
    if (typeof error?.stdout === 'string' && error.stdout) return error.stdout;
    throw error;
  }
}

async function collectMacosRuntimeData({ platform = process.platform, exec = execFileAsync } = {}) {
  if (platform !== 'darwin') {
    return {
      processes: [],
      listeners: [],
      limitations: ['macOS runtime discovery is not available on this operating system.'],
    };
  }

  const limitations = [];
  let processes = [];
  try {
    const [commands, executables] = await Promise.all([
      runTool(exec, '/bin/ps', ['-axww', '-o', 'pid=,ppid=,command=']),
      runTool(exec, '/bin/ps', ['-axww', '-o', 'pid=,comm=']),
    ]);
    processes = parseMacosProcesses(commands, executables);
  } catch {
    limitations.push('macOS process metadata is unavailable for this scan.');
  }

  let listeners = [];
  try {
    listeners = parseLsofListeners(
      await runTool(exec, '/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn']),
    );
  } catch {
    limitations.push('macOS TCP listener ownership is unavailable for this scan.');
  }

  if (!processes.length && limitations.length === 2)
    throw new Error('The macOS process and listener scan could not complete.');
  return { processes, listeners, limitations };
}

module.exports = { collectMacosRuntimeData, parseMacosProcesses, parseLsofListeners };
