const { collectLinuxRuntimeData } = require('./linux-runtime-collector.cjs');
const { collectMacosRuntimeData } = require('./macos-runtime-collector.cjs');
const { collectWindowsRuntimeData } = require('./windows-runtime-collector.cjs');

function collectRuntimeData() {
  if (process.platform === 'darwin') return collectMacosRuntimeData();
  if (process.platform === 'linux') return collectLinuxRuntimeData();
  if (process.platform === 'win32') return collectWindowsRuntimeData();
  return Promise.reject(new Error('Runtime discovery is not available on this operating system.'));
}

module.exports = { collectRuntimeData };
