#!/usr/bin/env node
/**
 * ruri-webgpu リリース自動化スクリプト
 * 
 * 使用方法:
 *   npm run release               # 対話式でバージョンを選択してリリース
 *   npm run release -- patch      # 0.1.0 -> 0.1.1
 *   npm run release -- minor      # 0.1.0 -> 0.2.0
 *   npm run release -- major      # 0.1.0 -> 1.0.0
 *   npm run release -- 0.2.0      # 直接バージョン指定
 *   npm run release -- --dry-run  # 変更を行わずにシミュレーション
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const PACKAGE_JSON_PATH = path.join(ROOT_DIR, 'package.json');
const MANIFEST_JSON_PATH = path.join(ROOT_DIR, 'extension/manifest.json');

function exec(cmd, options = {}) {
  return execSync(cmd, { cwd: ROOT_DIR, stdio: options.silent ? 'pipe' : 'inherit', encoding: 'utf-8', ...options });
}

function getGitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT_DIR, encoding: 'utf-8' }).trim();
  } catch {
    return 'unknown';
  }
}

function isGitClean() {
  try {
    const status = execSync('git status --porcelain', { cwd: ROOT_DIR, encoding: 'utf-8' }).trim();
    return status.length === 0;
  } catch {
    return false;
  }
}

function parseSemver(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4]
  };
}

function bumpVersion(current, type) {
  const parsed = parseSemver(current);
  if (!parsed) {
    throw new Error(`不正なバージョン形式です: ${current}`);
  }
  switch (type) {
    case 'patch':
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
    case 'minor':
      return `${parsed.major}.${parsed.minor + 1}.0`;
    case 'major':
      return `${parsed.major + 1}.0.0`;
    default:
      if (/^\d+\.\d+\.\d+/.test(type)) {
        return type;
      }
      throw new Error(`不明なバージョンアップタイプ: ${type}`);
  }
}

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('\n🚀 === ruri-webgpu リリースヘルパー ===\n');

  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const noPush = args.includes('--no-push');
  const autoYes = args.includes('--yes') || args.includes('-y');
  const filteredArgs = args.filter(a => !a.startsWith('-'));

  // 1. 現在のバージョン取得
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
  const currentVersion = pkg.version;
  const currentBranch = getGitBranch();

  console.log(`📌 現在のバージョン: v${currentVersion}`);
  console.log(`🌿 現在のブランチ: ${currentBranch}`);
  if (isDryRun) {
    console.log(`🔍 [DRY-RUN モード] ファイル更新や git 操作はシミュレーションのみ実行されます\n`);
  }

  // 2. 新しいバージョンの決定
  let nextVersion = '';
  if (filteredArgs.length > 0) {
    const target = filteredArgs[0];
    nextVersion = bumpVersion(currentVersion, target);
  } else {
    const patchVer = bumpVersion(currentVersion, 'patch');
    const minorVer = bumpVersion(currentVersion, 'minor');
    const majorVer = bumpVersion(currentVersion, 'major');

    console.log('\nリリースする新しいバージョンを選択してください:');
    console.log(`  1) patch (v${patchVer}) - バグ修正・軽微な改善`);
    console.log(`  2) minor (v${minorVer}) - 新機能追加・機能強化`);
    console.log(`  3) major (v${majorVer}) - 破壊的変更・メジャー更新`);
    console.log(`  4) カスタム指定\n`);

    const answer = await prompt('選択 [1-4] (デフォルト: 2): ');
    if (answer === '1') {
      nextVersion = patchVer;
    } else if (answer === '3') {
      nextVersion = majorVer;
    } else if (answer === '4') {
      const custom = await prompt('バージョンを入力 (例: 0.3.0): ');
      if (!parseSemver(custom)) {
        console.error('❌ 正しいセマンティックバージョニング形式で入力してください。');
        process.exit(1);
      }
      nextVersion = custom;
    } else {
      // デフォルトは minor
      nextVersion = minorVer;
    }
  }

  console.log(`\n🎯 対象バージョン: v${currentVersion} -> v${nextVersion}`);

  // 確認プロンプト
  if (!isDryRun && !autoYes) {
    const confirm = await prompt(`\nv${nextVersion} としてリリース処理を開始しますか？ (y/N): `);
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      console.log('中止しました。');
      process.exit(0);
    }
  }

  // 3. 作業ツリーのチェック
  if (!isGitClean() && !isDryRun) {
    console.log('\n⚠️  未コミットの変更が存在します。事前にコミットまたは stash してください。');
    if (!autoYes) {
      const proceed = await prompt('未コミットの変更を含めて続行しますか？ (y/N): ');
      if (proceed.toLowerCase() !== 'y') {
        process.exit(1);
      }
    }
  }

  // 4. バージョン更新 (package.json & extension/manifest.json)
  console.log('\n📝 package.json と extension/manifest.json のバージョンを更新中...');
  if (!isDryRun) {
    pkg.version = nextVersion;
    fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(pkg, null, 2) + '\n');

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_JSON_PATH, 'utf-8'));
    manifest.version = nextVersion;
    fs.writeFileSync(MANIFEST_JSON_PATH, JSON.stringify(manifest, null, 2) + '\n');
  }
  console.log('✅ バージョンファイルを更新しました。');

  // 5. テストとビルドの検証
  console.log('\n🧪 テストと拡張機能ビルドを実行中...');
  if (!isDryRun) {
    try {
      exec('npm run build:extension');
      exec('npm test');
    } catch (err) {
      console.error('\n❌ ビルドまたはテストに失敗しました。バージョンファイルを元に戻します。');
      pkg.version = currentVersion;
      fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(pkg, null, 2) + '\n');
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_JSON_PATH, 'utf-8'));
      manifest.version = currentVersion;
      fs.writeFileSync(MANIFEST_JSON_PATH, JSON.stringify(manifest, null, 2) + '\n');
      process.exit(1);
    }
  }
  console.log('✅ ビルドおよびテストが正常に通過しました。');

  // 6. Git コミット & タグ作成
  const tagName = `v${nextVersion}`;
  console.log(`\n📦 Git コミットとタグ (${tagName}) を作成中...`);
  if (!isDryRun) {
    exec(`git add package.json extension/manifest.json`);
    exec(`git commit -m "chore(release): ${tagName}"`);
    exec(`git tag -a ${tagName} -m "Release ${tagName}"`);
  }
  console.log(`✅ コミットおよびタグ ${tagName} を作成しました。`);

  // 7. リモートへプッシュ
  if (!noPush && !isDryRun) {
    let shouldPush = autoYes;
    if (!autoYes) {
      const answer = await prompt(`\n🚀 リモート (origin/${currentBranch}) とタグ (${tagName}) をプッシュしますか？ (Y/n): `);
      shouldPush = answer.toLowerCase() !== 'n';
    }
    if (shouldPush) {
      console.log('リモートへプッシュ中...');
      exec(`git push origin ${currentBranch}`);
      exec(`git push origin ${tagName}`);
      console.log('✅ プッシュ完了！');
    } else {
      console.log('\nℹ️  手動でプッシュする場合は以下を実行してください:');
      console.log(`   git push origin ${currentBranch}`);
      console.log(`   git push origin ${tagName}\n`);
    }
  } else if (isDryRun) {
    console.log(`\n[DRY-RUN] 以下のプッシュが実行される予定でした:`);
    console.log(`   git push origin ${currentBranch}`);
    console.log(`   git push origin ${tagName}`);
  }

  // 8. 完了後の指示・案内
  console.log('\n🎉 ==========================================');
  console.log(`✨ リリース ${tagName} の手続きが完了しました！`);
  console.log('==========================================\n');
  console.log('📋 次のステップ・確認事項:');
  console.log('  1. GitHub Actions の自動ビルド状況を確認:');
  console.log('     👉 https://github.com/chottokun/ruri-webgpu/actions');
  console.log('  2. ビルド完了後、GitHub Releases に ZIP が自動添付されます:');
  console.log('     👉 https://github.com/chottokun/ruri-webgpu/releases');
  console.log('  3. ローカルでも ZIP を作成したい場合:');
  console.log('     👉 npm run zip:extension\n');
}

main().catch((err) => {
  console.error('\n❌ エラーが発生しました:', err);
  process.exit(1);
});
