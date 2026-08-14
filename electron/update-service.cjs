const https = require('https');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { execSync } = require('child_process');

const REPO = 'javeedin/fusionclientweb';
const GITHUB_API = 'https://api.github.com/repos';

// Get current app version from package.json
function getCurrentVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version;
  } catch (e) {
    console.error('[Update] Error reading version:', e.message);
    return '0.0.0';
  }
}

// Compare versions (semver-like)
function isNewerVersion(latest, current) {
  const latestParts = (latest || '0.0.0').split('.').map(Number);
  const currentParts = (current || '0.0.0').split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

// Fetch latest release from GitHub
async function checkForUpdates() {
  return new Promise((resolve, reject) => {
    const url = `${GITHUB_API}/${REPO}/releases/latest`;

    console.log('[Update] Checking for updates at:', url);

    const req = https.get(url, {
      headers: { 'User-Agent': 'FusionClient-Updater' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const currentVersion = getCurrentVersion();
          const latestVersion = release.tag_name?.replace('v', '') || release.tag_name || '0.0.0';

          console.log('[Update] Current:', currentVersion, 'Latest:', latestVersion);

          const hasUpdate = isNewerVersion(latestVersion, currentVersion);

          if (hasUpdate) {
            // Find the exe asset
            const exeAsset = release.assets?.find(a => a.name.toLowerCase().endsWith('.exe'));
            if (exeAsset) {
              resolve({
                hasUpdate: true,
                currentVersion,
                latestVersion,
                releaseNotes: release.body || '',
                downloadUrl: exeAsset.browser_download_url,
                downloadName: exeAsset.name,
              });
            } else {
              resolve({
                hasUpdate: false,
                currentVersion,
                latestVersion,
                message: 'Latest release has no exe asset',
              });
            }
          } else {
            resolve({
              hasUpdate: false,
              currentVersion,
              latestVersion,
              message: 'You are running the latest version',
            });
          }
        } catch (e) {
          reject(new Error(`Failed to parse release: ${e.message}`));
        }
      });
    });

    req.on('error', (e) => {
      console.error('[Update] Network error:', e.message);
      reject(new Error(`Failed to check updates: ${e.message}`));
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Update check timeout'));
    });
  });
}

// Download file with progress
async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    console.log('[Update] Downloading from:', url);

    const req = https.get(url, {
      headers: { 'User-Agent': 'FusionClient-Updater' }
    }, (res) => {
      let downloadedBytes = 0;
      const totalBytes = parseInt(res.headers['content-length'], 10);

      res.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const progress = Math.round((downloadedBytes / totalBytes) * 100);
        console.log(`[Update] Download progress: ${progress}%`);
      });

      res.pipe(file);

      file.on('finish', () => {
        file.close();
        console.log('[Update] Download complete:', destPath);
        resolve();
      });
    });

    req.on('error', (e) => {
      fs.unlink(destPath, () => {});
      reject(new Error(`Download failed: ${e.message}`));
    });

    file.on('error', (e) => {
      fs.unlink(destPath, () => {});
      reject(new Error(`File write failed: ${e.message}`));
    });

    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

// Install update (replace exe and restart)
async function installUpdate(newExePath) {
  try {
    const exePath = app.getPath('exe');
    const backupPath = exePath + '.backup';

    console.log('[Update] Current exe:', exePath);
    console.log('[Update] Backup path:', backupPath);
    console.log('[Update] New exe:', newExePath);

    // Create backup
    if (fs.existsSync(exePath)) {
      if (fs.existsSync(backupPath)) {
        fs.unlinkSync(backupPath);
      }
      fs.copyFileSync(exePath, backupPath);
      console.log('[Update] Backup created');
    }

    // Copy new exe to app location
    fs.copyFileSync(newExePath, exePath);
    console.log('[Update] Exe replaced');

    // Clean up downloaded file
    fs.unlinkSync(newExePath);

    // Restart app
    app.relaunch();
    app.exit(0);
  } catch (e) {
    throw new Error(`Failed to install update: ${e.message}`);
  }
}

module.exports = {
  getCurrentVersion,
  checkForUpdates,
  downloadFile,
  installUpdate,
  isNewerVersion,
};
