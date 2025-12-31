import React, { useState } from 'react';

export default function CodebaseMap({ categorizedFiles, owner, repo }) {
  const [expandedCategories, setExpandedCategories] = useState({
    frontend: false,
    backend: false,
    config: false,
    tests: false,
    docs: false
  });

  function toggleCategory(category) {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  }

  function openFile(path) {
    const url = `https://github.com/${owner}/${repo}/blob/main/${path}`;
    window.open(url, '_blank');
  }

  const categories = [
    { key: 'frontend', label: 'Frontend', files: categorizedFiles.frontend },
    { key: 'backend', label: 'Backend', files: categorizedFiles.backend },
    { key: 'config', label: 'Configuration', files: categorizedFiles.config },
    { key: 'tests', label: 'Tests', files: categorizedFiles.tests },
    { key: 'docs', label: 'Documentation', files: categorizedFiles.docs }
  ];

  return (
    <div className="section">
      <h3 className="section-title">Codebase Map</h3>
      
      <div className="file-tree">
        {categories.map(category => {
          if (category.files.length === 0) return null;

          return (
            <div key={category.key}>
              <div 
                className="tree-item folder" 
                onClick={() => toggleCategory(category.key)}
                style={{ fontWeight: '600', marginBottom: '8px' }}
              >
                <span>{expandedCategories[category.key] ? '▼' : '▶'}</span>
                <span style={{ marginLeft: '8px' }}>{category.label}</span>
                <span className={`category-badge category-${category.key}`}>
                  {category.files.length}
                </span>
              </div>

              {expandedCategories[category.key] && (
                <div className="tree-children">
                  {category.files.slice(0, 10).map((file, index) => (
                    <div 
                      key={index} 
                      className="tree-item file"
                      onClick={() => openFile(file.path)}
                    >
                      {file.path.split('/').pop()}
                    </div>
                  ))}
                  {category.files.length > 10 && (
                    <div className="tree-item file" style={{ fontStyle: 'italic' }}>
                      ... and {category.files.length - 10} more files
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}