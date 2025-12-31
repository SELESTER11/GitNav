const HF_API = 'https://api-inference.huggingface.co/models/facebook/bart-large-cnn';

export async function generateSummary(repoInfo, fileTree) {
  try {
    const input = prepareSummaryInput(repoInfo, fileTree);
    
    const response = await fetch(HF_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: input,
        parameters: {
          max_length: 200,
          min_length: 50,
          do_sample: false
        }
      })
    });

    if (!response.ok) {
      throw new Error('AI service temporarily unavailable');
    }

    const result = await response.json();
    return result[0]?.summary_text || 'Summary generation failed';
  } catch (error) {
    console.error('Error generating summary:', error);
    return 'Unable to generate AI summary at this time. Please try again later.';
  }
}

function prepareSummaryInput(repoInfo, fileTree) {
  const folders = getFolderStructure(fileTree);
  const keyFiles = findKeyFiles(fileTree);
  
  return `
Repository: ${repoInfo.name}
Description: ${repoInfo.description || 'No description available'}
Main Language: ${repoInfo.language || 'Unknown'}
Stars: ${repoInfo.stargazers_count || 0}

File Structure:
Total Files: ${fileTree.length}
Main Folders: ${folders.slice(0, 10).join(', ')}

Key Files Found:
${keyFiles.map(f => `- ${f.name}: ${f.type}`).join('\n')}

This is a ${repoInfo.language || 'software'} project. Based on the structure, it appears to be a ${detectProjectType(fileTree, repoInfo)} project.
  `.trim();
}

function getFolderStructure(fileTree) {
  const folders = new Set();
  fileTree.forEach(item => {
    if (item.type === 'tree') {
      folders.add(item.path);
    } else {
      const parts = item.path.split('/');
      if (parts.length > 1) {
        folders.add(parts[0]);
      }
    }
  });
  return Array.from(folders);
}

function findKeyFiles(fileTree) {
  const keyPatterns = {
    'package.json': 'Node.js Dependencies',
    'requirements.txt': 'Python Dependencies',
    'Cargo.toml': 'Rust Dependencies',
    'go.mod': 'Go Dependencies',
    'pom.xml': 'Maven Dependencies',
    'README.md': 'Documentation',
    'index.js': 'Entry Point',
    'main.py': 'Entry Point',
    'app.py': 'Entry Point',
    'index.html': 'Frontend Entry',
    'Dockerfile': 'Container Config'
  };

  const found = [];
  fileTree.forEach(item => {
    const fileName = item.path.split('/').pop();
    if (keyPatterns[fileName]) {
      found.push({ name: item.path, type: keyPatterns[fileName] });
    }
  });

  return found;
}

function detectProjectType(fileTree, repoInfo) {
  const hasFile = (pattern) => fileTree.some(f => f.path.includes(pattern));
  
  if (hasFile('package.json') && hasFile('react')) return 'React web application';
  if (hasFile('package.json') && hasFile('vue')) return 'Vue.js web application';
  if (hasFile('package.json') && hasFile('angular')) return 'Angular web application';
  if (hasFile('requirements.txt') && hasFile('django')) return 'Django web application';
  if (hasFile('requirements.txt') && hasFile('flask')) return 'Flask web application';
  if (hasFile('Cargo.toml')) return 'Rust application';
  if (hasFile('go.mod')) return 'Go application';
  if (hasFile('pom.xml')) return 'Java Maven application';
  
  return repoInfo.language ? `${repoInfo.language} application` : 'software application';
}