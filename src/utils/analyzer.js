export function categorizeFiles(fileTree) {
    const categories = {
      frontend: [],
      backend: [],
      config: [],
      tests: [],
      docs: [],
      other: []
    };
  
    fileTree.forEach(file => {
      if (file.type !== 'blob') return;
  
      const path = file.path.toLowerCase();
      const category = detectCategory(path);
      categories[category].push(file);
    });
  
    return categories;
  }
  
  function detectCategory(path) {
    if (path.match(/\/(src|components?|views?|pages?|public|assets?|styles?)\//i) ||
        path.match(/\.(jsx?|tsx?|vue|svelte|css|scss|less)$/i)) {
      return 'frontend';
    }
  
    if (path.match(/\/(server|api|routes?|controllers?|models?|services?|database|db)\//i) ||
        path.match(/\.(py|java|go|rs|php|rb)$/i)) {
      return 'backend';
    }
  
    if (path.match(/\.(json|ya?ml|toml|ini|env|config)$/i) ||
        path.match(/^(package|cargo|go\.mod|requirements|gemfile|dockerfile)/i)) {
      return 'config';
    }
  
    if (path.match(/\/(test|__tests__|spec|e2e)\//i) ||
        path.match(/\.(test|spec)\.(js|ts|py|go|rs)$/i)) {
      return 'tests';
    }
  
    if (path.match(/\/(docs?|documentation)\//i) ||
        path.match(/\.(md|txt|rst|adoc)$/i) ||
        path.match(/^(readme|contributing|changelog|license)/i)) {
      return 'docs';
    }
  
    return 'other';
  }
  
  export function buildFileTree(files) {
    const root = { name: 'root', children: [], type: 'folder', path: '' };
  
    files.forEach(file => {
      const parts = file.path.split('/');
      let current = root;
  
      parts.forEach((part, index) => {
        const isLast = index === parts.length - 1;
        let child = current.children.find(c => c.name === part);
  
        if (!child) {
          child = {
            name: part,
            children: [],
            type: isLast ? 'file' : 'folder',
            path: parts.slice(0, index + 1).join('/'),
            category: isLast ? detectCategory(file.path) : null,
            size: file.size
          };
          current.children.push(child);
        }
  
        current = child;
      });
    });
  
    return root;
  }
  
  export function findKeyFiles(fileTree) {
    const keyFiles = [];
    
    const patterns = [
      { pattern: /^(index|main|app)\.(js|ts|py|go|rs|java)$/i, type: 'Entry Point' },
      { pattern: /^package\.json$/i, type: 'Node.js Config' },
      { pattern: /^requirements\.txt$/i, type: 'Python Config' },
      { pattern: /^cargo\.toml$/i, type: 'Rust Config' },
      { pattern: /^go\.mod$/i, type: 'Go Config' },
      { pattern: /^pom\.xml$/i, type: 'Maven Config' },
      { pattern: /^readme\.md$/i, type: 'Documentation' },
      { pattern: /^dockerfile$/i, type: 'Docker Config' }
    ];
  
    fileTree.forEach(file => {
      if (file.type !== 'blob') return;
      
      const fileName = file.path.split('/').pop().toLowerCase();
      
      patterns.forEach(({ pattern, type }) => {
        if (pattern.test(fileName)) {
          keyFiles.push({
            path: file.path,
            name: fileName,
            type: type,
            category: detectCategory(file.path)
          });
        }
      });
    });
  
    return keyFiles;
  }
  
  export function searchFiles(fileTree, query) {
    if (!query || query.trim() === '') return [];
  
    const searchTerm = query.toLowerCase().trim();
    const results = [];
  
    fileTree.forEach(file => {
      if (file.type !== 'blob') return;
  
      const path = file.path.toLowerCase();
      const fileName = path.split('/').pop();
  
      if (path.includes(searchTerm) || fileName.includes(searchTerm)) {
        results.push({
          path: file.path,
          name: fileName,
          category: detectCategory(file.path),
          match: path.indexOf(searchTerm)
        });
      }
    });
  
    return results.sort((a, b) => {
      const aFileName = a.name.toLowerCase();
      const bFileName = b.name.toLowerCase();
      
      if (aFileName === searchTerm && bFileName !== searchTerm) return -1;
      if (bFileName === searchTerm && aFileName !== searchTerm) return 1;
      
      return a.match - b.match;
    }).slice(0, 20);
  }
  
  export function buildDependencyGraph(fileTree, fileContents) {
    const graph = {};
  
    Object.entries(fileContents).forEach(([filePath, content]) => {
      const imports = extractImports(content, filePath);
      graph[filePath] = imports;
    });
  
    return graph;
  }
  
  function extractImports(content, filePath) {
    const imports = [];
    const ext = filePath.split('.').pop();
  
    if (ext === 'js' || ext === 'jsx' || ext === 'ts' || ext === 'tsx') {
      const importRegex = /import\s+.*?\s+from\s+['"](.+?)['"]/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        imports.push(match[1]);
      }
    } else if (ext === 'py') {
      const importRegex = /(?:from\s+(\S+)\s+)?import\s+(.+)/g;
      let match;
      while ((match = importRegex.exec(content)) !== null) {
        imports.push(match[1] || match[2]);
      }
    }
  
    return imports;
  }
  
  export function findFileDependents(filePath, dependencyGraph) {
    const dependents = [];
  
    Object.entries(dependencyGraph).forEach(([file, imports]) => {
      if (imports.some(imp => imp.includes(filePath))) {
        dependents.push(file);
      }
    });
  
    return dependents;
  }