import React, { useState, useEffect } from 'react';
import { fetchRepoTree, fetchRepoInfo } from '../utils/githubAPI.js';
import { categorizeFiles, buildFileTree, findKeyFiles } from '../utils/analyzer.js';
import Onboarding from './Onboarding.jsx';
import Search from './Search.jsx';
import CodebaseMap from './CodebaseMap.jsx';
import KeyFiles from './KeyFiles.jsx';

export default function Sidebar({ owner, repo }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [repoData, setRepoData] = useState(null);
  const [fileTree, setFileTree] = useState(null);
  const [categorizedFiles, setCategorizedFiles] = useState(null);
  const [keyFiles, setKeyFiles] = useState([]);

  useEffect(() => {
    loadRepoData();
  }, [owner, repo]);

  async function loadRepoData() {
    try {
      setLoading(true);
      setError(null);

      const [info, tree] = await Promise.all([
        fetchRepoInfo(owner, repo),
        fetchRepoTree(owner, repo)
      ]);

      const categories = categorizeFiles(tree);
      const builtTree = buildFileTree(tree);
      const keys = findKeyFiles(tree);

      setRepoData(info);
      setFileTree(tree);
      setCategorizedFiles(categories);
      setKeyFiles(keys);
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  function closeSidebar() {
    const sidebar = document.getElementById('codebase-navigator-sidebar');
    if (sidebar) sidebar.remove();
  }

  if (loading) {
    return (
      <div>
        <div className="sidebar-header">
          <h2 className="sidebar-title">Analyzing Repository</h2>
          <button className="close-btn" onClick={closeSidebar}>&times;</button>
        </div>
        <div className="loading">
          <div className="spinner"></div>
          <span>Loading codebase...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className="sidebar-header">
          <h2 className="sidebar-title">Error</h2>
          <button className="close-btn" onClick={closeSidebar}>&times;</button>
        </div>
        <div className="sidebar-content">
          <div className="error">
            Failed to load repository: {error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="sidebar-header">
        <h2 className="sidebar-title">{owner}/{repo}</h2>
        <button className="close-btn" onClick={closeSidebar}>&times;</button>
      </div>
      
      <div className="sidebar-content">
        <Onboarding 
          repoData={repoData} 
          keyFiles={keyFiles}
          fileTree={fileTree}
        />

        <Search 
          fileTree={fileTree}
          owner={owner}
          repo={repo}
        />

        <KeyFiles 
          keyFiles={keyFiles}
          owner={owner}
          repo={repo}
        />

        <CodebaseMap 
          categorizedFiles={categorizedFiles}
          owner={owner}
          repo={repo}
        />
      </div>
    </div>
  );
}
