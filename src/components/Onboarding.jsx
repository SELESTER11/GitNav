import React from 'react';

export default function Onboarding({ repoData, keyFiles, fileTree }) {
  const steps = generateOnboardingSteps(repoData, keyFiles, fileTree);

  return (
    <div className="section">
      <h3 className="section-title">Start Here</h3>
      <ol className="onboarding-steps">
        {steps.map((step, index) => (
          <li key={index} className="onboarding-step">
            <div className="step-title">{step.title}</div>
            {step.file && (
              <div className="step-file">{step.file}</div>
            )}
            {step.command && (
              <div className="step-command">{step.command}</div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function generateOnboardingSteps(repoData, keyFiles, fileTree) {
  const steps = [];

  const readme = keyFiles.find(f => f.name.toLowerCase() === 'readme.md');
  if (readme) {
    steps.push({
      title: 'Read Documentation',
      file: readme.path
    });
  }

  const packageJson = keyFiles.find(f => f.name === 'package.json');
  const requirements = keyFiles.find(f => f.name === 'requirements.txt');
  const cargoToml = keyFiles.find(f => f.name === 'cargo.toml');
  const goMod = keyFiles.find(f => f.name === 'go.mod');

  if (packageJson) {
    steps.push({
      title: 'Install Dependencies',
      file: packageJson.path,
      command: 'npm install'
    });
  } else if (requirements) {
    steps.push({
      title: 'Install Dependencies',
      file: requirements.path,
      command: 'pip install -r requirements.txt'
    });
  } else if (cargoToml) {
    steps.push({
      title: 'Build Project',
      file: cargoToml.path,
      command: 'cargo build'
    });
  } else if (goMod) {
    steps.push({
      title: 'Install Dependencies',
      file: goMod.path,
      command: 'go mod download'
    });
  }

  const entryPoint = keyFiles.find(f => f.type === 'Entry Point');
  if (entryPoint) {
    steps.push({
      title: 'Explore Entry Point',
      file: entryPoint.path
    });
  }

  const mainFolder = detectMainFolder(fileTree);
  if (mainFolder) {
    steps.push({
      title: 'Explore Main Code',
      file: mainFolder
    });
  }

  return steps.length > 0 ? steps : [
    { title: 'Browse Repository', file: 'Start exploring the files below' }
  ];
}

function detectMainFolder(fileTree) {
  if (!fileTree || fileTree.length === 0) return null;

  const commonFolders = ['src', 'lib', 'app', 'components', 'pages'];
  
  for (const folder of commonFolders) {
    const found = fileTree.find(f => f.path === folder || f.path.startsWith(folder + '/'));
    if (found) return folder + '/';
  }

  return null;
}