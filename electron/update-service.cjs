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

// Compare versions (semver-like) - strips company prefix if present
function isNewerVersion(latest, current) {
  // Extract numeric version (strip company prefix if present)
  const latestNumeric = latest.split('.').slice(-3).join('.') || '0.0.0';
  const currentNumeric = current.split('.').slice(-3).join('.') || '0.0.0';

  const latestParts = latestNumeric.split('.').map(Number);
  const currentParts = currentNumeric.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

// Fetch latest release from GitHub (company-specific)
async function checkForUpdates(companyName) {
  return new Promise((resolve, reject) => {
    const url = `${GITHUB_API}/${REPO}/releases`;

    console.log('[Update] Checking for updates at:', url);
    console.log('[Update] Company:', companyName);

    const req = https.get(url, {
      headers: { 'User-Agent': 'FusionClient-Updater' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const releases = JSON.parse(data);
          if (!Array.isArray(releases) || releases.length === 0) {
            resolve({
              hasUpdate: false,
              currentVersion: getCurrentVersion(),
              latestVersion: '0.0.0',
              message: 'No releases found for this company',
            });
            return;
          }

          // Find latest release for this company
          const companyReleases = releases.filter(r =>
            r.tag_name?.startsWith(companyName + '-')
          );

          if (companyReleases.length === 0) {
            resolve({
              hasUpdate: false,
              currentVersion: getCurrentVersion(),
              latestVersion: '0.0.0',
              message: 'No release found',
            });
            return;
          }

          const release = companyReleases[0];
          const currentVersion = getCurrentVersion();
          const numericVersion = release.tag_name?.replace(companyName + '-v', '')?.replace(companyName + '-', '') || '0.0.0';
          const latestVersion = `${companyName}.${numericVersion}`;

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

// Download file with progress and redirect support
async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const downloadToFile = (downloadUrl) => {
      const file = fs.createWriteStream(destPath);

      console.log('[Update] Downloading from:', downloadUrl);

      const req = https.get(downloadUrl, {
        headers: { 'User-Agent': 'FusionClient-Updater' },
        timeout: 60000,
      }, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          console.log('[Update] Redirect to:', res.headers.location);
          file.destroy();
          fs.unlink(destPath, () => {});
          downloadToFile(res.headers.location);
          return;
        }

        if (res.statusCode !== 200) {
          file.destroy();
          fs.unlink(destPath, () => {});
          reject(new Error(`Download failed with status ${res.statusCode}`));
          return;
        }

        let downloadedBytes = 0;
        const totalBytes = parseInt(res.headers['content-length'], 10);

        console.log('[Update] Total size:', totalBytes, 'bytes');

        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            const progress = Math.round((downloadedBytes / totalBytes) * 100);
            console.log(`[Update] Download progress: ${progress}%`);
          }
        });

        res.pipe(file);

        file.on('finish', () => {
          file.close();
          console.log('[Update] Download complete:', destPath);
          resolve();
        });

        file.on('error', (e) => {
          fs.unlink(destPath, () => {});
          reject(new Error(`File write failed: ${e.message}`));
        });
      });

      req.on('error', (e) => {
        fs.unlink(destPath, () => {});
        reject(new Error(`Download failed: ${e.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        fs.unlink(destPath, () => {});
        reject(new Error('Download timeout'));
      });
    };

    downloadToFile(url);
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
        try { fs.unlinkSync(backupPath); } catch (_) {}
      }
      try {
        fs.copyFileSync(exePath, backupPath);
        console.log('[Update] Backup created');
      } catch (e) {
        console.warn('[Update] Could not create backup:', e.message);
      }
    }

    // Try to copy new exe to app location
    try {
      fs.copyFileSync(newExePath, exePath);
      console.log('[Update] Exe replaced');
    } catch (e) {
      // If file is locked, try to schedule replacement for next restart
      if (e.code === 'EBUSY' || e.code === 'EPERM') {
        console.log('[Update] Exe is locked, scheduling replacement for next restart');
        // Create a temp marker file to indicate update pending
        const updateMarker = path.join(path.dirname(exePath), '.update-pending');
        fs.writeFileSync(updateMarker, newExePath);
        throw new Error(`Update downloaded. Close the app completely and restart to apply the update. File: ${newExePath}`);
      }
      throw e;
    }

    // Clean up downloaded file
    try { fs.unlinkSync(newExePath); } catch (_) {}

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
