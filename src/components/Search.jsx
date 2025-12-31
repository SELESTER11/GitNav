import React, { useState } from 'react';
import { searchFiles } from '../utils/analyzer.js';

export default function Search({ fileTree, owner, repo }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);

  function handleSearch(e) {
    const value = e.target.value;
    setQuery(value);

    if (value.trim() === '') {
      setResults([]);
      return;
    }

    const searchResults = searchFiles(fileTree, value);
    setResults(searchResults);
  }

  function openFile(path) {
    const url = `https://github.com/${owner}/${repo}/blob/main/${path}`;
    window.open(url, '_blank');
  }

  return (
    <div className="section">
      <h3 className="section-title">Search Files</h3>
      
      <div className="search-container">
        <input
          type="text"
          className="search-input"
          placeholder="Search files..."
          value={query}
          onChange={handleSearch}
        />
      </div>

      {results.length > 0 && (
        <ul className="file-list">
          {results.map((file, index) => (
            <li key={index} className="file-item" onClick={() => openFile(file.path)}>
              <div className="file-name">{file.name}</div>
              <div className="file-path">{file.path}</div>
              <span className={`category-badge category-${file.category}`}>
                {file.category}
              </span>
            </li>
          ))}
        </ul>
      )}

      {query && results.length === 0 && (
        <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
          No files found matching "{query}"
        </div>
      )}
    </div>
  );
}