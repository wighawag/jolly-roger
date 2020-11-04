/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

const assetsPath = 'dist/_assets';
const files = fs.readdirSync(assetsPath);
for (const file of files) {
  const filepath = path.join(assetsPath, file);
  const stat = fs.statSync(filepath);
  if (stat.isDirectory()) {
    continue;
  }
  const envNames = Object.keys(process.env).filter((v) =>
    v.startsWith('VITE_')
  );
  let content = fs.readFileSync(filepath).toString();
  for (const envName of envNames) {
    const newContent = content.replace(
      new RegExp(`{}.${envName}`, 'g'),
      `"${process.env[envName]}"`
    );
    if (newContent != content) {
      console.log(`replaced {}.${envName} with "${process.env[envName]}"`);
      content = newContent;
    }
  }
  fs.writeFileSync(filepath, content);
}
