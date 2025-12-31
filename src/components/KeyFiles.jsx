import React from 'react';

export default function KeyFiles({ keyFiles, owner, repo }) {
  function openFile(path) {
    const url = `https://github.com/${owner}/${repo}/blob/main/${path}`;
    window.open(url, '_blank');
  }

  if (keyFiles.length === 0) {
    return null;
  }

  return (
    <div className="section">
      <h3 className="section-title">Key Files</h3>
      
      <ul className="file-list">
        {keyFiles.map((file, index) => (
          <li key={index} className="file-item" onClick={() => openFile(file.path)}>
            <div className="file-name">{file.name}</div>
            <div className="file-path">{file.path}</div>
            <span className="file-type">{file.type}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}