import fs from 'fs-extra';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

// Setup __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 🛠️ CONFIGURATION: Adjust these paths if your folder structure is different
const VITE_DIST_DIR = path.join(__dirname, 'dist');
const ANDROID_WWW_DIR = path.join(__dirname, '../app/src/main/assets/www');

async function buildAndCopy() {
  try {
    // 1. Run the Vite production build
    console.log('Running Vite build...');
    execSync('npm run build', { stdio: 'inherit' });

    // 2. Clear the old Android www folder if it exists to avoid caching ghost assets
    if (fs.existsSync(ANDROID_WWW_DIR)) {
      console.log('Clearing old Android assets/www folder...');
      fs.emptyDirSync(ANDROID_WWW_DIR);
    } else {
      console.log('Creating Android assets/www directory...');
      fs.ensureDirSync(ANDROID_WWW_DIR);
    }

    // 3. Copy the fresh compiled files
    console.log('Copying compiled build to Android project...');
    fs.copySync(VITE_DIST_DIR, ANDROID_WWW_DIR);
  } catch (error) {
    console.error('❌ Build script failed:', error.message);
    process.exit(1);
  }
}

buildAndCopy();
