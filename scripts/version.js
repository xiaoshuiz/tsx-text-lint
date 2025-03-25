const fs = require('node:fs');
const { execSync } = require('node:child_process');
const path = require('node:path');

function incrementVersion(currentVersion, type) {
    const [major, minor, patch] = currentVersion.split('.').map(Number);
    switch (type) {
        case 'major':
            return `${major + 1}.0.0`;
        case 'minor':
            return `${major}.${minor + 1}.0`;
        case 'patch':
            return `${major}.${minor}.${patch + 1}`;
        default:
            return type; // 如果是具体版本号就直接使用
    }
}

// 获取版本类型参数
const versionType = process.argv[2];
if (!versionType) {
    console.error('请提供版本类型，例如: node version.js patch');
    console.error('可用选项: major, minor, patch, 或具体版本号');
    process.exit(1);
}

try {
    // 读取 package.json
    const packagePath = path.join(__dirname, '../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    
    // 计算新版本号
    const newVersion = incrementVersion(packageJson.version, versionType);
    
    // 更新版本号
    packageJson.version = newVersion;
    
    // 写入 package.json
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    
    // Git 操作
    execSync('git add package.json');
    execSync(`git commit -m "chore: update version to ${newVersion}"`);
    execSync(`git tag v${newVersion}`);
    execSync('git push');
    execSync('git push --tags');
    
    console.log(`版本已更新至 ${newVersion} 并推送到远程仓库`);
} catch (error) {
    console.error('更新版本失败:', error.message);
    process.exit(1);
} 