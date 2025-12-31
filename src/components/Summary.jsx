import React, { useState } from 'react';
import { generateSummary } from '../utils/aiSummary.js';

export default function Summary({ repoData, fileTree }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleGenerateSummary() {
    setLoading(true);
    const result = await generateSummary(repoData, fileTree);
    setSummary(result);
    setLoading(false);
  }

  return (
    <div className="section">
      <h3 className="section-title">AI Summary</h3>
      
      {!summary && !loading && (
        <button className="btn-primary" onClick={handleGenerateSummary}>
          Generate Summary
        </button>
      )}

      {loading && (
        <div className="loading">
          <div className="spinner"></div>
          <span>Generating summary...</span>
        </div>
      )}

      {summary && (
        <div className="summary-box">
          <div className="summary-text">{summary}</div>
        </div>
      )}
    </div>
  );
}