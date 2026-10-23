const fs = require('node:fs/promises');

const LISTEN_STATE = '0A';
const READ_BATCH_SIZE = 64;

function parseProcStat(text) {
  // The command name is parenthesised and may itself contain spaces or parentheses.
  const open = text.indexOf('(');
  const close = text.lastIndexOf(')');
  if (open === -1 || close < open) return null;
  const fields = text
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const parentPid = Number(fields[1]);
  if (!Number.isInteger(parentPid)) return null;
  return { name: text.slice(open + 1, close), parentPid };
}

function parseCmdline(text) {
  const joined = text.split('\0').filter(Boolean).join(' ').trim();
  return joined || null;
}

function formatIpv6(words) {
  let bestStart = -1;
  let bestLength = 0;
  for (let start = 0; start < 8; start += 1) {
    let length = 0;
    while (start + length < 8 && words[start + length] === 0) length += 1;
    if (length > bestLength) [bestStart, bestLength] = [start, length];
  }
  const hex = words.map((word) => word.toString(16));
  if (bestLength < 2) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`;
}

function parseHostAddress(hex) {
  // /proc/net/tcp prints each 32-bit word in host (little-endian) byte order.
  const words = hex.match(/.{8}/g) ?? [];
  const bytes = words.flatMap((word) =>
    [6, 4, 2, 0].map((offset) => Number.parseInt(word.slice(offset, offset + 2), 16)),
  );
  if (bytes.length === 4) return bytes.join('.');
  if (bytes.length !== 16) return null;
  // IPv4-mapped addresses (::ffff:a.b.c.d) are shown as the plain IPv4 address.
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 255 && bytes[11] === 255)
    return bytes.slice(12).join('.');
  const groups = [];
  for (let index = 0; index < 16; index += 2) groups.push((bytes[index] << 8) | bytes[index + 1]);
  return formatIpv6(groups);
}

function parseProcNetTcp(text) {
  const sockets = [];
  for (const line of text.split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10 || fields[3] !== LISTEN_STATE) continue;
    const [host, port] = fields[1].split(':');
    const address = parseHostAddress(host ?? '');
    const inode = Number(fields[9]);
    if (address === null || !port || !inode) continue;
    sockets.push({ address, port: Number.parseInt(port, 16), inode });
  }
  return sockets;
}

async function readOptional(read, filePath) {
  try {
    return await read(filePath);
  } catch {
    return null;
  }
}

async function collectLinuxRuntimeData({ platform = process.platform, fsApi = fs } = {}) {
  if (platform !== 'linux') {
    return {
      processes: [],
      listeners: [],
      limitations: ['Linux runtime discovery is not available on this operating system.'],
    };
  }

  const readText = (filePath) => fsApi.readFile(filePath, 'utf8');
  let pids;
  try {
    pids = (await fsApi.readdir('/proc')).filter((entry) => /^\d+$/.test(entry)).map(Number);
  } catch {
    throw new Error('The Linux process scan could not complete.');
  }

  const limitations = [];
  const ownNamespace = await readOptional(fsApi.readlink, '/proc/self/ns/net');
  const readProcess = async (pid) => {
    const stat = parseProcStat((await readOptional(readText, `/proc/${pid}/stat`)) ?? '');
    if (!stat) return null; // The process exited during the scan.
    const cmdline = await readOptional(readText, `/proc/${pid}/cmdline`);
    const namespace = await readOptional(fsApi.readlink, `/proc/${pid}/ns/net`);
    const descriptors = await readOptional(fsApi.readdir, `/proc/${pid}/fd`);
    const inodes = [];
    for (const descriptor of descriptors ?? []) {
      const target = await readOptional(fsApi.readlink, `/proc/${pid}/fd/${descriptor}`);
      const inode = /^socket:\[(\d+)\]$/.exec(target ?? '')?.[1];
      if (inode) inodes.push(Number(inode));
    }
    return {
      process: {
        pid,
        parentPid: stat.parentPid,
        name: stat.name,
        executablePath: (await readOptional(fsApi.readlink, `/proc/${pid}/exe`)) || null,
        commandLine: cmdline === null ? null : parseCmdline(cmdline),
      },
      inodes,
      inOtherNamespace: Boolean(ownNamespace && namespace && namespace !== ownNamespace),
    };
  };

  const results = [];
  for (let start = 0; start < pids.length; start += READ_BATCH_SIZE)
    results.push(
      ...(await Promise.all(pids.slice(start, start + READ_BATCH_SIZE).map(readProcess))),
    );
  const scanned = results.filter(Boolean);
  if (!scanned.length) throw new Error('The Linux process scan could not complete.');
  const processes = scanned.map(({ process: record }) => record);

  // A socket inherited by several processes is reported for every process that holds it.
  const socketOwners = new Map();
  for (const { process: record, inodes } of scanned)
    for (const inode of inodes)
      socketOwners.set(inode, [...(socketOwners.get(inode) ?? []), record.pid]);

  const listeners = [];
  let unownedListeners = 0;
  let unreadableTables = 0;
  for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
    const text = await readOptional(readText, table);
    if (text === null) {
      unreadableTables += 1;
      continue;
    }
    for (const socket of parseProcNetTcp(text)) {
      const owners = socketOwners.get(socket.inode) ?? [];
      if (!owners.length) unownedListeners += 1;
      for (const pid of owners) listeners.push({ pid, address: socket.address, port: socket.port });
    }
  }
  if (unreadableTables) limitations.push('Linux TCP listener data is unavailable for this scan.');
  if (unownedListeners)
    limitations.push(
      'Linux TCP listener ownership is partial: some listening sockets belong to processes this user cannot inspect.',
    );
  const otherNamespaces = scanned.filter(({ inOtherNamespace }) => inOtherNamespace).length;
  if (otherNamespaces)
    limitations.push(
      `${otherNamespaces} processes run in another network namespace, so their listening sockets are not visible to this scan.`,
    );
  const mounts = (await readOptional(readText, '/proc/mounts')) ?? '';
  if (/^proc \/proc proc \S*\bhidepid=(?:1|2|invisible|noaccess)\b/m.test(mounts))
    limitations.push("/proc is mounted with hidepid, so other users' processes are not visible.");

  return { processes, listeners, limitations };
}

module.exports = {
  collectLinuxRuntimeData,
  parseCmdline,
  parseProcNetTcp,
  parseProcStat,
};
